import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { Blockchain } from '../src/core/blockchain.js';
import { Mempool } from '../src/core/mempool.js';
import { State } from '../src/core/state.js';
import { buildTransaction } from '../src/core/transaction.js';

test('supply: conservação — soma dos saldos+stake = gênese + mintado − queimado', () => {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  const t0 = Math.floor((Date.now() - 120_000) / CHAIN.BLOCK_TIME_MS) * CHAIN.BLOCK_TIME_MS;
  const chain = new Blockchain();
  chain.createGenesis({ address: addr, timestamp: t0 });
  const alvo = walletAddress(generateKeyPair());
  // produz alguns blocos com transferências (o produtor ganha reward; nada queimado pois tem energia)
  for (let n = 1; n <= 4; n++) {
    chain.produceBlock(w, [buildTransaction(w, { type: 'TRANSFER', to: alvo, amount: 1n * CHAIN.UNIT, nonce: n })], { timestamp: t0 + n * CHAIN.BLOCK_TIME_MS });
  }
  const st = chain.state;
  let soma = 0n;
  for (const a of Object.values(st.accounts)) soma += a.balance + a.staked;
  assert.equal(soma, CHAIN.GENESIS_SUPPLY + st.totalMinted - st.totalBurned);
  assert.equal(st.totalMinted, 4n * CHAIN.BLOCK_REWARD); // 4 blocos de recompensa
});

test('energia: stake aumenta a energia máxima e a energia usada regenera', () => {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  const alvo = walletAddress(generateKeyPair());
  const state = new State();
  state.getAccount(addr).balance = 100n * CHAIN.UNIT;

  assert.equal(state.energyOf(addr, 0).max, CHAIN.ENERGY.FREE); // sem stake => só a cota grátis
  state.getAccount(addr).staked = 50n * CHAIN.UNIT;
  assert.equal(state.energyOf(addr, 0).max, CHAIN.ENERGY.FREE + 50); // +1 por EAV7 travado

  // gasta 5 de energia (5 transferências no bloco 0)
  for (let n = 1; n <= 5; n++) state.applyTransaction(buildTransaction(w, { type: 'TRANSFER', to: alvo, amount: 1n, nonce: n }), 0);
  assert.equal(state.energyOf(addr, 0).available, CHAIN.ENERGY.FREE + 50 - 5);
  // após REGEN_BLOCKS blocos, a energia usada regenera 100%
  assert.equal(state.energyOf(addr, CHAIN.ENERGY.REGEN_BLOCKS).available, CHAIN.ENERGY.FREE + 50);
  assert.equal(state.totalBurned, 0n); // tudo coberto por energia => nada queimado
});

function setup() {
  const wallet = generateKeyPair();
  const address = walletAddress(wallet);
  const chain = new Blockchain();
  const t0 = Date.now() - 60_000;
  chain.createGenesis({ address, timestamp: t0 });
  return { wallet, address, chain, t0 };
}

test('gênese: tokenomics padrão Tron e validador inicial', () => {
  const { chain, address } = setup();
  assert.equal(chain.height, 0);
  assert.ok(chain.head.hash.startsWith('E7'));
  assert.equal(chain.state.balanceOf(address), CHAIN.GENESIS_SUPPLY - CHAIN.GENESIS_STAKE);
  assert.equal(chain.state.accounts[address].staked, CHAIN.GENESIS_STAKE);
  assert.equal(CHAIN.GENESIS_SUPPLY, 100_000_000_000n * CHAIN.UNIT); // 100 bi como a Tron
  assert.equal(CHAIN.BLOCK_REWARD, 16n * CHAIN.UNIT); // 16 EAV7 como os 16 TRX
  assert.ok(CHAIN.BLOCK_TIME_MS < 3000); // mais rápido que a Tron
  assert.deepEqual(chain.state.validators().map((v) => v.address), [address]);
});

test('transferência: saldos, recompensa de minerador e taxas', () => {
  const { chain, wallet, address, t0 } = setup();
  const destino = walletAddress(generateKeyPair());
  const amount = 5n * CHAIN.UNIT;

  const tx = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount, nonce: 1 });
  const antes = chain.state.balanceOf(address);
  chain.produceBlock(wallet, [tx], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });

  assert.equal(chain.height, 1);
  assert.equal(chain.state.balanceOf(destino), amount);
  // remetente == minerador: paga amount+fee, recebe reward+fee de volta
  assert.equal(chain.state.balanceOf(address), antes - amount + CHAIN.BLOCK_REWARD);
  assert.equal(chain.getTransaction(tx.id).blockHeight, 1);
});

test('energia: cota grátis + stake cobrem taxas; sem energia e limite 0 é rejeitado; senão queima', () => {
  const { chain, wallet, t0 } = setup();
  const pobre = generateKeyPair();
  const pobreAddr = walletAddress(pobre);
  const alvo = walletAddress(generateKeyPair());

  // genesis (staked 10k => muita energia) envia com limite de taxa 0 — a energia cobre
  const semTaxa = buildTransaction(wallet, { type: 'TRANSFER', to: pobreAddr, amount: 50n * CHAIN.UNIT, fee: 0n, nonce: 1 });
  chain.produceBlock(wallet, [semTaxa], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
  assert.equal(chain.state.balanceOf(pobreAddr), 50n * CHAIN.UNIT);

  // pobre (sem stake) tem a cota grátis (FREE). Gasta toda a cota de graça.
  const sim = chain.state.clone();
  for (let n = 1; n <= CHAIN.ENERGY.FREE; n++) {
    sim.applyTransaction(buildTransaction(pobre, { type: 'TRANSFER', to: alvo, amount: 1n, fee: 0n, nonce: n }), 0);
  }
  assert.equal(sim.totalBurned, 0n); // tudo dentro da cota grátis => nada queimado

  // sem energia e com limite 0 => rejeitada
  assert.throws(() => sim.clone().applyTransaction(
    buildTransaction(pobre, { type: 'TRANSFER', to: alvo, amount: 1n, fee: 0n, nonce: CHAIN.ENERGY.FREE + 1 }), 0,
  ), /energia insuficiente|limite/);

  // sem energia mas com limite suficiente => queima EAV7 (deflacionário)
  sim.applyTransaction(buildTransaction(pobre, { type: 'TRANSFER', to: alvo, amount: 1n, nonce: CHAIN.ENERGY.FREE + 1 }), 0);
  assert.equal(sim.totalBurned, CHAIN.ENERGY.BURN_PER_ENERGY); // 1 unidade de energia em falta queimada
});

test('regras de estado: nonce, saldo e blocos inválidos', () => {
  const { chain, wallet, t0 } = setup();
  const destino = walletAddress(generateKeyPair());

  const nonceErrado = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount: 1n, nonce: 7 });
  assert.throws(() => chain.state.clone().applyTransaction(nonceErrado), /nonce/);

  const semSaldo = generateKeyPair();
  const txSemSaldo = buildTransaction(semSaldo, { type: 'TRANSFER', to: destino, amount: 1n, nonce: 1 });
  assert.throws(() => chain.state.clone().applyTransaction(txSemSaldo), /saldo/);

  // produtor fora do slot / carteira que não é validadora
  const intruso = generateKeyPair();
  assert.throws(
    () => chain.produceBlock(intruso, [], { timestamp: t0 + CHAIN.BLOCK_TIME_MS }),
    /slot/,
  );
});

test('mempool: seleção executável respeita nonce e descarta inválidas', () => {
  const { chain, wallet } = setup();
  const mempool = new Mempool();
  const destino = walletAddress(generateKeyPair());

  const tx2 = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount: 1n * CHAIN.UNIT, nonce: 2 });
  const tx1 = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount: 1n * CHAIN.UNIT, nonce: 1 });
  const semSaldo = buildTransaction(generateKeyPair(), { type: 'TRANSFER', to: destino, amount: 1n, nonce: 1 });
  mempool.add(tx2);
  mempool.add(tx1);
  mempool.add(semSaldo);

  const selecionadas = mempool.selectExecutable(chain.state);
  assert.deepEqual(selecionadas.map((tx) => tx.nonce), [1, 2]);
});

test('persistência: cadeia recarregada do disco por replay', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'eav7-test-'));
  const wallet = generateKeyPair();
  const address = walletAddress(wallet);
  const t0 = Date.now() - 60_000;

  const chain = new Blockchain({ dataDir });
  chain.createGenesis({ address, timestamp: t0 });
  const destino = walletAddress(generateKeyPair());
  const tx = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount: 7n * CHAIN.UNIT, nonce: 1 });
  chain.produceBlock(wallet, [tx], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });

  // formato incremental: um blocks.jsonl (não o chain.json cheio reescrito)
  assert.ok(existsSync(join(dataDir, 'blocks.jsonl')));
  const recarregada = new Blockchain({ dataDir });
  assert.equal(recarregada.height, 1);
  assert.equal(recarregada.head.hash, chain.head.hash);
  assert.equal(recarregada.state.balanceOf(destino), 7n * CHAIN.UNIT);
});

test('persistência: migra chain.json legado para blocks.jsonl', () => {
  const wallet = generateKeyPair();
  const address = walletAddress(wallet);
  const t0 = Date.now() - 60_000;
  // cria uma cadeia em memória e grava no formato LEGADO (array único)
  const src = new Blockchain();
  src.createGenesis({ address, timestamp: t0 });
  src.produceBlock(wallet, [], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
  const dataDir = mkdtempSync(join(tmpdir(), 'eav7-mig-'));
  writeFileSync(join(dataDir, 'chain.json'), JSON.stringify(src.getRange(0, src.height + 1)));

  const loaded = new Blockchain({ dataDir }); // deve migrar
  assert.equal(loaded.height, 1);
  assert.equal(loaded.head.hash, src.head.hash);
  assert.ok(existsSync(join(dataDir, 'blocks.jsonl')));       // novo formato criado
  assert.ok(existsSync(join(dataDir, 'chain.json.legacy')));  // legado renomeado
});

test('fork choice: adota a cadeia válida mais longa com a mesma gênese', () => {
  const wallet = generateKeyPair();
  const address = walletAddress(wallet);
  const t0 = Date.now() - 60_000;

  const a = new Blockchain();
  a.createGenesis({ address, timestamp: t0 });
  const b = new Blockchain();
  b.adoptGenesis(structuredClone(a.getBlock(0)));

  b.produceBlock(wallet, [], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
  b.produceBlock(wallet, [], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS });

  assert.equal(a.height, 0);
  assert.ok(a.replaceChain(structuredClone(b.getRange(0, b.height + 1))));
  assert.equal(a.height, 2);
  assert.equal(a.head.hash, b.head.hash);
});
