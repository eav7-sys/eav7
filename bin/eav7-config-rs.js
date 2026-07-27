#!/usr/bin/env node
// Gera `rust/src/config.rs` a partir de `src/config.js`.
//
// Existe porque os módulos do cliente Rust foram portados em paralelo e cada um
// declarou as constantes de que precisava no próprio arquivo — 131 no total, 10
// delas DUPLICADAS entre arquivos. Duas cópias de um valor de consenso é convite
// a divergência silenciosa: alguém ajusta uma, esquece a outra, e o nó passa a
// discordar de si mesmo dependendo do caminho de código.
//
// Gerar em vez de transcrever elimina a terceira fonte de erro (o dedo humano) e
// deixa a referência como fonte única. Rodar depois de mudar `src/config.js`.
import { writeFileSync } from 'node:fs';
import { CHAIN, FORK_HEIGHTS } from '../src/config.js';

const linhas = [];
const L = (s = '') => linhas.push(s);

L('//! Parâmetros do protocolo eav20.');
L('//!');
L('//! GERADO por `node bin/eav7-config-rs.js` a partir de `src/config.js`. Não');
L('//! edite à mão: a referência em JavaScript é a fonte única, e uma divergência');
L('//! aqui faz este cliente aceitar o que a rede rejeita (ou o contrário).');
L('//!');
L('//! Toda constante de consenso mora AQUI. Módulo que declare a própria cópia');
L('//! reintroduz o problema que este arquivo resolve.');
L('');
L('#![allow(dead_code)]');
L('');

const nome = (k) => k.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
const emitir = (k, v, indent = '') => {
  if (typeof v === 'bigint') L(`${indent}pub const ${nome(k)}: u128 = ${v};`);
  else if (typeof v === 'number' && Number.isInteger(v)) L(`${indent}pub const ${nome(k)}: u64 = ${v};`);
  else if (typeof v === 'string') L(`${indent}pub const ${nome(k)}: &str = ${JSON.stringify(v)};`);
  else if (typeof v === 'boolean') L(`${indent}pub const ${nome(k)}: bool = ${v};`);
  else return false;
  return true;
};

L('// ---- parâmetros de topo ----');
for (const [k, v] of Object.entries(CHAIN)) emitir(k, v);
L('');

// Sub-tabelas viram módulos, preservando o agrupamento da referência.
for (const [grupo, valores] of Object.entries(CHAIN)) {
  if (!valores || typeof valores !== 'object' || Array.isArray(valores) || typeof valores === 'bigint') continue;
  const dentro = Object.entries(valores).filter(([, v]) => typeof v !== 'object');
  if (!dentro.length) continue;
  L(`/// \`CHAIN.${grupo}\` da referência.`);
  L(`pub mod ${grupo.toLowerCase()} {`);
  for (const [k, v] of dentro) emitir(k, v, '    ');
  L('}');
  L('');
}

// `CHAIN.ENERGY.COST` — o custo em ENERGIA de cada tipo de transação. É consenso:
// entra no cálculo de recurso/taxa de TODA transação. Ficava de fora porque o
// laço de topo pula sub-tabelas aninhadas, e o cliente Rust acabou com cópias
// locais parciais — exatamente o que este arquivo existe para impedir.
L('/// Custo em ENERGIA por tipo de transação (`CHAIN.ENERGY.COST`).');
L('///');
L('/// Consenso: entra no trilho de recursos de TODA transação. Um tipo ausente');
L('/// aqui vale 1 na referência (`?? 1`), e é o que `energy_cost` devolve.');
L('pub const ENERGY_COST: &[(&str, u64)] = &[');
for (const [tipo, custo] of Object.entries(CHAIN.ENERGY.COST)) L(`    ("${tipo}", ${custo}),`);
L('];');
L('');
L('/// Custo em energia do tipo, com o default 1 da referência (`?? 1`).');
L('pub fn energy_cost(tipo: &str) -> u64 {');
L('    ENERGY_COST.iter().find(|(t, _)| *t == tipo).map_or(1, |(_, c)| *c)');
L('}');
L('');

const genesisAtivo = process.env.EAV7_GENESIS_ACTIVE === '1';

// AMBIENTE QUE MUDA VALOR DE CONSENSO.
//
// A referência lê estas variáveis em TEMPO DE EXECUÇÃO (src/config.js). O Rust as
// tem como `const`, fixadas no build — logo, o binário só é equivalente ao nó JS
// se tiver sido GERADO com o mesmo ambiente em que roda. `EAV7_GENESIS_ACTIVE` já
// era conferido no boot; as demais não eram nem lidas, e a mais cara delas é
// `EAV7_AI_TEE_HEIGHT`: ela é o interruptor do rollout coordenado da Fase 6, e um
// nó Rust que a ignorasse continuaria recusando atestação depois de a rede ligá-la
// — divergência de estado no primeiro AI_RESULT atestado.
//
// A lista alimenta o marcador que o nó confere no boot. Acrescentar uma variável
// aqui é o bastante para ela passar a ser conferida.
const ENV_DE_CONSENSO = [
  'EAV7_NETWORK_NAME',
  'EAV7_PROTOCOL',
  'EAV7_GOV_TIMELOCK_BLOCKS',
  'EAV7_BRIDGE_BREAKER_HEIGHT',
  'EAV7_AI_TEE_HEIGHT',
  'EAV7_EAVM_CHAIN_ID',
];

L('/// Alturas de fork, na ordem declarada pela referência.');
L('///');
L('/// Zeradas quando `EAV7_GENESIS_ACTIVE=1` — um gênese novo nasce com tudo ativo.');
L('/// Um cliente que ignore essa variável divergiria de uma rede de testes inteira.');
L(`pub const FORK_HEIGHTS: &[(&str, u64)] = &[`);
for (const k of FORK_HEIGHTS) L(`    ("${k}", ${CHAIN[k]}),`);
L('];');
L('');
L('/// EM QUE MODO ESTE BINÁRIO FOI COMPILADO.');
L('///');
L('/// O JavaScript zera as alturas de fork em TEMPO DE EXECUÇÃO quando');
L('/// `EAV7_GENESIS_ACTIVE=1`; o Rust as tem como `const` (custo zero, mas fixas');
L('/// no build). As duas coisas SÓ são equivalentes se o binário tiver sido');
L('/// gerado no mesmo modo em que roda — senão o cliente aplica regras de fork');
L('/// diferentes das da rede e diverge em silêncio, que é a pior falha possível.');
L('///');
L('/// Por isso este marcador existe e o nó o CONFERE contra o ambiente no boot,');
L('/// abortando se divergirem. Um erro de consenso silencioso vira uma falha de');
L('/// inicialização ruidosa.');
L(`pub const GENESIS_ACTIVE_BUILD: bool = ${genesisAtivo};`);
L('');
L('/// AMBIENTE COM QUE ESTE BINÁRIO FOI GERADO, para as variáveis que mudam valor');
L('/// de consenso em tempo de execução na referência.');
L('///');
L('/// `(nome, valor)`; ausente vira string vazia. O nó compara com o ambiente REAL');
L('/// no boot e aborta se divergirem — pelo mesmo motivo de');
L('/// [`GENESIS_ACTIVE_BUILD`]: um binário gerado sem `EAV7_AI_TEE_HEIGHT` e rodado');
L('/// numa rede que a define aplica um fork diferente do resto da rede, e diverge');
L('/// em silêncio no primeiro bloco que dependa dele.');
L('pub const ENV_DE_CONSENSO: &[(&str, &str)] = &[');
for (const k of ENV_DE_CONSENSO) L(`    ("${k}", ${JSON.stringify(process.env[k] ?? '')}),`);
L('];');

writeFileSync('rust/src/config.rs', linhas.join('\n') + '\n');
console.log(`rust/src/config.rs — ${linhas.length} linhas${genesisAtivo ? ' (GÊNESE-ATIVO: forks zerados)' : ''}`);
