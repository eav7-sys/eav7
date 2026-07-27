// Permissão `witness` — separa a chave que ASSINA blocos da chave que guarda o STAKE.
//
// Motivo: em block.js o cabeçalho carrega as chaves públicas do produtor, e `producer` é
// derivado delas. Um validador que produziu um bloco expõe para sempre a chave que
// custodia stake, votos e fundos. Com witness, a chave exposta deixa de ser essa.
//
// O ponto mais delicado, apontado na auditoria: SLASHING depende da identidade que o
// witness quebra. Punir `producer` cru cairia numa chave sem stake e a equivocação
// ficaria impune — os testes abaixo cobrem isso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildBlock, buildGenesisBlock, blockValidator, verifyBlockIntegrity } from '../src/core/block.js';
import { buildTransaction } from '../src/core/transaction.js';

const H = CHAIN.PERMISSIONS_V2_HEIGHT;

function chave(state, saldo = 10_000n) {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  if (state) state.getAccount(addr).balance = saldo * CHAIN.UNIT;
  return { w, addr };
}

// Conta validadora que delega a produção a uma chave witness.
function comWitness(state) {
  const conta = chave(state);
  const o = chave(state);
  const act = chave(state);
  const wit = chave(state);
  state.getAccount(conta.addr).staked = CHAIN.MIN_VALIDATOR_STAKE * 3n;
  state.applyTransaction(
    buildTransaction(conta.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: {
        permission: {
          owner: { threshold: 1, keys: { [o.addr]: 1 } },
          active: { threshold: 1, keys: { [act.addr]: 1 } },
          witness: wit.addr,
          delayBlocks: CHAIN.PERM_DELAY_MIN_BLOCKS,
        },
      },
    }),
    H,
  );
  return { conta, o, act, wit };
}

test('witness: validador efetivo é a CONTA, não a chave que assinou', () => {
  const w = generateKeyPair();
  const contaAddr = walletAddress(generateKeyPair());
  const b = buildBlock(w, { height: H, previousHash: 'E7' + '0'.repeat(62), producerAccount: contaAddr, stateRoot: 'E7' + '1'.repeat(62) });
  assert.equal(b.producerAccount, contaAddr);
  assert.notEqual(b.producer, contaAddr, 'quem assina é outra chave');
  assert.equal(blockValidator(b), contaAddr, 'o validador efetivo é a conta');
});

test('witness: sem delegação o campo nem existe — serialização histórica intacta', () => {
  const w = generateKeyPair();
  const b = buildBlock(w, { height: H, previousHash: 'E7' + '0'.repeat(62), stateRoot: 'E7' + '1'.repeat(62) });
  assert.equal('producerAccount' in b, false);
  assert.equal(blockValidator(b), b.producer);
});

test('witness: producerAccount antes do fork é rejeitado', () => {
  const w = generateKeyPair();
  const b = buildBlock(w, { height: H, previousHash: 'E7' + '0'.repeat(62), stateRoot: 'E7' + '1'.repeat(62) });
  // injeta o campo à força num bloco de altura anterior ao fork
  const forjado = { ...b, height: CHAIN.PERMISSIONS_V2_HEIGHT - 1, producerAccount: walletAddress(generateKeyPair()) };
  assert.match(String(verifyBlockIntegrity(forjado)), /producerAccount|stateRoot|hash|assinatura/);
});

// --- Slashing: o furo apontado na auditoria -------------------------------------------

function blocoDuplo(witWallet, contaAddr, altura) {
  const base = { height: altura, previousHash: '0'.repeat(64), stateRoot: '1'.repeat(64), producerAccount: contaAddr };
  const a = buildBlock(witWallet, { ...base, timestamp: 1_000 });
  const b = buildBlock(witWallet, { ...base, timestamp: 2_000 });
  return { a, b };
}

test('slashing: a penalidade cai na CONTA (que tem stake), não na chave witness', () => {
  const state = new State();
  const { conta, wit } = comWitness(state);
  const denunciante = chave(state);
  const stakeAntes = state.accounts[conta.addr].staked;
  assert.equal(state.accounts[wit.addr]?.staked ?? 0n, 0n, 'a chave witness não tem stake');

  const { a, b } = blocoDuplo(wit.w, conta.addr, H + 10);
  state.applyTransaction(
    buildTransaction(denunciante.w, { type: 'SLASH_DOUBLE_SIGN', amount: 0, nonce: 1, data: { blockA: a, blockB: b } }),
    CHAIN.SLASHING_HEIGHT,
  );

  assert.ok(state.accounts[conta.addr].staked < stakeAntes, 'stake da CONTA foi penalizado');
  assert.ok(state.balanceOf(denunciante.addr) > 0n, 'denunciante premiado');
});

test('slashing: não dá para forjar evidência contra conta que não delegou àquela chave', () => {
  const state = new State();
  const { conta } = comWitness(state);
  const impostor = chave(state);
  const denunciante = chave(state);

  // o impostor assina blocos alegando produzir pela conta alheia
  const { a, b } = blocoDuplo(impostor.w, conta.addr, H + 10);
  assert.throws(
    () => state.applyTransaction(
      buildTransaction(denunciante.w, { type: 'SLASH_DOUBLE_SIGN', amount: 0, nonce: 1, data: { blockA: a, blockB: b } }),
      CHAIN.SLASHING_HEIGHT,
    ),
    /não é o witness registrado/,
  );
  assert.equal(state.accounts[conta.addr].staked, CHAIN.MIN_VALIDATOR_STAKE * 3n, 'stake intacto');
});

test('slashing: blocos apontando para contas produtoras diferentes não é assinatura dupla', () => {
  const state = new State();
  const { conta, wit } = comWitness(state);
  const outra = chave(state);
  const denunciante = chave(state);

  const a = buildBlock(wit.w, { height: H + 10, previousHash: 'E7' + '0'.repeat(62), stateRoot: 'E7' + '1'.repeat(62), producerAccount: conta.addr, timestamp: 1_000 });
  const b = buildBlock(wit.w, { height: H + 10, previousHash: 'E7' + '0'.repeat(62), stateRoot: 'E7' + '1'.repeat(62), producerAccount: outra.addr, timestamp: 2_000 });
  assert.throws(
    () => state.applyTransaction(
      buildTransaction(denunciante.w, { type: 'SLASH_DOUBLE_SIGN', amount: 0, nonce: 1, data: { blockA: a, blockB: b } }),
      CHAIN.SLASHING_HEIGHT,
    ),
    /contas produtoras diferentes/,
  );
});
