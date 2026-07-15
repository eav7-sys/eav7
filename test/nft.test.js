// Testes do padrão de NFT nativo EAV721.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

function collection() {
  const owner = generateKeyPair();
  const s = new State(); s.credit(walletAddress(owner), 100n * U);
  const create = buildTransaction(owner, { type: 'NFT_CREATE', nonce: 1, data: { name: 'Arte', symbol: 'ART' } });
  s.applyTransaction(create, 5, now());
  return { s, owner, cid: Object.keys(s.nfts)[0] };
}

test('EAV721: create + mint (só owner) atribui dono e uri', () => {
  const saved = CHAIN.NFT_HEIGHT; CHAIN.NFT_HEIGHT = 1;
  try {
    const { s, owner, cid } = collection();
    const alice = walletAddress(generateKeyPair());
    s.applyTransaction(buildTransaction(owner, { type: 'NFT_MINT', to: alice, nonce: 2, data: { collection: cid, uri: 'ipfs://x' } }), 5, now());
    assert.equal(s.nfts[cid].tokens['1'].owner, alice);
    assert.equal(s.nfts[cid].tokens['1'].uri, 'ipfs://x');
    // não-owner não faz mint
    const intruso = generateKeyPair(); s.credit(walletAddress(intruso), 1n * U);
    assert.throws(() => s.applyTransaction(buildTransaction(intruso, { type: 'NFT_MINT', to: alice, nonce: 1, data: { collection: cid } }), 5, now()), /só o owner/);
  } finally { CHAIN.NFT_HEIGHT = saved; }
});

test('EAV721: transferência pelo dono; terceiro sem aprovação é rejeitado', () => {
  const saved = CHAIN.NFT_HEIGHT; CHAIN.NFT_HEIGHT = 1;
  try {
    const { s, owner, cid } = collection();
    const alice = generateKeyPair(); const aAddr = walletAddress(alice);
    const bob = walletAddress(generateKeyPair());
    s.applyTransaction(buildTransaction(owner, { type: 'NFT_MINT', to: aAddr, nonce: 2, data: { collection: cid } }), 5, now());
    // estranho não transfere
    const estranho = generateKeyPair(); s.credit(walletAddress(estranho), 1n * U);
    assert.throws(() => s.applyTransaction(buildTransaction(estranho, { type: 'NFT_TRANSFER', to: bob, nonce: 1, data: { collection: cid, tokenId: 1 } }), 5, now()), /não é dono nem aprovado/);
    // dono transfere para bob
    s.applyTransaction(buildTransaction(alice, { type: 'NFT_TRANSFER', to: bob, nonce: 1, data: { collection: cid, tokenId: 1 } }), 5, now());
    assert.equal(s.nfts[cid].tokens['1'].owner, bob);
  } finally { CHAIN.NFT_HEIGHT = saved; }
});

test('EAV721: approve permite operador transferir uma vez; depois some; burn pelo dono', () => {
  const saved = CHAIN.NFT_HEIGHT; CHAIN.NFT_HEIGHT = 1;
  try {
    const { s, owner, cid } = collection();
    const alice = generateKeyPair(); const aAddr = walletAddress(alice);
    const op = generateKeyPair(); const opAddr = walletAddress(op); s.credit(opAddr, 1n * U);
    const bob = generateKeyPair(); const bAddr = walletAddress(bob); s.credit(bAddr, 1n * U);
    s.applyTransaction(buildTransaction(owner, { type: 'NFT_MINT', to: aAddr, nonce: 2, data: { collection: cid } }), 5, now());
    // alice aprova o operador
    s.applyTransaction(buildTransaction(alice, { type: 'NFT_APPROVE', to: opAddr, nonce: 1, data: { collection: cid, tokenId: 1 } }), 5, now());
    assert.equal(s.nfts[cid].approvals['1'], opAddr);
    // operador transfere para bob; aprovação some
    s.applyTransaction(buildTransaction(op, { type: 'NFT_TRANSFER', to: bAddr, nonce: 1, data: { collection: cid, tokenId: 1 } }), 5, now());
    assert.equal(s.nfts[cid].tokens['1'].owner, bAddr);
    assert.equal(s.nfts[cid].approvals['1'], undefined, 'aprovação limpa após transferir');
    // operador não transfere de novo (sem aprovação, não é dono)
    assert.throws(() => s.applyTransaction(buildTransaction(op, { type: 'NFT_TRANSFER', to: aAddr, nonce: 2, data: { collection: cid, tokenId: 1 } }), 5, now()), /não é dono nem aprovado/);
    // bob (dono) queima
    s.applyTransaction(buildTransaction(bob, { type: 'NFT_BURN', nonce: 1, data: { collection: cid, tokenId: 1 } }), 5, now());
    assert.equal(s.nfts[cid].tokens['1'], undefined, 'NFT queimado');
  } finally { CHAIN.NFT_HEIGHT = saved; }
});
