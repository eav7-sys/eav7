// Ciclo de vida da cadeia: gênese → expulsão da janela → âncora → reorg → replay.
//
// Duas frentes, de propósito:
//
//   1. o VETOR (vectors/lifecycle.json) — as relações que qualquer implementação
//      tem de reproduzir. A regeneração byte a byte já é conferida em
//      vectors.test.js; aqui conferimos que o vetor AFIRMA as invariantes certas
//      (um gerador quebrado que gravasse âncora errada passaria na regeneração —
//      ela só prova determinismo, não sentido);
//
//   2. o CAMINHO REAL — cadeia assinada, janela encolhida (TAIL_BLOCKS) e disco,
//      passando pelo `#slideTail`/`reorg`/boot de verdade. É a lição dos três
//      bugs (docs/plano/07-metodo-testes.md): o teste tem de CONSTRUIR a
//      situação a partir da gênese, não montar a pré-condição pronta. O vetor
//      fixa os números entre clientes; este teste garante que o nó de referência
//      continua fazendo o que o vetor descreve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { Blockchain } from '../src/core/blockchain.js';
import { State } from '../src/core/state.js';
import { computeStateRoot } from '../src/core/stateroot.js';
import { buildTransaction } from '../src/core/transaction.js';

const RAIZ = new URL('..', import.meta.url).pathname;
const vetor = JSON.parse(readFileSync(join(RAIZ, 'vectors', 'lifecycle.json'), 'utf8'));

// ---------------------------------------------------------------- o vetor

test('vetor: a âncora da PRIMEIRA expulsão é a alocação da gênese', () => {
  // O caso do bug real: tail_start 0 → 1, âncora nenhuma. `unwrap_or_default()`
  // aqui produzia "estado vazio + bloco 0" e perdia saldo, stake e tesouro.
  const primeira = vetor.evictions[0];
  assert.equal(primeira.tailStart, 1);
  assert.equal(primeira.anchorRoot, vetor.genesis.stateRoot,
    'a âncora que sai da primeira expulsão tem de ser a raiz da ALOCAÇÃO da gênese');
  assert.notEqual(vetor.genesis.stateRoot, computeStateRoot(new State()),
    'a alocação da gênese não pode coincidir com estado vazio — senão o vetor não distingue o bug');
});

test('vetor: após k expulsões a âncora é o estado APÓS o bloco k-1', () => {
  for (const e of vetor.evictions.slice(1)) {
    const alvo = vetor.blocks.find((b) => b.height === e.tailStart - 1);
    assert.ok(alvo, `bloco ${e.tailStart - 1} presente no vetor`);
    assert.equal(e.anchorRoot, alvo.stateRootAfter,
      `âncora com tailStart=${e.tailStart} tem de ser a raiz após o bloco ${e.tailStart - 1}`);
  }
});

test('vetor: o reorg parte da raiz do bloco comum e o rival é contíguo e mais longo', () => {
  const { common, rootAtFork, rival, rootAfterReorg } = vetor.reorg;
  assert.equal(rootAtFork, vetor.blocks.find((b) => b.height === common).stateRootAfter,
    'o estado no ponto de fork é o estado após o bloco comum');
  const cabeca = vetor.blocks[vetor.blocks.length - 1].height;
  assert.ok(common + rival.length > cabeca, 'o rabo rival tem de deixar a cadeia MAIS LONGA');
  rival.forEach((b, i) => assert.equal(b.height, common + 1 + i, 'alturas do rival são contíguas ao comum'));
  assert.equal(rootAfterReorg, rival[rival.length - 1].stateRootAfter);
  assert.notEqual(rootAfterReorg, vetor.headRoot, 'o ramo rival tem de produzir estado DIFERENTE do original');
});

// ---------------------------------------------------------- o caminho real

test('caminho real: gênese → expulsão → âncora → reorg → replay, com disco e janela curta', () => {
  CHAIN.TAIL_BLOCKS = 6;
  const dataDir = mkdtempSync(join(tmpdir(), 'eav7-ciclo-'));
  try {
    const w = generateKeyPair();
    const addr = walletAddress(w);
    const destino = walletAddress(generateKeyPair());
    const t0 = Math.floor((Date.now() - 600_000) / CHAIN.BLOCK_TIME_MS) * CHAIN.BLOCK_TIME_MS;
    const chain = new Blockchain({ dataDir });
    const genese = chain.createGenesis({ address: addr, timestamp: t0 });
    assert.equal(chain.tailStart, 0);
    assert.equal(chain.baseState, null, 'a cadeia nasce SEM âncora — é o caso do bug');

    // Blocos até a PRIMEIRA expulsão: no bloco 6 a janela passa a 7 (> 6) e a
    // gênese — e SÓ ela — é expulsa.
    const tx1 = buildTransaction(w, {
      type: 'TRANSFER', to: destino, amount: 3n * CHAIN.UNIT, nonce: 1, timestamp: t0 + CHAIN.BLOCK_TIME_MS,
    });
    chain.produceBlock(w, [tx1], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
    for (let n = 2; n <= 6; n++) chain.produceBlock(w, [], { timestamp: t0 + n * CHAIN.BLOCK_TIME_MS });
    assert.equal(chain.tailStart, 1, 'a gênese foi expulsa da janela');

    // A âncora que saiu é a ALOCAÇÃO da gênese — nunca "vazio + bloco 0".
    const soGenese = new State();
    soGenese.applyGenesis(genese.genesis);
    assert.equal(computeStateRoot(chain.baseState), computeStateRoot(soGenese),
      'a âncora da primeira expulsão tem de ser a alocação da gênese');

    // Mais blocos: a âncora avança e continua sendo o estado após tailStart-1.
    for (let n = 8; n <= 10; n++) chain.produceBlock(w, [], { timestamp: t0 + n * CHAIN.BLOCK_TIME_MS });
    assert.ok(chain.tailStart > 1, 'a janela continuou deslizando');
    const prefixo = new Blockchain();
    prefixo.adoptGenesis(structuredClone(genese));
    for (let h = 1; h < chain.tailStart; h++) prefixo.addBlock(structuredClone(chain.getBlock(h)));
    assert.equal(computeStateRoot(chain.baseState), computeStateRoot(prefixo.state),
      'âncora == replay independente até tailStart-1');

    // Reorg forkado EXATAMENTE na fronteira da âncora (common == tailStart-1):
    // o rebuild usa `baseState` DIRETO — o caminho que a âncora corrompida quebrava.
    const common = chain.tailStart - 1;
    const rivalChain = new Blockchain();
    rivalChain.adoptGenesis(structuredClone(genese));
    for (let h = 1; h <= common; h++) rivalChain.addBlock(structuredClone(chain.getBlock(h)));
    const alvo = chain.height + 2; // mais longa que a original
    for (let h = common + 1; h <= alvo; h++) {
      rivalChain.produceBlock(w, [], { timestamp: t0 + (h + 20) * CHAIN.BLOCK_TIME_MS });
    }
    const rival = structuredClone(rivalChain.getRange(common + 1, alvo - common));
    const orfas = chain.reorg(common, rival);
    assert.ok(Array.isArray(orfas), 'o rabo rival mais longo tem de ser adotado');
    assert.equal(chain.head.hash, rivalChain.head.hash);
    // O bloco 1 (com a transferência) está ABAIXO do fork: sobrevive ao reorg —
    // prova que o rebuild partiu da âncora certa, que carrega esse saldo.
    assert.equal(chain.state.balanceOf(destino), 3n * CHAIN.UNIT,
      'a transferência do prefixo comum tem de sobreviver ao reorg');
    assert.equal(computeStateRoot(chain.state), computeStateRoot(rivalChain.state),
      'âncora + rabo rival tem de chegar à MESMA raiz de quem construiu o ramo direto');

    // Replay: um boot NOVO do mesmo disco chega à cadeia adotada e à mesma raiz.
    rmSync(join(dataDir, 'snapshot.json'), { force: true });
    const boot = new Blockchain({ dataDir });
    assert.equal(boot.height, chain.height);
    assert.equal(boot.head.hash, chain.head.hash);
    assert.equal(computeStateRoot(boot.state), computeStateRoot(chain.state),
      'o replay do disco tem de reproduzir o estado pós-reorg');
  } finally {
    delete CHAIN.TAIL_BLOCKS;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
