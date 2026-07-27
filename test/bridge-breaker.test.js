// Testes do circuit breaker da ponte (auto-mitigação de consenso, fork-gated).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

// Ponte via atestação de 1 relayer (quórum 1), sem prova de comitê (fork de prova alto).
function setup(lockedNative = 1000n * CHAIN.UNIT) {
  const relayer = generateKeyPair();
  const s = new State();
  s.bridgeRelayers = { [walletAddress(relayer)]: true };
  s.bridge.lockedNative = lockedNative;
  s.credit(walletAddress(relayer), 100n * CHAIN.UNIT);
  return { s, relayer };
}
let UNIQ = 0;
function bridgeIn(s, relayer, amount, height) {
  const dest = walletAddress(generateKeyPair());
  const nonce = (s.accounts[walletAddress(relayer)]?.nonce ?? 0) + 1; // nonce por-relayer
  const tx = buildTransaction(relayer, {
    type: 'BRIDGE_IN', to: dest, amount, nonce,
    data: { sourceChain: 'TRON', sourceTxHash: '0x' + (++UNIQ).toString(16).padStart(8, '0'), token: null },
  });
  s.applyTransaction(tx, height, Date.now());
  return dest;
}

test('breaker: abaixo do fork NÃO limita (grandfather) — pode drenar acima de 30%', () => {
  // BRIDGE_BREAKER_HEIGHT padrão é distante; height 10 < fork → sem breaker.
  const { s, relayer } = setup();
  bridgeIn(s, relayer, 500n * CHAIN.UNIT, 10); // 50% do pool, liberado
  assert.equal(s.bridge.lockedNative, 500n * CHAIN.UNIT);
});

test('breaker: acima do fork, soma da janela > BPS do pool é REJEITADA (falha fechada)', () => {
  const saved = CHAIN.BRIDGE_BREAKER_HEIGHT; CHAIN.BRIDGE_BREAKER_HEIGHT = 1;
  try {
    const { s, relayer } = setup(1000n * CHAIN.UNIT); // pool 1000, BPS 3000 = cap 300/janela
    bridgeIn(s, relayer, 200n * CHAIN.UNIT, 10); // 200 <= 300 → ok
    assert.equal(s.bridge.lockedNative, 800n * CHAIN.UNIT);
    // 2ª liberação de 150 na MESMA janela: 200+150=350 > 300 → breaker dispara
    assert.throws(() => bridgeIn(s, relayer, 150n * CHAIN.UNIT, 10), /circuit breaker/);
    assert.equal(s.bridge.lockedNative, 800n * CHAIN.UNIT, 'nada liberado ao disparar (falha fechada)');
    // uma liberação pequena que cabe (200+90=290 <= 300) ainda passa
    bridgeIn(s, relayer, 90n * CHAIN.UNIT, 10);
    assert.equal(s.bridge.lockedNative, 710n * CHAIN.UNIT);
    // agora 290+20=310 > 300 → dispara de novo
    assert.throws(() => bridgeIn(s, relayer, 20n * CHAIN.UNIT, 10), /circuit breaker/);
  } finally { CHAIN.BRIDGE_BREAKER_HEIGHT = saved; }
});

test('breaker: janela desliza — liberações antigas saem da conta e a ponte reabre', () => {
  const saved = CHAIN.BRIDGE_BREAKER_HEIGHT; CHAIN.BRIDGE_BREAKER_HEIGHT = 1;
  try {
    const { s, relayer } = setup(1000n * CHAIN.UNIT);
    bridgeIn(s, relayer, 200n * CHAIN.UNIT, 10);
    assert.throws(() => bridgeIn(s, relayer, 200n * CHAIN.UNIT, 10), /circuit breaker/); // 400>300
    // muito depois (fora da janela de 3600 blocos): a de height 10 sai da soma → reabre
    const h2 = 10 + CHAIN.BRIDGE_BREAKER_WINDOW_BLOCKS + 1;
    bridgeIn(s, relayer, 200n * CHAIN.UNIT, h2); // pool agora 800, cap 240, 0+200<=240 → ok
    assert.equal(s.bridge.lockedNative, 600n * CHAIN.UNIT);
  } finally { CHAIN.BRIDGE_BREAKER_HEIGHT = saved; }
});

test('breaker: releaseLog só existe a partir do fork (serialização de bridge intacta antes)', () => {
  const { s, relayer } = setup();
  bridgeIn(s, relayer, 100n * CHAIN.UNIT, 10); // abaixo do fork
  assert.equal(s.bridge.releaseLog, undefined, 'sem releaseLog abaixo do fork → stateRoot histórico inalterado');
});

test('breaker: BPS é governável (param sobrepõe o default)', () => {
  const saved = CHAIN.BRIDGE_BREAKER_HEIGHT; CHAIN.BRIDGE_BREAKER_HEIGHT = 1;
  try {
    const { s, relayer } = setup(1000n * CHAIN.UNIT);
    s.params.BRIDGE_BREAKER_BPS = 1000; // 10% → cap 100/janela
    bridgeIn(s, relayer, 100n * CHAIN.UNIT, 10); // 100 <= 100 → ok (limite exato)
    assert.throws(() => bridgeIn(s, relayer, 1n * CHAIN.UNIT, 10), /circuit breaker/); // 101 > 100
  } finally { CHAIN.BRIDGE_BREAKER_HEIGHT = saved; }
});
