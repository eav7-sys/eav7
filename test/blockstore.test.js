import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, appendFileSync, rmSync, statSync, truncateSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildTransaction } from '../src/core/transaction.js';

// Constrói uma cadeia em disco com N blocos; txs[n] (opcional) entra no bloco n.
function buildChain(dataDir, blocos, txs = {}) {
  const wallet = generateKeyPair();
  const address = walletAddress(wallet);
  const t0 = Math.floor((Date.now() - 600_000) / CHAIN.BLOCK_TIME_MS) * CHAIN.BLOCK_TIME_MS;
  const chain = new Blockchain({ dataDir });
  chain.createGenesis({ address, timestamp: t0 });
  for (let n = 1; n <= blocos; n++) {
    chain.produceBlock(wallet, txs[n] ?? [], { timestamp: t0 + n * CHAIN.BLOCK_TIME_MS });
  }
  return { chain, wallet, address, t0 };
}

test('janela: blocos antigos saem da RAM e são lidos do disco', () => {
  CHAIN.TAIL_BLOCKS = 6;
  try {
    const dataDir = mkdtempSync(join(tmpdir(), 'eav7-tail-'));
    const destino = walletAddress(generateKeyPair());
    const { chain, wallet } = buildChain(dataDir, 0);
    const tx = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount: 3n * CHAIN.UNIT, nonce: 1 });
    const t0 = chain.head.timestamp;
    chain.produceBlock(wallet, [tx], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
    for (let n = 2; n <= 20; n++) chain.produceBlock(wallet, [], { timestamp: t0 + n * CHAIN.BLOCK_TIME_MS });

    assert.equal(chain.height, 20);
    assert.ok(chain.tail.length <= 6, `janela em RAM tem ${chain.tail.length} blocos`);
    assert.ok(chain.tailStart > 1, 'o bloco 1 já foi expulso da RAM');
    // bloco expulso é lido do disco e é o bloco certo
    const b1 = chain.getBlock(1);
    assert.equal(b1.height, 1);
    assert.equal(b1.hash, chain.hashAt(1));
    assert.equal(b1.transactions[0].id, tx.id);
    // lookup por hash e por tx continuam funcionando para alturas fora da janela
    assert.equal(chain.getBlock(b1.hash).height, 1);
    assert.equal(chain.getTransaction(tx.id).blockHeight, 1);
    assert.equal(chain.getRange(0, 21).length, 21);
    assert.equal(chain.state.balanceOf(destino), 3n * CHAIN.UNIT);

    // replay do zero (sem snapshot) converge para o mesmo head e estado
    rmSync(join(dataDir, 'snapshot.json'), { force: true });
    const relida = new Blockchain({ dataDir });
    assert.equal(relida.height, 20);
    assert.equal(relida.head.hash, chain.head.hash);
    assert.equal(relida.state.balanceOf(destino), 3n * CHAIN.UNIT);
    assert.equal(relida.state.totalMinted, chain.state.totalMinted);
    assert.equal(relida.getBlock(1).hash, b1.hash);
  } finally {
    delete CHAIN.TAIL_BLOCKS;
  }
});

test('snapshot: boot parte do snapshot e replaya só o rabo', () => {
  CHAIN.TAIL_BLOCKS = 6;
  const intervalo = CHAIN.SNAPSHOT_INTERVAL_BLOCKS;
  CHAIN.SNAPSHOT_INTERVAL_BLOCKS = 5;
  try {
    const dataDir = mkdtempSync(join(tmpdir(), 'eav7-snap-'));
    const destino = walletAddress(generateKeyPair());
    const { chain, wallet } = buildChain(dataDir, 0);
    const tx = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount: 7n * CHAIN.UNIT, nonce: 1 });
    const t0 = chain.head.timestamp;
    chain.produceBlock(wallet, [tx], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
    for (let n = 2; n <= 12; n++) chain.produceBlock(wallet, [], { timestamp: t0 + n * CHAIN.BLOCK_TIME_MS });
    assert.ok(existsSync(join(dataDir, 'snapshot.json')), 'snapshot periódico foi gravado');

    const relida = new Blockchain({ dataDir });
    assert.equal(relida.height, 12);
    assert.equal(relida.head.hash, chain.head.hash);
    assert.equal(relida.state.balanceOf(destino), 7n * CHAIN.UNIT);
    assert.equal(relida.state.totalMinted, chain.state.totalMinted);
    assert.equal(relida.getTransaction(tx.id).blockHeight, 1);
    assert.deepEqual(relida.blocksWithTxs, chain.blocksWithTxs);
    // continua produzindo normalmente depois do boot por snapshot
    relida.produceBlock(wallet, [], { timestamp: t0 + 13 * CHAIN.BLOCK_TIME_MS });
    assert.equal(relida.height, 13);
  } finally {
    delete CHAIN.TAIL_BLOCKS;
    CHAIN.SNAPSHOT_INTERVAL_BLOCKS = intervalo;
  }
});

test('snapshot inválido (arquivo de blocos truncado) cai no replay completo', () => {
  const intervalo = CHAIN.SNAPSHOT_INTERVAL_BLOCKS;
  CHAIN.SNAPSHOT_INTERVAL_BLOCKS = 5;
  try {
    const dataDir = mkdtempSync(join(tmpdir(), 'eav7-snapbad-'));
    const { chain } = buildChain(dataDir, 8);
    assert.ok(existsSync(join(dataDir, 'snapshot.json')));
    // simula perda de dados: o arquivo de blocos encolheu (menos bytes que o snapshot espera)
    const file = join(dataDir, 'blocks.jsonl');
    truncateSync(file, statSync(file).size - 10);

    const relida = new Blockchain({ dataDir }); // não pode lançar
    assert.equal(relida.height, chain.height - 1); // última linha rasgada foi descartada
    assert.equal(relida.head.hash, chain.hashAt(chain.height - 1));
  } finally {
    CHAIN.SNAPSHOT_INTERVAL_BLOCKS = intervalo;
  }
});

test('reorg em disco: trunca no fork, appenda o rabo novo e sobrevive ao reboot', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'eav7-reorg-'));
  const destino = walletAddress(generateKeyPair());
  const { chain: a, wallet } = buildChain(dataDir, 0);
  const t0 = a.head.timestamp;
  const txOrfa = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount: 1n * CHAIN.UNIT, nonce: 1 });
  a.produceBlock(wallet, [txOrfa], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
  a.produceBlock(wallet, [], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS });

  // cadeia B: mesma gênese, mais longa, timestamps divergentes (fork da altura 0)
  const b = new Blockchain();
  b.adoptGenesis(structuredClone(a.getBlock(0)));
  for (let n = 1; n <= 4; n++) b.produceBlock(wallet, [], { timestamp: t0 + (n + 4) * CHAIN.BLOCK_TIME_MS });

  const orfas = a.reorg(0, structuredClone(b.getRange(1, 4)));
  assert.ok(Array.isArray(orfas));
  assert.equal(orfas[0]?.id, txOrfa.id); // a tx do ramo descartado volta como órfã
  assert.equal(a.height, 4);
  assert.equal(a.head.hash, b.head.hash);
  assert.equal(a.state.balanceOf(destino), 0n); // transferência órfã não vale mais
  assert.equal(a.getTransaction(txOrfa.id), null);

  // o disco reflete o reorg: reboot converge para a cadeia nova
  const relida = new Blockchain({ dataDir });
  assert.equal(relida.height, 4);
  assert.equal(relida.head.hash, b.head.hash);
  assert.equal(relida.state.totalMinted, a.state.totalMinted);
});

test('lacuna no arquivo (blocos perdidos): mantém o prefixo válido e trunca o resto', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'eav7-gap-'));
  const { chain } = buildChain(dataDir, 6);
  // remonta o arquivo sem os blocos 4 e 5 (o 6 fica órfão depois da lacuna) —
  // exatamente a corrupção vista em produção (appends perdidos sob pressão de RAM)
  const file = join(dataDir, 'blocks.jsonl');
  const linhas = readFileSync(file, 'utf8').trim().split('\n');
  writeFileSync(file, [...linhas.slice(0, 4), linhas[6]].join('\n') + '\n');

  const relida = new Blockchain({ dataDir }); // não pode lançar
  assert.equal(relida.height, 3); // prefixo válido preservado
  assert.equal(relida.head.hash, chain.hashAt(3));
  // o lixo além da lacuna foi truncado do arquivo: um reboot é idempotente
  const denovo = new Blockchain({ dataDir });
  assert.equal(denovo.height, 3);
  assert.equal(denovo.head.hash, chain.hashAt(3));
});

test('append rasgado por crash: a linha parcial final é truncada no boot', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'eav7-torn-'));
  const { chain, wallet } = buildChain(dataDir, 3);
  const file = join(dataDir, 'blocks.jsonl');
  const bytesAntes = statSync(file).size;
  appendFileSync(file, '{"height":4,"hash":"E7QUEBRADO'); // crash no meio do append (sem \n)

  const relida = new Blockchain({ dataDir });
  assert.equal(relida.height, 3);
  assert.equal(relida.head.hash, chain.head.hash);
  assert.equal(statSync(file).size, bytesAntes); // o lixo foi removido do arquivo
  // e o próximo append cai no offset certo
  relida.produceBlock(wallet, [], { timestamp: chain.head.timestamp + CHAIN.BLOCK_TIME_MS });
  const denovo = new Blockchain({ dataDir });
  assert.equal(denovo.height, 4);
  assert.equal(denovo.head.hash, relida.head.hash);
});
