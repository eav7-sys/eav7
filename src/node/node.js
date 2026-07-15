import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CHAIN, formatEav7 } from '../config.js';
import { walletAddress } from '../crypto/keys.js';
import { Blockchain } from '../core/blockchain.js';
import { Mempool } from '../core/mempool.js';
import { verifyTransaction } from '../core/transaction.js';
import { P2P } from './p2p.js';
import { createApiServer } from './api.js';
import { createEavmRpcServer } from '../eavm/rpc.js';

export class Eav7Node {
  constructor({
    port = 6070,
    host = '0.0.0.0',
    dataDir = null,
    validatorWallet = null,
    peers = [],
    selfUrl = null,
    allowPrivatePeers = false,
    expectedGenesisHash = null,
    genesisFile = null,
    adminToken = process.env.EAV7_ADMIN_TOKEN || null,
    publicRpcUrl = process.env.EAV7_PUBLIC_RPC_URL || null,
    eavm = true,
    eavmPort = null,
    log = console.log,
  } = {}) {
    this.port = port;
    this.host = host;
    this.log = log;
    this.adminToken = adminToken;
    this.publicRpcUrl = publicRpcUrl;
    this.blockchain = new Blockchain({ dataDir, expectedGenesisHash });
    this.mempool = new Mempool();
    this.validatorWallet = validatorWallet;
    this.validatorAddress = validatorWallet ? walletAddress(validatorWallet) : null;
    this.genesisFile = genesisFile;
    this.securityAlerts = [];
    this.p2p = new P2P({ node: this, selfUrl: selfUrl ?? `http://127.0.0.1:${port}`, peers, allowPrivatePeers, log });
    this.api = createApiServer(this);
    this.eavmEnabled = eavm;
    this.eavmPort = eavmPort ?? port + 1000;
    this.eavmServer = eavm ? createEavmRpcServer(this) : null;
    this.lastSlot = -1;
    this.productionTimer = null;
    // Registro de contratos verificados (#8): metadados NÃO-consensuais (fora do stateRoot).
    // Verificação = o bytecode submetido bate com o código on-chain do contrato.
    this.verifiedContracts = new Map();
  }

  // #8: verifica um contrato EAVM conferindo que o bytecode submetido é idêntico ao
  // código de runtime on-chain; se bater, guarda o source para o explorer exibir.
  verifyContract(address, { source, language = 'solidity', compiler = '', bytecode }) {
    const addr = String(address).toLowerCase();
    const onchain = this.blockchain.state.contracts[addr]?.code;
    if (!onchain) throw new Error('contrato não encontrado on-chain');
    const provided = '0x' + String(bytecode ?? '').replace(/^0x/, '').toLowerCase();
    if (provided !== onchain.toLowerCase()) throw new Error('bytecode não confere com o código on-chain');
    if (typeof source !== 'string' || source.length === 0 || source.length > 200_000) throw new Error('source inválido (1..200000 chars)');
    const codeHash = createHash('sha3-256').update(onchain).digest('hex');
    const record = { address: addr, language: String(language), compiler: String(compiler), source, codeHash, verifiedAt: Date.now() };
    this.verifiedContracts.set(addr, record);
    return { verified: true, address: addr, codeHash };
  }

  getVerifiedContract(address) {
    return this.verifiedContracts.get(String(address).toLowerCase()) ?? null;
  }

  // Autoriza operações administrativas (ex.: escrever alertas). Sem token
  // configurado, nega — endpoints de admin ficam desabilitados por padrão.
  checkAdmin(req) {
    if (!this.adminToken) return false;
    const header = req.headers?.['x-admin-token'];
    if (typeof header !== 'string') return false;
    // Comparação constant-time: compara SHA-256 de ambos (mesmo comprimento
    // sempre), evitando o side-channel de timing do `===` que sai no 1º byte
    // divergente e vazaria o token byte a byte (achado L1).
    const a = createHash('sha256').update(header).digest();
    const b = createHash('sha256').update(this.adminToken).digest();
    return timingSafeEqual(a, b);
  }

  ensureGenesis() {
    if (this.blockchain.hasGenesis()) return;
    // Gênese CUSTOMIZADO (--genesis): TODOS os nós adotam o mesmo bloco gênese (mesmo
    // hash), sem depender de um nó semente. É o caminho do relaunch multi-validador.
    if (this.genesisFile) {
      const block = JSON.parse(readFileSync(this.genesisFile, 'utf8'));
      this.blockchain.adoptGenesis(block); // valida integridade + confere o hash fixado
      this.log(`[nó] gênese adotada do arquivo (${block.hash})`);
      return;
    }
    // Com peers configurados, a gênese vem da REDE (sincronização) — mesmo sendo
    // validador. Um validador que ENTRA numa rede existente não cria uma gênese
    // nova (que teria hash divergente); apenas os primeiros nós de uma rede nova
    // (sem peers) criam a gênese.
    if (this.p2p.peers.size > 0) return;
    if (!this.validatorWallet) {
      throw new Error('primeira inicialização exige uma carteira de validador (--validator) ou peers para sincronizar');
    }
    const genesis = this.blockchain.createGenesis({ address: this.validatorAddress });
    this.log(`[nó] gênese criada (${genesis.hash})`);
    this.log(`[nó] ${formatEav7(CHAIN.GENESIS_SUPPLY)} ${CHAIN.SYMBOL} alocados para ${this.validatorAddress}`);
  }

  // Próximo nonce utilizável considerando transações do remetente ainda no mempool.
  nextNonceFor(address) {
    let nonce = this.blockchain.state.accounts[address]?.nonce ?? 0;
    for (const tx of this.mempool.all()) {
      if (tx.from === address && tx.nonce > nonce) nonce = tx.nonce;
    }
    return nonce + 1;
  }

  submitTransaction(tx, { broadcast = true } = {}) {
    const err = verifyTransaction(tx);
    if (err) throw new Error(err);
    const confirmedNonce = this.blockchain.state.accounts[tx.from]?.nonce ?? 0;
    if (tx.nonce <= confirmedNonce) throw new Error(`nonce ${tx.nonce} já utilizado por ${tx.from}`);
    // Rejeita nonces muito à frente: sem isto, transações que nunca ficam
    // executáveis (lacuna de nonce) se acumulariam para sempre no mempool (DoS).
    if (tx.nonce > confirmedNonce + CHAIN.MAX_FUTURE_NONCE_GAP) {
      throw new Error(`nonce ${tx.nonce} muito à frente (máx +${CHAIN.MAX_FUTURE_NONCE_GAP})`);
    }
    if (this.blockchain.txIndex.has(tx.id) || this.mempool.has(tx.id)) {
      return { accepted: false, id: tx.id, reason: 'transação já conhecida' };
    }
    if (this.mempool.size >= CHAIN.MAX_MEMPOOL) throw new Error('mempool cheio, tente novamente mais tarde');
    this.mempool.add(tx);
    if (broadcast) this.p2p.broadcastTx(tx);
    return { accepted: true, id: tx.id };
  }

  receiveBlock(block) {
    if (block?.hash && this.blockchain.getBlock(block.hash)) {
      return { accepted: false, reason: 'bloco já conhecido' };
    }
    try {
      this.blockchain.addBlock(block);
    } catch (err) {
      // Bloco à frente da nossa altura: provavelmente estamos atrasados — sincroniza.
      if (Number.isSafeInteger(block?.height) && block.height > this.blockchain.height + 1) {
        this.p2p.syncOnce().catch(() => {});
      }
      throw err;
    }
    this.mempool.prune(this.blockchain.state);
    this.p2p.broadcastBlock(block);
    return { accepted: true, hash: block.hash };
  }

  addSecurityAlert({ source = 'api', kind, severity = 'info', message, context = {} }) {
    if (typeof kind !== 'string' || typeof message !== 'string') {
      throw new Error('alerta inválido: kind e message são obrigatórios');
    }
    if (!['info', 'warning', 'critical'].includes(severity)) {
      throw new Error('severity deve ser info, warning ou critical');
    }
    // context é serializado e truncado: sem limite, 500 alertas com ~2 MB cada
    // reteriam ~1 GB de memória.
    let safeContext = context;
    try {
      const encoded = JSON.stringify(context ?? {});
      if (encoded.length > CHAIN.MAX_ALERT_CONTEXT_BYTES) safeContext = { truncated: true, bytes: encoded.length };
    } catch {
      safeContext = { unserializable: true };
    }
    const alert = {
      at: Date.now(),
      source: String(source).slice(0, 40),
      kind: kind.slice(0, 40),
      severity,
      message: message.slice(0, 4000),
      context: safeContext,
    };
    this.securityAlerts.push(alert);
    if (this.securityAlerts.length > 500) this.securityAlerts.shift();
    return alert;
  }

  #produce() {
    if (!this.validatorWallet || !this.blockchain.hasGenesis()) return;
    const now = Date.now();
    const slot = this.blockchain.slotFor(now);
    if (slot === this.lastSlot) return; // uma tentativa por slot
    // slot já preenchido na cadeia? então não produz
    if (this.blockchain.slotFor(this.blockchain.head.timestamp) >= slot) return;
    // Produz APENAS o próprio slot do rodízio. Com a validação ESTRITA de produtor
    // (blockchain.addBlock a partir de STRICT_PRODUCER_HEIGHT), um bloco produzido
    // fora de turno é rejeitado pela rede; e um bloco de um nó atrasado (no seu slot,
    // mas sobre uma cadeia divergente) fica órfão e o nó reorganiza para a canônica.
    // Não há gate por altura auto-reportada de peer — evita o vetor de halt (H2).
    if (this.blockchain.expectedProducer(now) !== this.validatorAddress) return;
    if (now <= this.blockchain.head.timestamp) return;
    try {
      const txs = this.mempool.selectExecutable(this.blockchain.state, this.blockchain.height + 1, now);
      const block = this.blockchain.produceBlock(this.validatorWallet, txs, { timestamp: now });
      this.lastSlot = slot; // marca só após produzir com sucesso (permite retry no mesmo slot) — L4
      this.mempool.prune(this.blockchain.state);
      this.p2p.broadcastBlock(block);
      if (block.txCount > 0 || block.height % 60 === 0) {
        this.log(`[minerador] bloco ${block.height} (${block.txCount} tx) — recompensa ${formatEav7(CHAIN.BLOCK_REWARD)} ${CHAIN.SYMBOL} + taxas`);
      }
    } catch (err) {
      this.log(`[minerador] falha ao produzir bloco: ${err.message}`);
    }
  }

  async start() {
    this.ensureGenesis();
    await new Promise((resolve, reject) => {
      this.api.once('error', reject);
      this.api.listen(this.port, this.host, resolve);
    });
    if (this.eavmServer) {
      await new Promise((resolve, reject) => {
        this.eavmServer.once('error', reject);
        this.eavmServer.listen(this.eavmPort, this.host, resolve);
      });
    }
    await this.p2p.start();
    if (this.validatorWallet) {
      this.productionTimer = setInterval(() => this.#produce(), 200);
    }
    const shown = this.host === '0.0.0.0' ? '127.0.0.1' : this.host;
    this.log(`[nó] ${CHAIN.NAME} (protocolo ${CHAIN.PROTOCOL}) escutando em ${this.host}:${this.port} (bind ${this.host})`);
    this.log(`[nó] plataforma de mineração: http://${shown}:${this.port}/app`);
    if (this.eavmServer) {
      this.log(`[nó] RPC EAVM (MetaMask/Trust Wallet): http://${shown}:${this.eavmPort} — Chain ID ${CHAIN.EAVM_CHAIN_ID}, símbolo ${CHAIN.SYMBOL}`);
    }
    if (this.validatorAddress) this.log(`[nó] minerando como ${this.validatorAddress}`);
    return this;
  }

  stop() {
    if (this.productionTimer) clearInterval(this.productionTimer);
    this.productionTimer = null;
    this.p2p.stop();
    this.api.close();
    this.eavmServer?.close();
  }
}
