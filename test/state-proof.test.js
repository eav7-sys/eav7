// Testes das provas de estado (light clients).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { computeStateRoot, accountProof, verifyAccountProof, decodeProofBig, accountLeafFromEncoded } from '../src/core/stateroot.js';

const U = CHAIN.UNIT;

function stateWithAccounts(n) {
  const s = new State();
  const addrs = [];
  for (let i = 0; i < n; i++) { const a = walletAddress(generateKeyPair()); addrs.push(a); s.credit(a, BigInt(i + 1) * U); s.getAccount(a).staked = BigInt(i) * U; }
  return { s, addrs };
}

test('prova de estado: uma conta é provada contra o stateRoot sem o estado inteiro', () => {
  const { s, addrs } = stateWithAccounts(9); // exercita níveis ímpares na árvore
  const root = computeStateRoot(s);
  for (const a of addrs) {
    const p = accountProof(s, a);
    assert.ok(p, 'prova existe');
    // o cliente recompõe a folha do encodedAccount e valida o caminho até a raiz
    assert.ok(verifyAccountProof(root, a, p.encodedAccount, p.path), `prova de ${a} não valida`);
    // e lê o saldo provado
    assert.equal(decodeProofBig(p.encodedAccount.balance), s.balanceOf(a));
  }
});

test('prova de estado: conta adulterada ou raiz errada falham', () => {
  const { s, addrs } = stateWithAccounts(5);
  const root = computeStateRoot(s);
  const a = addrs[2];
  const p = accountProof(s, a);
  // adultera o saldo no encodedAccount → folha muda → não valida contra a raiz
  const tampered = { ...p.encodedAccount, balance: 'B999999999999' };
  assert.equal(verifyAccountProof(root, a, tampered, p.path), false);
  // raiz errada
  assert.equal(verifyAccountProof('E7' + '0'.repeat(62), a, p.encodedAccount, p.path), false);
  // folha recomposta bate com a folha da prova (consistência do encode)
  assert.equal(accountLeafFromEncoded(a, p.encodedAccount), p.leaf);
});

test('prova de estado: acompanha mudanças (nova raiz após uma transferência)', () => {
  const { s, addrs } = stateWithAccounts(4);
  const a = addrs[0];
  const root1 = computeStateRoot(s);
  const p1 = accountProof(s, a);
  assert.ok(verifyAccountProof(root1, a, p1.encodedAccount, p1.path));
  s.credit(a, 100n * U); // muda o estado
  const root2 = computeStateRoot(s);
  assert.notEqual(root1, root2);
  const p2 = accountProof(s, a);
  assert.ok(verifyAccountProof(root2, a, p2.encodedAccount, p2.path));
  // a prova antiga não valida contra a raiz nova
  assert.equal(verifyAccountProof(root2, a, p1.encodedAccount, p1.path), false);
});
