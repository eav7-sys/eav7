// Gateway de interoperabilidade da EAV7 — conecta a rede a outras blockchains.
//
// Modelo lock-and-release:
//   • BRIDGE_OUT (on-chain) trava EAV7/token EAV20 e registra a transferência
//     com a cadeia e o endereço de destino. O relayer observa e paga lá fora.
//   • BRIDGE_IN (on-chain) é assinada por um relayer registrado (mesmo stake de
//     oráculo) e libera fundos travados para um endereço E7, referenciando a
//     hash da transação na cadeia de origem.
//
// Cada blockchain externa é plugada por um ChainAdapter:
//   {
//     chain: 'TRON' | 'ETH' | 'BTC' | ...,
//     async payout(transfer)          -> paga transfer.amount em transfer.targetAddress
//     watchDeposits(onDeposit)        -> chama onDeposit({ sourceTxHash, to, amount, token })
//                                        quando alguém deposita para a EAV7 lá fora
//   }
import { walletAddress } from '../crypto/keys.js';
import { buildTransaction } from '../core/transaction.js';
import { buildBridgeSettleTx } from '../ai/bridge.js';

export class BridgeRelayer {
  constructor({ nodeUrl, wallet, adapters = [], pollMs = 3000, log = console.log }) {
    this.nodeUrl = nodeUrl.replace(/\/$/, '');
    this.wallet = wallet;
    this.address = walletAddress(wallet);
    this.adapters = new Map(adapters.map((a) => [a.chain.toUpperCase(), a]));
    this.pollMs = pollMs;
    this.log = log;
    this.nextNonce = null;
    this.sendChain = Promise.resolve(); // serializa nonce + submit
    this.settling = new Set(); // transferId em processamento (evita pagamento duplo)
    this.ticking = false; // evita reentrância de ticks
    this.timer = null;
  }

  async #getJson(path) {
    const response = await fetch(this.nodeUrl + path, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${path} respondeu ${response.status}`);
    return response.json();
  }

  async #submitTx(tx) {
    const response = await fetch(this.nodeUrl + '/tx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tx),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `nó respondeu ${response.status}`);
    return body;
  }

  // Serializa reserva-de-nonce + submissão. Em QUALQUER erro (inclusive
  // timeout/rede), o nonce é ressincronizado; a reserva considera o mempool
  // (nextNonce da API) para não reusar um nonce de tx pendente.
  #send(buildTx) {
    const run = this.sendChain.then(async () => {
      try {
        if (this.nextNonce === null) {
          const account = await this.#getJson(`/address/${this.address}`);
          this.nextNonce = account.nextNonce ?? account.nonce + 1;
        }
        const tx = buildTx(this.nextNonce);
        await this.#submitTx(tx);
        this.nextNonce += 1;
        return tx;
      } catch (err) {
        this.nextNonce = null; // ressincroniza no próximo envio
        throw err;
      }
    });
    this.sendChain = run.then(() => {}, () => {});
    return run;
  }

  // Deposito confirmado numa cadeia externa -> libera na EAV7 via BRIDGE_IN.
  async releaseInbound(sourceChain, { sourceTxHash, to, amount, token = null }) {
    const tx = await this.#send((nonce) =>
      buildTransaction(this.wallet, {
        type: 'BRIDGE_IN',
        to,
        amount,
        nonce,
        data: { sourceChain, sourceTxHash, token },
      }),
    );
    this.log(`[ponte] BRIDGE_IN de ${sourceChain} liberado para ${to} (tx ${tx.id.slice(0, 16)}…)`);
    return tx;
  }

  async tick() {
    if (this.ticking) return; // não reentrar enquanto um tick anterior roda
    this.ticking = true;
    try {
      // Só pega transferências ainda travadas (status LOCKED). Entre pagar na
      // cadeia externa e o BRIDGE_SETTLE ser minerado, a transferência continua
      // LOCKED — por isso o Set `settling` impede um segundo payout do MESMO
      // transferId (o pagamento externo NÃO é idempotente).
      const transfers = await this.#getJson('/bridge/transfers?direction=OUT&status=LOCKED');
      for (const transfer of transfers) {
        if (this.settling.has(transfer.id)) continue;
        const adapter = this.adapters.get(transfer.targetChain);
        if (!adapter) continue; // cadeia sem adapter plugado neste relayer
        this.settling.add(transfer.id); // marca ANTES do payout
        try {
          const receipt = await adapter.payout(transfer);
          await this.#send((nonce) =>
            buildBridgeSettleTx(this.wallet, {
              transferId: transfer.id,
              externalTxHash: receipt?.externalTxHash ?? null,
              nonce,
            }),
          );
          this.log(`[ponte] payout de ${transfer.amount} e7 em ${transfer.targetChain} para ${transfer.targetAddress} (liquidado on-chain)`);
        } catch (err) {
          this.settling.delete(transfer.id); // permite nova tentativa se o payout falhou
          this.log(`[ponte] falha no payout ${transfer.id.slice(0, 16)}…: ${err.message}`);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async start() {
    for (const adapter of this.adapters.values()) {
      adapter.watchDeposits?.((deposit) => {
        this.releaseInbound(adapter.chain, deposit).catch((err) =>
          this.log(`[ponte] falha ao liberar depósito de ${adapter.chain}: ${err.message}`),
        );
      });
    }
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log(`[ponte] erro no ciclo: ${err.message}`));
    }, this.pollMs);
    this.log(`[ponte] relayer ativo em ${this.nodeUrl} (cadeias: ${[...this.adapters.keys()].join(', ') || 'nenhuma'})`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// Adapter de demonstração: simula uma cadeia externa em memória. Todo payout
// (saída da EAV7) gera, segundos depois, um depósito equivalente de volta —
// útil para testar o ciclo completo BRIDGE_OUT -> payout -> depósito -> BRIDGE_IN.
export class LoopbackAdapter {
  constructor({ chain = 'LOOPBACK', echoBack = false, delayMs = 2000 } = {}) {
    this.chain = chain;
    this.echoBack = echoBack;
    this.delayMs = delayMs;
    this.listeners = [];
    this.payouts = [];
  }

  watchDeposits(onDeposit) {
    this.listeners.push(onDeposit);
  }

  simulateDeposit(deposit) {
    for (const listener of this.listeners) listener(deposit);
  }

  async payout(transfer) {
    this.payouts.push(transfer);
    if (this.echoBack) {
      setTimeout(() => {
        this.simulateDeposit({
          sourceTxHash: `${this.chain}-${transfer.id.slice(0, 20)}`,
          to: transfer.from,
          amount: transfer.amount,
          token: transfer.token,
        });
      }, this.delayMs);
    }
  }
}
