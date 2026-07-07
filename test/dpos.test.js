import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildTransaction } from '../src/core/transaction.js';

test('DPoS: eleição por stake, rodízio de slots e produtor fora do slot rejeitado', () => {
  const w1 = generateKeyPair();
  const w2 = generateKeyPair();
  const addr1 = walletAddress(w1);
  const addr2 = walletAddress(w2);

  const chain = new Blockchain();
  // alinhado ao início de um slot (offset 0), para que eligibleProducer == primário
  const t0 = Math.floor((Date.now() - 120_000) / CHAIN.BLOCK_TIME_MS) * CHAIN.BLOCK_TIME_MS;
  chain.createGenesis({ address: addr1, timestamp: t0 });

  // financia w2 e ele faz stake suficiente para virar minerador
  const financia = buildTransaction(w1, {
    type: 'TRANSFER', to: addr2, amount: 3_000n * CHAIN.UNIT, nonce: 1,
  });
  chain.produceBlock(w1, [financia], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });

  const stake = buildTransaction(w2, {
    type: 'STAKE', amount: 2_000n * CHAIN.UNIT, nonce: 1,
  });
  chain.produceBlock(w1, [stake], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS });

  const validadores = chain.state.validators();
  assert.equal(validadores.length, 2);
  assert.equal(validadores[0].address, addr1); // maior stake primeiro
  assert.equal(validadores[1].address, addr2);

  // com 2 validadores, slots consecutivos alternam o produtor
  const ts = t0 + 10 * CHAIN.BLOCK_TIME_MS;
  const p1 = chain.expectedProducer(ts);
  const p2 = chain.expectedProducer(ts + CHAIN.BLOCK_TIME_MS);
  assert.notEqual(p1, p2);
  assert.ok([addr1, addr2].includes(p1));
  assert.ok([addr1, addr2].includes(p2));

  // produzir com a carteira errada para o slot é rejeitado
  const walletErrada = p1 === addr1 ? w2 : w1;
  assert.throws(() => chain.produceBlock(walletErrada, [], { timestamp: ts }), /slot/);

  // com a carteira certa, funciona — e o minerador recebe a recompensa
  const walletCerta = p1 === addr1 ? w1 : w2;
  const antes = chain.state.balanceOf(p1);
  chain.produceBlock(walletCerta, [], { timestamp: ts });
  assert.equal(chain.state.balanceOf(p1), antes + CHAIN.BLOCK_REWARD);
});
