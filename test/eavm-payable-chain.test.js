// Fase 2.3 na CADEIA: verifica a fiação bloco→índice que a API /internal lê.
//
// Simula o gênese-ativo (todas as alturas de fork em 0), que é como a rede vai
// nascer. `node --test` isola cada arquivo em seu próprio processo, então mutar
// CHAIN aqui não vaza para os outros testes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';

CHAIN.EAVM_VALUE_HEIGHT = 0;

const { generateKeyPair, walletAddress } = await import('../src/crypto/keys.js');
const { Blockchain } = await import('../src/core/blockchain.js');
const { buildGenesisBlock } = await import('../src/core/block.js');
const { buildTransaction } = await import('../src/core/transaction.js');
const { keccak256 } = await import('../src/eavm/keccak.js');
const { encodeE7Dest } = await import('../src/eavm/envelope.js');

const createAddr = (s, n) => '0x' + keccak256(Buffer.from(s + ':' + n)).subarray(12).toString('hex');
// Runtime: devolve TODO o saldo do contrato ao destino fixo (35 bytes).
const payoutRuntime = (target) =>
  '6000600060006000' + '47' + '73' + target.slice(2).toLowerCase() + '61ffff' + 'f1' + '00';
const initFor = (runtime) => '6023600c60003960236000f3' + runtime;
// Runtime que emite LOG1 (topic 0x42) — para provar a separação dos dois índices.
const LOGGER = '604260006000a100';
const INIT_LOGGER = '6008600c60003960086000f3' + LOGGER;

function chainWith(wallet, balanceEav7) {
  const addr = walletAddress(wallet);
  const t0 = Date.now() - 60_000;
  const gen = buildGenesisBlock({
    timestamp: t0,
    balances: { [addr]: (balanceEav7 * CHAIN.UNIT).toString() },
    stakes: { [addr]: (CHAIN.MIN_VALIDATOR_STAKE * 2n).toString() },
  });
  const chain = new Blockchain();
  chain.adoptGenesis(gen);
  return { chain, addr, t0 };
}

test('2.3 cadeia: transferência interna entra em internalIndex, não em logIndex', () => {
  const w = generateKeyPair();
  const { chain, addr, t0 } = chainWith(w, 1000n);
  const sink = walletAddress(generateKeyPair());
  const target = encodeE7Dest(sink);

  let slot = 1;
  const produce = (txs) => {
    const ts = t0 + slot++ * CHAIN.BLOCK_TIME_MS;
    return chain.produceBlock(w, txs, { timestamp: ts });
  };

  produce([buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + initFor(payoutRuntime(target)) } })]);
  const contract = createAddr(encodeE7Dest(addr), 0);
  assert.ok(chain.state.contracts[contract]?.code, 'contrato implantado no bloco');

  const call = buildTransaction(w, { type: 'EAVM_CALL', amount: 6n * CHAIN.UNIT, nonce: 2, data: { to: contract, input: '0x' } });
  produce([call]);

  assert.equal(chain.internalIndex.length, 1, 'uma transferência interna indexada');
  const x = chain.internalIndex[0];
  assert.equal(x.txId, call.id);
  assert.equal(x.toE7, sink);
  assert.equal(x.amount, (6n * CHAIN.UNIT).toString());
  assert.equal(typeof x.blockHeight, 'number', 'altura do bloco anotada (filtro ?from=)');
  assert.equal(chain.logIndex.length, 0, 'índice de eventos NÃO foi poluído');

  // e o valor realmente chegou ao destino
  assert.equal(chain.state.balanceOf(sink), 6n * CHAIN.UNIT);
});

test('2.3 cadeia: eventos e transferências internas coexistem em índices separados', () => {
  const w = generateKeyPair();
  const { chain, addr, t0 } = chainWith(w, 1000n);
  let slot = 1;
  const produce = (txs) => chain.produceBlock(w, txs, { timestamp: t0 + slot++ * CHAIN.BLOCK_TIME_MS });

  produce([buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + INIT_LOGGER } })]);
  const logger = createAddr(encodeE7Dest(addr), 0);
  produce([buildTransaction(w, { type: 'EAVM_CALL', amount: 0, nonce: 2, data: { to: logger, input: '0x' } })]);

  assert.equal(chain.logIndex.length, 1, 'evento indexado');
  assert.equal(chain.internalIndex.length, 0, 'nenhuma transferência interna (chamada sem valor)');
});
