// Worker de oráculo de IA — processo off-chain que observa a rede EAV7,
// executa tarefas AI_TASK pendentes e publica AI_RESULT assinado.
//
// O handler é plugável: por padrão usa a API da Anthropic quando
// ANTHROPIC_API_KEY está definida; caso contrário responde com um eco local
// (útil para desenvolvimento e testes sem rede).
import { CHAIN, formatEav7 } from '../config.js';
import { walletAddress } from '../crypto/keys.js';
import { buildAiResultTx, buildOracleRegisterTx } from './bridge.js';

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

export async function defaultHandler(task) {
  if (process.env.ANTHROPIC_API_KEY) return claudeHandler(task);
  return `[oráculo-local EAV7] resposta simulada para a tarefa ${task.id.slice(0, 12)}…: ${task.prompt.slice(0, 500)}`;
}

async function claudeHandler(task) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: task.model || DEFAULT_CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: task.prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`API da Anthropic respondeu ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  return body.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export class AiOracleWorker {
  constructor({ nodeUrl, wallet, handler = defaultHandler, pollMs = 2000, log = console.log }) {
    this.nodeUrl = nodeUrl.replace(/\/$/, '');
    this.wallet = wallet;
    this.address = walletAddress(wallet);
    this.handler = handler;
    this.pollMs = pollMs;
    this.log = log;
    this.submitted = new Set(); // tarefas com resultado já enviado (aguardando inclusão)
    this.nextNonce = null;
    this.timer = null;
    this.sendChain = Promise.resolve(); // serializa reserva de nonce + submit
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

  // Serializa reserva-de-nonce + submissão numa única fila. Em QUALQUER erro
  // (inclusive timeout/rede) o nonce é ressincronizado; a reserva usa o nonce
  // ciente do mempool (nextNonce da API) para não colidir com txs pendentes.
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
        this.nextNonce = null;
        throw err;
      }
    });
    this.sendChain = run.then(() => {}, () => {});
    return run;
  }

  async ensureRegistered() {
    const oracles = await this.#getJson('/ai/oracles');
    if (oracles.some((oracle) => oracle.address === this.address)) return;
    const account = await this.#getJson(`/address/${this.address}`);
    const cost = CHAIN.MIN_ORACLE_STAKE + CHAIN.FEES.ORACLE_REGISTER;
    if (BigInt(account.balance) < cost) {
      throw new Error(
        `carteira do oráculo precisa de ${formatEav7(cost)} ${CHAIN.SYMBOL} para registro (saldo: ${formatEav7(BigInt(account.balance))})`,
      );
    }
    const tx = await this.#send((nonce) =>
      buildOracleRegisterTx(this.wallet, { stake: CHAIN.MIN_ORACLE_STAKE, nonce }),
    );
    this.log(`[oráculo] registro enviado (${tx.id})`);
  }

  async tick() {
    const tasks = await this.#getJson('/ai/tasks?status=PENDING');
    for (const task of tasks) {
      // Só processa tarefas designadas a este oráculo (o solicitante o escolheu).
      if (task.assignedOracle !== this.address) continue;
      if (this.submitted.has(task.id)) continue;
      this.submitted.add(task.id);
      try {
        this.log(`[oráculo] executando tarefa ${task.id.slice(0, 16)}…`);
        const output = await this.handler(task);
        const tx = await this.#send((nonce) => buildAiResultTx(this.wallet, { taskId: task.id, output, nonce }));
        this.log(`[oráculo] resultado publicado para ${task.id.slice(0, 16)}… (tx ${tx.id.slice(0, 16)}…)`);
      } catch (err) {
        this.submitted.delete(task.id); // permite nova tentativa no próximo ciclo
        this.log(`[oráculo] falha na tarefa ${task.id.slice(0, 16)}…: ${err.message}`);
      }
    }
  }

  async start() {
    await this.ensureRegistered();
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log(`[oráculo] erro no ciclo: ${err.message}`));
    }, this.pollMs);
    this.log(`[oráculo] ativo em ${this.nodeUrl} como ${this.address}`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
