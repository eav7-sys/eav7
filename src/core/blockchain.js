import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { CHAIN } from '../config.js';
import { isValidHash } from '../crypto/hash.js';
import { walletAddress } from '../crypto/keys.js';
import { State } from './state.js';
import { verifyTransaction } from './transaction.js';
import { buildBlock, buildGenesisBlock, verifyBlockIntegrity } from './block.js';

export class Blockchain {
  #loading = false;

  constructor({ dataDir = null, expectedGenesisHash = null } = {}) {
    this.dataDir = dataDir;
    // Hash da gênese fixado (pin): ao entrar numa rede existente, o nó só adota
    // uma gênese cujo hash bata com este valor — impede que um peer malicioso
    // imponha sua própria gênese num nó que ainda não tem cadeia (trust-on-first-sync).
    this.expectedGenesisHash = expectedGenesisHash;
    this.blocks = [];
    this.state = new State();
    this.txIndex = new Map(); // txId -> altura do bloco
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.#loadFromDisk();
    }
  }

  get blocksFile() {
    return this.dataDir ? join(this.dataDir, 'blocks.jsonl') : null;
  }

  get chainFile() {
    return this.dataDir ? join(this.dataDir, 'chain.json') : null; // formato legado (migração)
  }

  get head() {
    return this.blocks[this.blocks.length - 1] ?? null;
  }

  get height() {
    return this.head ? this.head.height : -1;
  }

  hasGenesis() {
    return this.blocks.length > 0;
  }

  createGenesis({ address, timestamp = Date.now() }) {
    if (this.hasGenesis()) throw new Error('a cadeia já possui bloco gênese');
    const genesis = buildGenesisBlock({
      timestamp,
      balances: { [address]: (CHAIN.GENESIS_SUPPLY - CHAIN.GENESIS_STAKE).toString() },
      stakes: { [address]: CHAIN.GENESIS_STAKE.toString() },
      // O endereço da gênese é o relayer de ponte inicial autorizado. Em produção
      // este conjunto deve migrar para uma allowlist de M-de-N por governança.
      bridgeRelayers: [address],
    });
    this.adoptGenesis(genesis);
    return genesis;
  }

  adoptGenesis(block) {
    const err = verifyBlockIntegrity(block);
    if (err) throw new Error(`gênese inválida: ${err}`);
    if (block.height !== 0) throw new Error('bloco gênese deve ter altura 0');
    if (this.expectedGenesisHash && block.hash !== this.expectedGenesisHash) {
      throw new Error(`gênese não confere com o hash fixado (${this.expectedGenesisHash})`);
    }
    this.blocks = [block];
    this.state = new State();
    this.state.applyGenesis(block.genesis);
    this.txIndex = new Map();
    this.#rewriteAll();
  }

  slotFor(timestamp) {
    return Math.floor(timestamp / CHAIN.BLOCK_TIME_MS);
  }

  // Recompensa de bloco na altura dada, com halving periódico (emissão limitada).
  blockReward(height) {
    const halvings = Math.floor(height / CHAIN.HALVING_INTERVAL_BLOCKS);
    if (halvings >= 64) return 0n;
    return CHAIN.BLOCK_REWARD >> BigInt(halvings);
  }

  // DPoS round-robin: o produtor PRIMÁRIO do slot (rodízio determinístico).
  expectedProducer(timestamp) {
    const validators = this.state.validators();
    if (validators.length === 0) return null;
    return validators[this.slotFor(timestamp) % validators.length].address;
  }

  addBlock(block, { now = Date.now() } = {}) {
    if (!this.hasGenesis()) throw new Error('cadeia sem bloco gênese');
    const err = verifyBlockIntegrity(block);
    if (err) throw new Error(err);
    if (block.height !== this.head.height + 1) {
      throw new Error(`altura inválida (esperada ${this.head.height + 1}, recebida ${block.height})`);
    }
    if (block.previousHash !== this.head.hash) throw new Error('previousHash não aponta para a cabeça da cadeia');
    if (block.timestamp <= this.head.timestamp) throw new Error('timestamp do bloco não avança');

    // Um bloco por slot: o slot do bloco tem de ser estritamente maior que o do
    // head. Sem isto, um validador produziria centenas de blocos dentro do seu
    // slot (timestamps a 1 ms), inflando a emissão e monopolizando a cadeia.
    const headSlot = this.slotFor(this.head.timestamp);
    const blockSlot = this.slotFor(block.timestamp);
    if (blockSlot <= headSlot) throw new Error('slot já ocupado: no máximo um bloco por slot');
    if (block.transactions.length > CHAIN.MAX_TXS_PER_BLOCK) throw new Error('bloco excede o limite de transações');

    // Checagens de consenso sensíveis a TEMPO e a VERSÃO DA REGRA (slot futuro,
    // drift, produtor elegível). Puladas no replay do próprio disco (#loading):
    // esses blocos já foram validados quando aceitos, e re-aplicar a regra atual
    // a blocos antigos quebraria o replay após qualquer ajuste do rodízio. Blocos
    // novos (gossip ao vivo e sync de peers) continuam passando pela regra atual.
    if (!this.#loading) {
      // O slot do bloco não pode exceder o slot do relógio local (mais uma pequena
      // tolerância p/ skew de relógio + propagação).
      if (blockSlot > this.slotFor(now + CHAIN.SLOT_FUTURE_TOLERANCE_MS)) throw new Error('bloco pertence a um slot futuro');
      if (block.timestamp > now + CHAIN.MAX_CLOCK_DRIFT_MS) throw new Error('timestamp do bloco está no futuro');
      // O produtor precisa ser um VALIDADOR ATIVO. Não exigimos que seja o produtor
      // exato do slot: combinado com "um bloco por slot" + fork-choice pela cadeia
      // MAIS LONGA, um validador bizantino não consegue uma cadeia mais longa que a
      // honesta (ambas limitadas a 1 bloco/slot), então não há ganho em roubar slot.
      // Isso também mantém válidos blocos de backup históricos (sem hard-fork de altura).
      const validators = this.state.validators();
      if (validators.length === 0) throw new Error('nenhum validador ativo na rede');
      if (block.height >= CHAIN.STRICT_PRODUCER_HEIGHT) {
        // ESTRITO: só o produtor escalado do slot (round-robin). Sem isto, um
        // validador bizantino produziria fora de turno e, com os buracos deixados
        // por validadores honestos offline, forjaria a cadeia mais longa (C1).
        const expected = this.expectedProducer(block.timestamp);
        if (block.producer !== expected) {
          throw new Error(`produtor fora do slot (esperado ${expected}, recebido ${block.producer})`);
        }
      } else if (!validators.some((v) => v.address === block.producer)) {
        // blocos ANTES do fork: grandfathered (só exige ser validador ativo)
        throw new Error(`produtor não é um validador ativo (${block.producer})`);
      }
    }

    const sim = this.state.clone();
    let fees = 0n;
    const seen = new Set();
    for (const tx of block.transactions) {
      const txErr = verifyTransaction(tx);
      if (txErr) throw new Error(`transação ${tx?.id ?? '?'} inválida: ${txErr}`);
      if (seen.has(tx.id) || this.txIndex.has(tx.id)) throw new Error(`transação duplicada: ${tx.id}`);
      seen.add(tx.id);
      fees += sim.applyTransaction(tx, block.height, block.timestamp);
    }
    const reward = this.blockReward(block.height);
    sim.credit(block.producer, reward + fees);
    sim.totalMinted += reward; // contabiliza a emissão (para o supply real) — M1

    this.state = sim;
    this.blocks.push(block);
    for (const tx of block.transactions) this.txIndex.set(tx.id, block.height);
    this.#appendBlock(block);
    return block;
  }

  produceBlock(wallet, transactions = [], { timestamp = Date.now() } = {}) {
    if (!this.hasGenesis()) throw new Error('cadeia sem bloco gênese');
    const producer = walletAddress(wallet);
    const expected = this.expectedProducer(timestamp);
    if (expected !== producer) {
      throw new Error(`slot pertence a ${expected ?? 'ninguém'}, não a ${producer}`);
    }
    const block = buildBlock(wallet, {
      height: this.head.height + 1,
      previousHash: this.head.hash,
      timestamp,
      transactions,
    });
    // Valida o próprio bloco contra o relógio real (não contra o timestamp do
    // bloco), para que as checagens de slot-futuro e drift não fiquem nulas.
    return this.addBlock(block, { now: Date.now() });
  }

  getBlock(ref) {
    if (typeof ref === 'string' && isValidHash(ref)) {
      return this.blocks.find((b) => b.hash === ref) ?? null;
    }
    const height = Number(ref);
    if (Number.isSafeInteger(height) && height >= 0) return this.blocks[height] ?? null;
    return null;
  }

  getTransaction(id) {
    const height = this.txIndex.get(id);
    if (height === undefined) return null;
    const tx = this.blocks[height].transactions.find((t) => t.id === id);
    return tx ? { tx, blockHeight: height, blockHash: this.blocks[height].hash } : null;
  }

  // Fork choice: adota a cadeia válida mais longa com a mesma gênese. Como a
  // regra de "um bloco por slot" (addBlock) limita o número de blocos ao número
  // de slots decorridos, ninguém consegue fabricar uma cadeia artificialmente
  // mais longa. (Produção: evoluir para peso de stake acumulado / finalidade.)
  // Retorna false se não substituiu, ou o array de transações órfãs (dos blocos
  // descartados que não estão na nova cadeia) para o chamador reinserir no
  // mempool — sem isto, uma reorganização descartava txs confirmadas para sempre.
  replaceChain(rawBlocks, { now = Date.now() } = {}) {
    if (!Array.isArray(rawBlocks) || rawBlocks.length <= this.blocks.length) return false;
    if (this.hasGenesis() && rawBlocks[0]?.hash !== this.blocks[0].hash) {
      throw new Error('gênese divergente: a cadeia recebida pertence a outra rede');
    }
    // FINALIDADE (correção C-1): uma vez que a cadeia PASSOU de STRICT_PRODUCER_HEIGHT,
    // os blocos até esse ponto (a janela de grandfathering, de validação fraca) ficam
    // imutáveis — um reorg não pode substituí-los. Sem isto, um validador bizantino
    // forjaria uma cadeia mais densa naquela janela e a rede a adotaria. Como cada hash
    // encadeia o anterior, bater no bloco STRICT garante que 0..STRICT são idênticos.
    // Só vale depois de STRICT (cadeias novas/testes reorganizam normalmente).
    const fin = CHAIN.STRICT_PRODUCER_HEIGHT;
    if (fin > 0 && this.height >= fin && rawBlocks[fin]?.hash !== this.blocks[fin]?.hash) {
      throw new Error('reorg rejeitado: tentaria substituir histórico finalizado (< STRICT_PRODUCER_HEIGHT)');
    }
    const candidate = new Blockchain({ expectedGenesisHash: this.expectedGenesisHash });
    candidate.adoptGenesis(rawBlocks[0]);
    for (const block of rawBlocks.slice(1)) candidate.addBlock(block, { now });
    if (candidate.height <= this.height) return false;

    const orphans = [];
    for (const block of this.blocks) {
      for (const tx of block.transactions) {
        if (!candidate.txIndex.has(tx.id)) orphans.push(tx);
      }
    }
    this.blocks = candidate.blocks;
    this.state = candidate.state;
    this.txIndex = candidate.txIndex;
    this.#rewriteAll(); // reorg: reescreve o arquivo inteiro (evento raro)
    return orphans;
  }

  #loadFromDisk() {
    let migrated = false;
    this.#loading = true;
    try {
      if (existsSync(this.blocksFile)) {
        // Formato incremental (uma linha JSON por bloco). Lê como BUFFER e processa
        // linha a linha — o arquivo cresce sem limite e passa dos ~512MB do limite de
        // string do Node, então NUNCA materializar o arquivo inteiro numa string só.
        const buf = readFileSync(this.blocksFile);
        let start = 0;
        let first = true;
        const handle = (from, to) => {
          if (to <= from) return;
          const line = buf.toString('utf8', from, to).trim();
          if (!line) return;
          const block = JSON.parse(line);
          if (first) { this.adoptGenesis(block); first = false; } else this.addBlock(block);
        };
        let nl;
        while ((nl = buf.indexOf(10, start)) !== -1) { handle(start, nl); start = nl + 1; } // 10 = '\n'
        handle(start, buf.length);
        if (first) return; // arquivo vazio
      } else if (existsSync(this.chainFile)) {
        // migração do formato legado (array único) para incremental
        const raw = JSON.parse(readFileSync(this.chainFile, 'utf8'));
        if (!Array.isArray(raw) || raw.length === 0) return;
        this.adoptGenesis(raw[0]);
        for (const block of raw.slice(1)) this.addBlock(block);
        migrated = true;
      }
    } finally {
      this.#loading = false;
    }
    if (migrated && this.hasGenesis()) {
      this.#rewriteAll(); // grava o novo formato
      try { renameSync(this.chainFile, this.chainFile + '.legacy'); } catch { /* ok */ }
    }
  }

  // Append de um único bloco (custo O(1) por bloco, em vez de reescrever tudo).
  #appendBlock(block) {
    if (!this.blocksFile || this.#loading) return;
    appendFileSync(this.blocksFile, JSON.stringify(block) + '\n');
  }

  // Reescrita completa (só na gênese, migração e reorg — eventos raros).
  #rewriteAll() {
    if (!this.blocksFile || this.#loading) return;
    const tmp = this.blocksFile + '.tmp';
    writeFileSync(tmp, this.blocks.map((b) => JSON.stringify(b)).join('\n') + (this.blocks.length ? '\n' : ''));
    renameSync(tmp, this.blocksFile);
  }
}
