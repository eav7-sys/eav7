// Testes da ponte trustless (feature #3): liberação por prova do comitê de origem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';
import {
  N, bufToBig, sign, publicKeyFromPrivate, ethAddressFromPoint,
} from '../src/eavm/secp256k1.js';
import { bridgeEventDigest } from '../src/bridge/proof.js';

// Membro do comitê da cadeia de origem: um par de chaves secp256k1 (como TRON/ETH).
function committeeMember() {
  const priv = (bufToBig(randomBytes(32)) % (N - 1n)) + 1n;
  const addr = ethAddressFromPoint(publicKeyFromPrivate(priv)).toLowerCase();
  return { priv, addr };
}
function signEvent(member, event) {
  const { r, s, recId } = sign(bridgeEventDigest(event), member.priv);
  return { r: r.toString(), s: s.toString(), recId: Number(recId) };
}

function bridgeSetup(members, quorum) {
  const relayer = generateKeyPair();
  const s = new State();
  s.bridgeRelayers = { [walletAddress(relayer)]: true };
  s.bridgeSourceCommittees = { TRON: { members: members.map((m) => m.addr), quorum } };
  s.bridge.lockedNative = 1000n * CHAIN.UNIT;
  s.credit(walletAddress(relayer), 100n * CHAIN.UNIT); // energia p/ fee
  return { s, relayer };
}

test('#3: prova do comitê com quórum libera o BRIDGE_IN (relayer só transporta)', () => {
  const saved = CHAIN.BRIDGE_PROOF_HEIGHT; CHAIN.BRIDGE_PROOF_HEIGHT = 1;
  try {
    const members = [committeeMember(), committeeMember(), committeeMember()]; // 3, quórum 2
    const { s, relayer } = bridgeSetup(members, 2);
    const dest = walletAddress(generateKeyPair());
    const amount = 5n * CHAIN.UNIT;
    const event = { sourceChain: 'TRON', sourceTxHash: '0xabc123', to: dest, amount, token: null };
    const proof = { sigs: [signEvent(members[0], event), signEvent(members[1], event)] };
    const tx = buildTransaction(relayer, {
      type: 'BRIDGE_IN', to: dest, amount, nonce: 1,
      data: { sourceChain: 'TRON', sourceTxHash: '0xabc123', token: null, proof },
    });
    s.applyTransaction(tx, 5, Date.now());
    assert.equal(s.balanceOf(dest), amount, 'com quórum de prova, libera');
    assert.equal(s.bridge.lockedNative, 1000n * CHAIN.UNIT - amount);
  } finally { CHAIN.BRIDGE_PROOF_HEIGHT = saved; }
});

test('#3: prova insuficiente (abaixo do quórum) NÃO libera', () => {
  const saved = CHAIN.BRIDGE_PROOF_HEIGHT; CHAIN.BRIDGE_PROOF_HEIGHT = 1;
  try {
    const members = [committeeMember(), committeeMember(), committeeMember()];
    const { s, relayer } = bridgeSetup(members, 2);
    const dest = walletAddress(generateKeyPair());
    const amount = 5n * CHAIN.UNIT;
    const event = { sourceChain: 'TRON', sourceTxHash: '0xabc123', to: dest, amount, token: null };
    const proof = { sigs: [signEvent(members[0], event)] }; // só 1 de 2
    const tx = buildTransaction(relayer, {
      type: 'BRIDGE_IN', to: dest, amount, nonce: 1,
      data: { sourceChain: 'TRON', sourceTxHash: '0xabc123', token: null, proof },
    });
    assert.throws(() => s.applyTransaction(tx, 5, Date.now()), /prova do comitê insuficiente/);
  } finally { CHAIN.BRIDGE_PROOF_HEIGHT = saved; }
});

test('#3: assinatura de NÃO-membro não conta', () => {
  const saved = CHAIN.BRIDGE_PROOF_HEIGHT; CHAIN.BRIDGE_PROOF_HEIGHT = 1;
  try {
    const members = [committeeMember(), committeeMember(), committeeMember()];
    const { s, relayer } = bridgeSetup(members, 2);
    const outsider = committeeMember(); // NÃO está no comitê
    const dest = walletAddress(generateKeyPair());
    const amount = 5n * CHAIN.UNIT;
    const event = { sourceChain: 'TRON', sourceTxHash: '0xabc123', to: dest, amount, token: null };
    const proof = { sigs: [signEvent(members[0], event), signEvent(outsider, event)] }; // 1 membro + 1 estranho
    const tx = buildTransaction(relayer, {
      type: 'BRIDGE_IN', to: dest, amount, nonce: 1,
      data: { sourceChain: 'TRON', sourceTxHash: '0xabc123', token: null, proof },
    });
    assert.throws(() => s.applyTransaction(tx, 5, Date.now()), /prova do comitê insuficiente/);
  } finally { CHAIN.BRIDGE_PROOF_HEIGHT = saved; }
});

test('#3: prova assinada para OUTRO valor não libera (digest amarra os campos)', () => {
  const saved = CHAIN.BRIDGE_PROOF_HEIGHT; CHAIN.BRIDGE_PROOF_HEIGHT = 1;
  try {
    const members = [committeeMember(), committeeMember(), committeeMember()];
    const { s, relayer } = bridgeSetup(members, 2);
    const dest = walletAddress(generateKeyPair());
    // comitê assina 5 EAV7, mas o relayer tenta liberar 500
    const signedEvent = { sourceChain: 'TRON', sourceTxHash: '0xabc123', to: dest, amount: 5n * CHAIN.UNIT, token: null };
    const proof = { sigs: [signEvent(members[0], signedEvent), signEvent(members[1], signedEvent)] };
    const tx = buildTransaction(relayer, {
      type: 'BRIDGE_IN', to: dest, amount: 500n * CHAIN.UNIT, nonce: 1,
      data: { sourceChain: 'TRON', sourceTxHash: '0xabc123', token: null, proof },
    });
    assert.throws(() => s.applyTransaction(tx, 5, Date.now()), /prova do comitê insuficiente/);
  } finally { CHAIN.BRIDGE_PROOF_HEIGHT = saved; }
});
