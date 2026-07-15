import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CHAIN } from '../config.js';
import { isValidHash } from '../crypto/hash.js';
import { walletAddress } from '../crypto/keys.js';
import { State } from './state.js';
import { verifyTransaction } from './transaction.js';
import { buildBlock, buildGenesisBlock, verifyBlockIntegrity } from './block.js';
import { BlockStore } from './blockstore.js';
import { computeStateRoot } from './stateroot.js';

// Serialização do snapshot: BigInt vira { $big: "…" } (marcador sem colisão com
// strings legítimas do estado) e o reviver restaura. Maps são convertidos a
// arrays de entradas antes do stringify.
const bigReplacer = (_, v) => (typeof v === 'bigint' ? { $big: v.toString() } : v);
const bigReviver = (_, v) =>
  v && typeof v === 'object' && typeof v.$big === 'string' && Object.keys(v).length === 1 ? BigInt(v.$big) : v;

// Chaves que, atribuídas a um objeto, reescreveriam seu protótipo/constructor.
// JSON.parse cria `__proto__` como propriedade PRÓPRIA enumerável; um
// Object.assign a copiaria via [[Set]], trocando o protótipo da instância State
// (métodos somem → crash no boot). Copiamos campo a campo pulando essas chaves.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const reviveState = (obj) => {
  if (!obj) return null;
  const s = new State();
  for (const k of Object.keys(obj)) {
    if (UNSAFE_KEYS.has(k)) continue;
    s[k] = obj[k];
  }
  return s;
};

// Autenticação OPCIONAL do snapshot: se EAV7_SNAPSHOT_KEY estiver setada (segredo
// do operador, mantido FORA do dataDir), o snapshot é selado com um HMAC. No boot,
// um snapshot sem HMAC válido é descartado e cai no replay completo — fecha o vetor
// de "quem escreve no dataDir injeta saldos/validadores via snapshot.json" (achado
// C2). Sem a chave, mantém o comportamento anterior (otimização não autenticada).
const SNAPSHOT_KEY = process.env.EAV7_SNAPSHOT_KEY || null;
const snapshotMac = (body) => createHmac('sha256', SNAPSHOT_KEY).update(body).digest();

// Janela de blocos mantida em RAM (contígua até o head). Precisa cobrir a
// REORG_WINDOW do p2p (o ancestral comum de qualquer reorg cai dentro dela).
// Lida dinamicamente para os testes poderem encolher a janela (TAIL_BLOCKS).
const tailLimit = () => CHAIN.TAIL_BLOCKS ?? CHAIN.REORG_WINDOW + 100;

// A RAM é proporcional ao ESTADO + janela recente, não à idade da cadeia:
// blocos antigos vivem só no disco (BlockStore) e o boot parte de um snapshot
// de estado + replay do rabo — nunca mais replay desde a gênese.
export class Blockchain {
  #loading = false;
  #lastSnapshotHeight = -1;

  constructor({ dataDir = null, expectedGenesisHash = null } = {}) {
    this.dataDir = dataDir;
    // Hash da gênese fixado (pin): ao entrar numa rede existente, o nó só adota
    // uma gênese cujo hash bata com este valor — impede que um peer malicioso
    // imponha sua própria gênese num nó que ainda não tem cadeia (trust-on-first-sync).
    this.expectedGenesisHash = expectedGenesisHash;
    this.tail = []; // janela recente de blocos em RAM (tail[i] = altura tailStart+i)
    this.tailStart = 0; // altura de tail[0]
    this.baseState = null; // estado APÓS o bloco (tailStart-1) — âncora para reorgs
    this.state = new State();
    this.hashes = []; // altura -> hash do bloco (cadeia inteira; ~70B por bloco)
    this.hashIndex = new Map(); // hash -> altura
    this.txIndex = new Map(); // txId -> altura do bloco
    this.addressTxIndex = new Map(); // endereço -> [alturas de blocos com tx desse endereço] (asc)
    this.blocksWithTxs = []; // alturas (asc) de blocos que contêm ≥1 transação (feed global de txs)
    this.logIndex = []; // #33: eventos EAVM (ring buffer node-local, NÃO-consenso) para /logs
    this.store = null;
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.store = new BlockStore(join(dataDir, 'blocks.jsonl'));
      this.#loadFromDisk();
    }
  }

  get blocksFile() {
    return this.dataDir ? join(this.dataDir, 'blocks.jsonl') : null;
  }

  get chainFile() {
    return this.dataDir ? join(this.dataDir, 'chain.json') : null; // formato legado (migração)
  }

  get snapshotFile() {
    return this.dataDir ? join(this.dataDir, 'snapshot.json') : null;
  }

  get head() {
    return this.tail[this.tail.length - 1] ?? null;
  }

  get height() {
    return this.head ? this.head.height : -1;
  }

  hasGenesis() {
    return this.tail.length > 0;
  }

  hashAt(height) {
    return this.hashes[height] ?? null;
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
    this.tail = [block];
    this.tailStart = 0;
    this.baseState = null;
    this.state = new State();
    this.state.applyGenesis(block.genesis);
    this.hashes = [block.hash];
    this.hashIndex = new Map([[block.hash, 0]]);
    this.txIndex = new Map();
    this.addressTxIndex = new Map();
    this.blocksWithTxs = [];
    if (this.store && !this.#loading) {
      this.store.reset([block]);
      if (this.snapshotFile) rmSync(this.snapshotFile, { force: true }); // snapshot antigo é de outra cadeia
      this.#lastSnapshotHeight = -1;
    }
  }

  slotFor(timestamp) {
    return Math.floor(timestamp / CHAIN.BLOCK_TIME_MS);
  }

  // Recompensa de bloco na altura dada, com halving periódico (emissão limitada).
  // Recompensa de bloco: base governável (#9) com halving (#M1). Lê o parâmetro do
  // ESTADO sendo aplicado (não do global) para o replay/reorg ser determinístico.
  blockReward(height, state = this.state) {
    const base = state?.param ? state.param('BLOCK_REWARD') : CHAIN.BLOCK_REWARD;
    const halvings = Math.floor(height / CHAIN.HALVING_INTERVAL_BLOCKS);
    if (halvings >= 64) return 0n;
    return base >> BigInt(halvings);
  }

  // DPoS round-robin: o produtor PRIMÁRIO do slot (rodízio determinístico).
  expectedProducer(timestamp) {
    const validators = this.state.validators();
    if (validators.length === 0) return null;
    return validators[this.slotFor(timestamp) % validators.length].address;
  }

  addBlock(block, { now = Date.now(), presim = null } = {}) {
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

    // Aplica o bloco a um estado clonado — A MENOS que produceBlock já tenha aplicado e
    // passado `presim` (evita clonar + aplicar + computar a raiz DUAS vezes no produtor).
    let sim, blockLogs;
    if (presim) { sim = presim.sim; blockLogs = presim.logs; }
    else { sim = this.state.clone(); blockLogs = []; this.#simulate(sim, block, blockLogs); }

    // #1: acima do fork, o header commita o stateRoot (Merkle do estado APÓS o bloco).
    // Recalculamos do estado simulado e exigimos igualdade — qualquer divergência de
    // saldo/stake/ponte/contrato entre nós é detectada aqui (hoje o consenso não valida
    // estado). Roda inclusive no replay de disco: é a checagem que pega corrupção.
    // Com presim (produceBlock), a raiz já foi computada do MESMO sim → não recomputa.
    if (!presim && block.height >= CHAIN.STATEROOT_HEIGHT) {
      const computed = computeStateRoot(sim);
      if (computed !== block.stateRoot) {
        throw new Error(`stateRoot não confere (esperado ${computed}, recebido ${block.stateRoot})`);
      }
    }

    // Disco ANTES da memória: se o append falhar, o bloco é rejeitado inteiro —
    // memória e disco nunca divergem (uma divergência aqui já produziu lacuna
    // no blocks.jsonl em produção, com o nó avançando só em RAM sob pressão).
    this.#appendBlock(block);
    this.state = sim;
    this.tail.push(block);
    this.hashes.push(block.hash);
    this.hashIndex.set(block.hash, block.height);
    for (const tx of block.transactions) this.txIndex.set(tx.id, block.height);
    this.#indexAddressTxs(block);
    if (blockLogs.length) { // #33: índice node-local de logs (ring buffer)
      this.logIndex.push(...blockLogs);
      if (this.logIndex.length > CHAIN.MAX_LOG_INDEX) this.logIndex.splice(0, this.logIndex.length - CHAIN.MAX_LOG_INDEX);
    }
    this.#slideTail();
    this.#maybeSnapshot();
    return block;
  }

  // Caminho ÚNICO de aplicação de um bloco a um estado clonado `sim`: valida cada tx,
  // deduplica, aplica, credita a recompensa (comissão + eleitores) e roda o tick. Coleta
  // os eventos EAVM em `blockLogs`. Usado por addBlock e por produceBlock.
  #simulate(sim, block, blockLogs) {
    let fees = 0n;
    const seen = new Set();
    for (const tx of block.transactions) {
      const txErr = verifyTransaction(tx);
      if (txErr) throw new Error(`transação ${tx?.id ?? '?'} inválida: ${txErr}`);
      if (seen.has(tx.id) || this.txIndex.has(tx.id)) throw new Error(`transação duplicada: ${tx.id}`);
      seen.add(tx.id);
      fees += sim.applyTransaction(tx, block.height, block.timestamp, blockLogs ? (lg) => blockLogs.push({ ...lg, blockHeight: block.height }) : null);
    }
    const reward = this.blockReward(block.height, sim);
    sim.distributeBlockReward(block.producer, reward + fees); // comissão + partilha c/ eleitores
    sim.totalMinted += reward; // contabiliza a emissão (para o supply real) — M1
    sim.blockTick(block.height); // aplica governança madura + poda estado (por bloco)
  }

  // Re-executa um bloco JÁ VALIDADO sobre um estado (sem clone, sem verificação):
  // usado para avançar o baseState quando a janela desliza e para reconstruir o
  // estado no ponto de fork num reorg. Determinístico — mesma sequência do addBlock.
  #applyBlockTo(state, block) {
    let fees = 0n;
    for (const tx of block.transactions) fees += state.applyTransaction(tx, block.height, block.timestamp);
    const reward = this.blockReward(block.height, state);
    state.distributeBlockReward(block.producer, reward + fees);
    state.totalMinted += reward;
    state.blockTick(block.height);
  }

  // Desliza a janela: expulsa blocos antigos da RAM (continuam no disco) e avança
  // o baseState aplicando cada bloco expulso. Sem store (cadeia só em memória,
  // testes/candidatos de reorg) mantém tudo em RAM.
  #slideTail() {
    if (!this.store) return;
    const limit = tailLimit();
    while (this.tail.length > limit) {
      const evicted = this.tail.shift();
      if (evicted.height === 0) {
        const s = new State();
        s.applyGenesis(evicted.genesis);
        this.baseState = s;
      } else {
        this.#applyBlockTo(this.baseState, evicted);
      }
      this.tailStart = evicted.height + 1;
    }
  }

  // Índice de transações por endereço: registra a altura do bloco para cada endereço
  // (from/to) tocado. Permite listar TODAS as txs de uma carteira sem varrer a cadeia.
  #indexAddressTxs(block) {
    if (block.transactions.length > 0) this.blocksWithTxs.push(block.height);
    for (const tx of block.transactions) {
      for (const a of [tx.from, tx.to]) {
        if (!a) continue;
        let arr = this.addressTxIndex.get(a);
        if (!arr) { arr = []; this.addressTxIndex.set(a, arr); }
        if (arr[arr.length - 1] !== block.height) arr.push(block.height);
      }
    }
  }

  produceBlock(wallet, transactions = [], { timestamp = Date.now() } = {}) {
    if (!this.hasGenesis()) throw new Error('cadeia sem bloco gênese');
    const producer = walletAddress(wallet);
    const expected = this.expectedProducer(timestamp);
    if (expected !== producer) {
      throw new Error(`slot pertence a ${expected ?? 'ninguém'}, não a ${producer}`);
    }
    const height = this.head.height + 1;
    // Aplica UMA vez: obtém o stateRoot pós-estado para o header e REUSA o mesmo `sim`
    // no addBlock (via presim), em vez de clonar+aplicar+computar a raiz duas vezes.
    const sim = this.state.clone();
    const blockLogs = [];
    this.#simulate(sim, { height, producer, timestamp, transactions }, blockLogs);
    const stateRoot = height >= CHAIN.STATEROOT_HEIGHT ? computeStateRoot(sim) : null;
    const block = buildBlock(wallet, { height, previousHash: this.head.hash, timestamp, transactions, stateRoot });
    // Valida o próprio bloco contra o relógio real (slot-futuro/drift) e commita o `sim` já pronto.
    return this.addBlock(block, { now: Date.now(), presim: { sim, logs: blockLogs } });
  }

  getBlock(ref) {
    if (typeof ref === 'string' && isValidHash(ref)) {
      const h = this.hashIndex.get(ref);
      return h === undefined ? null : this.getBlock(h);
    }
    const height = Number(ref);
    if (!Number.isSafeInteger(height) || height < 0 || height > this.height) return null;
    if (height >= this.tailStart) return this.tail[height - this.tailStart] ?? null;
    return this.store ? this.store.get(height) : null;
  }

  // Faixa contígua de blocos [from, from+limit) — da RAM ou do disco.
  getRange(from, limit) {
    const start = Math.max(0, Number(from) || 0);
    const end = Math.min(start + Math.max(0, limit) - 1, this.height);
    const out = [];
    for (let h = start; h <= end; h++) {
      const b = this.getBlock(h);
      if (b) out.push(b);
    }
    return out;
  }

  getTransaction(id) {
    const height = this.txIndex.get(id);
    if (height === undefined) return null;
    const block = this.getBlock(height);
    const tx = block?.transactions.find((t) => t.id === id);
    return tx ? { tx, blockHeight: height, blockHash: block.hash } : null;
  }

  // Finalidade BFT (#2): maior altura FINALIZADA — aquela sobre a qual >= 2/3+1
  // validadores DISTINTOS já produziram. Determinística da cadeia (produtores estão
  // nos blocos), sem subprotocolo de votos. Um reorg não pode reverter abaixo disto.
  // Retorna -1 (sem finalidade) quando há poucos validadores para garantia BFT.
  finalizedHeight() {
    const N = this.state.validators().length;
    if (N < CHAIN.FINALITY_MIN_VALIDATORS) return -1;
    const quorum = Math.floor((2 * N) / 3) + 1;
    const producers = new Set();
    for (let h = this.height; h >= Math.max(1, this.tailStart); h--) {
      const b = this.getBlock(h);
      if (!b) break;
      producers.add(b.producer);
      if (producers.size >= quorum) return h - 1; // [h, head] tem quórum → h-1 é final
    }
    return -1;
  }

  // Fork choice a partir de um ANCESTRAL COMUM: valida e aplica o novo rabo sobre
  // o estado reconstruído no fork (dentro da janela em RAM — O(janela), nunca
  // O(cadeia)). Adota se ficar mais longa. Retorna false se não substituiu, ou o
  // array de transações órfãs (dos blocos descartados que não estão na nova
  // cadeia) para o chamador reinserir no mempool.
  reorg(common, newBlocks, { now = Date.now() } = {}) {
    if (!this.hasGenesis()) throw new Error('cadeia sem bloco gênese');
    if (!Number.isSafeInteger(common) || common < 0 || common > this.height) {
      throw new Error('ponto de fork inválido');
    }
    if (!Array.isArray(newBlocks) || common + newBlocks.length <= this.height) return false;
    // FINALIDADE (correção C-1): uma vez que a cadeia PASSOU de STRICT_PRODUCER_HEIGHT,
    // os blocos até esse ponto (a janela de grandfathering, de validação fraca) ficam
    // imutáveis — um reorg não pode substituí-los. Sem isto, um validador bizantino
    // forjaria uma cadeia mais densa naquela janela e a rede a adotaria.
    const fin = CHAIN.STRICT_PRODUCER_HEIGHT;
    if (fin > 0 && this.height >= fin && common < fin) {
      throw new Error('reorg rejeitado: tentaria substituir histórico finalizado (< STRICT_PRODUCER_HEIGHT)');
    }
    // Finalidade BFT dinâmica (#2): não pode reverter abaixo do último bloco finalizado
    // por >= 2/3+1 validadores distintos. Um fork mais longo ramificado no histórico
    // finalizado exigiria supermaioria equivocando — rejeitado.
    const finalized = this.finalizedHeight();
    if (common < finalized) {
      throw new Error(`reorg rejeitado: tentaria reverter bloco finalizado por BFT (comum ${common} < final ${finalized})`);
    }
    if (common < this.tailStart - 1) throw new Error('reorg além da janela de reorganização');

    // Estado no ponto de fork: âncora (baseState) + re-execução dos blocos da
    // janela até `common`. Blocos já validados — só re-execução determinística.
    let forkState;
    if (common === this.tailStart - 1) {
      forkState = this.baseState.clone();
    } else if (this.tailStart === 0) {
      forkState = new State();
      forkState.applyGenesis(this.tail[0].genesis);
      for (let h = 1; h <= common; h++) this.#applyBlockTo(forkState, this.tail[h]);
    } else {
      forkState = this.baseState.clone();
      for (let h = this.tailStart; h <= common; h++) this.#applyBlockTo(forkState, this.tail[h - this.tailStart]);
    }

    // Candidato descartável: cadeia em memória ancorada no bloco do fork. O
    // addBlock dele aplica TODAS as regras de consenso vivas ao novo rabo.
    const candidate = new Blockchain({ expectedGenesisHash: this.expectedGenesisHash });
    candidate.tail = [this.getBlock(common)];
    candidate.tailStart = common;
    candidate.state = forkState;
    // txIndex do candidato = histórico ≤ common (mantém a rejeição de tx duplicada
    // contra a cadeia inteira, não só contra o rabo novo).
    candidate.txIndex = new Map();
    for (const [id, h] of this.txIndex) if (h <= common) candidate.txIndex.set(id, h);
    for (const block of newBlocks) candidate.addBlock(block, { now });
    if (candidate.height <= this.height) return false;

    // Órfãs: txs dos blocos descartados que não estão na nova cadeia.
    const dropped = this.tail.slice(common + 1 - this.tailStart);
    const orphans = [];
    for (const block of dropped) {
      for (const tx of block.transactions) {
        if (!candidate.txIndex.has(tx.id)) orphans.push(tx);
      }
    }

    // ---- commit ----
    // Disco primeiro: uma falha aqui aborta o reorg com a memória intacta e o
    // arquivo reparado num prefixo válido (≤ fork), que reboot + resync curam.
    if (this.store && !this.#loading) {
      try {
        this.store.truncateFrom(common + 1);
        for (const block of newBlocks) this.store.append(block);
      } catch (err) {
        try { this.store.truncateFrom(common + 1); } catch { /* melhor esforço */ }
        throw err;
      }
      if (this.#lastSnapshotHeight > common && this.snapshotFile) {
        rmSync(this.snapshotFile, { force: true }); // snapshot além do fork ficou inválido
        this.#lastSnapshotHeight = -1;
      }
    }
    this.state = candidate.state;
    this.txIndex = candidate.txIndex;
    // poda os índices por endereço/feed das alturas descartadas…
    for (const block of dropped) {
      for (const tx of block.transactions) {
        for (const a of [tx.from, tx.to]) {
          const arr = this.addressTxIndex.get(a);
          if (!arr) continue;
          while (arr.length && arr[arr.length - 1] > common) arr.pop();
          if (arr.length === 0) this.addressTxIndex.delete(a);
        }
      }
      this.hashIndex.delete(block.hash);
    }
    while (this.blocksWithTxs.length && this.blocksWithTxs[this.blocksWithTxs.length - 1] > common) this.blocksWithTxs.pop();
    // …e anexa as do candidato (só do rabo novo; alturas > common, em ordem)
    for (const [addr, arr] of candidate.addressTxIndex) {
      let ours = this.addressTxIndex.get(addr);
      if (!ours) { ours = []; this.addressTxIndex.set(addr, ours); }
      ours.push(...arr);
    }
    this.blocksWithTxs.push(...candidate.blocksWithTxs);
    this.hashes.length = common + 1;
    for (const block of newBlocks) {
      this.hashes.push(block.hash);
      this.hashIndex.set(block.hash, block.height);
    }
    this.tail = this.tail.slice(0, common + 1 - this.tailStart).concat(newBlocks);
    this.#slideTail();
    this.#maybeSnapshot();
    return orphans;
  }

  // Compatibilidade: recebe uma cadeia completa (bootstrap ou fork), acha o
  // ancestral comum localmente e delega ao reorg. Sem gênese, adota a cadeia.
  replaceChain(rawBlocks, { now = Date.now() } = {}) {
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return false;
    if (!this.hasGenesis()) {
      this.adoptGenesis(rawBlocks[0]);
      for (const block of rawBlocks.slice(1)) this.addBlock(block, { now });
      return [];
    }
    if (rawBlocks.length - 1 <= this.height) return false;
    if (rawBlocks[0]?.hash !== this.hashes[0]) {
      throw new Error('gênese divergente: a cadeia recebida pertence a outra rede');
    }
    let common = -1;
    for (let h = Math.min(this.height, rawBlocks.length - 1); h >= 0; h--) {
      if (rawBlocks[h]?.hash === this.hashes[h]) { common = h; break; }
    }
    return this.reorg(common, rawBlocks.slice(common + 1), { now });
  }

  #loadFromDisk() {
    this.#loading = true;
    let migrated = false;
    try {
      if (existsSync(this.store.file)) {
        if (!this.#loadFromSnapshot()) this.#fullReplay();
      } else if (existsSync(this.chainFile)) {
        // migração do formato legado (array único) para incremental
        const raw = JSON.parse(readFileSync(this.chainFile, 'utf8'));
        if (!Array.isArray(raw) || raw.length === 0) return;
        this.adoptGenesis(raw[0]);
        for (const block of raw.slice(1)) this.addBlock(block);
        this.store.reset(raw);
        migrated = true;
      }
    } finally {
      this.#loading = false;
    }
    if (migrated) {
      try { renameSync(this.chainFile, this.chainFile + '.legacy'); } catch { /* ok */ }
    }
    // Snapshot fresco após um replay completo (ou se o rabo replayado foi longo):
    // o PRÓXIMO boot parte daqui em segundos, sem replay desde a gênese.
    if (this.hasGenesis() && this.height - this.#lastSnapshotHeight >= CHAIN.SNAPSHOT_INTERVAL_BLOCKS) {
      this.#writeSnapshot();
    }
  }

  // Boot rápido: estado + índices vêm do snapshot; do disco só a janela recente
  // e o replay do rabo appendado depois do snapshot. Qualquer inconsistência
  // (arquivo truncado/trocado, hash não bate) descarta o snapshot e cai no
  // replay completo — o snapshot é uma otimização, nunca fonte de verdade.
  #loadFromSnapshot() {
    const file = this.snapshotFile;
    if (!file || !existsSync(file)) return false;
    let snap;
    try {
      const body = readFileSync(file, 'utf8');
      // Com chave configurada, exige HMAC válido (sidecar .mac). Ausente ou
      // divergente → não confia no snapshot e reconstrói do disco (achado C2).
      if (SNAPSHOT_KEY) {
        const macFile = file + '.mac';
        if (!existsSync(macFile)) {
          console.warn('[cadeia] snapshot sem HMAC (.mac) e EAV7_SNAPSHOT_KEY setada — descartando, replay completo');
          return false;
        }
        const stored = readFileSync(macFile);
        const expected = snapshotMac(body);
        if (stored.length !== expected.length || !timingSafeEqual(stored, expected)) {
          console.warn('[cadeia] HMAC do snapshot NÃO confere — arquivo adulterado/incompatível, replay completo');
          return false;
        }
      }
      snap = JSON.parse(body, bigReviver);
    } catch {
      return false;
    }
    try {
      if (snap?.version !== 1 || !Array.isArray(snap.offsets) || !Array.isArray(snap.hashes)) return false;
      if (this.expectedGenesisHash && snap.hashes[0] !== this.expectedGenesisHash) return false;
      if (statSync(this.store.file).size < snap.fileBytes) return false;
      this.store.offsets = snap.offsets;
      const headBlock = this.store.get(snap.height);
      if (!headBlock || headBlock.hash !== snap.headHash) throw new Error('snapshot não bate com o arquivo de blocos');

      this.hashes = snap.hashes;
      this.hashIndex = new Map();
      for (let h = 0; h < this.hashes.length; h++) this.hashIndex.set(this.hashes[h], h);
      this.state = reviveState(snap.state);
      this.baseState = reviveState(snap.baseState);
      this.txIndex = new Map(snap.txIndex);
      this.addressTxIndex = new Map(snap.addressTxIndex);
      this.blocksWithTxs = snap.blocksWithTxs;
      this.tailStart = snap.tailStart;
      this.tail = [];
      for (let h = snap.tailStart; h <= snap.height; h++) {
        const b = this.store.get(h);
        if (!b || b.hash !== this.hashes[h]) throw new Error('janela do snapshot não bate com o arquivo de blocos');
        this.tail.push(b);
      }
      this.#lastSnapshotHeight = snap.height;
      // replay do rabo: blocos appendados ao arquivo depois do snapshot
      let bad = null;
      this.store.scan((block) => {
        if (bad) return;
        try { this.addBlock(block); } catch (err) { bad = err; }
      }, snap.fileBytes);
      if (bad) this.#discardInvalidTail(bad);
      return true;
    } catch {
      this.#resetMemory();
      return false;
    }
  }

  // Replay tolerante: blocos inválidos no FIM do arquivo (lacuna/lixo deixado por
  // crash ou por bug antigo) são descartados — mantém o prefixo válido, trunca o
  // resto e o nó re-sincroniza da rede. O arquivo é cache; a rede é a fonte de
  // verdade. (Corrupção no meio continua fatal: JSON.parse do scan lança.)
  #fullReplay() {
    let first = true;
    let bad = null;
    this.store.scan((block) => {
      if (bad) return;
      try {
        if (first) { this.adoptGenesis(block); first = false; } else this.addBlock(block);
      } catch (err) { bad = err; }
    });
    if (bad) this.#discardInvalidTail(bad);
  }

  #discardInvalidTail(err) {
    this.store.offsets.length = this.height + 1;
    this.store.truncateToIndexedEnd();
    console.warn(`[cadeia] blocos inválidos no fim do blocks.jsonl descartados após a altura ${this.height} (${err.message}) — o restante re-sincroniza da rede`);
  }

  #resetMemory() {
    this.tail = [];
    this.tailStart = 0;
    this.baseState = null;
    this.state = new State();
    this.hashes = [];
    this.hashIndex = new Map();
    this.txIndex = new Map();
    this.addressTxIndex = new Map();
    this.blocksWithTxs = [];
    this.#lastSnapshotHeight = -1;
    if (this.store) {
      this.store.offsets = [];
      this.store.close();
    }
  }

  // Append de um único bloco (custo O(1) por bloco, em vez de reescrever tudo).
  // INVARIANTE: o store só guarda um prefixo contíguo 0..count-1 da cadeia. Se o
  // disco ficou para trás (falha anterior), NÃO appenda fora de ordem — o nó segue
  // em RAM e o reboot re-sincroniza o que faltar da rede (nunca grava lacuna).
  #appendBlock(block) {
    if (!this.store || this.#loading) return;
    if (this.store.count !== block.height) {
      console.warn(`[cadeia] disco em ${this.store.count - 1}, bloco ${block.height} não persistido (re-sincroniza no reboot)`);
      return;
    }
    this.store.append(block);
  }

  // Snapshot periódico do estado + índices (tmp + rename: um crash no meio deixa
  // o snapshot anterior válido). O boot seguinte parte daqui.
  #maybeSnapshot() {
    if (this.#loading || !this.store || !this.hasGenesis()) return;
    if (this.height - this.#lastSnapshotHeight < CHAIN.SNAPSHOT_INTERVAL_BLOCKS) return;
    this.#writeSnapshot();
  }

  #writeSnapshot() {
    const file = this.snapshotFile;
    if (!file || !this.hasGenesis()) return;
    const snap = {
      version: 1,
      height: this.height,
      headHash: this.head.hash,
      fileBytes: this.store.fileBytes,
      tailStart: this.tailStart,
      offsets: this.store.offsets,
      hashes: this.hashes,
      state: this.state,
      baseState: this.baseState,
      txIndex: [...this.txIndex],
      addressTxIndex: [...this.addressTxIndex],
      blocksWithTxs: this.blocksWithTxs,
    };
    const body = JSON.stringify(snap, bigReplacer);
    const tmp = file + '.tmp';
    writeFileSync(tmp, body);
    renameSync(tmp, file);
    // Sela o snapshot com HMAC quando há chave (mac primeiro, depois o arquivo já
    // foi renomeado; no boot exigimos ambos consistentes). Achado C2.
    if (SNAPSHOT_KEY) {
      const macTmp = file + '.mac.tmp';
      writeFileSync(macTmp, snapshotMac(body));
      renameSync(macTmp, file + '.mac');
    }
    this.#lastSnapshotHeight = this.height;
  }
}
