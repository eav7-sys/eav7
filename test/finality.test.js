// Testes da finalidade BFT (feature #2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildGenesisBlock } from '../src/core/block.js';

// Monta uma cadeia com N validadores de stake igual, semeados na gênese.
function multiValidatorChain(n, t0) {
  const wallets = Array.from({ length: n }, () => generateKeyPair());
  const byAddr = Object.fromEntries(wallets.map((w) => [walletAddress(w), w]));
  const stakes = Object.fromEntries(Object.keys(byAddr).map((a) => [a, (CHAIN.MIN_VALIDATOR_STAKE * 2n).toString()]));
  const gen = buildGenesisBlock({ timestamp: t0, balances: {}, stakes });
  const chain = new Blockchain();
  chain.adoptGenesis(gen);
  return { chain, byAddr, gen };
}

// Produz `count` blocos em rodízio: cada slot é preenchido pelo produtor esperado.
function produceRound(chain, byAddr, t0, count, slotOffset = 1) {
  for (let i = 0; i < count; i++) {
    const ts = t0 + (i + slotOffset) * CHAIN.BLOCK_TIME_MS;
    const producer = chain.expectedProducer(ts);
    chain.produceBlock(byAddr[producer], [], { timestamp: ts });
  }
}

test('#2: finalidade avança com >= 2/3+1 validadores distintos', () => {
  const t0 = Date.now() - 300_000;
  const { chain, byAddr } = multiValidatorChain(3, t0); // N=3 → quórum 3
  assert.equal(chain.finalizedHeight(), -1, 'sem blocos suficientes, nada finalizado');
  produceRound(chain, byAddr, t0, 8);
  const fin = chain.finalizedHeight();
  assert.ok(fin >= 0, `deveria haver finalidade (fin=${fin})`);
  assert.ok(fin < chain.height, 'a cabeça ainda não está finalizada (finalidade fica atrás do head)');
});

test('#2: reorg abaixo do bloco finalizado é REJEITADO', () => {
  const t0 = Date.now() - 300_000;
  const { chain, byAddr, gen } = multiValidatorChain(3, t0);
  produceRound(chain, byAddr, t0, 8);
  const fin = chain.finalizedHeight();
  assert.ok(fin >= 1, `precisa de finalidade > 0 para o teste (fin=${fin})`);

  // cadeia B: mesma gênese, ramo alternativo MAIS LONGO a partir da altura 0
  const b = new Blockchain();
  b.adoptGenesis(gen);
  produceRound(b, byAddr, t0, 12, 20); // timestamps diferentes → hashes divergentes

  // reorg com ponto de fork (0) ABAIXO do finalizado → rejeitado pela finalidade BFT
  assert.throws(
    () => chain.reorg(0, b.getRange(1, 12)),
    /finalizado por BFT/,
  );
});

test('#2: com < FINALITY_MIN_VALIDATORS não há finalidade (dev/bootstrap)', () => {
  const t0 = Date.now() - 300_000;
  const { chain, byAddr } = multiValidatorChain(2, t0); // N=2 < 3 → sem BFT
  produceRound(chain, byAddr, t0, 6);
  assert.equal(chain.finalizedHeight(), -1);
});
