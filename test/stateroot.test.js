// Testes do stateRoot nos headers (feature #1): compromisso de estado verificável.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { isValidHash, eavHash } from '../src/crypto/hash.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildBlock, verifyBlockIntegrity } from '../src/core/block.js';
import { buildTransaction } from '../src/core/transaction.js';
import { computeStateRoot } from '../src/core/stateroot.js';

function genesisChain() {
  const wallet = generateKeyPair();
  const chain = new Blockchain();
  const t0 = Date.now() - 120_000;
  chain.createGenesis({ address: walletAddress(wallet), timestamp: t0 });
  return { wallet, chain, t0 };
}

test('stateRoot: determinístico e sensível a qualquer mudança de estado', () => {
  const a = new Blockchain(); const b = new Blockchain();
  const w = generateKeyPair(); const addr = walletAddress(w); const t0 = Date.now() - 120_000;
  a.createGenesis({ address: addr, timestamp: t0 });
  b.createGenesis({ address: addr, timestamp: t0 });
  // mesmos estados → mesma raiz
  assert.equal(computeStateRoot(a.state), computeStateRoot(b.state));
  // muda um saldo em a → raiz diverge
  a.state.credit(walletAddress(generateKeyPair()), 1n);
  assert.notEqual(computeStateRoot(a.state), computeStateRoot(b.state));
});

test('#1: acima do fork o bloco produzido commita stateRoot pós-estado e verifica', () => {
  const saved = CHAIN.STATEROOT_HEIGHT; CHAIN.STATEROOT_HEIGHT = 1;
  try {
    const { wallet, chain, t0 } = genesisChain();
    const dest = walletAddress(generateKeyPair());
    const tx = buildTransaction(wallet, { type: 'TRANSFER', to: dest, amount: 5n * CHAIN.UNIT, nonce: 1 });
    const blk = chain.produceBlock(wallet, [tx], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
    assert.ok(isValidHash(blk.stateRoot), 'stateRoot deve estar presente e bem-formado');
    // o root do header bate com o estado APÓS o bloco
    assert.equal(blk.stateRoot, computeStateRoot(chain.state));
    assert.equal(verifyBlockIntegrity(blk), null);
  } finally { CHAIN.STATEROOT_HEIGHT = saved; }
});

test('#1: stateRoot adulterado é REJEITADO no addBlock', () => {
  const saved = CHAIN.STATEROOT_HEIGHT; CHAIN.STATEROOT_HEIGHT = 1;
  try {
    const { wallet, chain, t0 } = genesisChain();
    // bloco assinado com um stateRoot errado (formato válido, valor errado)
    const bad = buildBlock(wallet, {
      height: chain.height + 1, previousHash: chain.head.hash,
      timestamp: t0 + CHAIN.BLOCK_TIME_MS, transactions: [], stateRoot: eavHash('root-errado'),
    });
    assert.throws(() => chain.addBlock(bad, { now: t0 + CHAIN.BLOCK_TIME_MS }), /stateRoot não confere/);
  } finally { CHAIN.STATEROOT_HEIGHT = saved; }
});

test('#1: acima do fork, bloco SEM stateRoot é rejeitado (estrutural)', () => {
  const saved = CHAIN.STATEROOT_HEIGHT; CHAIN.STATEROOT_HEIGHT = 1;
  try {
    const { wallet, chain, t0 } = genesisChain();
    const noRoot = buildBlock(wallet, {
      height: chain.height + 1, previousHash: chain.head.hash,
      timestamp: t0 + CHAIN.BLOCK_TIME_MS, transactions: [], // stateRoot omitido → null
    });
    assert.match(verifyBlockIntegrity(noRoot), /stateRoot ausente/);
  } finally { CHAIN.STATEROOT_HEIGHT = saved; }
});

test('#1: abaixo do fork, stateRoot é PROIBIDO (grandfather do histórico)', () => {
  // com o fork no padrão (alto), um bloco produzido agora NÃO tem o campo
  const { wallet, chain, t0 } = genesisChain();
  const blk = chain.produceBlock(wallet, [], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
  assert.equal(blk.stateRoot, undefined, 'abaixo do fork não deve haver stateRoot');
  assert.equal(verifyBlockIntegrity(blk), null);

  // regra estrutural: um bloco ASSINADO com stateRoot no core mas numa altura ABAIXO
  // do fork é rejeitado. Assinamos com o fork em 1 (entra no core) e depois subimos o
  // fork, deixando o mesmo bloco "antes do fork".
  const saved = CHAIN.STATEROOT_HEIGHT;
  CHAIN.STATEROOT_HEIGHT = 1;
  const signed = buildBlock(wallet, {
    height: 1, previousHash: chain.head.hash, timestamp: t0 + CHAIN.BLOCK_TIME_MS,
    transactions: [], stateRoot: eavHash('x'),
  });
  CHAIN.STATEROOT_HEIGHT = 999_999; // agora a altura 1 está abaixo do fork
  assert.match(verifyBlockIntegrity(signed), /antes do fork/);
  CHAIN.STATEROOT_HEIGHT = saved;
});
