#!/usr/bin/env node
// Vetores de TRANSIÇÃO DE ESTADO — a parte mais crítica do consenso.
//
// Os demais vetores fixam funções puras (hash, codificação, folha). Estes fixam a
// MÁQUINA DE ESTADO: dado (estado, transação, altura), qual é o estado seguinte —
// ou qual erro. É onde mora o valor real do protocolo e onde um port diverge sem
// avisar: uma taxa cobrada a mais, um nonce não incrementado, uma checagem de
// fork na altura errada.
//
// Formato de cada caso:
//   setup      — como montar o estado inicial (declarativo, não código)
//   tx         — a transação aplicada
//   height     — a altura (define quais forks estão ativos)
//   rootBefore — raiz do estado antes
//   rootAfter  — raiz depois (ausente se lançou)
//   error      — trecho da mensagem, quando a transação é rejeitada
//   effects    — os campos que mudaram, em forma legível
//
// `rootAfter` sozinho já prova equivalência: é uma hash de TODO o estado. Mas hash
// não depura — por isso `effects` também vai, para que a falha diga o que divergiu
// em vez de só "as raízes diferem".
//
// Uso:  node bin/eav7-vectors-state.js [diretório]     (padrão: ./vectors)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { computeStateRoot } from '../src/core/stateroot.js';
import { deriveAddressFrom } from '../src/crypto/keys.js';
import { eavHash } from '../src/crypto/hash.js';

const OUT = process.argv[2] ?? join(process.cwd(), 'vectors');
mkdirSync(OUT, { recursive: true });

const A = deriveAddressFrom('VETOR:alice');
const B = deriveAddressFrom('VETOR:bob');
const C = deriveAddressFrom('VETOR:carol');
const UNIT = CHAIN.UNIT;

// Altura acima de TODOS os forks: o comportamento mais recente do protocolo.
const H = Math.max(...[
  'PERMISSIONS_V2_HEIGHT', 'EAVM_VALUE_HEIGHT', 'EAVM_CONTRACTS_HEIGHT',
  'EAVM_OSAKA_HEIGHT', 'VOTING_HEIGHT', 'GOVERNANCE_HEIGHT', 'SLASHING_HEIGHT',
].map((k) => CHAIN[k] ?? 0)) + 1000;
const TS = 1_700_000_000_000;

const estavel = (v) => {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, estavel(v[k])]));
  }
  return v;
};

// Monta o estado inicial a partir de uma descrição DECLARATIVA. O cliente Rust lê
// a mesma descrição e monta o mesmo estado — se fosse código, não seria portável.
function montar(setup) {
  const s = new State();
  for (const [end, conf] of Object.entries(setup.accounts ?? {})) {
    const a = s.getAccount(end);
    if (conf.balance != null) a.balance = BigInt(conf.balance);
    if (conf.staked != null) a.staked = BigInt(conf.staked);
    if (conf.nonce != null) a.nonce = conf.nonce;
  }
  for (const [id, tok] of Object.entries(setup.tokens ?? {})) {
    s.tokens[id] = {
      standard: 'eav20', id, name: tok.name, symbol: tok.symbol, decimals: tok.decimals,
      totalSupply: BigInt(tok.totalSupply), creator: tok.creator, owner: tok.owner ?? tok.creator,
      mintable: tok.mintable ?? false, paused: false, blacklist: {}, frozen: {},
      createdAt: TS, balances: Object.fromEntries(Object.entries(tok.balances ?? {}).map(([k, v]) => [k, BigInt(v)])),
      allowances: {},
    };
  }
  for (const [end, v] of Object.entries(setup.commission ?? {})) s.commission[end] = v;
  // Oráculos e tarefa de quórum EM CURSO — o único jeito de um vetor exercitar a
  // apuração, que acontece na revelação que fecha a conta.
  for (const [end, o] of Object.entries(setup.oracles ?? {})) {
    // Os campos são os do literal de `AI_ORACLE_REGISTER` (state.js:2040) — a
    // lista inteira, porque um campo faltando aqui vira `undefined` na folha e o
    // vetor passaria a descrever um estado que a rede não produz.
    s.oracles[end] = {
      address: end,
      stake: BigInt(o.stake ?? 0),
      tasksCompleted: o.tasksCompleted ?? 0,
      bridgeTransfers: o.bridgeTransfers ?? 0,
      registeredAt: TS,
      endpoint: o.endpoint ?? null,
      completed: o.completed ?? 0,
      failed: o.failed ?? 0,
      slashed: BigInt(o.slashed ?? 0),
      reputation: o.reputation ?? 50,
    };
  }
  for (const [id, t] of Object.entries(setup.aiTasks ?? {})) {
    s.aiTasks[id] = {
      id, requester: t.requester, mode: 'QUORUM', quorum: t.quorum,
      model: null, prompt: t.prompt ?? null, params: null,
      // A fase continua 'COMMIT' durante a janela de revelação: o protocolo só
      // tem COMMIT e DONE (state.js:1982 e :2329). Inventar 'REVEAL' aqui montaria
      // um estado que a rede nunca produz — e o vetor descreveria ficção.
      reward: BigInt(t.reward), status: 'PENDING', phase: 'COMMIT', createdAt: TS,
      commitDeadline: t.commitDeadline, revealDeadline: t.revealDeadline,
      expiresAt: t.revealDeadline,
      commits: { ...t.commits }, reveals: {}, winners: null, resultHash: null,
      output: null, completedAt: null,
    };
    // As revelações JÁ CHEGADAS entram na ordem declarada — é justamente a ordem
    // de chegada que o vetor precisa poder variar para provar que ela NÃO importa.
    for (const [quem, r] of t.reveals ?? []) {
      s.aiTasks[id].reveals[quem] = { resultHash: r.resultHash, output: r.output };
    }
  }
  return s;
}

// Campos do estado que interessam para depurar a transição.
function fotografar(s) {
  const contas = {};
  for (const [end, a] of Object.entries(s.accounts)) {
    contas[end] = estavel({ balance: a.balance, staked: a.staked, nonce: a.nonce });
  }
  const tokens = {};
  for (const [id, t] of Object.entries(s.tokens)) {
    tokens[id] = estavel({ totalSupply: t.totalSupply, balances: t.balances, paused: t.paused });
  }
  return {
    accounts: contas,
    ...(Object.keys(tokens).length ? { tokens } : {}),
    ...(Object.keys(s.votes ?? {}).length ? { votes: estavel(s.votes) } : {}),
    ...(Object.keys(s.candidateVotes ?? {}).length ? { candidateVotes: estavel(s.candidateVotes) } : {}),
    ...(Object.keys(s.pendingCommission ?? {}).length ? { pendingCommission: estavel(s.pendingCommission) } : {}),
    ...((s.unbonding ?? []).length ? { unbonding: estavel(s.unbonding) } : {}),
    ...(s.totalBurned ? { totalBurned: s.totalBurned.toString() } : {}),
  };
}

// Só o que MUDOU entre duas fotografias — é o que torna a falha legível.
function diferenca(antes, depois) {
  const d = {};
  for (const secao of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
    const a = antes[secao] ?? {};
    const b = depois[secao] ?? {};
    if (typeof a !== 'object' || typeof b !== 'object') {
      if (JSON.stringify(a) !== JSON.stringify(b)) d[secao] = { de: a, para: b };
      continue;
    }
    const mudou = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) mudou[k] = { de: a[k] ?? null, para: b[k] ?? null };
    }
    if (Object.keys(mudou).length) d[secao] = mudou;
  }
  return d;
}

const casos = [];
function caso(nome, { setup, tx, height = H, blockTs = TS, note }) {
  const s = montar(setup);
  const antes = fotografar(s);
  const rootBefore = computeStateRoot(s);
  let erro = null;
  let taxa = null;
  // A tx REGISTRADA no vetor tem de ser a MESMA que foi aplicada, com `protocol` e
  // `scheme` inclusos. Registrar a versão sem eles descrevia uma transação que
  // nunca rodou — e, como o bandwidth é cobrado pelo TAMANHO da tx canônica, um
  // segundo cliente que aplicasse o que está escrito cobraria bandwidth diferente
  // e chegaria a outra raiz. O vetor acusaria divergência que não existe.
  const aplicada = { protocol: CHAIN.PROTOCOL, scheme: 'eav7-hybrid-1', ...tx };
  try {
    taxa = s.applyTransaction(aplicada, height, blockTs);
  } catch (e) {
    erro = e.message;
  }
  const registro = {
    name: nome, note, setup: estavel(setup), tx: estavel(aplicada), height, blockTs, rootBefore,
  };
  if (erro) {
    registro.error = erro;
    // Transação rejeitada NÃO pode deixar estado sujo — a raiz tem de ser a mesma.
    registro.rootAfter = computeStateRoot(s);
    registro.rejected = true;
  } else {
    registro.rootAfter = computeStateRoot(s);
    registro.feeCharged = taxa?.toString() ?? '0';
    registro.effects = diferenca(antes, fotografar(s));
  }
  casos.push(registro);
}

const idDe = (r) => eavHash('VETOR-TX:' + r);
// `to: null` explícito, e não ausente: `buildTransaction` (transaction.js:31) SEMPRE
// emite o campo, e o tamanho canônico da tx — que é o que o bandwidth cobra —
// muda em 10 bytes com ele. Um vetor sem `to` descreveria uma transação que a rede
// não produz, e cobraria bandwidth diferente de qualquer cliente correto.
const txBase = (extra) => ({ to: null, fee: '10000', timestamp: TS, id: idDe(extra.type + extra.nonce), ...extra });

// ----------------------------------------------------------------- TRANSFER
caso('TRANSFER: caminho feliz', {
  setup: { accounts: { [A]: { balance: (1000n * UNIT).toString() } } },
  tx: txBase({ type: 'TRANSFER', from: A, to: B, amount: (5n * UNIT).toString(), nonce: 1 }),
});
caso('TRANSFER: saldo insuficiente é rejeitado sem sujar o estado', {
  setup: { accounts: { [A]: { balance: '100' } } },
  tx: txBase({ type: 'TRANSFER', from: A, to: B, amount: (5n * UNIT).toString(), nonce: 1 }),
  note: 'rootAfter tem de ser IGUAL a rootBefore — rejeição não pode mutar nada',
});
caso('TRANSFER: nonce fora de ordem é rejeitado', {
  setup: { accounts: { [A]: { balance: (1000n * UNIT).toString(), nonce: 5 } } },
  tx: txBase({ type: 'TRANSFER', from: A, to: B, amount: '1', nonce: 3 }),
});
caso('TRANSFER: valor zero é REJEITADO', {
  setup: { accounts: { [A]: { balance: (10n * UNIT).toString() } } },
  tx: txBase({ type: 'TRANSFER', from: A, to: B, amount: '0', nonce: 1 }),
  note: 'eu presumi que zero passaria ao escrever este vetor; o protocolo exige valor positivo. ' +
        'Transferência de zero só serviria para poluir o histórico ao custo da taxa.',
});
caso('TRANSFER: para si mesmo', {
  setup: { accounts: { [A]: { balance: (10n * UNIT).toString() } } },
  tx: txBase({ type: 'TRANSFER', from: A, to: A, amount: (1n * UNIT).toString(), nonce: 1 }),
});

// -------------------------------------------------------------- STAKE/UNSTAKE
caso('STAKE: move saldo para stake', {
  setup: { accounts: { [A]: { balance: (10_000n * UNIT).toString() } } },
  tx: txBase({ type: 'STAKE', from: A, to: null, amount: (5_000n * UNIT).toString(), nonce: 1 }),
});
caso('UNSTAKE: entra na fila de unbonding, não volta na hora', {
  setup: { accounts: { [A]: { balance: (100n * UNIT).toString(), staked: (5_000n * UNIT).toString() } } },
  tx: txBase({ type: 'UNSTAKE', from: A, to: null, amount: (1_000n * UNIT).toString(), nonce: 1 }),
  note: 'o saldo NÃO volta imediatamente — é o que impede sair-e-dumpar e ataque long-range',
});
caso('UNSTAKE: acima do stake é rejeitado', {
  setup: { accounts: { [A]: { balance: (100n * UNIT).toString(), staked: (10n * UNIT).toString() } } },
  tx: txBase({ type: 'UNSTAKE', from: A, to: null, amount: (1_000n * UNIT).toString(), nonce: 1 }),
});

// -------------------------------------------------------------------- VOTE
caso('VOTE: aloca poder de voto e credita o candidato', {
  setup: { accounts: {
    [A]: { balance: (100n * UNIT).toString(), staked: (5_000n * UNIT).toString() },
    [B]: { balance: (100n * UNIT).toString(), staked: (2_000n * UNIT).toString() },
  } },
  tx: txBase({ type: 'VOTE', from: A, to: null, amount: '0', nonce: 1, data: { votes: { [B]: (3_000n * UNIT).toString() } } }),
});
caso('VOTE: acima do stake é rejeitado — voto precisa de lastro', {
  setup: { accounts: {
    [A]: { balance: (100n * UNIT).toString(), staked: (100n * UNIT).toString() },
    [B]: { balance: (100n * UNIT).toString(), staked: (2_000n * UNIT).toString() },
  } },
  tx: txBase({ type: 'VOTE', from: A, to: null, amount: '0', nonce: 1, data: { votes: { [B]: (9_000n * UNIT).toString() } } }),
});

// --------------------------------------------------------------- SET_COMMISSION
caso('SET_COMMISSION: entra em FILA, não vale na hora', {
  setup: { accounts: { [A]: { balance: (100n * UNIT).toString(), staked: (5_000n * UNIT).toString() } } },
  tx: txBase({ type: 'SET_COMMISSION', from: A, to: null, amount: '0', nonce: 1, data: { percent: 15 } }),
  note: 'sem o atraso, o validador sobe para 100% no próprio slot, captura a recompensa dos eleitores e baixa de volta — ataque verificado',
});
caso('SET_COMMISSION: acima de 100% é rejeitado', {
  setup: { accounts: { [A]: { balance: (100n * UNIT).toString(), staked: (5_000n * UNIT).toString() } } },
  tx: txBase({ type: 'SET_COMMISSION', from: A, to: null, amount: '0', nonce: 1, data: { percent: 150 } }),
});

// ------------------------------------------------------------------- TOKEN
const TOKID = eavHash('VETOR-TOKEN');
const tokenSetup = {
  accounts: {
    [A]: { balance: (1000n * UNIT).toString() },
    [B]: { balance: (1000n * UNIT).toString() },
  },
  tokens: { [TOKID]: {
    name: 'Vetor', symbol: 'VET', decimals: 6, totalSupply: '1000000000',
    creator: A, balances: { [A]: '1000000000' },
  } },
};
caso('TOKEN_TRANSFER: move saldo do token, não o nativo', {
  setup: tokenSetup,
  tx: txBase({ type: 'TOKEN_TRANSFER', from: A, to: B, amount: '250000', nonce: 1, data: { token: TOKID } }),
});
caso('TOKEN_TRANSFER: acima do saldo do token é rejeitado', {
  setup: tokenSetup,
  tx: txBase({ type: 'TOKEN_TRANSFER', from: B, to: A, amount: '1', nonce: 1, data: { token: TOKID } }),
});
caso('TOKEN_TRANSFER: token inexistente é rejeitado', {
  setup: tokenSetup,
  tx: txBase({ type: 'TOKEN_TRANSFER', from: A, to: B, amount: '1', nonce: 1, data: { token: eavHash('nao-existe') } }),
});

// ------------------------------------------------------- comportamento de fork
caso('FORK: VOTE abaixo de VOTING_HEIGHT é rejeitado', {
  setup: { accounts: {
    [A]: { balance: (100n * UNIT).toString(), staked: (5_000n * UNIT).toString() },
    [B]: { balance: (100n * UNIT).toString(), staked: (2_000n * UNIT).toString() },
  } },
  tx: txBase({ type: 'VOTE', from: A, to: null, amount: '0', nonce: 1, data: { votes: { [B]: (1_000n * UNIT).toString() } } }),
  height: CHAIN.VOTING_HEIGHT - 1,
  note: 'a MESMA transação é válida acima da altura — é isto que um cliente precisa acertar para não cindir a rede',
});
caso('FORK: a mesma VOTE é aceita acima de VOTING_HEIGHT', {
  setup: { accounts: {
    [A]: { balance: (100n * UNIT).toString(), staked: (5_000n * UNIT).toString() },
    [B]: { balance: (100n * UNIT).toString(), staked: (2_000n * UNIT).toString() },
  } },
  tx: txBase({ type: 'VOTE', from: A, to: null, amount: '0', nonce: 1, data: { votes: { [B]: (1_000n * UNIT).toString() } } }),
  height: CHAIN.VOTING_HEIGHT,
});

// ------------------------------------------------------------------- gravação
const corpo = {
  description:
    'Transições da máquina de estado. Cada caso: estado inicial declarativo + transação + ' +
    'altura -> raiz resultante (ou erro). `rootAfter` prova equivalência de TODO o estado; ' +
    '`effects` existe para a falha dizer o que divergiu, não só que divergiu.',
  invariants: [
    'transação rejeitada não altera o estado: rootAfter == rootBefore',
    'a altura decide quais forks estão ativos; a mesma transação pode ser válida ou não',
    'a taxa é cobrada do remetente e some do supply (queima)',
  ],
  heightAboveAllForks: H,
  cases: casos,
};
// ------------------------------------------------- AI_REVEAL (quórum): apuração
//
// Cobre a regra que decide `winners` e quem leva o resto da divisão. Ficava SEM
// vetor nenhum — e foi por isso que uma dependência de ordem de chegada
// sobreviveu tanto tempo sem ninguém notar: os dois clientes podiam discordar e
// a suíte de conformidade continuava verde.
//
// Os dois casos abaixo são o MESMO cenário com as revelações chegando em ordem
// INVERTIDA. As duas raízes finais têm de ser iguais — é isso que prova que a
// ordem de chegada não entra mais no consenso.
const TAREFA = eavHash('VETOR-AI-TAREFA');
const SAIDA = 'resposta';
const HASH_OK = eavHash(SAIDA);
const SALT = 'sal';
const COMMIT = eavHash(`${SAIDA}|${SALT}`);
const JANELA = { commitDeadline: TS - 1, revealDeadline: TS + 1_000_000 };

const cenarioQuorum = (ordem) => ({
  setup: {
    accounts: {
      [A]: { balance: (10n * UNIT).toString() },
      [B]: { balance: (10n * UNIT).toString() },
      [C]: { balance: (10n * UNIT).toString() },
    },
    oracles: {
      [A]: { stake: (1000n * UNIT).toString() },
      [B]: { stake: (1000n * UNIT).toString() },
      [C]: { stake: (1000n * UNIT).toString() },
    },
    aiTasks: {
      [TAREFA]: {
        requester: A, quorum: 2, reward: '3', ...JANELA,
        commits: { [A]: COMMIT, [B]: COMMIT, [C]: COMMIT },
        // Quem JÁ revelou, na ordem declarada.
        reveals: ordem.map((quem) => [quem, { resultHash: HASH_OK, output: SAIDA }]),
      },
    },
  },
  // A revelação que FECHA a conta — é ela que dispara a apuração.
  tx: txBase({
    type: 'AI_REVEAL', from: C, amount: '0', nonce: 1,
    data: { taskId: TAREFA, output: SAIDA, salt: SALT },
  }),
  height: CHAIN.AI_QUORUM_HEIGHT,
});

caso('AI_REVEAL quórum: apuração com chegada A,B', {
  ...cenarioQuorum([A, B]),
  note: 'recompensa 3 dividida por 3 vencedores: resto 0 — winners em ordem canônica',
});
caso('AI_REVEAL quórum: MESMO cenário com chegada B,A', {
  ...cenarioQuorum([B, A]),
  note: 'raiz final IDÊNTICA à do caso anterior: a ordem de chegada não entra no consenso',
});

const texto = JSON.stringify(estavel(corpo), null, 2) + '\n';
writeFileSync(join(OUT, 'state.json'), texto);

const rejeitados = casos.filter((c) => c.rejected).length;
console.log(`  state.json           ${String(casos.length).padStart(4)} casos  ${String(texto.length).padStart(7)} bytes`);
console.log(`    ${casos.length - rejeitados} aceitos, ${rejeitados} rejeitados`);

// Invariante conferida no próprio gerador: rejeição não pode sujar o estado.
for (const c of casos) {
  if (c.rejected && c.rootAfter !== c.rootBefore) {
    console.error(`\nFALHA DE INVARIANTE: "${c.name}" foi rejeitada mas MUTOU o estado.`);
    console.error('  Isso é bug no nó, não no vetor. Uma transação rejeitada tem de ser um no-op.');
    process.exit(1);
  }
}
console.log('    invariante de rejeição conferida: nenhuma rejeitada mutou o estado');
