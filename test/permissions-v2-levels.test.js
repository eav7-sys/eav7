// Permissões v2 — níveis owner/active/witness/recovery com fila, timelock e veto.
// Ver docs/permissoes-v2.md. Cada teste cobre um vetor da tabela de ataque do plano.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildTransaction } from '../src/core/transaction.js';

const H = CHAIN.PERMISSIONS_V2_HEIGHT;
const DELAY = CHAIN.PERM_DELAY_MIN_BLOCKS;

function chave(state, saldo = 10_000n) {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  state.getAccount(addr).balance = saldo * CHAIN.UNIT;
  return { w, addr };
}

// Conta v2: owner 2-de-2 (o cenário que discutimos), active 1-de-1, recovery com 1 chave.
function contaV2(state, { ownerLimiar = 2 } = {}) {
  const alvo = chave(state);
  const o1 = chave(state);
  const o2 = chave(state);
  const act = chave(state);
  const rec = chave(state);
  state.applyTransaction(
    buildTransaction(alvo.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: {
        permission: {
          owner: { threshold: ownerLimiar, keys: { [o1.addr]: 1, [o2.addr]: 1 } },
          active: { threshold: 1, keys: { [act.addr]: 1 } },
          recovery: rec.addr,
          delayBlocks: DELAY,
        },
      },
    }),
    H,
  );
  return { alvo, o1, o2, act, rec };
}

function tx(state, de, type, data, height = H) {
  const nonce = (state.accounts[de.addr]?.nonce ?? 0) + 1;
  return state.applyTransaction(buildTransaction(de.w, { type, amount: 0, nonce, data }), height);
}

const novoOwner = (addr) => ({ level: 'owner', value: { threshold: 1, keys: { [addr]: 1 } } });

test('v2: configura os quatro níveis e preserva a estrutura', () => {
  const state = new State();
  const { alvo, o1, act, rec } = contaV2(state);
  const p = state.permissions[alvo.addr];
  assert.equal(p.owner.threshold, 2);
  assert.equal(p.owner.keys[o1.addr], 1);
  assert.equal(p.actives[0].keys[act.addr], 1);
  assert.equal(p.recovery, rec.addr);
  assert.equal(p.delayBlocks, DELAY);
});

test('v2: RECUPERAÇÃO — active + recovery trocam o owner após o timelock', () => {
  const state = new State();
  const { alvo, act, rec } = contaV2(state);
  const salvador = chave(state);

  tx(state, act, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(salvador.addr) });
  // active sozinha NÃO autoriza: falta o recovery
  assert.equal(state.pendingPerm[alvo.addr].executeAt, null, 'timelock não iniciou só com a active');

  tx(state, rec, 'PERMISSION_APPROVE', { account: alvo.addr });
  const executeAt = state.pendingPerm[alvo.addr].executeAt;
  assert.equal(executeAt, H + DELAY, 'timelock começou ao completar active + recovery');

  state.blockTick(executeAt - 1);
  assert.ok(state.pendingPerm[alvo.addr], 'ainda pendente antes do prazo');

  state.blockTick(executeAt);
  assert.equal(state.pendingPerm[alvo.addr], undefined, 'pendência consumida');
  assert.deepEqual(Object.keys(state.permissions[alvo.addr].owner.keys), [salvador.addr], 'owner trocado');
});

test('v2: recovery agindo SOZINHO não troca o owner', () => {
  const state = new State();
  const { alvo, rec } = contaV2(state);
  const ladrao = chave(state);

  tx(state, rec, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(ladrao.addr) });
  assert.equal(state.pendingPerm[alvo.addr].executeAt, null, 'sem timelock: recovery não autoriza sozinho');

  state.blockTick(H + DELAY + 1);
  assert.ok(state.pendingPerm[alvo.addr], 'continua pendente para sempre, nunca aplica');
  assert.equal(state.permissions[alvo.addr].owner.threshold, 2, 'owner intacto');
});

test('v2: ladrão com active + recovery é VETADO pelo owner dentro do timelock', () => {
  const state = new State();
  const { alvo, o1, o2, act, rec } = contaV2(state);
  const ladrao = chave(state);

  tx(state, act, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(ladrao.addr) });
  tx(state, rec, 'PERMISSION_APPROVE', { account: alvo.addr });
  assert.ok(state.pendingPerm[alvo.addr].executeAt, 'mudança agendada');

  // uma chave de owner sozinha NÃO veta (limiar 2)
  tx(state, o1, 'PERMISSION_VETO', { account: alvo.addr });
  assert.ok(state.pendingPerm[alvo.addr], 'ainda pendente com 1 veto de 2');

  tx(state, o2, 'PERMISSION_VETO', { account: alvo.addr });
  assert.equal(state.pendingPerm[alvo.addr], undefined, 'vetada ao atingir o limiar de owner');

  state.blockTick(H + DELAY + 1);
  assert.equal(state.permissions[alvo.addr].owner.threshold, 2, 'owner original preservado');
});

test('v2: ladrão com UMA chave de owner não age, não veta e não bloqueia recuperação', () => {
  const state = new State();
  const { alvo, o1, act, rec } = contaV2(state);
  const salvador = chave(state);

  // recuperação legítima em andamento
  tx(state, act, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(salvador.addr) });
  tx(state, rec, 'PERMISSION_APPROVE', { account: alvo.addr });
  const executeAt = state.pendingPerm[alvo.addr].executeAt;

  // o ladrão tem só o1 — veta, mas não atinge o limiar 2
  tx(state, o1, 'PERMISSION_VETO', { account: alvo.addr });
  assert.ok(state.pendingPerm[alvo.addr], 'veto isolado não derruba');

  state.blockTick(executeAt);
  assert.deepEqual(Object.keys(state.permissions[alvo.addr].owner.keys), [salvador.addr], 'recuperação concluiu');
});

test('v2: só UMA pendência por conta — propor de novo substitui', () => {
  const state = new State();
  const { alvo, act, rec } = contaV2(state);
  const a = chave(state);
  const b = chave(state);

  tx(state, act, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(a.addr) });
  tx(state, rec, 'PERMISSION_APPROVE', { account: alvo.addr });
  assert.ok(state.pendingPerm[alvo.addr].executeAt, 'primeira agendada');

  // nova proposta zera aprovações e o agendamento
  tx(state, act, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(b.addr) });
  assert.equal(state.pendingPerm[alvo.addr].executeAt, null, 'agendamento reiniciado');
  assert.equal(Object.keys(state.pendingPerm[alvo.addr].approvals).length, 1);

  state.blockTick(H + DELAY + 1);
  assert.equal(state.permissions[alvo.addr].owner.threshold, 2, 'nenhuma das duas aplicou');
});

test('v2: configuração que deixaria a conta sem active é rejeitada na PROPOSTA', () => {
  const state = new State();
  const { alvo, o1 } = contaV2(state);
  assert.throws(
    () => tx(state, o1, 'PERMISSION_PROPOSE', { account: alvo.addr, change: { level: 'active', value: { threshold: 1, keys: {} } } }),
    /nº de keys inválido|sem active/,
  );
});

test('v2: quem não participa da permissão não propõe, não aprova e não veta', () => {
  const state = new State();
  const { alvo, act, rec } = contaV2(state);
  const estranho = chave(state);
  const salvador = chave(state);

  assert.throws(
    () => tx(state, estranho, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(salvador.addr) }),
    /não participa desta permissão/,
  );

  tx(state, act, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(salvador.addr) });
  assert.throws(
    () => tx(state, estranho, 'PERMISSION_APPROVE', { account: alvo.addr }),
    /não participa desta permissão/,
  );
  // veto exige chave do OWNER — nem a active nem o recovery vetam
  assert.throws(() => tx(state, act, 'PERMISSION_VETO', { account: alvo.addr }), /veto exige chave do owner/);
  assert.throws(() => tx(state, rec, 'PERMISSION_VETO', { account: alvo.addr }), /veto exige chave do owner/);
});

test('v2: trocar a recovery exige owner E active', () => {
  const state = new State();
  const { alvo, o1, o2, act } = contaV2(state);
  const novaRec = chave(state);
  const mudanca = { level: 'recovery', value: novaRec.addr };

  tx(state, o1, 'PERMISSION_PROPOSE', { account: alvo.addr, change: mudanca });
  tx(state, o2, 'PERMISSION_APPROVE', { account: alvo.addr });
  assert.equal(state.pendingPerm[alvo.addr].executeAt, null, 'owner completo ainda não basta');

  tx(state, act, 'PERMISSION_APPROVE', { account: alvo.addr });
  const executeAt = state.pendingPerm[alvo.addr].executeAt;
  assert.ok(executeAt, 'agendou com owner + active');

  state.blockTick(executeAt);
  assert.equal(state.permissions[alvo.addr].recovery, novaRec.addr);
});

test('v2: trocar a active exige apenas o owner', () => {
  const state = new State();
  const { alvo, o1, o2 } = contaV2(state);
  const novaAct = chave(state);

  tx(state, o1, 'PERMISSION_PROPOSE', { account: alvo.addr, change: { level: 'active', value: { threshold: 1, keys: { [novaAct.addr]: 1 } } } });
  tx(state, o2, 'PERMISSION_APPROVE', { account: alvo.addr });
  const executeAt = state.pendingPerm[alvo.addr].executeAt;
  assert.ok(executeAt, 'owner 2-de-2 basta');

  state.blockTick(executeAt);
  assert.deepEqual(Object.keys(state.permissions[alvo.addr].actives[0].keys), [novaAct.addr]);
});

test('v2: delayBlocks fora da faixa é rejeitado', () => {
  const state = new State();
  const alvo = chave(state);
  const k = chave(state);
  const base = {
    owner: { threshold: 1, keys: { [k.addr]: 1 } },
    active: { threshold: 1, keys: { [k.addr]: 1 } },
  };
  assert.throws(
    () => state.applyTransaction(
      buildTransaction(alvo.w, { type: 'PERMISSION_UPDATE', amount: 0, nonce: 1, data: { permission: { ...base, delayBlocks: 1 } } }),
      H,
    ),
    /delayBlocks fora da faixa/,
  );
});

test('v2: ABAIXO do fork as transações de permissão v2 são rejeitadas', () => {
  const state = new State();
  const k = chave(state);
  assert.throws(
    () => tx(state, k, 'PERMISSION_PROPOSE', { account: k.addr, change: novoOwner(k.addr) }, CHAIN.PERMISSIONS_V2_HEIGHT - 1),
    /ainda não ativas/,
  );
});

test('v2: conta em formato v1 não usa o caminho de níveis', () => {
  const state = new State();
  const alvo = chave(state);
  const dono = chave(state);
  state.applyTransaction(
    buildTransaction(alvo.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: { permission: { threshold: 1, keys: { [dono.addr]: 1 } } },
    }),
    H,
  );
  assert.throws(
    () => tx(state, dono, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(dono.addr) }),
    /não usa permissões v2/,
  );
});

// --- Furos encontrados na auditoria da implementação (não teóricos: reproduzidos) -------

test('v2: conta v2 CONSEGUE gastar — não fica inutilizável (regressão do brick)', () => {
  const state = new State();
  const { alvo, act } = contaV2(state);
  const dest = chave(state, 0n);
  state.getAccount(alvo.addr).balance = 100n * CHAIN.UNIT;

  tx(state, act, 'MULTISIG_PROPOSE', {
    account: alvo.addr,
    op: { type: 'TRANSFER', to: dest.addr, amount: (10n * CHAIN.UNIT).toString() },
  });
  assert.equal(state.balanceOf(dest.addr), 10n * CHAIN.UNIT, 'active de limiar 1 gastou');
});

test('v2: PERMISSION_CHANGE por multisig é BLOQUEADO — timelock não é contornável', () => {
  const state = new State();
  const { alvo, act } = contaV2(state);
  const ladrao = chave(state);
  assert.throws(
    () => tx(state, act, 'MULTISIG_PROPOSE', {
      account: alvo.addr,
      op: { type: 'PERMISSION_CHANGE', permission: { threshold: 1, keys: { [ladrao.addr]: 1 } } },
    }),
    /altere permissões via PERMISSION_PROPOSE/,
  );
  assert.equal(state.permissions[alvo.addr].owner.threshold, 2, 'permissão intacta');
});

test('v2: aprovação de chave REMOVIDA durante o timelock não vale na execução', () => {
  const state = new State();
  const { alvo, o1, o2, act, rec } = contaV2(state);
  const salvador = chave(state);
  const novaAct = chave(state);

  // recuperação agendada com a active atual + recovery
  tx(state, act, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(salvador.addr) });
  tx(state, rec, 'PERMISSION_APPROVE', { account: alvo.addr });
  const executeAt = state.pendingPerm[alvo.addr].executeAt;
  assert.ok(executeAt);

  // o owner troca a active POR FORA, substituindo a pendência (uma por conta)…
  tx(state, o1, 'PERMISSION_PROPOSE', { account: alvo.addr, change: { level: 'active', value: { threshold: 1, keys: { [novaAct.addr]: 1 } } } });
  tx(state, o2, 'PERMISSION_APPROVE', { account: alvo.addr });
  state.blockTick(state.pendingPerm[alvo.addr].executeAt);
  assert.deepEqual(Object.keys(state.permissions[alvo.addr].actives[0].keys), [novaAct.addr], 'active trocada');

  // …e a antiga proposta de recuperação não existe mais nem pode ressurgir
  assert.equal(state.pendingPerm[alvo.addr], undefined);
  assert.equal(state.permissions[alvo.addr].owner.threshold, 2, 'owner nunca foi trocado');
});

test('v2: aplicar mudança de permissão limpa ops multisig pendentes', () => {
  const state = new State();
  const { alvo, o1, o2 } = contaV2(state);
  const act2 = chave(state);
  const dest = chave(state, 0n);
  state.getAccount(alvo.addr).balance = 100n * CHAIN.UNIT;

  // eleva a active para 2-de-2 para conseguir deixar uma op PENDENTE
  const k1 = chave(state);
  const k2 = chave(state);
  tx(state, o1, 'PERMISSION_PROPOSE', { account: alvo.addr, change: { level: 'active', value: { threshold: 2, keys: { [k1.addr]: 1, [k2.addr]: 1 } } } });
  tx(state, o2, 'PERMISSION_APPROVE', { account: alvo.addr });
  state.blockTick(state.pendingPerm[alvo.addr].executeAt);

  // op de transferência fica pendente (1 de 2)
  tx(state, k1, 'MULTISIG_PROPOSE', { account: alvo.addr, op: { type: 'TRANSFER', to: dest.addr, amount: '1' } });
  assert.equal(Object.keys(state.pendingOps).length, 1, 'op pendente criada');

  // troca a active de novo → a op aprovada sob a permissão antiga tem de sumir
  tx(state, o1, 'PERMISSION_PROPOSE', { account: alvo.addr, change: { level: 'active', value: { threshold: 1, keys: { [act2.addr]: 1 } } } });
  tx(state, o2, 'PERMISSION_APPROVE', { account: alvo.addr });
  state.blockTick(state.pendingPerm[alvo.addr].executeAt);

  assert.equal(Object.keys(state.pendingOps).length, 0, 'ops pendentes invalidadas pela troca');
});

test('v2: PERMISSION_UPDATE direto continua bloqueado numa conta já configurada', () => {
  const state = new State();
  const { alvo } = contaV2(state);
  const ladrao = chave(state);
  assert.throws(
    () => state.applyTransaction(
      buildTransaction(alvo.w, {
        type: 'PERMISSION_UPDATE', amount: 0, nonce: 2,
        data: { permission: { owner: { threshold: 1, keys: { [ladrao.addr]: 1 } }, active: { threshold: 1, keys: { [ladrao.addr]: 1 } } } },
      }),
      H,
    ),
    /conta multisig: opere via/,
  );
});

// --- Escopo de operações (equivalente ao bitmap de 32 bytes da TRON) -------------------

function contaComEscopo(state, operations) {
  const alvo = chave(state);
  const o = chave(state);
  const act = chave(state);
  state.getAccount(alvo.addr).balance = 1_000n * CHAIN.UNIT;
  state.applyTransaction(
    buildTransaction(alvo.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: {
        permission: {
          owner: { threshold: 1, keys: { [o.addr]: 1 } },
          active: { threshold: 1, keys: { [act.addr]: 1 }, operations },
          delayBlocks: DELAY,
        },
      },
    }),
    H,
  );
  return { alvo, o, act };
}

test('escopo: chave quente restrita a TRANSFER não consegue votar nem stakear', () => {
  const state = new State();
  const { alvo, act } = contaComEscopo(state, ['TRANSFER']);
  const dest = chave(state, 0n);
  const cand = chave(state);
  state.getAccount(cand.addr).staked = CHAIN.MIN_VALIDATOR_STAKE;

  // dentro do escopo
  tx(state, act, 'MULTISIG_PROPOSE', { account: alvo.addr, op: { type: 'TRANSFER', to: dest.addr, amount: (5n * CHAIN.UNIT).toString() } });
  assert.equal(state.balanceOf(dest.addr), 5n * CHAIN.UNIT);

  // fora do escopo
  assert.throws(
    () => tx(state, act, 'MULTISIG_PROPOSE', { account: alvo.addr, op: { type: 'STAKE', amount: (1n * CHAIN.UNIT).toString() } }),
    /fora do escopo/,
  );
  assert.throws(
    () => tx(state, act, 'MULTISIG_PROPOSE', { account: alvo.addr, op: { type: 'VOTE', votes: { [cand.addr]: '1' } } }),
    /fora do escopo/,
  );
});

test('escopo: ausente significa tudo liberado (retrocompatível)', () => {
  const state = new State();
  const { alvo, act } = contaV2(state);
  const dest = chave(state, 0n);
  state.getAccount(alvo.addr).balance = 100n * CHAIN.UNIT;
  assert.equal(state.permissions[alvo.addr].actives[0].operations, undefined);
  tx(state, act, 'MULTISIG_PROPOSE', { account: alvo.addr, op: { type: 'TRANSFER', to: dest.addr, amount: '1' } });
  assert.equal(state.balanceOf(dest.addr), 1n);
});

test('escopo: PERMISSION_CHANGE não é escopável — o desvio do timelock fica fechado', () => {
  const state = new State();
  const alvo = chave(state);
  const o = chave(state);
  assert.throws(
    () => state.applyTransaction(
      buildTransaction(alvo.w, {
        type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
        data: {
          permission: {
            owner: { threshold: 1, keys: { [o.addr]: 1 } },
            active: { threshold: 1, keys: { [o.addr]: 1 }, operations: ['TRANSFER', 'PERMISSION_CHANGE'] },
          },
        },
      }),
      H,
    ),
    /não é escopável/,
  );
});

test('escopo: operação desconhecida, lista vazia e duplicata são rejeitadas', () => {
  const state = new State();
  const alvo = chave(state);
  const o = chave(state);
  const cfg = (operations) => () => state.applyTransaction(
    buildTransaction(alvo.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: { permission: { owner: { threshold: 1, keys: { [o.addr]: 1 } }, active: { threshold: 1, keys: { [o.addr]: 1 }, operations } } },
    }),
    H,
  );
  assert.throws(cfg(['VOAR']), /operação desconhecida/);
  assert.throws(cfg([]), /lista não vazia/);
  assert.throws(cfg(['TRANSFER', 'TRANSFER']), /duplicada/);
});

// --- Múltiplas permissões `active` (a TRON permite 8) ---------------------------------

test('actives: chaves diferentes com escopos diferentes na mesma conta', () => {
  const state = new State();
  const alvo = chave(state);
  const o = chave(state);
  const caixa = chave(state);   // só transfere
  const eleitor = chave(state); // só vota
  state.getAccount(alvo.addr).balance = 1_000n * CHAIN.UNIT;
  state.getAccount(alvo.addr).staked = CHAIN.MIN_VALIDATOR_STAKE * 2n;

  state.applyTransaction(
    buildTransaction(alvo.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: {
        permission: {
          owner: { threshold: 1, keys: { [o.addr]: 1 } },
          actives: [
            { name: 'caixa', threshold: 1, keys: { [caixa.addr]: 1 }, operations: ['TRANSFER'] },
            { name: 'voto', threshold: 1, keys: { [eleitor.addr]: 1 }, operations: ['VOTE'] },
          ],
          delayBlocks: DELAY,
        },
      },
    }),
    H,
  );

  const p = state.permissions[alvo.addr];
  assert.equal(p.actives.length, 2);
  assert.equal(p.actives[0].name, 'caixa');
  assert.equal(p.actives[1].id, 1);

  const dest = chave(state, 0n);
  const cand = chave(state);
  state.getAccount(cand.addr).staked = CHAIN.MIN_VALIDATOR_STAKE;

  // caixa transfere pela active 0
  tx(state, caixa, 'MULTISIG_PROPOSE', { account: alvo.addr, permissionId: 0, op: { type: 'TRANSFER', to: dest.addr, amount: (3n * CHAIN.UNIT).toString() } });
  assert.equal(state.balanceOf(dest.addr), 3n * CHAIN.UNIT);

  // eleitor vota pela active 1
  tx(state, eleitor, 'MULTISIG_PROPOSE', { account: alvo.addr, permissionId: 1, op: { type: 'VOTE', votes: { [cand.addr]: (100n * CHAIN.UNIT).toString() } } });
  assert.equal(state.candidateVotes[cand.addr], 100n * CHAIN.UNIT);

  // cada uma presa ao seu escopo
  assert.throws(
    () => tx(state, caixa, 'MULTISIG_PROPOSE', { account: alvo.addr, permissionId: 0, op: { type: 'VOTE', votes: { [cand.addr]: '1' } } }),
    /fora do escopo/,
  );
  // e a chave de uma active não vale na outra
  assert.throws(
    () => tx(state, caixa, 'MULTISIG_PROPOSE', { account: alvo.addr, permissionId: 1, op: { type: 'VOTE', votes: { [cand.addr]: '1' } } }),
    /não é uma chave autorizada/,
  );
});

test('actives: permissionId inexistente é rejeitado', () => {
  const state = new State();
  const { alvo, act } = contaV2(state);
  assert.throws(
    () => tx(state, act, 'MULTISIG_PROPOSE', { account: alvo.addr, permissionId: 5, op: { type: 'TRANSFER', to: chave(state).addr, amount: '1' } }),
    /active 5 inexistente/,
  );
});

test('actives: acima do limite é rejeitado', () => {
  const state = new State();
  const alvo = chave(state);
  const o = chave(state);
  const muitas = Array.from({ length: CHAIN.MAX_ACTIVE_PERMISSIONS + 1 }, () => ({ threshold: 1, keys: { [chave(state).addr]: 1 } }));
  assert.throws(
    () => state.applyTransaction(
      buildTransaction(alvo.w, {
        type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
        data: { permission: { owner: { threshold: 1, keys: { [o.addr]: 1 } }, actives: muitas } },
      }),
      H,
    ),
    /no máximo .* permissões active/,
  );
});

test('actives: só a PRIMÁRIA participa da recuperação', () => {
  const state = new State();
  const alvo = chave(state);
  const o = chave(state);
  const principal = chave(state);
  const secundaria = chave(state);
  const rec = chave(state);
  const salvador = chave(state);

  state.applyTransaction(
    buildTransaction(alvo.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: {
        permission: {
          owner: { threshold: 1, keys: { [o.addr]: 1 } },
          actives: [
            { threshold: 1, keys: { [principal.addr]: 1 } },
            { threshold: 1, keys: { [secundaria.addr]: 1 } },
          ],
          recovery: rec.addr,
          delayBlocks: DELAY,
        },
      },
    }),
    H,
  );

  // a secundária + recovery NÃO recuperam
  tx(state, secundaria, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(salvador.addr) });
  tx(state, rec, 'PERMISSION_APPROVE', { account: alvo.addr });
  assert.equal(state.pendingPerm[alvo.addr].executeAt, null, 'active secundária não autoriza troca de owner');

  // a primária + recovery recuperam
  tx(state, principal, 'PERMISSION_PROPOSE', { account: alvo.addr, change: novoOwner(salvador.addr) });
  tx(state, rec, 'PERMISSION_APPROVE', { account: alvo.addr });
  const executeAt = state.pendingPerm[alvo.addr].executeAt;
  assert.ok(executeAt, 'active primária autoriza');
  state.blockTick(executeAt);
  assert.deepEqual(Object.keys(state.permissions[alvo.addr].owner.keys), [salvador.addr]);
});

test('actives: nome longo demais é rejeitado', () => {
  const state = new State();
  const alvo = chave(state);
  const o = chave(state);
  assert.throws(
    () => state.applyTransaction(
      buildTransaction(alvo.w, {
        type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
        data: { permission: { owner: { threshold: 1, keys: { [o.addr]: 1 } }, actives: [{ name: 'x'.repeat(CHAIN.MAX_PERMISSION_NAME + 1), threshold: 1, keys: { [o.addr]: 1 } }] } },
      }),
      H,
    ),
    /nome da permissão é longo demais/,
  );
});
