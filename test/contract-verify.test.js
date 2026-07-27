// Verificação de contrato no padrão de mercado.
//
// A armadilha central: comparar o bytecode byte a byte NÃO funciona. Variáveis
// `immutable` são gravadas no DEPLOY, então o compilador entrega zeros onde o
// on-chain tem valor — um único `immutable` (aqui, `decimals`) reprova um contrato
// legítimo. A fixture é um ERC20 real compilado por solc 0.8.26 (alvo shanghai,
// porque a EAVM tem PUSH0 mas não os opcodes de Cancun).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Eav7Node } from '../src/node/node.js';
import { generateKeyPair } from '../src/crypto/keys.js';

const ART = JSON.parse(readFileSync(new URL('./fixtures-erc20.json', import.meta.url), 'utf8'));
const ADDR = '0x' + 'ab'.repeat(20);

// Nó sem rede: só precisamos do estado para plantar o código do contrato.
function noComContrato(codeHex) {
  const node = new Eav7Node({ port: 0, validatorWallet: generateKeyPair(), eavm: false, log: () => {} });
  node.blockchain.state.contracts[ADDR] = { code: codeHex, storage: {}, balance: 0n, nonce: 0 };
  return node;
}

// Simula o deploy: grava o valor 6 na faixa do `immutable`, como a VM faz.
function comImmutablePreenchido(runtimeHex, valor = 6) {
  const b = Buffer.from(runtimeHex.replace(/^0x/, ''), 'hex');
  for (const refs of Object.values(ART.immutableReferences)) {
    for (const r of refs) {
      b.fill(0, r.start, r.start + r.length);
      b[r.start + r.length - 1] = valor; // uint8 alinhado à direita na palavra
    }
  }
  return '0x' + b.toString('hex');
}

const base = () => ({
  source: ART.source,
  language: 'solidity',
  compiler: ART.versao,
  evmVersion: ART.evmVersion,
  optimizer: ART.optimizer,
  contractName: 'EAV7Token',
});

test('bytecode idêntico: casamento completo', () => {
  const node = noComContrato(ART.runtime);
  const r = node.verifyContract(ADDR, { ...base(), bytecode: ART.runtime });
  assert.equal(r.verified, true);
  assert.equal(r.match, 'full');
});

test('immutable preenchido no deploy ainda verifica — o caso que quebrava tudo', () => {
  const onchain = comImmutablePreenchido(ART.runtime, 6);
  assert.notEqual(onchain, ART.runtime, 'o on-chain difere mesmo do compilador');
  const node = noComContrato(onchain);

  // Sem declarar as faixas, reprova (é o comportamento antigo).
  assert.throws(
    () => node.verifyContract(ADDR, { ...base(), bytecode: ART.runtime }),
    /não confere/,
  );

  // Declarando `immutableReferences`, aprova com o grau correto.
  const r = node.verifyContract(ADDR, {
    ...base(), bytecode: ART.runtime, immutableReferences: ART.immutableReferences,
  });
  assert.equal(r.verified, true);
  assert.equal(r.match, 'immutable', 'não pode alegar casamento completo — o byte difere');
});

test('metadados diferentes com código igual: casamento parcial', () => {
  // Troca só o bloco CBOR do fim (caminho de fonte diferente muda o hash do metadado).
  const b = Buffer.from(ART.runtime.replace(/^0x/, ''), 'hex');
  const metaLen = b.readUInt16BE(b.length - 2);
  b[b.length - metaLen - 2 + 5] ^= 0xff; // um byte dentro do metadado
  const node = noComContrato('0x' + b.toString('hex'));

  const r = node.verifyContract(ADDR, {
    ...base(), bytecode: ART.runtime, immutableReferences: ART.immutableReferences,
  });
  assert.equal(r.match, 'partial', 'código executável igual, metadado diferente');
});

test('bytecode adulterado é rejeitado — inclusive usando immutable como disfarce', () => {
  const node = noComContrato(ART.runtime);
  const outro = '0x' + '61'.repeat(ART.runtime.replace(/^0x/, '').length / 2);
  assert.throws(() => node.verifyContract(ADDR, { ...base(), bytecode: outro }), /não confere/);

  // Faixa de immutable gigante não pode virar buraco para mascarar o código inteiro:
  // a validação recusa offsets fora do bytecode.
  assert.throws(
    () => node.verifyContract(ADDR, {
      ...base(), bytecode: outro,
      immutableReferences: { 1: [{ start: 0, length: 999_999 }] },
    }),
    /fora do bytecode/,
  );
});

test('tamanho diferente é rejeitado antes de qualquer máscara', () => {
  const node = noComContrato(ART.runtime);
  assert.throws(
    () => node.verifyContract(ADDR, { ...base(), bytecode: '0x6001' }),
    /tamanho do bytecode difere/,
  );
});

test('contrato inexistente e source inválido são rejeitados', () => {
  const node = noComContrato(ART.runtime);
  assert.throws(() => node.verifyContract('0x' + '11'.repeat(20), { ...base(), bytecode: ART.runtime }), /não encontrado/);
  assert.throws(() => node.verifyContract(ADDR, { ...base(), source: '', bytecode: ART.runtime }), /source inválido/);
});

test('o registro guarda o que o explorer precisa mostrar', () => {
  const node = noComContrato(ART.runtime);
  node.verifyContract(ADDR, { ...base(), bytecode: ART.runtime });
  const rec = node.getVerifiedContract(ADDR);
  assert.equal(rec.contractName, 'EAV7Token');
  assert.equal(rec.language, 'solidity');
  assert.match(rec.compiler, /^0\.8\.26/);
  assert.equal(rec.evmVersion, 'shanghai');
  assert.deepEqual(rec.optimizer, { enabled: true, runs: 200 });
  assert.match(rec.source, /contract EAV7Token/);
  assert.match(rec.codeHash, /^[0-9a-f]{64}$/);
});
