// Faucet de TESTNET: dispensa EAV7 de teste para onboarding de devs. Usa o SDK para
// enviar de uma carteira-faucet, com cooldown por endereço e teto por pedido. NÃO deve
// rodar em mainnet (dispensaria supply real) — o bin exige EAV7_FAUCET_ENABLED=1.
export class FaucetService {
  // client: Eav7Client com a carteira-faucet; amount: quanto por pedido; cooldownMs:
  // intervalo mínimo entre pedidos do MESMO endereço. `now` é injetável para testes.
  constructor({ client, amount, cooldownMs = 60 * 60 * 1000, now = () => Date.now() }) {
    if (!client?.wallet) throw new Error('faucet exige um client com carteira');
    this.client = client;
    this.amount = BigInt(amount);
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.last = new Map(); // address -> timestamp do último saque
  }

  // Quanto falta (ms) até o endereço poder sacar de novo; 0 = liberado.
  cooldownLeft(address) {
    const prev = this.last.get(address);
    if (prev === undefined) return 0;
    return Math.max(0, this.cooldownMs - (this.now() - prev));
  }

  // Dispensa para `address` se fora do cooldown. Retorna { id } da tx, ou lança.
  async dispense(address) {
    const left = this.cooldownLeft(address);
    if (left > 0) throw new Error(`aguarde ${Math.ceil(left / 1000)}s antes do próximo pedido`);
    // reserva o slot ANTES do await para evitar corrida (dois pedidos simultâneos)
    this.last.set(address, this.now());
    try {
      return await this.client.transfer(address, this.amount);
    } catch (err) {
      this.last.delete(address); // falhou no envio → libera para tentar de novo
      throw err;
    }
  }

  // poda entradas antigas para o Map não crescer sem limite
  prune() {
    const cutoff = this.now() - this.cooldownMs;
    for (const [addr, t] of this.last) if (t < cutoff) this.last.delete(addr);
  }
}
