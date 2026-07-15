// Testes da rotação de comitê da ponte (recomendação (d)).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';
import { N, bufToBig, sign, publicKeyFromPrivate, ethAddressFromPoint } from '../src/eavm/secp256k1.js';
import { committeeUpdateDigest, bridgeEventDigest } from '../src/bridge/proof.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

function member() {
  const priv = (bufToBig(randomBytes(32)) % (N - 1n)) + 1n;
  return { priv, addr: ethAddressFromPoint(publicKeyFromPrivate(priv)).toLowerCase() };
}
const signDigest = (m, digest) => { const { r, s, recId } = sign(digest, m.priv); return { r: r.toString(), s: s.toString(), recId: Number(recId) }; };

function setup() {
  const cur = [member(), member(), member()]; // comitê atual: 3, quórum 2, epoch 0
  const s = new State();
  s.bridgeSourceCommittees = { TRON: { members: cur.map((m) => m.addr), quorum: 2, epoch: 0 } };
  const submitter = generateKeyPair();
  s.credit(walletAddress(submitter), 100n * U);
  s.bridgeRelayers[walletAddress(submitter)] = true; // BRIDGE_COMMITTEE_UPDATE agora exige relayer (anti-DoS)
  return { s, cur, submitter };
}

test('(d) handoff assinado pelo comitê atual troca para o novo (epoch+1)', () => {
  const saved = CHAIN.BRIDGE_PROOF_HEIGHT; CHAIN.BRIDGE_PROOF_HEIGHT = 1;
  try {
    const { s, cur, submitter } = setup();
    const next = [member(), member(), member()];
    const newCommittee = { members: next.map((m) => m.addr), quorum: 2 };
    const digest = committeeUpdateDigest({ sourceChain: 'TRON', epoch: 1, members: newCommittee.members, quorum: 2 });
    const sigs = [signDigest(cur[0], digest), signDigest(cur[1], digest)]; // 2 de 3 atuais
    s.applyTransaction(buildTransaction(submitter, { type: 'BRIDGE_COMMITTEE_UPDATE', nonce: 1, data: { sourceChain: 'TRON', newCommittee, sigs } }), 5, now());
    const c = s.bridgeSourceCommittees.TRON;
    assert.equal(c.epoch, 1);
    assert.deepEqual(c.members.sort(), newCommittee.members.slice().sort());
    assert.equal(c.quorum, 2);
  } finally { CHAIN.BRIDGE_PROOF_HEIGHT = saved; }
});

test('(d) handoff sem quórum do comitê ATUAL é rejeitado', () => {
  const saved = CHAIN.BRIDGE_PROOF_HEIGHT; CHAIN.BRIDGE_PROOF_HEIGHT = 1;
  try {
    const { s, cur, submitter } = setup();
    const next = [member(), member()];
    const newCommittee = { members: next.map((m) => m.addr), quorum: 1 };
    const digest = committeeUpdateDigest({ sourceChain: 'TRON', epoch: 1, members: newCommittee.members, quorum: 1 });
    const sigs = [signDigest(cur[0], digest)]; // só 1 (quórum atual é 2)
    assert.throws(() => s.applyTransaction(buildTransaction(submitter, { type: 'BRIDGE_COMMITTEE_UPDATE', nonce: 1, data: { sourceChain: 'TRON', newCommittee, sigs } }), 5, now()), /sem quórum do comitê atual/);
  } finally { CHAIN.BRIDGE_PROOF_HEIGHT = saved; }
});

test('(d) após a rotação, BRIDGE_IN exige assinaturas do NOVO comitê', () => {
  const savedP = CHAIN.BRIDGE_PROOF_HEIGHT, savedQ = CHAIN.BRIDGE_QUORUM_HEIGHT;
  CHAIN.BRIDGE_PROOF_HEIGHT = 1; CHAIN.BRIDGE_QUORUM_HEIGHT = 1;
  try {
    const { s, cur, submitter } = setup();
    const next = [member(), member(), member()];
    const newCommittee = { members: next.map((m) => m.addr), quorum: 2 };
    const hd = committeeUpdateDigest({ sourceChain: 'TRON', epoch: 1, members: newCommittee.members, quorum: 2 });
    s.applyTransaction(buildTransaction(submitter, { type: 'BRIDGE_COMMITTEE_UPDATE', nonce: 1, data: { sourceChain: 'TRON', newCommittee, sigs: [signDigest(cur[0], hd), signDigest(cur[1], hd)] } }), 5, now());

    // prepara um BRIDGE_IN: relayer autorizado + fundos travados
    const relayer = generateKeyPair(); s.bridgeRelayers[walletAddress(relayer)] = true; s.credit(walletAddress(relayer), 100n * U);
    s.bridge.lockedNative = 1000n * U;
    const dest = walletAddress(generateKeyPair());
    const ev = { sourceChain: 'TRON', sourceTxHash: '0xdead', to: dest, amount: 5n * U, token: null };
    const digest = bridgeEventDigest(ev);
    // assinaturas dos membros ANTIGOS não valem mais
    const oldSigs = [signDigest(cur[0], digest), signDigest(cur[1], digest)];
    assert.throws(() => s.applyTransaction(buildTransaction(relayer, { type: 'BRIDGE_IN', to: dest, amount: 5n * U, nonce: 1, data: { sourceChain: 'TRON', sourceTxHash: '0xdead', token: null, proof: { sigs: oldSigs } } }), 5, now()), /prova do comitê insuficiente/);
    // com o NOVO comitê, libera
    const newSigs = [signDigest(next[0], digest), signDigest(next[1], digest)];
    s.applyTransaction(buildTransaction(relayer, { type: 'BRIDGE_IN', to: dest, amount: 5n * U, nonce: 1, data: { sourceChain: 'TRON', sourceTxHash: '0xdead', token: null, proof: { sigs: newSigs } } }), 5, now());
    assert.equal(s.balanceOf(dest), 5n * U);
  } finally { CHAIN.BRIDGE_PROOF_HEIGHT = savedP; CHAIN.BRIDGE_QUORUM_HEIGHT = savedQ; }
});
