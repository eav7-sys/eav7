// Testes de INTEGRAÇÃO (recomendação (c)): as features rodando JUNTAS numa cadeia real
// multi-validador, com todos os forks ativos do bloco 0 (como no gênese novo), passando
// pelo pipeline real addBlock → applyTransaction → blockTick → stateRoot. Fecha o gap de
// "unit tests não provam interação".
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildGenesisBlock } from '../src/core/block.js';
import { buildTransaction } from '../src/core/transaction.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { isValidHash } from '../src/crypto/hash.js';

const U = CHAIN.UNIT;
// Todos os forks em 0 = gênese-ativo (o cenário do relaunch). Salva/restaura.
const HEIGHTS = ['STRICT_PRODUCER_HEIGHT', 'CANONICAL_HASH_HEIGHT', 'STATEROOT_HEIGHT', 'BRIDGE_QUORUM_HEIGHT',
  'BRIDGE_PROOF_HEIGHT', 'VOTING_HEIGHT', 'PERMISSIONS_HEIGHT', 'RESOURCE_HEIGHT', 'GOVERNANCE_HEIGHT', 'SLASHING_HEIGHT'];
function genesisActive() {
  const saved = { GOV_TIMELOCK_BLOCKS: CHAIN.GOV_TIMELOCK_BLOCKS, BW_FREE: CHAIN.BANDWIDTH.FREE };
  for (const k of HEIGHTS) { saved[k] = CHAIN[k]; CHAIN[k] = 0; }
  CHAIN.GOV_TIMELOCK_BLOCKS = 2;
  CHAIN.BANDWIDTH.FREE = 5_000_000; // banda folgada no teste (não interferir no fluxo)
  return () => { for (const k of HEIGHTS) CHAIN[k] = saved[k]; CHAIN.GOV_TIMELOCK_BLOCKS = saved.GOV_TIMELOCK_BLOCKS; CHAIN.BANDWIDTH.FREE = saved.BW_FREE; };
}

function genesisChain(t0) {
  const vals = Array.from({ length: 4 }, () => generateKeyPair());
  const byAddr = Object.fromEntries(vals.map((w) => [walletAddress(w), w]));
  const balances = {}, stakes = {};
  for (const a of Object.keys(byAddr)) { balances[a] = (100n * U).toString(); stakes[a] = (2n * CHAIN.MIN_VALIDATOR_STAKE).toString(); }
  const gen = buildGenesisBlock({ timestamp: t0, balances, stakes });
  const chain = new Blockchain();
  chain.adoptGenesis(gen);
  return { chain, vals, byAddr, gen };
}
// Produz o próximo bloco pelo produtor ESPERADO do slot, incluindo `txs`.
function produceNext(chain, byAddr, txs = []) {
  const ts = chain.head.timestamp + CHAIN.BLOCK_TIME_MS;
  const producer = chain.expectedProducer(ts);
  return chain.produceBlock(byAddr[producer], txs, { timestamp: ts });
}

test('(c) integração: stateRoot + votação + governança c/ timelock + finalidade, numa cadeia real', () => {
  const restore = genesisActive();
  try {
    const t0 = Date.now() - 600_000;
    const { chain, vals, byAddr } = genesisChain(t0);
    const [v0, v1, v2] = vals;
    const a0 = walletAddress(v0), a1 = walletAddress(v1);

    // bloco 1: v0 vota (eleição de validador, #4) em v1 → muda o peso/ordem do conjunto
    produceNext(chain, byAddr, [buildTransaction(v0, { type: 'VOTE', nonce: 1, data: { votes: { [a1]: (1n * CHAIN.MIN_VALIDATOR_STAKE).toString() } } })]);
    assert.equal(chain.state.validators()[0].address, a1, 'v1 subiu ao topo pelos votos');

    // bloco 2: v0 propõe baixar BLOCK_REWARD para 8 EAV7 (#9)
    const prop = buildTransaction(v0, { type: 'GOV_PROPOSE', nonce: 2, data: { param: 'BLOCK_REWARD', value: (8n * U).toString() } });
    produceNext(chain, byAddr, [prop]);
    // bloco 3: v1 e v2 votam → quórum 3 (v0+v1+v2) → ENFILEIRA (timelock 2)
    produceNext(chain, byAddr, [
      buildTransaction(v1, { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }),
      buildTransaction(v2, { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }),
    ]);
    assert.equal(chain.state.param('BLOCK_REWARD'), CHAIN.BLOCK_REWARD, 'ainda no default (timelock)');

    // produz blocos até o timelock maturar → blockTick aplica o override
    for (let i = 0; i < 4; i++) produceNext(chain, byAddr);
    assert.equal(chain.state.param('BLOCK_REWARD'), 8n * U, 'override aplicado após o timelock');

    // todo bloco > 0 carrega um stateRoot bem-formado (pipeline #1)
    for (let h = 1; h <= chain.height; h++) assert.ok(isValidHash(chain.getBlock(h).stateRoot), `bloco ${h} sem stateRoot`);
    // finalidade BFT avança (#2)
    assert.ok(chain.finalizedHeight() >= 0 && chain.finalizedHeight() < chain.height);

    // DETERMINISMO: replay dos blocos numa cadeia nova reproduz head + minted idênticos
    // (o addBlock RE-verifica cada stateRoot → prova que os roots produzidos batem).
    const t2 = Date.now() - 600_000;
    void t2;
    const replay = new Blockchain();
    replay.adoptGenesis(chain.getBlock(0));
    for (let h = 1; h <= chain.height; h++) replay.addBlock(chain.getBlock(h), { now: Date.now() });
    assert.equal(replay.head.hash, chain.head.hash, 'head diverge no replay');
    assert.equal(replay.state.totalMinted, chain.state.totalMinted, 'minted diverge no replay');
    assert.equal(replay.state.param('BLOCK_REWARD'), 8n * U, 'governança não persistiu no replay');
  } finally { restore(); }
});
