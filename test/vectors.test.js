// Os vetores de conformidade são o critério de aceitação de QUALQUER implementação
// do eav20 — a começar pelo cliente em Rust. Este teste garante duas coisas:
//
//   1. os vetores versionados continuam batendo com o comportamento atual do nó
//      (se alguém mudar consenso sem regerar, quebra aqui, não em produção);
//   2. o gerador é determinístico (rodar duas vezes produz bytes idênticos).
//
// Sem (1), o vetor vira documentação desatualizada. Sem (2), não serve para provar
// equivalência entre implementações.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const DIR = join(RAIZ, 'vectors');
const ler = (n) => JSON.parse(readFileSync(join(DIR, n), 'utf8'));

function geraEm(destino) {
  // Três geradores: funções puras, transição de estado e integração EAVM<->estado.
  // Todos precisam ser determinísticos e são conferidos contra o que está versionado.
  execFileSync(process.execPath, [join(RAIZ, 'bin/eav7-vectors.js'), destino], { stdio: 'pipe' });
  execFileSync(process.execPath, [join(RAIZ, 'bin/eav7-vectors-state.js'), destino], { stdio: 'pipe' });
  execFileSync(process.execPath, [join(RAIZ, 'bin/eav7-vectors-eavm.js'), destino], { stdio: 'pipe' });
  return Object.fromEntries(
    readdirSync(destino).sort().map((f) => [f, readFileSync(join(destino, f), 'utf8')]),
  );
}

test('os vetores versionados batem com o comportamento atual do nó', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eav7-vec-'));
  try {
    const gerado = geraEm(tmp);
    const versionado = Object.fromEntries(
      readdirSync(DIR).sort().map((f) => [f, readFileSync(join(DIR, f), 'utf8')]),
    );
    assert.deepEqual(Object.keys(gerado), Object.keys(versionado), 'conjunto de arquivos mudou');
    for (const nome of Object.keys(versionado)) {
      assert.equal(
        gerado[nome], versionado[nome],
        `${nome} divergiu — se a mudança de consenso é intencional, regere os vetores:\n` +
        `  node bin/eav7-vectors.js && node bin/eav7-vectors-state.js && node bin/eav7-vectors-eavm.js`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('o gerador é determinístico entre execuções', () => {
  const a = mkdtempSync(join(tmpdir(), 'eav7-vec-a-'));
  const b = mkdtempSync(join(tmpdir(), 'eav7-vec-b-'));
  try {
    assert.deepEqual(geraEm(a), geraEm(b), 'duas execuções produziram bytes diferentes');
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('nenhum vetor esconde um caso que falhou ao gerar', () => {
  // Um caso com `error` INESPERADO significa que o gerador está errado (hex mal
  // digitado, por exemplo) — e aí o vetor testaria o meu erro, não o protocolo.
  //
  // A exceção é `state.json`: ali a rejeição é o RESULTADO ESPERADO de metade dos
  // casos, e vem marcada com `rejected: true`. Erro sem essa marca continua sendo
  // falha do gerador, inclusive lá.
  for (const nome of readdirSync(DIR)) {
    for (const caso of ler(nome).cases ?? []) {
      if (caso.rejected === true) continue; // rejeição declarada é o teste, não a falha
      assert.ok(!('error' in caso), `${nome}: caso "${caso.name ?? caso.kind}" guardou erro: ${caso.error}`);
    }
  }
});

test('meta.json fixa os parâmetros que definem a rede', () => {
  const m = ler('meta.json');
  assert.equal(m.protocol, 'eav20');
  assert.equal(m.addressPrefix, 'E7');
  assert.equal(m.hashLength, 64);
  assert.equal(m.eavmChainId, 72020);
  assert.ok(Object.keys(m.forkHeights).length > 0, 'a lista de forks precisa estar no vetor');
});

test('o envelope EAVM classifica os quatro caminhos a partir do raw assinado', () => {
  const tipos = ler('eavm-envelope.json').cases.map((c) => c.envelope.type);
  for (const esperado of ['EAVM_TRANSFER', 'STAKE', 'EAVM_DEPLOY', 'EAVM_CALL']) {
    assert.ok(tipos.includes(esperado), `falta caso de ${esperado}`);
  }
  // `from` é sempre RECUPERADO da assinatura — nunca informado pelo remetente.
  for (const c of ler('eavm-envelope.json').cases) {
    assert.match(c.recoveredFrom, /^0x[0-9a-f]{40}$/);
  }
});

test('hashes nos vetores são 64 hex minúsculos, sem prefixo', () => {
  for (const c of ler('crypto.json').cases) {
    if (c.kind === 'eavHash' || c.kind === 'merkleRoot' || c.kind === 'eavHash.multipart') {
      assert.match(c.output, /^[0-9a-f]{64}$/, `${c.kind} devolveu formato inesperado`);
    }
  }
});

test('transição de estado: rejeição NUNCA muta o estado', () => {
  // A invariante mais importante da máquina de estado. Se uma transação rejeitada
  // deixasse resíduo, dois nós que processassem a mesma transação com resultados
  // diferentes (por ordem de mempool, por exemplo) divergiriam para sempre.
  const casos = ler('state.json').cases;
  const rejeitados = casos.filter((c) => c.rejected);
  assert.ok(rejeitados.length >= 8, 'poucos casos de rejeição para ter confiança');
  for (const c of rejeitados) {
    assert.equal(c.rootAfter, c.rootBefore, `"${c.name}" foi rejeitada mas mudou o estado`);
    assert.ok(c.error && c.error.length > 0, `"${c.name}" precisa da mensagem de erro`);
  }
});

test('transição de estado: casos aceitos registram efeito e taxa', () => {
  for (const c of ler('state.json').cases.filter((x) => !x.rejected)) {
    assert.notEqual(c.rootAfter, c.rootBefore, `"${c.name}" foi aceita mas não mudou nada`);
    assert.ok(c.effects && Object.keys(c.effects).length > 0, `"${c.name}" sem efeitos registrados`);
    assert.ok(typeof c.feeCharged === 'string', `"${c.name}" sem taxa registrada`);
  }
});

test('transição de estado: o mesmo tx é válido ou não conforme a ALTURA', () => {
  // É o caso que mais importa para um cliente novo: errar a altura de um fork faz
  // o nó aceitar o que a rede rejeita (ou o contrário) e cindir a cadeia.
  const casos = ler('state.json').cases;
  const abaixo = casos.find((c) => c.name.includes('abaixo de VOTING_HEIGHT'));
  const acima = casos.find((c) => c.name.includes('acima de VOTING_HEIGHT'));
  assert.ok(abaixo?.rejected, 'abaixo do fork tem de ser rejeitado');
  assert.ok(!acima?.rejected, 'acima do fork tem de ser aceito');
  assert.deepEqual(abaixo.tx, acima.tx, 'tem de ser a MESMA transação nos dois casos');
});
