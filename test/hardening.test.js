// Testes de regressão das correções da auditoria de segurança.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { eavHash, canonical } from '../src/crypto/hash.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildBlock, buildGenesisBlock, verifyBlockIntegrity, blockCore } from '../src/core/block.js';
import { buildTransaction, verifyTransaction, txSigningPayload } from '../src/core/transaction.js';
import { State } from '../src/core/state.js';

function genesisChain() {
  const wallet = generateKeyPair();
  const chain = new Blockchain();
  const t0 = Date.now() - 120_000;
  chain.createGenesis({ address: walletAddress(wallet), timestamp: t0 });
  return { wallet, chain, t0 };
}

test('consenso: no máximo um bloco por slot (anti-grinding)', () => {
  const { wallet, chain, t0 } = genesisChain();
  // primeiro bloco no próximo slot: OK
  chain.produceBlock(wallet, [], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
  // segundo bloco no MESMO slot (timestamp 1 ms depois): rejeitado
  const sameSlot = buildBlock(wallet, {
    height: chain.height + 1,
    previousHash: chain.head.hash,
    timestamp: t0 + CHAIN.BLOCK_TIME_MS + 1,
    transactions: [],
  });
  assert.throws(() => chain.addBlock(sameSlot, { now: t0 + CHAIN.BLOCK_TIME_MS + 1 }), /um bloco por slot/);
});

test('consenso: bloco de slot futuro é rejeitado', () => {
  const { wallet, chain, t0 } = genesisChain();
  const now = t0 + CHAIN.BLOCK_TIME_MS;
  // bloco cujo slot está 10 slots à frente do relógio do nó
  const future = buildBlock(wallet, {
    height: chain.height + 1,
    previousHash: chain.head.hash,
    timestamp: now + 10 * CHAIN.BLOCK_TIME_MS,
    transactions: [],
  });
  assert.throws(() => chain.addBlock(future, { now }), /futuro/);
});

test('maleabilidade: o id da tx deriva do payload, não das assinaturas', () => {
  const wallet = generateKeyPair();
  const to = walletAddress(generateKeyPair());
  const tx = buildTransaction(wallet, { type: 'TRANSFER', to, amount: 5n, nonce: 1 });

  // o id é exatamente o hash do payload canônico assinado
  assert.equal(tx.id, eavHash(txSigningPayload(tx)));

  // trocar os bytes da assinatura (mantendo o payload) NÃO muda o id — logo a
  // dedup por id captura qualquer variante maleável
  const mutated = { ...tx, signature: Buffer.from('outra-coisa').toString('base64') };
  assert.equal(eavHash(txSigningPayload(mutated)), tx.id);
  // e a verificação rejeita a assinatura adulterada
  assert.match(verifyTransaction(mutated), /assinatura/);
});

test('RLP: inteiros não canônicos (zero à esquerda) são rejeitados na tx EAVM', async () => {
  const { randomBytes } = await import('node:crypto');
  const { createSignedTx, decodeRawTransaction } = await import('../src/eavm/tx.js');
  const { rlpDecode, rlpEncode } = await import('../src/eavm/rlp.js');
  const { publicKeyFromPrivate, bufToBig } = await import('../src/eavm/secp256k1.js');

  const priv = (bufToBig(randomBytes(32)) % (2n ** 250n)) + 1n;
  void publicKeyFromPrivate(priv);
  const raw = createSignedTx({
    privateKey: priv, nonce: 0, to: '0x' + 'ab'.repeat(20),
    valueWei: 10n ** 18n, chainId: CHAIN.EAVM_CHAIN_ID,
  });
  // canônico decodifica normalmente
  assert.ok(decodeRawTransaction(raw).from.startsWith('0x'));

  // padear o campo r (índice 7) com 0x00 à esquerda → deve ser rejeitado
  const list = rlpDecode(Buffer.from(raw.slice(2), 'hex'));
  list[7] = Buffer.concat([Buffer.from([0]), list[7]]);
  const tampered = '0x' + rlpEncode(list).toString('hex');
  assert.throws(() => decodeRawTransaction(tampered), /não canônico/);
});

test('produção: UNSTAKE não pode esvaziar o conjunto de validadores', () => {
  const { wallet, chain, t0 } = genesisChain();
  const addr = walletAddress(wallet);
  // o validador gênese tem GENESIS_STAKE; unstake que o derruba abaixo do mínimo
  // e esvazia o conjunto deve ser rejeitado (senão a cadeia trava para sempre)
  const bad = buildTransaction(wallet, { type: 'UNSTAKE', amount: (CHAIN.GENESIS_STAKE - 500n * CHAIN.UNIT), nonce: 1 });
  assert.throws(() => chain.state.clone().applyTransaction(bad), /último validador/);
  assert.ok(chain.state.validators().some((v) => v.address === addr));
});

test('gênese fixada: hash divergente é rejeitado no bootstrap sem cadeia', () => {
  const wallet = generateKeyPair();
  const real = new Blockchain();
  real.createGenesis({ address: walletAddress(wallet), timestamp: Date.now() - 60_000 });
  // um nó que fixa OUTRO hash de gênese recusa a gênese do peer
  const pinned = new Blockchain({ expectedGenesisHash: 'E7' + '1'.repeat(62) });
  assert.throws(() => pinned.adoptGenesis(structuredClone(real.getBlock(0))), /hash fixado/);
  // com o hash correto, adota normalmente
  const ok = new Blockchain({ expectedGenesisHash: real.getBlock(0).hash });
  ok.adoptGenesis(structuredClone(real.getBlock(0)));
  assert.equal(ok.height, 0);
});

test('consenso: validação ESTRITA de produtor rejeita bloco fora de turno (correção C1)', () => {
  const orig = CHAIN.STRICT_PRODUCER_HEIGHT;
  CHAIN.STRICT_PRODUCER_HEIGHT = 0; // estrito desde o início, para o teste
  try {
    const w1 = generateKeyPair();
    const w2 = generateKeyPair();
    const chain = new Blockchain();
    const t0 = Math.floor((Date.now() - 120_000) / CHAIN.BLOCK_TIME_MS) * CHAIN.BLOCK_TIME_MS;
    chain.createGenesis({ address: walletAddress(w1), timestamp: t0 });
    chain.produceBlock(w1, [buildTransaction(w1, { type: 'TRANSFER', to: walletAddress(w2), amount: 3000n * CHAIN.UNIT, nonce: 1 })], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
    chain.produceBlock(w1, [buildTransaction(w2, { type: 'STAKE', amount: 2000n * CHAIN.UNIT, nonce: 1 })], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS });
    assert.equal(chain.state.validators().length, 2);

    // acha um slot cujo produtor escalado seja w1
    let ts = (chain.slotFor(chain.head.timestamp) + 3) * CHAIN.BLOCK_TIME_MS;
    while (chain.expectedProducer(ts) !== walletAddress(w1)) ts += CHAIN.BLOCK_TIME_MS;

    // um bloco assinado por w2 (fora de turno) é REJEITADO pelo addBlock (antes era aceito -> C1)
    const errado = buildBlock(w2, { height: chain.height + 1, previousHash: chain.head.hash, timestamp: ts, transactions: [] });
    assert.throws(() => chain.addBlock(errado, { now: Date.now() }), /fora do slot/);

    // o produtor escalado (w1) é aceito
    const bom = chain.produceBlock(w1, [], { timestamp: ts });
    assert.equal(bom.producer, walletAddress(w1));
  } finally {
    CHAIN.STRICT_PRODUCER_HEIGHT = orig;
  }
});

test('emissão: recompensa de bloco com halving', () => {
  const chain = new Blockchain();
  assert.equal(chain.blockReward(0), CHAIN.BLOCK_REWARD);
  assert.equal(chain.blockReward(CHAIN.HALVING_INTERVAL_BLOCKS - 1), CHAIN.BLOCK_REWARD);
  assert.equal(chain.blockReward(CHAIN.HALVING_INTERVAL_BLOCKS), CHAIN.BLOCK_REWARD / 2n);
  assert.equal(chain.blockReward(CHAIN.HALVING_INTERVAL_BLOCKS * 2), CHAIN.BLOCK_REWARD / 4n);
  assert.equal(chain.blockReward(CHAIN.HALVING_INTERVAL_BLOCKS * 64), 0n);
});

test('EAVM_TRANSFER na rota híbrida é rejeitado (evita queima de fundos)', () => {
  const wallet = generateKeyPair();
  const tx = buildTransaction(wallet, { type: 'EAVM_TRANSFER', amount: 1000n, nonce: 1 });
  assert.match(verifyTransaction(tx), /EAVM_TRANSFER só é válido via esquema EAVM/);
});

test('consenso: bloco de slot futuro (além da tolerância) é rejeitado', () => {
  const { wallet, chain, t0 } = genesisChain();
  const now = t0 + 5 * CHAIN.BLOCK_TIME_MS; // relógio no slot atual
  // bloco vários slots à frente do relógio => sempre rejeitado (a tolerância de
  // skew é < 1 slot, então dois slots à frente nunca passam)
  const future = buildBlock(wallet, {
    height: chain.height + 1,
    previousHash: chain.head.hash,
    timestamp: now + 3 * CHAIN.BLOCK_TIME_MS,
    transactions: [],
  });
  assert.throws(() => chain.addBlock(future, { now }), /futuro/);
});

test('mempool: nonce muito à frente é recusado na submissão (anti-DoS)', async () => {
  const { Eav7Node } = await import('../src/node/node.js');
  const validator = generateKeyPair();
  const node = new Eav7Node({ validatorWallet: validator, eavm: false });
  node.blockchain.createGenesis({ address: node.validatorAddress, timestamp: Date.now() - 60_000 });

  const user = generateKeyPair();
  const to = walletAddress(generateKeyPair());
  // nonce dentro da janela é aceito na validação stateless + submit
  const ok = buildTransaction(user, { type: 'TRANSFER', to, amount: 1n, nonce: 1 });
  assert.equal(verifyTransaction(ok), null);
  // nonce muito à frente é recusado pelo nó
  const farAhead = buildTransaction(user, {
    type: 'TRANSFER', to, amount: 1n, nonce: CHAIN.MAX_FUTURE_NONCE_GAP + 5,
  });
  assert.throws(() => node.submitTransaction(farAhead, { broadcast: false }), /muito à frente/);
});

// ---- M1: hash de bloco canônico (imune à maleabilidade de assinatura) ----
test('M1: acima do fork o hash do bloco deriva só do payload (não da assinatura)', () => {
  const saved = CHAIN.CANONICAL_HASH_HEIGHT;
  CHAIN.CANONICAL_HASH_HEIGHT = 1;
  try {
    const w = generateKeyPair();
    const g = buildGenesisBlock({ timestamp: Date.now() - 60_000, balances: {}, stakes: {} });
    const b = buildBlock(w, { height: 1, previousHash: g.hash, timestamp: Date.now() - 30_000, transactions: [] });
    const payload = canonical(blockCore(b));
    assert.equal(b.hash, eavHash(payload), 'hash deve ser eavHash(payload) puro');
    assert.notEqual(b.hash, eavHash(payload + b.signature + b.pqSignature), 'hash não pode depender da assinatura');
    assert.equal(verifyBlockIntegrity(b), null, 'bloco real deve verificar');
    // qualquer variante do MESMO payload (assinatura reencodada) colide no MESMO id:
    // não existem dois ids válidos para o mesmo conteúdo.
    assert.equal(eavHash(canonical(blockCore({ ...b, signature: 'x', pqSignature: 'y' }))), b.hash);
  } finally {
    CHAIN.CANONICAL_HASH_HEIGHT = saved;
  }
});

test('M1: abaixo do fork mantém a fórmula antiga (grandfather do histórico)', () => {
  const saved = CHAIN.CANONICAL_HASH_HEIGHT;
  CHAIN.CANONICAL_HASH_HEIGHT = 100_000;
  try {
    const w = generateKeyPair();
    const g = buildGenesisBlock({ timestamp: Date.now() - 60_000, balances: {}, stakes: {} });
    const b = buildBlock(w, { height: 1, previousHash: g.hash, timestamp: Date.now() - 30_000, transactions: [] });
    const payload = canonical(blockCore(b));
    assert.equal(b.hash, eavHash(payload + b.signature + b.pqSignature));
    assert.equal(verifyBlockIntegrity(b), null);
  } finally {
    CHAIN.CANONICAL_HASH_HEIGHT = saved;
  }
});

// ---- C1: quórum M-de-N da ponte (sem ponto único de falha) ----
function bridgeState(relayers) {
  const s = new State();
  s.bridgeRelayers = Object.fromEntries(relayers.map((r) => [r.addr, true]));
  s.bridge.lockedNative = 1000n * CHAIN.UNIT;
  for (const r of relayers) s.credit(r.addr, 100n * CHAIN.UNIT); // energia p/ fee
  return s;
}

test('C1: acima do fork, um relayer sozinho NÃO drena o pool (exige maioria)', () => {
  const saved = CHAIN.BRIDGE_QUORUM_HEIGHT;
  CHAIN.BRIDGE_QUORUM_HEIGHT = 1;
  try {
    const relayers = [0, 1, 2].map(() => { const w = generateKeyPair(); return { w, addr: walletAddress(w) }; });
    const dest = walletAddress(generateKeyPair());
    const data = { sourceChain: 'TRON', sourceTxHash: '0xdeposit1', token: null };
    const amt = 5n * CHAIN.UNIT;
    const s = bridgeState(relayers);

    // 1ª atestação: apenas ATESTADO, sem liberar (quórum = 2 de 3)
    s.applyTransaction(buildTransaction(relayers[0].w, { type: 'BRIDGE_IN', to: dest, amount: amt, nonce: 1, data }), 5, Date.now());
    assert.equal(s.balanceOf(dest), 0n, 'uma atestação não pode liberar');

    // 2ª atestação distinta: atinge quórum e libera exatamente uma vez
    s.applyTransaction(buildTransaction(relayers[1].w, { type: 'BRIDGE_IN', to: dest, amount: amt, nonce: 1, data }), 5, Date.now());
    assert.equal(s.balanceOf(dest), amt, 'quórum atingido deve liberar');
    assert.equal(s.bridge.lockedNative, 1000n * CHAIN.UNIT - amt, 'lockedNative cai exatamente 1x');

    // depósito já liberado: replay é rejeitado
    assert.throws(() => s.applyTransaction(buildTransaction(relayers[2].w, { type: 'BRIDGE_IN', to: dest, amount: amt, nonce: 1, data }), 5, Date.now()), /já processado/);
  } finally {
    CHAIN.BRIDGE_QUORUM_HEIGHT = saved;
  }
});

test('C1: abaixo do fork mantém quórum antigo (grandfather do histórico)', () => {
  const saved = CHAIN.BRIDGE_QUORUM_HEIGHT;
  CHAIN.BRIDGE_QUORUM_HEIGHT = 100_000;
  try {
    const relayers = [0, 1, 2].map(() => { const w = generateKeyPair(); return { w, addr: walletAddress(w) }; });
    const dest = walletAddress(generateKeyPair());
    const amt = 5n * CHAIN.UNIT;
    const s = bridgeState(relayers);
    s.applyTransaction(buildTransaction(relayers[0].w, { type: 'BRIDGE_IN', to: dest, amount: amt, nonce: 1, data: { sourceChain: 'TRON', sourceTxHash: '0xhist', token: null } }), 5, Date.now());
    assert.equal(s.balanceOf(dest), amt, 'abaixo do fork, 1 atestação libera (regra antiga)');
  } finally {
    CHAIN.BRIDGE_QUORUM_HEIGHT = saved;
  }
});
