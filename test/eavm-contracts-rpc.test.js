// EAVM aberta para contratos pela rota EVM (EAVM_CONTRACTS_HEIGHT) + a superfície
// JSON-RPC que torna a VM alcançável: eth_call, eth_getCode, eth_getLogs e recibo real.
//
// Antes disto o envelope recusava deploy e calldata, e eth_call/eth_getCode eram
// constantes — a VM executava contratos que NENHUMA ferramenta externa conseguia
// implantar ou ler. O teste prova o caminho inteiro sobre uma cadeia de verdade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { createSignedTx } from '../src/eavm/tx.js';
import { buildEavmEnvelope, verifyEavmEnvelope, eavmToE7 } from '../src/eavm/envelope.js';
import { verifyTransaction } from '../src/core/transaction.js';
import { State } from '../src/core/state.js';

const PRIV = 0x2222222222222222222222222222222222222222222222222222222222222222n;
const H = Math.max(CHAIN.EAVM_CONTRACTS_HEIGHT, CHAIN.EAVM_VALUE_HEIGHT);

// Runtime de 8 bytes que emite LOG1 com o tópico 0xAA e para:
//   PUSH1 0xaa (tópico) · PUSH1 0 (tam.) · PUSH1 0 (offset) · LOG1 · STOP
const RUNTIME = '60aa60006000a100';
// Init padrão: copia os 8 bytes do runtime a partir do offset 12 e retorna.
const INITCODE = '0x6008600c60003960086000f3' + RUNTIME;

function contaCom(state, addr0x, saldo = 10_000n) {
  const e7 = eavmToE7(addr0x);
  const acc = state.getAccount(e7);
  acc.balance = saldo * CHAIN.UNIT;
  // Stake dá energia: sem ela, o orçamento de gás fica limitado ao teto de queima
  // do tipo (FEES.EAVM_CALL) e a execução não fecha. É o mesmo que um usuário real
  // faria — stakear para operar sem queimar saldo a cada chamada.
  acc.staked = 100_000n * CHAIN.UNIT;
  return e7;
}

// Snapshot comparável do mundo de contratos (BigInt não passa por JSON.stringify).
const snap = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

function assina({ nonce, to = null, data = '0x', valueWei = 0n }) {
  return createSignedTx({
    privateKey: PRIV, nonce, to, valueWei,
    chainId: CHAIN.EAVM_CHAIN_ID, gasLimit: 3_000_000n, data,
  });
}

test('envelope: deploy pela rota EVM vira EAVM_DEPLOY com o bytecode do raw assinado', () => {
  const env = buildEavmEnvelope(assina({ nonce: 0, data: INITCODE }));
  assert.equal(env.type, 'EAVM_DEPLOY');
  assert.equal(env.to, null, 'deploy não tem destino no campo do protocolo');
  assert.equal(env.data.code, INITCODE);
  assert.equal(verifyEavmEnvelope(env), null);
  assert.equal(verifyTransaction(env), null);
});

test('envelope: calldata pela rota EVM vira EAVM_CALL com destino e input do raw', () => {
  const alvo = '0x' + '33'.repeat(20);
  const env = buildEavmEnvelope(assina({ nonce: 1, to: alvo, data: '0xdeadbeef' }));
  assert.equal(env.type, 'EAVM_CALL');
  assert.equal(env.data.to, alvo);
  assert.equal(env.data.input, '0xdeadbeef');
  assert.equal(verifyEavmEnvelope(env), null);
});

test('envelope adulterado: trocar o bytecode mantendo a assinatura é rejeitado', () => {
  const env = buildEavmEnvelope(assina({ nonce: 0, data: INITCODE }));
  // Um relay tenta implantar OUTRO contrato reaproveitando a assinatura da vítima.
  const forjado = { ...env, data: { ...env.data, code: '0x6001600155' } };
  assert.notEqual(verifyEavmEnvelope(forjado), null);

  const alvo = '0x' + '33'.repeat(20);
  const chamada = buildEavmEnvelope(assina({ nonce: 1, to: alvo, data: '0xdeadbeef' }));
  const inputTrocado = { ...chamada, data: { ...chamada.data, input: '0xcafebabe' } };
  assert.notEqual(verifyEavmEnvelope(inputTrocado), null);
  const destinoTrocado = { ...chamada, data: { ...chamada.data, to: '0x' + '44'.repeat(20) } };
  assert.notEqual(verifyEavmEnvelope(destinoTrocado), null);
});

test('endereço de sistema (stake) continua recusando calldata', () => {
  const raw = assina({ nonce: 0, to: '0x0000000000000000000000000000000000007001', data: '0xdeadbeef' });
  assert.throws(() => buildEavmEnvelope(raw), /calldata/);
});

test('fork: contrato pela rota EVM é recusado ABAIXO de EAVM_CONTRACTS_HEIGHT', () => {
  const state = new State();
  const env = buildEavmEnvelope(assina({ nonce: 0, data: INITCODE }));
  contaCom(state, env.data.eavmFrom);
  assert.throws(
    () => state.applyTransaction(env, CHAIN.EAVM_CONTRACTS_HEIGHT - 1),
    /ainda não ativos/,
  );
});

test('deploy + chamada executam, e o log emitido fica no índice', () => {
  const state = new State();
  const env = buildEavmEnvelope(assina({ nonce: 0, data: INITCODE }));
  contaCom(state, env.data.eavmFrom);

  const logs = [];
  state.applyTransaction(env, H, 0, (e) => logs.push(e));

  const recibo = logs.find((e) => e.receipt);
  assert.ok(recibo, 'deploy gera recibo');
  assert.equal(recibo.success, true);
  const contrato = recibo.contract;
  assert.match(contrato, /^0x[0-9a-f]{40}$/);
  assert.equal(state.codeOf(contrato), '0x' + RUNTIME, 'runtime foi depositado');

  // Chamar o contrato dispara o LOG1. Calldata NÃO-vazia: é ela que distingue
  // uma chamada de contrato de uma transferência simples na classificação do
  // envelope (ver o teste de lacuna no fim deste arquivo).
  const chamada = buildEavmEnvelope(assina({ nonce: 1, to: contrato, data: '0x01' }));
  const logs2 = [];
  state.applyTransaction(chamada, H, 0, (e) => logs2.push(e));

  const evento = logs2.find((e) => !e.receipt && !e.internal);
  assert.ok(evento, 'a chamada emitiu um evento');
  assert.equal(String(evento.address).toLowerCase(), contrato);
  assert.equal(evento.topics.length, 1);
  assert.match(String(evento.topics[0]).toLowerCase(), /aa$/);
});

test('callEavm (motor do eth_call) executa e NÃO altera o estado', () => {
  const state = new State();
  const env = buildEavmEnvelope(assina({ nonce: 0, data: INITCODE }));
  contaCom(state, env.data.eavmFrom);
  const logs = [];
  state.applyTransaction(env, H, 0, (e) => logs.push(e));
  const contrato = logs.find((e) => e.receipt).contract;

  const antes = snap(state.contracts);
  const saldoAntes = state.accounts[env.from].balance;

  const out = state.callEavm({ from: env.data.eavmFrom, to: contrato, data: '0x', height: H });
  assert.equal(out.success, true);
  assert.ok(out.gasUsed > 0, 'consumiu gás de verdade — não é constante');

  assert.equal(snap(state.contracts), antes, 'consulta não pode sujar o mundo de contratos');
  assert.equal(state.accounts[env.from].balance, saldoAntes, 'consulta não pode mexer em saldo');
});

test('codeOf: contrato devolve runtime, conta comum devolve 0x', () => {
  const state = new State();
  const env = buildEavmEnvelope(assina({ nonce: 0, data: INITCODE }));
  contaCom(state, env.data.eavmFrom);
  const logs = [];
  state.applyTransaction(env, H, 0, (e) => logs.push(e));
  const contrato = logs.find((e) => e.receipt).contract;

  assert.equal(state.codeOf(contrato), '0x' + RUNTIME);
  assert.equal(state.codeOf('0x' + '55'.repeat(20)), '0x', 'conta sem código responde 0x');
});

// LACUNA CONHECIDA, documentada por teste em vez de descoberta em produção.
//
// A classificação do envelope é STATELESS (é o invariante que faz
// `verifyEavmEnvelope` não precisar de estado). Sem estado não há como saber se o
// destino tem código, então `to` + calldata vazia é classificado como transferência
// simples — e o contrato NÃO executa.
//
// Consequência: um contrato com `receive()`/`fallback()` payable não é acionado por
// um envio comum. Não afeta ERC20 (que não usa receive), e o valor não se perde: sob
// o ledger unificado ele credita a conta nativa do próprio contrato. Mas diverge do
// Ethereum e precisa de decisão antes do fork valer em produção.
test('LACUNA: envio sem calldata para contrato não executa o código', () => {
  const state = new State();
  const env = buildEavmEnvelope(assina({ nonce: 0, data: INITCODE }));
  contaCom(state, env.data.eavmFrom);
  const logs = [];
  state.applyTransaction(env, H, 0, (e) => logs.push(e));
  const contrato = logs.find((e) => e.receipt).contract;

  const semCalldata = buildEavmEnvelope(assina({ nonce: 1, to: contrato, data: '0x' }));
  assert.equal(semCalldata.type, 'EAVM_TRANSFER', 'classificado como transferência, não chamada');

  const logs2 = [];
  state.applyTransaction(semCalldata, H, 0, (e) => logs2.push(e));
  assert.equal(logs2.length, 0, 'o código do contrato não roda — é a lacuna');
});
