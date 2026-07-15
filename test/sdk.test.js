// Testes do tooling de dev (feature #8): SDK, faucet, verificação de contrato.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { Eav7Client, generateKeyPair, walletAddress } from '../src/sdk/eav7.js';
import { FaucetService } from '../src/sdk/faucet.js';
import { verifyTransaction } from '../src/core/transaction.js';
import { Eav7Node } from '../src/node/node.js';

const U = CHAIN.UNIT;

test('#8 SDK: build* monta txs válidas e assinadas (sem rede)', () => {
  const wallet = generateKeyPair();
  const client = new Eav7Client({ url: 'http://x', wallet });
  const dest = walletAddress(generateKeyPair());
  const tx = client.buildTransfer(dest, 5n * U, 1);
  assert.equal(verifyTransaction(tx), null, 'transferência deve ser válida');
  assert.equal(tx.from, walletAddress(wallet));
  // outras operações
  assert.equal(verifyTransaction(client.buildStake(10n * U, 2)), null);
  assert.equal(verifyTransaction(client.buildDelegate(dest, 3n * U, 3)), null);
  assert.equal(verifyTransaction(client.buildVote({ [dest]: (2n * U).toString() }, 4)), null);
});

test('#8 SDK: build rejeita uso inválido antes de ir à rede', () => {
  const client = new Eav7Client({ url: 'http://x', wallet: generateKeyPair() });
  // amount negativo → amountToString/validação falha ao montar
  assert.throws(() => client.buildTransfer(walletAddress(generateKeyPair()), -1n, 1));
  // client sem wallet não assina
  assert.throws(() => new Eav7Client({ url: 'http://x' }).buildTransfer('E7abc', 1n, 1), /sem wallet/);
});

test('#8 Faucet: dispensa e respeita o cooldown por endereço', async () => {
  let clock = 1_000_000;
  const sent = [];
  const fakeClient = { wallet: {}, transfer: async (to, amt) => { sent.push([to, amt]); return { id: 'tx' + sent.length }; } };
  const faucet = new FaucetService({ client: fakeClient, amount: 100n * U, cooldownMs: 1000, now: () => clock });
  const addr = walletAddress(generateKeyPair());
  const r1 = await faucet.dispense(addr);
  assert.equal(r1.id, 'tx1');
  assert.equal(sent[0][1], 100n * U);
  // dentro do cooldown → rejeita
  await assert.rejects(() => faucet.dispense(addr), /aguarde/);
  // passa o cooldown → libera
  clock += 1001;
  const r2 = await faucet.dispense(addr);
  assert.equal(r2.id, 'tx2');
});

test('#8 Faucet: falha no envio libera o slot para nova tentativa', async () => {
  let clock = 0;
  let fail = true;
  const fakeClient = { wallet: {}, transfer: async () => { if (fail) throw new Error('nó fora'); return { id: 'ok' }; } };
  const faucet = new FaucetService({ client: fakeClient, amount: 1n * U, cooldownMs: 10_000, now: () => clock });
  const addr = walletAddress(generateKeyPair());
  await assert.rejects(() => faucet.dispense(addr), /nó fora/);
  fail = false; // agora o nó responde; o slot não deve estar travado pelo cooldown
  const r = await faucet.dispense(addr);
  assert.equal(r.id, 'ok');
});

test('#8 Verificação de contrato: bytecode idêntico verifica, divergente falha', () => {
  const node = new Eav7Node({ validatorWallet: generateKeyPair(), eavm: false });
  const addr = '0x' + 'ab'.repeat(20);
  node.blockchain.state.contracts[addr] = { code: '0x6001600155' };
  // bytecode certo → verifica
  const ok = node.verifyContract(addr, { source: 'contract C {}', bytecode: '0x6001600155' });
  assert.equal(ok.verified, true);
  assert.equal(node.getVerifiedContract(addr).source, 'contract C {}');
  // bytecode errado → rejeita
  assert.throws(() => node.verifyContract(addr, { source: 'x', bytecode: '0xdead' }), /não confere/);
  // contrato inexistente → rejeita
  assert.throws(() => node.verifyContract('0x' + '00'.repeat(20), { source: 'x', bytecode: '0x00' }), /não encontrado/);
});
