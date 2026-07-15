import { CHAIN } from '../config.js';

export class Mempool {
  constructor() {
    this.txs = new Map(); // id -> tx
  }

  get size() {
    return this.txs.size;
  }

  has(id) {
    return this.txs.has(id);
  }

  all() {
    return [...this.txs.values()];
  }

  add(tx) {
    if (this.txs.has(tx.id)) return false;
    this.txs.set(tx.id, tx);
    return true;
  }

  remove(ids) {
    for (const id of ids) this.txs.delete(id);
  }

  // Remove transações cujo nonce já foi consumido no estado (incluídas ou obsoletas).
  prune(state) {
    for (const [id, tx] of this.txs) {
      const nonce = state.accounts[tx.from]?.nonce ?? 0;
      if (tx.nonce <= nonce) this.txs.delete(id);
    }
  }

  // Seleciona um conjunto executável de transações simulando-as num clone do
  // estado — respeita ordem de nonce por remetente e descarta as inválidas.
  selectExecutable(state, height = 0, blockTs = 0, max = CHAIN.MAX_TXS_PER_BLOCK) {
    const sim = state.clone();
    const pending = this.all().sort((a, b) => a.nonce - b.nonce || a.timestamp - b.timestamp);
    const selected = [];
    const picked = new Set();
    const stale = [];

    let progress = true;
    while (progress && selected.length < max) {
      progress = false;
      for (const tx of pending) {
        if (selected.length >= max) break;
        if (picked.has(tx.id)) continue;
        try {
          sim.applyTransaction(tx, height, blockTs);
          selected.push(tx);
          picked.add(tx.id);
          progress = true;
        } catch { /* pode ser nonce-futuro (espera as anteriores) — decide na varredura final */ }
      }
    }

    // Após a convergência (sem mais progresso), qualquer tx NÃO escolhida cujo nonce seja
    // <= próximo-esperado é PERMANENTEMENTE inválida neste ponto (nonce já consumido, ou é
    // o próximo esperado e falhou fundo no handler). Poda — senão uma tx cripto-cara que
    // sempre lança (prova/slash/bridge inválidos) re-executaria a cada bloco, de graça (DoS).
    for (const tx of pending) {
      if (picked.has(tx.id)) continue;
      if (tx.nonce <= (sim.accounts[tx.from]?.nonce ?? 0) + 1) stale.push(tx.id);
    }

    this.remove(stale);
    return selected;
  }
}
