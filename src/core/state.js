import { CHAIN } from '../config.js';
import { eavHash, canonical } from '../crypto/hash.js';
import { isValidAddress, deriveAddressFrom } from '../crypto/keys.js';
import { validateTokenParams } from '../token/eav20.js';
import { verifyBlockIntegrity } from './block.js';
import { verifyTransaction } from './transaction.js';
import { runEavm, EavmError } from '../eavm/vm.js';
import { createHost } from '../eavm/host.js';
import { keccak256 } from '../eavm/keccak.js';
import { bridgeEventDigest, verifyCommitteeProof, committeeUpdateDigest } from '../bridge/proof.js';

// Máquina de estado do protocolo eav20. Valores monetários são BigInt.
// applyTransaction valida TUDO antes de mutar — uma transação que lança erro
// não pode deixar o estado parcialmente modificado (o mempool reusa o mesmo clone).
export class State {
  constructor() {
    this.accounts = {}; // addr -> { balance: BigInt, nonce: Number, staked: BigInt }
    this.tokens = {}; // tokenId (hash E7) -> token EAV20
    this.aiTasks = {}; // taskId (id da tx AI_TASK) -> tarefa de IA
    this.oracles = {}; // addr -> oráculo de IA registrado
    // Ponte cross-chain. processedInbound deduplica depósitos de origem já
    // liberados; attestations acumula os relayers que atestaram cada depósito
    // até atingir o quórum (BRIDGE_MIN_ATTESTATIONS).
    this.bridge = { transfers: {}, lockedNative: 0n, lockedTokens: {}, processedInbound: {}, attestations: {} };
    // Allowlist de relayers de ponte autorizados (semeada na gênese). BRIDGE_IN /
    // BRIDGE_SETTLE só são aceitos destes endereços — não do registro
    // permissionless de oráculos.
    this.bridgeRelayers = {};
    // Comitês das cadeias de ORIGEM (#3): CHAIN -> { members: [endereço eth 0x…],
    // quorum }. Semeados na gênese/governança. A liberação BRIDGE_IN acima do fork
    // exige assinaturas de >= quorum destes membros sobre o evento (ponte trustless).
    this.bridgeSourceCommittees = {};
    // Total de EAV7 (e7) queimado pelo modelo de energia (deflacionário) e total
    // MINTADO em recompensas de bloco. Supply real = GENESIS + minted − burned.
    this.totalBurned = 0n;
    this.totalMinted = 0n;
    // Mundo de contratos EAVM (espaço de endereço 0x): addr -> { code, storage, balance }.
    this.contracts = {};
    // Votação de validadores (#4): votes = eleitor -> { candidato: amountString } (a
    // alocação atual de cada eleitor); candidateVotes = candidato -> total de votos
    // RECEBIDOS de terceiros (BigInt). O peso de ranking é self-stake + candidateVotes.
    this.votes = {};
    this.candidateVotes = {};
    // Permissões / multi-sig (#5): permissions = conta -> { threshold, keys: {addr: peso} }.
    // Conta COM permissão é multisig: não move nada por single-sig; só via propose/approve.
    // pendingOps = opId (id da tx MULTISIG_PROPOSE) -> { account, op, approvals:{signer:peso}, weight }.
    this.permissions = {};
    this.pendingOps = {};
    // Delegação de recurso (#6): delegador -> { delegatário: amount (BigInt) }. O espelho
    // agregado fica em acc.delegatedOut / acc.delegatedIn (usado por resourceStake).
    this.delegations = {};
    // Governança on-chain (#9): params = overrides de parâmetros aprovados (nome -> valor
    // já coagido ao tipo); proposals = id -> proposta em votação/encerrada.
    this.params = {};
    this.proposals = {};
    // Slashing/unbonding (b): slashed = 'produtor:altura' já penalizado (anti-duplo-slash).
    // Cresce com o nº de ofensas penalizadas (raras) — conjunto nullifier-like, como
    // bridge.processedInbound; não é podável sem reabrir replay. unbonding = [{ address,
    // amount, matureAt }] — stake dessteikado esperando o período.
    this.slashed = {};
    this.unbonding = [];
    // Vesting (evolução): id -> { beneficiary, total, claimed, start, cliff, duration }.
    // Fundos travados que liberam linearmente após o cliff; o beneficiário resgata o vested.
    this.vesting = {};
    // Recompensa de eleitores (evolução): commission = validador -> % que fica com ele;
    // rewardAccPerVote = validador -> acumulador de recompensa por unidade de voto (escalado);
    // voterRewardDebt = eleitor -> { validador -> acumulador na última liquidação }.
    this.commission = {};
    this.rewardAccPerVote = {};
    this.voterRewardDebt = {};
    // Tesouraria (evolução): cofre que recebe TREASURY_PCT da recompensa de bloco e é
    // gasto por governança (proposta TREASURY_SPEND).
    this.treasury = 0n;
    // NFTs EAV721 (evolução): collectionId -> { name, symbol, owner, nextId,
    // tokens:{tokenId->{owner,uri}}, approvals:{tokenId->addr} }.
    this.nfts = {};
    // Serviço de nomes EAV-NS (evolução): nome(minúsculo) -> { owner, target, registeredAt }.
    this.names = {};
  }

  getAccount(address) {
    // energyUsed/energyBlock + bandwidthUsed/bandwidthBlock: contabilidade dos recursos.
    // delegatedOut/In: stake cujo RECURSO foi cedido a/recebido de outra conta (#6).
    return (this.accounts[address] ??= {
      balance: 0n, nonce: 0, staked: 0n, energyUsed: 0, energyBlock: 0,
      bandwidthUsed: 0, bandwidthBlock: 0, delegatedOut: 0n, delegatedIn: 0n,
    });
  }

  // Stake efetivo para RECURSOS (energia/bandwidth): o próprio − o delegado a outros
  // + o recebido em delegação (#6). Poder de VOTO e peso de validador seguem usando
  // acc.staked (delegar recurso não tira voto). Sem delegação, = acc.staked.
  resourceStake(acc) {
    return BigInt(acc?.staked ?? 0n) - BigInt(acc?.delegatedOut ?? 0n) + BigInt(acc?.delegatedIn ?? 0n);
  }

  // Energia máxima: cota grátis + bônus por resourceStake (por EAV7 de recurso).
  maxEnergy(acc) {
    return CHAIN.ENERGY.FREE + Number(this.resourceStake(acc) / CHAIN.UNIT) * CHAIN.ENERGY.PER_STAKED_EAV7;
  }

  // Bandwidth máximo: cota grátis + bônus por resourceStake (bytes por EAV7 de recurso).
  maxBandwidth(acc) {
    return CHAIN.BANDWIDTH.FREE + Number(this.resourceStake(acc) / CHAIN.UNIT) * CHAIN.BANDWIDTH.PER_STAKED_EAV7;
  }

  // Falta de bandwidth para custear `bytes`, SEM mutar (regenera ao longo de REGEN_BLOCKS).
  #peekBandwidth(acc, height, bytes) {
    const maxB = this.maxBandwidth(acc);
    const elapsed = Math.max(0, height - (acc.bandwidthBlock ?? 0));
    const used = Math.max(0, (acc.bandwidthUsed ?? 0) - Math.floor((maxB * elapsed) / CHAIN.BANDWIDTH.REGEN_BLOCKS));
    const available = Math.max(0, maxB - used);
    return { shortfall: Math.max(0, bytes - available), usedAfter: used + Math.min(available, bytes) };
  }

  #commitBandwidth(acc, height, peek) {
    acc.bandwidthBlock = height;
    acc.bandwidthUsed = peek.usedAfter;
  }

  // Calcula a energia em FALTA para custear `cost`, SEM mutar (a energia usada
  // regenera linearmente ao longo de REGEN_BLOCKS). Retorna { shortfall, usedAfter }.
  #peekEnergy(acc, height, cost) {
    const maxE = this.maxEnergy(acc);
    const elapsed = Math.max(0, height - (acc.energyBlock ?? 0));
    const used = Math.max(0, (acc.energyUsed ?? 0) - Math.floor((maxE * elapsed) / CHAIN.ENERGY.REGEN_BLOCKS));
    const available = Math.max(0, maxE - used);
    return { shortfall: Math.max(0, cost - available), usedAfter: used + Math.min(available, cost) };
  }

  #commitEnergy(acc, height, peek) {
    acc.energyBlock = height;
    acc.energyUsed = peek.usedAfter;
  }

  // Energia disponível agora (para exibição), sem mutar.
  energyOf(address, height) {
    const acc = this.accounts[address];
    if (!acc) return { max: CHAIN.ENERGY.FREE, available: CHAIN.ENERGY.FREE };
    const maxE = this.maxEnergy(acc);
    const elapsed = Math.max(0, height - (acc.energyBlock ?? 0));
    const used = Math.max(0, (acc.energyUsed ?? 0) - Math.floor((maxE * elapsed) / CHAIN.ENERGY.REGEN_BLOCKS));
    return { max: maxE, available: Math.max(0, maxE - used) };
  }

  balanceOf(address) {
    return this.accounts[address]?.balance ?? 0n;
  }

  credit(address, amount) {
    this.getAccount(address).balance += amount;
  }

  // Isenção de taxa: contas com stake >= FEE_EXEMPT_STAKE transacionam de graça
  // (equivalente ao modelo de bandwidth por freeze da Tron).
  isFeeExempt(address) {
    return (this.accounts[address]?.staked ?? 0n) >= CHAIN.FEE_EXEMPT_STAKE;
  }

  // DPoS: top N contas com stake mínimo, ordenadas por stake (desempate por
  // endereço). Contas mapeadas de EAVM (0x…) são excluídas: elas não têm par de
  // chaves híbrido e nunca conseguiriam assinar/produzir um bloco — se entrassem
  // no conjunto, seus slots seriam pulados (grief de liveness).
  // Valida e normaliza uma permissão { threshold, keys:{addr:peso} } (#5). Garante que
  // a soma dos pesos >= threshold (senão a conta ficaria PERMANENTEMENTE travada).
  #normalizePermission(p) {
    if (!p || typeof p !== 'object') throw new Error('permissão inválida');
    const threshold = Number(p.threshold);
    if (!Number.isSafeInteger(threshold) || threshold <= 0) throw new Error('threshold inválido');
    const keys = p.keys;
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('keys inválidas');
    const entries = Object.entries(keys);
    if (entries.length === 0 || entries.length > CHAIN.MAX_PERMISSION_KEYS) throw new Error('nº de keys inválido');
    let totalWeight = 0;
    const norm = {};
    for (const [addr, w] of entries) {
      if (!isValidAddress(addr)) throw new Error('endereço de key inválido');
      const wt = Number(w);
      if (!Number.isSafeInteger(wt) || wt <= 0) throw new Error('peso inválido');
      totalWeight += wt;
      norm[addr] = wt;
    }
    if (totalWeight < threshold) throw new Error('soma dos pesos < threshold (conta ficaria travada)');
    return { threshold, keys: norm };
  }

  // Executa uma operação multisig APROVADA em nome da conta (#5). Suporta transferência
  // nativa e troca da própria permissão. Chamado só quando o peso das aprovações >= threshold.
  #executeMultisigOp(account, op, height) {
    if (!op || typeof op !== 'object') throw new Error('operação inválida');
    if (op.type === 'TRANSFER') {
      if (!isValidAddress(op.to)) throw new Error('destino inválido');
      const amt = BigInt(op.amount);
      if (amt <= 0n) throw new Error('valor deve ser positivo');
      const acc = this.getAccount(account);
      if (acc.balance < amt) throw new Error('saldo insuficiente na conta multisig');
      acc.balance -= amt;
      this.credit(op.to, amt);
    } else if (op.type === 'STAKE') {
      const amt = BigInt(op.amount);
      if (amt <= 0n) throw new Error('valor deve ser positivo');
      const a = this.getAccount(account);
      if (a.balance < amt) throw new Error('saldo insuficiente na conta multisig');
      a.balance -= amt; a.staked += amt;
    } else if (op.type === 'UNSTAKE') {
      // Contraparte do STAKE: sem isto, o stake de uma conta multisig ficaria travado
      // (a guarda de topo bloqueia UNSTAKE direto). Entra em unbonding como o UNSTAKE normal.
      const amt = BigInt(op.amount);
      if (amt <= 0n) throw new Error('valor deve ser positivo');
      const a = this.getAccount(account);
      if (a.staked < amt) throw new Error('stake insuficiente');
      a.staked -= amt;
      if (this.validators().length === 0) { a.staked += amt; throw new Error('não é possível remover o último validador ativo da rede'); }
      this.unbonding.push({ address: account, amount: amt.toString(), matureAt: height + CHAIN.UNBONDING_BLOCKS });
    } else if (op.type === 'TOKEN_TRANSFER') {
      const token = this.tokens[op.token];
      if (!token) throw new Error('token inexistente');
      this.#tokenGuard(token, account, op.to);
      const amt = BigInt(op.amount);
      if (amt <= 0n) throw new Error('valor deve ser positivo');
      if (!isValidAddress(op.to)) throw new Error('destino inválido');
      if (this.#tokenAvailable(token, account, height) < amt) throw new Error('saldo do token insuficiente ou congelado');
      token.balances[account] = (token.balances[account] ?? 0n) - amt;
      token.balances[op.to] = (token.balances[op.to] ?? 0n) + amt;
    } else if (op.type === 'NFT_TRANSFER') {
      const col = this.nfts[op.collection];
      if (!col) throw new Error('coleção inexistente');
      const nft = col.tokens[String(op.tokenId)];
      if (!nft || nft.owner !== account) throw new Error('a conta multisig não é dona deste NFT');
      if (!isValidAddress(op.to)) throw new Error('destino inválido');
      nft.owner = op.to;
      delete col.approvals[String(op.tokenId)];
    } else if (op.type === 'PERMISSION_CHANGE') {
      if (op.permission === null) delete this.permissions[account]; // remove multisig (volta a single-sig)
      else this.permissions[account] = this.#normalizePermission(op.permission);
      // Invalida ops pendentes desta conta: elas foram aprovadas sob a permissão ANTIGA
      // (pesos/threshold), que não valem mais. Devem ser repropostas sob a nova.
      for (const [id, p] of Object.entries(this.pendingOps)) if (p.account === account) delete this.pendingOps[id];
    } else {
      throw new Error(`tipo de operação multisig não suportado: ${op.type}`);
    }
  }

  // Quanto de um vesting já venceu na altura `height`: 0 antes do cliff; linear entre
  // start e start+duration; total ao fim. Determinístico (só inteiros).
  vestedAmount(v, height) {
    const total = BigInt(v.total);
    if (height < v.start + v.cliff) return 0n;
    if (height >= v.start + v.duration) return total;
    return (total * BigInt(height - v.start)) / BigInt(v.duration);
  }

  // Distribui a recompensa de bloco: comissão ao produtor + partilha do resto com quem
  // votou nele (via acumulador reward-por-voto, O(1)). Sem votos, o produtor leva tudo
  // (retrocompatível). O `dust` da divisão inteira também vai ao produtor (conserva).
  distributeBlockReward(producer, reward) {
    // Corte da tesouraria (governável) sai primeiro; o resto vai a comissão + eleitores.
    const treasuryCut = (reward * BigInt(this.param('TREASURY_PCT'))) / 100n;
    if (treasuryCut > 0n) { this.treasury += treasuryCut; reward -= treasuryCut; }
    const totalVotes = this.candidateVotes[producer] ?? 0n;
    if (totalVotes <= 0n || reward <= 0n) { this.credit(producer, reward); return; }
    const pct = BigInt(this.commission[producer] ?? CHAIN.DEFAULT_COMMISSION_PCT);
    const commission = (reward * pct) / 100n;
    const voterShare = reward - commission;
    const inc = (voterShare * CHAIN.REWARD_SCALE) / totalVotes;
    const dust = voterShare - (inc * totalVotes) / CHAIN.REWARD_SCALE;
    this.credit(producer, commission + dust);
    this.rewardAccPerVote[producer] = (this.rewardAccPerVote[producer] ?? 0n) + inc;
  }

  // Liquida a recompensa pendente de um eleitor por um validador: credita votos*(acc-debt)
  // e atualiza a dívida. NÃO mexe em totalMinted (a emissão já foi contada no bloco).
  #settleVoterReward(voter, validator) {
    const votes = BigInt(this.votes[voter]?.[validator] ?? 0n);
    const acc = this.rewardAccPerVote[validator] ?? 0n;
    if (votes > 0n) {
      const debt = this.voterRewardDebt[voter]?.[validator] ?? 0n;
      const pending = (votes * (acc - debt)) / CHAIN.REWARD_SCALE;
      if (pending > 0n) this.credit(voter, pending);
    }
    (this.voterRewardDebt[voter] ??= {})[validator] = acc;
  }

  // Guarda de token EAV20: rejeita se pausado ou se algum endereço envolvido está na blacklist.
  #tokenGuard(token, ...addrs) {
    if (token.paused) throw new Error('token pausado');
    const bl = token.blacklist ?? {};
    for (const a of addrs) if (a && bl[a]) throw new Error(`endereço bloqueado neste token: ${a}`);
  }

  // Saldo de token TRANSFERÍVEL de um endereço: total menos o CONGELADO ainda não vencido.
  #tokenAvailable(token, addr, height) {
    const bal = token.balances[addr] ?? 0n;
    const fr = token.frozen?.[addr];
    if (fr && height < fr.unlockAt) return bal - BigInt(fr.amount);
    return bal;
  }

  // Aplica só o EFEITO de uma tx patrocinada (meta-tx). Restrito às operações de valor
  // comuns; o relayer já pagou a taxa. Não mexe em energia/fee do usuário.
  #applyMetaEffect(inner, fromAcc, height) {
    const amount = BigInt(inner.amount);
    if (inner.type === 'TRANSFER') {
      if (!isValidAddress(inner.to)) throw new Error('destino inválido');
      if (amount <= 0n) throw new Error('valor deve ser positivo');
      if (fromAcc.balance < amount) throw new Error('saldo insuficiente');
      fromAcc.balance -= amount;
      this.credit(inner.to, amount);
    } else if (inner.type === 'TOKEN_TRANSFER') {
      const token = this.tokens[inner.data?.token];
      if (!token) throw new Error('token inexistente');
      this.#tokenGuard(token, inner.from, inner.to); // pausa + blacklist (mesmas guardas do TOKEN_TRANSFER direto)
      if (amount <= 0n) throw new Error('valor do token deve ser positivo');
      if (this.#tokenAvailable(token, inner.from, height) < amount) throw new Error('saldo do token insuficiente ou congelado');
      token.balances[inner.from] = (token.balances[inner.from] ?? 0n) - amount;
      token.balances[inner.to] = (token.balances[inner.to] ?? 0n) + amount;
    } else {
      throw new Error(`tipo não patrocinável via meta-tx: ${inner.type}`);
    }
  }

  // Total de votos que um eleitor alocou (soma da sua entrada em `votes`).
  votedTotal(address) {
    let sum = 0n;
    for (const a of Object.values(this.votes[address] ?? {})) sum += BigInt(a);
    return sum;
  }

  // Valor EFETIVO de um parâmetro governável (#9): o override aprovado on-chain
  // (state.params) se houver, senão o default de CHAIN. Já vem coagido ao tipo certo.
  param(name) {
    return Object.prototype.hasOwnProperty.call(this.params, name) ? this.params[name] : CHAIN[name];
  }

  // Conjunto ativo: top-N candidatos elegíveis (self-stake >= MIN, não-EAVM) por PESO
  // = self-stake + votos RECEBIDOS de terceiros (#4). Sem votos, `candidateVotes` é
  // vazio e o peso é só o stake → mesma ordenação de antes (retrocompatível). MIN e N
  // são governáveis (#9). Desempate por endereço, determinístico.
  validators() {
    const minStake = this.param('MIN_VALIDATOR_STAKE');
    return Object.entries(this.accounts)
      .filter(([, acc]) => acc.staked >= minStake && !acc.eavmManaged)
      .map(([address, acc]) => ({ address, staked: acc.staked, votes: this.candidateVotes[address] ?? 0n }))
      .sort((a, b) => {
        const wa = a.staked + a.votes, wb = b.staked + b.votes;
        if (wa !== wb) return wa > wb ? -1 : 1;
        return a.address < b.address ? -1 : 1;
      })
      .slice(0, this.param('MAX_VALIDATORS'))
      .map(({ address, staked, votes }) => ({ address, staked, votes }));
  }

  // #9: coage/valida o valor proposto para um parâmetro governável (tipo + limites).
  #coerceGovValue(spec, raw) {
    if (spec.kind === 'bigint') {
      let v;
      try { v = BigInt(raw); } catch { throw new Error('valor inválido (esperado inteiro)'); }
      if (v < spec.min || v > spec.max) throw new Error('valor fora dos limites permitidos');
      return v;
    }
    const v = Number(raw);
    if (!Number.isSafeInteger(v) || v < spec.min || v > spec.max) throw new Error('valor inválido/fora dos limites');
    return v;
  }

  // Fix 3: valida um valor de comitê de ponte proposto por governança.
  #validateCommitteeValue(v) {
    if (!v || typeof v !== 'object') throw new Error('valor de comitê inválido');
    const sourceChain = String(v.sourceChain ?? '');
    if (!/^[A-Z0-9_-]{2,32}$/i.test(sourceChain)) throw new Error('sourceChain inválida');
    const members = (v.members ?? []).map((m) => String(m).toLowerCase());
    if (members.length === 0 || members.length > 200) throw new Error('nº de membros inválido');
    if (new Set(members).size !== members.length) throw new Error('membros duplicados');
    const quorum = Number(v.quorum);
    if (!Number.isSafeInteger(quorum) || quorum <= 0 || quorum > members.length) throw new Error('quorum inválido');
    return { sourceChain: sourceChain.toUpperCase(), members, quorum };
  }

  // Valida um gasto de tesouraria proposto por governança.
  #validateTreasurySpend(v) {
    if (!v || typeof v !== 'object') throw new Error('gasto de tesouraria inválido');
    if (!isValidAddress(v.recipient)) throw new Error('destinatário inválido');
    let amount;
    try { amount = BigInt(v.amount); } catch { throw new Error('valor inválido'); }
    if (amount <= 0n) throw new Error('valor deve ser positivo');
    return { recipient: v.recipient, amount: amount.toString() };
  }

  // #9: conta votos de validadores ATUAIS numa proposta; ao atingir 2/3+1, aplica o
  // override e marca EXECUTED. Determinístico (validadores e votos são estado).
  #tallyProposal(p, height) {
    const active = new Set(this.validators().map((v) => v.address));
    const N = active.size;
    if (N === 0) return;
    const quorum = Math.floor((2 * N) / 3) + 1;
    let yes = 0;
    for (const a of Object.keys(p.votes)) if (active.has(a)) yes++;
    if (yes >= quorum) {
      // Timelock: não aplica na hora — ENFILEIRA. O tick aplica em `executeAt`, dando
      // janela pros usuários reagirem antes de o parâmetro valer.
      p.status = 'QUEUED';
      p.executeAt = height + CHAIN.GOV_TIMELOCK_BLOCKS;
    }
  }

  // Hook determinístico rodado UMA vez por bloco (após as txs): aplica governança madura,
  // matura desbloqueios de stake (unbonding, (b)) e poda estado terminal (propostas
  // aplicadas/expiradas, ops multisig vencidas) para o estado não crescer sem fim.
  blockTick(height) {
    // governança madura + poda de propostas
    for (const [id, p] of Object.entries(this.proposals)) {
      if (p.status === 'QUEUED' && height >= p.executeAt) {
        if (p.param === 'BRIDGE_COMMITTEE') {
          const v = p.value;
          // BOOTSTRAP APENAS: governança só CRIA o primeiro comitê. Trocar um comitê ATIVO
          // exige o handoff assinado pela origem (BRIDGE_COMMITTEE_UPDATE) — senão 2/3 dos
          // validadores EAV7 trocariam o comitê por chaves próprias e drenariam a ponte.
          if (!this.bridgeSourceCommittees[v.sourceChain]) {
            this.bridgeSourceCommittees[v.sourceChain] = { members: v.members, quorum: v.quorum, epoch: 0 };
          }
        } else if (p.param === 'TREASURY_SPEND') {
          const amt = BigInt(p.value.amount); // gasta só se a tesouraria cobre (senão a proposta não tem efeito)
          if (this.treasury >= amt) { this.treasury -= amt; this.credit(p.value.recipient, amt); }
        } else {
          const prev = Object.prototype.hasOwnProperty.call(this.params, p.param) ? this.params[p.param] : undefined;
          this.params[p.param] = p.value; // aplica o override (efeito persiste em params)
          // Rail anti-brick: uma mudança que ESVAZIARIA o conjunto de validadores (MIN muito
          // alto / MAX 0) travaria a cadeia irreversivelmente — reverte em vez de aplicar.
          if ((p.param === 'MIN_VALIDATOR_STAKE' || p.param === 'MAX_VALIDATORS') && this.validators().length === 0) {
            if (prev === undefined) delete this.params[p.param]; else this.params[p.param] = prev;
          }
        }
        delete this.proposals[id]; // poda: o registro não é mais necessário
      } else if (p.status === 'VOTING' && height > p.deadline) {
        delete this.proposals[id]; // expirou sem atingir quórum
      }
    }
    // ops multisig pendentes vencidas
    for (const [id, op] of Object.entries(this.pendingOps)) {
      if (op.deadline !== undefined && height > op.deadline) delete this.pendingOps[id];
    }
    // unbonding maduro: devolve o stake dessteikado ao saldo depois do período (b)
    if (this.unbonding.length) {
      const still = [];
      for (const u of this.unbonding) {
        if (height >= u.matureAt) this.credit(u.address, BigInt(u.amount));
        else still.push(u);
      }
      this.unbonding = still;
    }
  }

  pendingAiTasks() {
    return Object.values(this.aiTasks).filter((task) => task.status === 'PENDING');
  }

  tokenBalancesOf(address) {
    const result = {};
    for (const [id, token] of Object.entries(this.tokens)) {
      const balance = token.balances[address] ?? 0n;
      if (balance > 0n) result[id] = { symbol: token.symbol, decimals: token.decimals, balance };
    }
    return result;
  }

  clone() {
    const copy = new State();
    copy.accounts = structuredClone(this.accounts);
    copy.tokens = structuredClone(this.tokens);
    copy.aiTasks = structuredClone(this.aiTasks);
    copy.oracles = structuredClone(this.oracles);
    copy.bridge = structuredClone(this.bridge);
    copy.bridgeRelayers = structuredClone(this.bridgeRelayers);
    copy.bridgeSourceCommittees = structuredClone(this.bridgeSourceCommittees);
    copy.totalBurned = this.totalBurned;
    copy.totalMinted = this.totalMinted;
    copy.contracts = structuredClone(this.contracts);
    copy.votes = structuredClone(this.votes);
    copy.candidateVotes = structuredClone(this.candidateVotes);
    copy.permissions = structuredClone(this.permissions);
    copy.pendingOps = structuredClone(this.pendingOps);
    copy.delegations = structuredClone(this.delegations);
    copy.params = structuredClone(this.params);
    copy.proposals = structuredClone(this.proposals);
    copy.slashed = structuredClone(this.slashed);
    copy.unbonding = structuredClone(this.unbonding);
    copy.vesting = structuredClone(this.vesting);
    copy.commission = structuredClone(this.commission);
    copy.rewardAccPerVote = structuredClone(this.rewardAccPerVote);
    copy.voterRewardDebt = structuredClone(this.voterRewardDebt);
    copy.treasury = this.treasury;
    copy.nfts = structuredClone(this.nfts);
    copy.names = structuredClone(this.names);
    return copy;
  }

  applyGenesis(genesis) {
    for (const [address, amount] of Object.entries(genesis.balances ?? {})) {
      this.credit(address, BigInt(amount));
    }
    for (const [address, amount] of Object.entries(genesis.stakes ?? {})) {
      this.getAccount(address).staked += BigInt(amount);
    }
    for (const address of genesis.bridgeRelayers ?? []) {
      this.bridgeRelayers[address] = true;
    }
    // Vesting semeado na gênese: distribuição de time/investidor nasce VESTIDA (não líquida).
    // { id, beneficiary, total, cliff, duration } — start = 0 (o gênese).
    for (const v of genesis.vesting ?? []) {
      this.vesting[v.id] = {
        beneficiary: v.beneficiary, total: BigInt(v.total).toString(), claimed: '0',
        start: 0, cliff: Number(v.cliff) || 0, duration: Number(v.duration) || 1,
      };
    }
    for (const [chain, committee] of Object.entries(genesis.bridgeSourceCommittees ?? {})) {
      this.bridgeSourceCommittees[chain.toUpperCase()] = {
        members: (committee.members ?? []).map((m) => String(m).toLowerCase()),
        quorum: Number(committee.quorum) || 0,
        epoch: Number(committee.epoch) || 0, // (d) rotação: incrementa a cada handoff
      };
    }
  }

  // Forma 0x (160 bits) de um endereço para os opcodes ADDRESS/CALLER da VM.
  #eavmForm(addr) {
    if (typeof addr === 'string' && addr.startsWith('0x')) return addr;
    return '0x' + keccak256(Buffer.from(String(addr))).subarray(12).toString('hex');
  }

  // Mundo de contratos (espaço 0x) para a VM: storage/código/saldo + snapshot/revert
  // (isolamento de sub-chamadas que revertem). NON-PAYABLE nesta fase: NÃO há ponte
  // de valor nativo↔contrato (removida no achado A-3). Os saldos do mundo de
  // contratos começam e permanecem em 0 (SELFDESTRUCT proibido); só a taxa nativa é
  // debitada. Value/payable é a Fase 2.3 com ledger unificado — NÃO reabilitar aqui.
  #eavmWorld() {
    const C = this.contracts;
    // Journaling (undo-log): snapshot = comprimento do journal (O(1)); revert desfaz
    // só as entradas desde o snapshot (O(mudanças do frame)). Evita o structuredClone
    // do mundo inteiro a cada CALL/CREATE — que era um DoS de CPU (achados A-2/M-2).
    const journal = [];
    const get = (a) => { if (!C[a]) { C[a] = { code: '', storage: {}, balance: 0n, nonce: 0 }; journal.push(['new', a]); } return C[a]; };
    return {
      getCode: (a) => Buffer.from((C[a]?.code ?? '').replace(/^0x/, ''), 'hex'),
      putCode: (a, buf) => { const c = get(a); journal.push(['code', a, c.code]); c.code = '0x' + Buffer.from(buf).toString('hex'); },
      getStorage: (a, k) => BigInt(C[a]?.storage?.[k] ?? 0n),
      setStorage: (a, k, v) => { const s = get(a).storage; journal.push(['stor', a, k, s[k]]); if (v === 0n) delete s[k]; else s[k] = '0x' + v.toString(16); },
      getBalance: (a) => C[a]?.balance ?? 0n,
      addBalance: (a, d) => { const c = get(a); journal.push(['bal', a, c.balance]); c.balance += d; },
      bumpNonce: (a) => { const c = get(a); journal.push(['non', a, c.nonce]); const n = c.nonce ?? 0; c.nonce = n + 1; return n; },
      createAddress: (s, n) => '0x' + keccak256(Buffer.from(s + ':' + n)).subarray(12).toString('hex'),
      create2Address: (s, salt, init) => '0x' + keccak256(Buffer.concat([Buffer.from(s.slice(2), 'hex'), Buffer.from(salt.toString(16).padStart(64, '0'), 'hex'), keccak256(init)])).subarray(12).toString('hex'),
      snapshot: () => journal.length,
      revert: (n) => {
        while (journal.length > n) {
          const e = journal.pop();
          if (e[0] === 'new') delete C[e[1]];
          else if (e[0] === 'code') C[e[1]].code = e[2];
          else if (e[0] === 'stor') { if (e[3] === undefined) delete C[e[1]].storage[e[2]]; else C[e[1]].storage[e[2]] = e[3]; }
          else if (e[0] === 'bal') C[e[1]].balance = e[2];
          else if (e[0] === 'non') C[e[1]].nonce = e[2];
        }
      },
    };
  }

  // Roda um contrato (DEPLOY/CALL) mutando o mundo de contratos; sub-chamadas que
  // revertem são isoladas pelo host. Na reversão da ENTRADA, o mundo é restaurado.
  // O orçamento de gás é limitado pela energia + queima que o SALDO real suporta (H1).
  #runEavmTx(tx, height, baseCost, blockTs = 0) {
    const isDeploy = tx.type === 'EAVM_DEPLOY';
    const from = this.getAccount(tx.from);
    // Fase 2.2: contratos NÃO são payable (sem ponte de valor nativo↔contrato, que
    // era unidirecional e travava fundos — achado A-3). Value/payable é a Fase 2.3
    // com ledger unificado. Rejeitado ANTES de rodar a VM (sem mutação).
    if (BigInt(tx.amount) !== 0n) throw new Error('EAVM não aceita valor (amount) nesta fase — use 0');
    const avail = this.energyOf(tx.from, height).available;
    const feeBurnable = BigInt(tx.fee) / CHAIN.ENERGY.BURN_PER_ENERGY;
    const balBurnable = from.balance / CHAIN.ENERGY.BURN_PER_ENERGY;
    const burnable = Number(feeBurnable < balBurnable ? feeBurnable : balBurnable);
    // orçamento de gás limitado por energia+queima que o saldo suporta (H1). Se o
    // orçamento útil for <= 0, rejeita ANTES de rodar a VM (fecha a folga do A-4).
    const budgetEnergy = avail + burnable - baseCost;
    if (budgetEnergy <= 0) throw new Error('energia/saldo insuficiente para executar o contrato');
    const budget = BigInt(Math.min(CHAIN.MAX_EAVM_GAS, budgetEnergy * CHAIN.GAS_PER_ENERGY));

    const world = this.#eavmWorld();
    const host = createHost(world);
    const sender0x = this.#eavmForm(tx.from);
    // M-1: usa o timestamp REAL do bloco (validado contra o drift do relógio), não
    // o tx.timestamp arbitrário do remetente — único por bloco, como no EVM.
    const block = { number: height, timestamp: blockTs, chainId: CHAIN.EAVM_CHAIN_ID };

    let contractAddr, code;
    if (isDeploy) {
      code = Buffer.from(String(tx.data?.code ?? '').replace(/^0x/, ''), 'hex');
      if (code.length === 0) throw new Error('EAVM_DEPLOY exige data.code (bytecode)');
      contractAddr = world.createAddress(sender0x, from.nonce);
      if (this.contracts[contractAddr]?.code) throw new Error('endereço de contrato já ocupado');
    } else {
      contractAddr = String(tx.data?.to ?? '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(contractAddr) || !this.contracts[contractAddr]) throw new Error('destino não é um contrato EAVM (use data.to = 0x…)');
      code = world.getCode(contractAddr);
    }

    let res;
    try {
      res = runEavm({
        host, code,
        calldata: Buffer.from(String(isDeploy ? '' : (tx.data?.input ?? '')).replace(/^0x/, ''), 'hex'),
        gas: budget, caller: sender0x, address: contractAddr, value: 0n,
        origin: sender0x, gasPrice: 0n, depth: 0, block,
      });
      if (isDeploy) {
        // L-2: cobra o gás de depósito de código (len×20), igual ao CREATE aninhado.
        const deposit = BigInt(res.returnData.length) * 20n;
        if (res.success && res.returnData.length <= CHAIN.MAX_CONTRACT_BYTES && res.gasUsed + deposit <= budget) {
          world.putCode(contractAddr, res.returnData);
          res = { ...res, gasUsed: res.gasUsed + deposit };
        } else {
          res = { ...res, success: false };
        }
      }
    } catch (e) {
      if (e instanceof EavmError) res = { success: false, gasUsed: budget, returnData: Buffer.alloc(0) };
      else { world.revert(0); throw e; }
    }
    if (!res.success) world.revert(0); // reverte tudo no mundo de contratos
    // world é retornado para o applyTransaction poder reverter atomicamente se
    // uma checagem posterior (fee/saldo) lançar depois da VM (corrige C-1/A-4).
    return { success: res.success, gasUsed: res.gasUsed, returnData: res.returnData, contractAddr, isDeploy, logs: res.success ? (res.logs ?? []) : [], world };
  }

  // Aplica uma transação já validada de forma stateless. Lança Error se as
  // regras de estado forem violadas. Retorna a taxa cobrada (BigInt).
  applyTransaction(tx, height = 0, blockTs = 0, logSink = null) {
    // L3: valida o nonce ANTES de materializar a conta (não cria conta-fantasma
    // no clone reusado quando a tx lança). L2: reafirma o teto do fee no estado.
    const curNonce = this.accounts[tx.from]?.nonce ?? 0;
    if (tx.nonce !== curNonce + 1) {
      throw new Error(`nonce inválido (esperado ${curNonce + 1}, recebido ${tx.nonce})`);
    }
    if (BigInt(tx.fee) > CHAIN.MAX_FEE_LIMIT) throw new Error('limite de taxa (fee) acima do máximo permitido');
    const acc = this.getAccount(tx.from);
    const amount = BigInt(tx.amount);
    // #5: conta multisig (com permissão) não age por assinatura ÚNICA. Todas as suas
    // operações (mover fundos, alterar permissão) passam por MULTISIG_PROPOSE/APPROVE
    // das chaves autorizadas — que assinam de SUAS PRÓPRIAS contas. Bloquear aqui impede
    // que a chave-dona original burle o M-de-N transferindo direto.
    if (this.permissions[tx.from]) {
      throw new Error('conta multisig: opere via MULTISIG_PROPOSE/APPROVE, não por assinatura única');
    }
    // ---- Energia: consome energia; a FALTA é queimada em EAV7 (deflacionário).
    // O peek NÃO muta (só commita no fim, após todas as validações passarem — o
    // clone do estado é reusado e uma tx que lança não pode deixar estado sujo).
    let cost = CHAIN.ENERGY.COST[tx.type] ?? 1;
    // Contratos EAVM: roda a VM ANTES de cobrar (o gás gasto vira energia).
    let vm = null;
    if (tx.type === 'EAVM_DEPLOY' || tx.type === 'EAVM_CALL') {
      vm = this.#runEavmTx(tx, height, cost, blockTs);
      cost += Math.ceil(Number(vm.gasUsed) / CHAIN.GAS_PER_ENERGY);
    }
    const energy = this.#peekEnergy(acc, height, cost);
    // #6: bandwidth consumido pelo TAMANHO da tx (só a partir de RESOURCE_HEIGHT — abaixo
    // do fork o cálculo de fee é idêntico ao antigo, replay do histórico intacto).
    let bw = null;
    let bwFee = 0n;
    if (height >= CHAIN.RESOURCE_HEIGHT) {
      const bytes = Buffer.byteLength(canonical(tx));
      bw = this.#peekBandwidth(acc, height, bytes);
      bwFee = BigInt(bw.shortfall) * CHAIN.BANDWIDTH.BURN_PER_BYTE;
    }
    const fee = BigInt(energy.shortfall) * CHAIN.ENERGY.BURN_PER_ENERGY + bwFee;
    if (fee > BigInt(tx.fee)) {
      if (vm) vm.world.revert(0); // atomicidade: desfaz o que a VM mutou antes de lançar (C-1/A-4)
      throw new Error('recursos (energia/bandwidth) insuficientes e limite de taxa excedido — faça stake ou aumente o limite');
    }

    switch (tx.type) {
      case 'TRANSFER': {
        if (amount <= 0n) throw new Error('valor da transferência deve ser positivo');
        if (acc.balance < amount + fee) throw new Error('saldo insuficiente');
        acc.balance -= amount + fee;
        this.credit(tx.to, amount);
        break;
      }

      // Transferência do protocolo EAVM (MetaMask/Trust Wallet), autenticada
      // pela assinatura secp256k1 do raw. Essas carteiras permitem valor 0.
      case 'EAVM_TRANSFER': {
        if (amount < 0n) throw new Error('valor inválido');
        if (acc.balance < amount + fee) throw new Error('saldo insuficiente');
        acc.balance -= amount + fee;
        this.credit(tx.to, amount);
        break;
      }

      case 'STAKE': {
        if (amount <= 0n) throw new Error('stake deve ser positivo');
        if (acc.balance < amount + fee) throw new Error('saldo insuficiente');
        acc.balance -= amount + fee;
        acc.staked += amount;
        // conta que stakeia via EAVM (0x…) não pode ser produtora de bloco
        if (tx.scheme === 'eav7-eavm-1') acc.eavmManaged = true;
        break;
      }

      case 'VOTE': {
        if (height < CHAIN.VOTING_HEIGHT) throw new Error('votação de validadores ainda não ativa');
        const votes = tx.data?.votes;
        if (!votes || typeof votes !== 'object' || Array.isArray(votes)) throw new Error('votos inválidos');
        const entries = Object.entries(votes);
        if (entries.length === 0 || entries.length > CHAIN.MAX_VOTE_TARGETS) throw new Error('nº de candidatos inválido');
        let total = 0n;
        const parsed = [];
        for (const [cand, amtRaw] of entries) {
          if (!isValidAddress(cand)) throw new Error('endereço de candidato inválido');
          if (cand === tx.from) throw new Error('não pode votar em si mesmo (o self-stake já conta)');
          // Candidato precisa ser ELEGÍVEL (self-stake >= mínimo) — senão votar num
          // endereço-lixo acumularia `candidateVotes` que nunca vira validador (poeira de estado).
          if ((this.accounts[cand]?.staked ?? 0n) < this.param('MIN_VALIDATOR_STAKE')) throw new Error('candidato não elegível (self-stake abaixo do mínimo)');
          const amt = BigInt(amtRaw);
          if (amt <= 0n) throw new Error('voto deve ser positivo');
          total += amt;
          parsed.push([cand, amt]);
        }
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        if (total > acc.staked) throw new Error('votos excedem o poder de voto (stake)');
        acc.balance -= fee;
        // remove a alocação ANTERIOR: LIQUIDA a recompensa pendente de cada candidato
        // ANTES de mexer nos votos (senão o eleitor perderia o acumulado).
        for (const [c, a] of Object.entries(this.votes[tx.from] ?? {})) {
          this.#settleVoterReward(tx.from, c);
          const left = (this.candidateVotes[c] ?? 0n) - BigInt(a);
          if (left > 0n) this.candidateVotes[c] = left; else delete this.candidateVotes[c];
        }
        // aplica a nova alocação, zerando a dívida (começa a acumular do ponto atual)
        const rec = {};
        for (const [c, a] of parsed) {
          this.candidateVotes[c] = (this.candidateVotes[c] ?? 0n) + a;
          rec[c] = a.toString();
          (this.voterRewardDebt[tx.from] ??= {})[c] = this.rewardAccPerVote[c] ?? 0n;
        }
        this.votes[tx.from] = rec;
        break;
      }

      // O validador define a COMISSÃO (% da recompensa que fica com ele; o resto vai aos eleitores).
      case 'SET_COMMISSION': {
        if (height < CHAIN.VOTING_HEIGHT) throw new Error('votação ainda não ativa');
        const pct = Number(tx.data?.percent);
        if (!Number.isSafeInteger(pct) || pct < 0 || pct > 100) throw new Error('comissão deve ser 0..100');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        this.commission[tx.from] = pct;
        break;
      }

      // O eleitor resgata a recompensa acumulada por ter votado num validador.
      case 'CLAIM_VOTER_REWARD': {
        if (height < CHAIN.VOTING_HEIGHT) throw new Error('votação ainda não ativa');
        const validator = tx.data?.validator;
        if (!isValidAddress(validator)) throw new Error('validador inválido');
        if ((this.votes[tx.from]?.[validator] ?? null) === null) throw new Error('você não vota nesse validador');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        this.#settleVoterReward(tx.from, validator);
        break;
      }

      // Meta-transação (gasless): o RELAYER (tx.from do META_TX) já pagou a energia/taxa no
      // topo do applyTransaction. Aqui só aplicamos o EFEITO da tx assinada do usuário, com
      // o NONCE do usuário (replay protection). O usuário não gasta EAV7 nenhum.
      case 'META_TX': {
        if (height < CHAIN.META_HEIGHT) throw new Error('meta-transação ainda não ativa');
        const inner = tx.data?.inner;
        if (!inner || typeof inner !== 'object' || inner.type === 'META_TX') throw new Error('inner inválida');
        const err = verifyTransaction(inner);
        if (err) throw new Error(`inner inválida: ${err}`);
        // CRÍTICO: uma conta multisig NÃO pode agir por meta-tx — senão a chave-dona
        // original (ou qualquer chave) burlaria o M-de-N patrocinando uma inner assinada
        // como a conta multisig. Mesma guarda do topo, agora também para o efeito interno.
        if (this.permissions[inner.from]) throw new Error('conta multisig: opere via MULTISIG_PROPOSE/APPROVE, não por meta-tx');
        const uAcc = this.getAccount(inner.from);
        if (inner.nonce !== (uAcc.nonce ?? 0) + 1) throw new Error(`nonce da inner inválido (esperado ${(uAcc.nonce ?? 0) + 1})`);
        this.#applyMetaEffect(inner, uAcc, height);
        uAcc.nonce += 1;
        break;
      }

      // Vesting: trava `amount` para um beneficiário com cliff + liberação linear.
      case 'VESTING_CREATE': {
        if (height < CHAIN.VESTING_HEIGHT) throw new Error('vesting ainda não ativo');
        const beneficiary = tx.data?.beneficiary;
        if (!isValidAddress(beneficiary)) throw new Error('beneficiário inválido');
        if (amount <= 0n) throw new Error('valor de vesting deve ser positivo');
        const cliff = Number(tx.data?.cliffBlocks ?? 0);
        const duration = Number(tx.data?.durationBlocks);
        if (!Number.isSafeInteger(duration) || duration <= 0 || duration > CHAIN.MAX_VESTING_BLOCKS) throw new Error('duração inválida');
        if (!Number.isSafeInteger(cliff) || cliff < 0 || cliff > duration) throw new Error('cliff inválido');
        if (acc.balance < amount + fee) throw new Error('saldo insuficiente para travar o vesting');
        acc.balance -= amount + fee;
        this.vesting[tx.id] = { beneficiary, total: amount.toString(), claimed: '0', start: height, cliff, duration };
        break;
      }

      case 'VESTING_CLAIM': {
        if (height < CHAIN.VESTING_HEIGHT) throw new Error('vesting ainda não ativo');
        const v = this.vesting[tx.data?.vestingId];
        if (!v) throw new Error('vesting inexistente');
        if (v.beneficiary !== tx.from) throw new Error('só o beneficiário resgata');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        const claimable = this.vestedAmount(v, height) - BigInt(v.claimed);
        if (claimable <= 0n) throw new Error('nada a resgatar ainda (cliff/linear)');
        acc.balance -= fee;
        v.claimed = (BigInt(v.claimed) + claimable).toString();
        this.credit(tx.from, claimable);
        if (BigInt(v.claimed) >= BigInt(v.total)) delete this.vesting[tx.data.vestingId]; // poda ao terminar
        break;
      }

      case 'UNSTAKE': {
        if (amount <= 0n) throw new Error('unstake deve ser positivo');
        if (acc.staked < amount) throw new Error('stake insuficiente');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa'); // fundos só voltam após unbonding
        // Stake precisa continuar lastreando VOTOS (#4) e RECURSO DELEGADO (#6): não pode
        // dessteikar abaixo do maior dos dois (senão votaria/delegaria e dessteikaria).
        const stakeFloor = this.votedTotal(tx.from);
        const dOut = BigInt(acc.delegatedOut ?? 0n);
        if (acc.staked - amount < stakeFloor) {
          throw new Error('unstake deixaria votos sem lastro; refaça VOTE (reduza os votos) primeiro');
        }
        if (acc.staked - amount < dOut) {
          throw new Error('unstake deixaria recurso delegado sem lastro; retire a delegação primeiro');
        }
        acc.staked -= amount;
        // não permitir esvaziar o conjunto de validadores (halt permanente da cadeia)
        if (this.validators().length === 0) {
          acc.staked += amount;
          throw new Error('não é possível remover o último validador ativo da rede');
        }
        acc.balance -= fee;
        // (b) unbonding: os fundos NÃO voltam agora — entram na fila e o blockTick os
        // devolve após UNBONDING_BLOCKS. O stake já saiu (perdeu voto/validação na hora).
        this.unbonding.push({ address: tx.from, amount: amount.toString(), matureAt: height + CHAIN.UNBONDING_BLOCKS });
        break;
      }

      // (b) Slashing por assinatura dupla: prova = dois blocos VÁLIDOS do MESMO produtor,
      // MESMA altura, hashes diferentes → o validador assinou dois forks. Queima uma fração
      // do stake dele e premia o denunciante. Dá lastro econômico à finalidade BFT (#2).
      case 'SLASH_DOUBLE_SIGN': {
        if (height < CHAIN.SLASHING_HEIGHT) throw new Error('slashing ainda não ativo');
        const { blockA, blockB } = tx.data ?? {};
        if (!blockA || !blockB || typeof blockA !== 'object' || typeof blockB !== 'object') throw new Error('evidência ausente');
        // Checks BARATOS primeiro (campos lidos SEM verificar assinatura) — as duas
        // verificações híbridas são caras, então só rodam se o resto fizer sentido:
        // conflito real, ainda não penalizado, e infrator COM stake. Fecha o DoS de
        // spammar SLASH forçando cripto cara de graça (mesma classe do achado M4).
        if (blockA.producer !== blockB.producer) throw new Error('produtores diferentes — não é assinatura dupla');
        if (blockA.height !== blockB.height) throw new Error('alturas diferentes — não é assinatura dupla');
        if (blockA.hash === blockB.hash) throw new Error('mesmo bloco — não há conflito');
        const offender = blockA.producer;
        const key = `${offender}:${blockA.height}`;
        if (this.slashed[key]) throw new Error('essa assinatura dupla já foi penalizada');
        const off = this.accounts[offender];
        // Fundos EM UNBONDING continuam penalizáveis — senão o infrator dava UNSTAKE
        // logo após a ofensa e escapava com o grosso. A penalidade incide sobre stake
        // ATIVO + unbonding pendente do infrator.
        const unbondTotal = this.unbonding.reduce((s, u) => (u.address === offender ? s + BigInt(u.amount) : s), 0n);
        const atRisk = (off?.staked ?? 0n) + unbondTotal;
        if (atRisk <= 0n) throw new Error('infrator sem stake para penalizar');
        // agora sim a verificação CARA (2 assinaturas híbridas)
        const eA = verifyBlockIntegrity(blockA); if (eA) throw new Error(`evidência A inválida: ${eA}`);
        const eB = verifyBlockIntegrity(blockB); if (eB) throw new Error(`evidência B inválida: ${eB}`);
        const penalty = (atRisk * BigInt(CHAIN.SLASH_PERCENT)) / 100n;
        const bounty = (penalty * BigInt(CHAIN.SLASH_REPORTER_PERCENT)) / 100n;
        let remaining = penalty;
        if (off) { const fromStake = off.staked < remaining ? off.staked : remaining; off.staked -= fromStake; remaining -= fromStake; }
        if (remaining > 0n) {
          const kept = [];
          for (const u of this.unbonding) {
            if (u.address !== offender || remaining === 0n) { kept.push(u); continue; }
            const amt = BigInt(u.amount);
            const take = amt < remaining ? amt : remaining;
            remaining -= take;
            if (amt - take > 0n) kept.push({ ...u, amount: (amt - take).toString() });
          }
          this.unbonding = kept;
        }
        // Se o slash deixou delegatedOut sem lastro (staked caiu abaixo do delegado),
        // revoga o excesso de delegação — mantém resourceStake >= 0 e não deixa o
        // delegatário com capacidade de recurso não lastreada por stake real.
        if (off && BigInt(off.delegatedOut ?? 0n) > off.staked) {
          let excess = BigInt(off.delegatedOut) - off.staked;
          const dmap = this.delegations[offender] ?? {};
          for (const to of Object.keys(dmap)) {
            if (excess === 0n) break;
            const amt = BigInt(dmap[to]);
            const take = amt < excess ? amt : excess;
            excess -= take;
            const target = this.getAccount(to);
            target.delegatedIn = BigInt(target.delegatedIn ?? 0n) - take;
            if (amt - take > 0n) dmap[to] = amt - take; else delete dmap[to];
          }
          if (Object.keys(dmap).length === 0) delete this.delegations[offender];
          off.delegatedOut = off.staked;
        }
        this.totalBurned += penalty - bounty; // a maior parte da penalidade some do supply
        this.credit(tx.from, bounty); // prêmio ao denunciante
        this.slashed[key] = true;
        break;
      }

      // #6: delega a CAPACIDADE DE RECURSO de parte do próprio stake a outra conta (sem
      // perder poder de voto). O delegatário ganha resourceStake (energia/bandwidth); o
      // delegador perde. dApps patrocinam taxas dos usuários com isto.
      case 'DELEGATE_RESOURCE': {
        if (height < CHAIN.RESOURCE_HEIGHT) throw new Error('delegação de recurso ainda não ativa');
        const to = tx.data?.to;
        if (!isValidAddress(to)) throw new Error('delegatário inválido');
        if (to === tx.from) throw new Error('não pode delegar para si mesmo');
        const amt = BigInt(tx.data?.amount ?? '0');
        if (amt <= 0n) throw new Error('valor de delegação deve ser positivo');
        const curOut = BigInt(acc.delegatedOut ?? 0n);
        if (curOut + amt > BigInt(acc.staked)) throw new Error('delegação excede o stake disponível');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        acc.delegatedOut = curOut + amt;
        const target = this.getAccount(to);
        target.delegatedIn = BigInt(target.delegatedIn ?? 0n) + amt;
        const d = (this.delegations[tx.from] ??= {});
        d[to] = BigInt(d[to] ?? 0n) + amt;
        break;
      }

      case 'UNDELEGATE_RESOURCE': {
        if (height < CHAIN.RESOURCE_HEIGHT) throw new Error('delegação de recurso ainda não ativa');
        const to = tx.data?.to;
        if (!isValidAddress(to)) throw new Error('delegatário inválido');
        const amt = BigInt(tx.data?.amount ?? '0');
        if (amt <= 0n) throw new Error('valor deve ser positivo');
        const d = this.delegations[tx.from] ?? {};
        const cur = BigInt(d[to] ?? 0n);
        if (cur < amt) throw new Error('delegação insuficiente para retirar');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        acc.delegatedOut = BigInt(acc.delegatedOut ?? 0n) - amt;
        const target = this.getAccount(to);
        target.delegatedIn = BigInt(target.delegatedIn ?? 0n) - amt;
        const left = cur - amt;
        if (left > 0n) d[to] = left;
        else { delete d[to]; if (Object.keys(d).length === 0) delete this.delegations[tx.from]; }
        break;
      }

      // #9: um validador ATIVO propõe alterar um parâmetro governável. O voto do
      // proponente já conta; se o conjunto for pequeno, pode atingir o quórum na hora.
      case 'GOV_PROPOSE': {
        if (height < CHAIN.GOVERNANCE_HEIGHT) throw new Error('governança ainda não ativa');
        if (!this.validators().some((v) => v.address === tx.from)) throw new Error('só validador ativo pode propor');
        const param = tx.data?.param;
        // Comitê de ponte via governança (bootstrap + troca): sem isto, um gênese sem
        // comitê não teria como criar o primeiro (o handoff (d) exige um comitê atual).
        let value;
        if (param === 'BRIDGE_COMMITTEE') {
          value = this.#validateCommitteeValue(tx.data?.value);
        } else if (param === 'TREASURY_SPEND') {
          value = this.#validateTreasurySpend(tx.data?.value);
        } else {
          const spec = CHAIN.GOVERNABLE[param];
          if (!spec) throw new Error(`parâmetro não governável: ${param}`);
          value = this.#coerceGovValue(spec, tx.data?.value);
        }
        const vb = Number(tx.data?.votingBlocks ?? CHAIN.GOV_MAX_VOTING_BLOCKS);
        if (!Number.isSafeInteger(vb) || vb <= 0 || vb > CHAIN.GOV_MAX_VOTING_BLOCKS) throw new Error('votingBlocks inválido');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        const proposal = { id: tx.id, param, value, proposer: tx.from, deadline: height + vb, votes: { [tx.from]: true }, status: 'VOTING', createdAt: tx.timestamp };
        this.proposals[tx.id] = proposal;
        this.#tallyProposal(proposal, height);
        break;
      }

      case 'GOV_VOTE': {
        if (height < CHAIN.GOVERNANCE_HEIGHT) throw new Error('governança ainda não ativa');
        const p = this.proposals[tx.data?.proposalId];
        if (!p || p.status !== 'VOTING') throw new Error('proposta inexistente ou encerrada');
        if (height > p.deadline) { p.status = 'DEFEATED'; throw new Error('proposta expirada'); }
        if (!this.validators().some((v) => v.address === tx.from)) throw new Error('só validador ativo pode votar');
        if (p.votes[tx.from]) throw new Error('validador já votou nesta proposta');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        p.votes[tx.from] = true;
        this.#tallyProposal(p, height);
        break;
      }

      // #5: a conta define sua permissão pela PRIMEIRA vez (por assinatura única do dono).
      // Depois disso ela vira multisig e a guarda no topo bloqueia txs diretas — mudanças
      // futuras de permissão só via op MULTISIG PERMISSION_CHANGE.
      case 'PERMISSION_UPDATE': {
        if (height < CHAIN.PERMISSIONS_HEIGHT) throw new Error('permissões ainda não ativas');
        // (a guarda no topo já garante que tx.from ainda NÃO tem permissão)
        // Conta COM stake não pode virar multisig: as ops multisig só fazem TRANSFER/
        // PERMISSION_CHANGE (não STAKE/UNSTAKE/VOTE), então um validador ficaria com stake
        // e voto PRESOS. Dessteike primeiro. (Multisig é para contas de custódia/tesouraria.)
        if (acc.staked > 0n) throw new Error('conta com stake não pode virar multisig — faça UNSTAKE primeiro');
        const perm = this.#normalizePermission(tx.data?.permission);
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        this.permissions[tx.from] = perm;
        break;
      }

      // Uma CHAVE autorizada propõe uma operação para uma conta multisig. Registra a
      // aprovação do proponente; se já atingir o threshold, executa na hora.
      case 'MULTISIG_PROPOSE': {
        if (height < CHAIN.PERMISSIONS_HEIGHT) throw new Error('permissões ainda não ativas');
        const account = tx.data?.account;
        const op = tx.data?.op;
        if (!isValidAddress(account)) throw new Error('conta multisig inválida');
        const perm = this.permissions[account];
        if (!perm) throw new Error('conta não é multisig');
        const weight = perm.keys[tx.from];
        if (!weight) throw new Error('remetente não é uma chave autorizada da conta');
        if (!op || typeof op !== 'object' || typeof op.type !== 'string') throw new Error('operação inválida');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        const approvals = { [tx.from]: weight };
        if (weight >= perm.threshold) {
          this.#executeMultisigOp(account, op, height); // quórum imediato (1 chave já basta)
        } else {
          this.pendingOps[tx.id] = { account, op, approvals, weight, createdAt: tx.timestamp, deadline: height + CHAIN.MULTISIG_OP_TTL_BLOCKS };
        }
        break;
      }

      // Outra CHAVE aprova uma operação pendente; ao cruzar o threshold, executa.
      case 'MULTISIG_APPROVE': {
        if (height < CHAIN.PERMISSIONS_HEIGHT) throw new Error('permissões ainda não ativas');
        const opId = tx.data?.opId;
        const pending = typeof opId === 'string' ? this.pendingOps[opId] : null;
        if (!pending) throw new Error('operação pendente inexistente');
        const perm = this.permissions[pending.account];
        if (!perm) throw new Error('conta não é mais multisig'); // permissão mudou sob a op
        const weight = perm.keys[tx.from];
        if (!weight) throw new Error('remetente não é uma chave autorizada da conta');
        if (pending.approvals[tx.from]) throw new Error('chave já aprovou esta operação');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        pending.approvals[tx.from] = weight;
        pending.weight += weight;
        if (pending.weight >= perm.threshold) {
          this.#executeMultisigOp(pending.account, pending.op, height);
          delete this.pendingOps[opId];
        }
        break;
      }

      case 'TOKEN_CREATE': {
        const err = validateTokenParams(tx.data);
        if (err) throw new Error(err);
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa de criação');
        const tokenId = eavHash('EAV20-TOKEN:' + tx.id);
        const totalSupply = BigInt(tx.data.totalSupply);
        acc.balance -= fee;
        this.tokens[tokenId] = {
          standard: 'eav20',
          id: tokenId,
          name: tx.data.name.trim(),
          symbol: tx.data.symbol,
          decimals: tx.data.decimals,
          totalSupply,
          creator: tx.from,
          owner: tx.from, // admin: pode mint (se mintable)/pause/blacklist
          mintable: tx.data.mintable === true, // supply pode crescer via TOKEN_MINT
          paused: false,
          blacklist: {},
          frozen: {}, // addr -> { amount, unlockAt } — saldo congelado (não transferível até unlockAt)
          createdAt: tx.timestamp,
          balances: { [tx.from]: totalSupply },
          allowances: {},
        };
        break;
      }

      case 'TOKEN_TRANSFER': {
        const token = this.tokens[tx.data.token];
        if (!token) throw new Error('token EAV20 inexistente');
        this.#tokenGuard(token, tx.from, tx.to); // pausa + blacklist
        if (amount <= 0n) throw new Error('valor do token deve ser positivo');
        const balance = token.balances[tx.from] ?? 0n;
        if (this.#tokenAvailable(token, tx.from, height) < amount) throw new Error('saldo do token insuficiente ou congelado');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        token.balances[tx.from] = balance - amount;
        token.balances[tx.to] = (token.balances[tx.to] ?? 0n) + amount;
        break;
      }

      // Funções administrativas do token (só o owner). mint exige mintable.
      case 'TOKEN_MINT': {
        if (height < CHAIN.TOKEN_ADMIN_HEIGHT) throw new Error('admin de token ainda não ativo');
        const token = this.tokens[tx.data?.token];
        if (!token) throw new Error('token EAV20 inexistente');
        if (token.owner !== tx.from) throw new Error('só o owner do token pode mint');
        if (!token.mintable) throw new Error('token não é mintable (supply fixo)');
        if (!isValidAddress(tx.to)) throw new Error('destino inválido');
        if (amount <= 0n) throw new Error('valor do mint deve ser positivo');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        token.totalSupply = BigInt(token.totalSupply) + amount;
        token.balances[tx.to] = (token.balances[tx.to] ?? 0n) + amount;
        break;
      }

      case 'TOKEN_BURN': {
        if (height < CHAIN.TOKEN_ADMIN_HEIGHT) throw new Error('admin de token ainda não ativo');
        const token = this.tokens[tx.data?.token];
        if (!token) throw new Error('token EAV20 inexistente');
        if (amount <= 0n) throw new Error('valor do burn deve ser positivo');
        const bal = token.balances[tx.from] ?? 0n; // queima do PRÓPRIO saldo
        if (bal < amount) throw new Error('saldo do token insuficiente para queimar');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        token.balances[tx.from] = bal - amount;
        token.totalSupply = BigInt(token.totalSupply) - amount;
        break;
      }

      case 'TOKEN_PAUSE':
      case 'TOKEN_UNPAUSE': {
        if (height < CHAIN.TOKEN_ADMIN_HEIGHT) throw new Error('admin de token ainda não ativo');
        const token = this.tokens[tx.data?.token];
        if (!token) throw new Error('token EAV20 inexistente');
        if (token.owner !== tx.from) throw new Error('só o owner do token pode pausar');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        token.paused = tx.type === 'TOKEN_PAUSE';
        break;
      }

      case 'TOKEN_BLACKLIST': {
        if (height < CHAIN.TOKEN_ADMIN_HEIGHT) throw new Error('admin de token ainda não ativo');
        const token = this.tokens[tx.data?.token];
        if (!token) throw new Error('token EAV20 inexistente');
        if (token.owner !== tx.from) throw new Error('só o owner do token pode bloquear');
        const target = tx.data?.address;
        if (!isValidAddress(target)) throw new Error('endereço inválido');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        token.blacklist ??= {};
        if (tx.data?.blocked === false) delete token.blacklist[target];
        else token.blacklist[target] = true;
        break;
      }

      // O HOLDER congela parte do próprio saldo do token até uma altura (freeze estilo Tron):
      // a parte congelada não é transferível até vencer.
      case 'TOKEN_FREEZE': {
        if (height < CHAIN.TOKEN_ADMIN_HEIGHT) throw new Error('admin de token ainda não ativo');
        const token = this.tokens[tx.data?.token];
        if (!token) throw new Error('token EAV20 inexistente');
        const dur = Number(tx.data?.durationBlocks);
        if (!Number.isSafeInteger(dur) || dur <= 0) throw new Error('duração inválida');
        if (amount <= 0n) throw new Error('valor a congelar deve ser positivo');
        token.frozen ??= {};
        const cur = token.frozen[tx.from];
        if (cur && height < cur.unlockAt) throw new Error('já há um congelamento ativo nesta conta');
        if ((token.balances[tx.from] ?? 0n) < amount) throw new Error('saldo do token insuficiente para congelar');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        token.frozen[tx.from] = { amount: amount.toString(), unlockAt: height + dur };
        break;
      }

      case 'TOKEN_UNFREEZE': {
        if (height < CHAIN.TOKEN_ADMIN_HEIGHT) throw new Error('admin de token ainda não ativo');
        const token = this.tokens[tx.data?.token];
        if (!token) throw new Error('token EAV20 inexistente');
        const cur = token.frozen?.[tx.from];
        if (!cur) throw new Error('nada congelado');
        if (height < cur.unlockAt) throw new Error('congelamento ainda não venceu');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        delete token.frozen[tx.from];
        break;
      }

      // ---- EAV721: padrão de NFT nativo (equivalente ao TRC-721) ----
      case 'NFT_CREATE': {
        if (height < CHAIN.NFT_HEIGHT) throw new Error('NFT ainda não ativo');
        const name = tx.data?.name, symbol = tx.data?.symbol;
        if (typeof name !== 'string' || name.trim().length < 1 || name.length > 64) throw new Error('nome da coleção inválido');
        if (typeof symbol !== 'string' || !/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error('símbolo inválido');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa de criação');
        acc.balance -= fee;
        const cid = eavHash('EAV721-COLLECTION:' + tx.id);
        this.nfts[cid] = { standard: 'eav721', id: cid, name: name.trim(), symbol, owner: tx.from, createdAt: tx.timestamp, nextId: 1, tokens: {}, approvals: {} };
        break;
      }

      case 'NFT_MINT': {
        if (height < CHAIN.NFT_HEIGHT) throw new Error('NFT ainda não ativo');
        const col = this.nfts[tx.data?.collection];
        if (!col) throw new Error('coleção inexistente');
        if (col.owner !== tx.from) throw new Error('só o owner da coleção pode mint');
        if (!isValidAddress(tx.to)) throw new Error('destino inválido');
        const uri = tx.data?.uri ?? '';
        if (typeof uri !== 'string' || Buffer.byteLength(uri) > CHAIN.MAX_NFT_URI_BYTES) throw new Error('uri inválida');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        const tokenId = String(col.nextId);
        col.nextId += 1;
        col.tokens[tokenId] = { owner: tx.to, uri };
        break;
      }

      case 'NFT_TRANSFER': {
        if (height < CHAIN.NFT_HEIGHT) throw new Error('NFT ainda não ativo');
        const col = this.nfts[tx.data?.collection];
        if (!col) throw new Error('coleção inexistente');
        const tokenId = String(tx.data?.tokenId);
        const nft = col.tokens[tokenId];
        if (!nft) throw new Error('NFT inexistente');
        if (nft.owner !== tx.from && col.approvals[tokenId] !== tx.from) throw new Error('não é dono nem aprovado');
        if (!isValidAddress(tx.to)) throw new Error('destino inválido');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        nft.owner = tx.to;
        delete col.approvals[tokenId]; // a aprovação some na transferência
        break;
      }

      case 'NFT_APPROVE': {
        if (height < CHAIN.NFT_HEIGHT) throw new Error('NFT ainda não ativo');
        const col = this.nfts[tx.data?.collection];
        if (!col) throw new Error('coleção inexistente');
        const tokenId = String(tx.data?.tokenId);
        const nft = col.tokens[tokenId];
        if (!nft) throw new Error('NFT inexistente');
        if (nft.owner !== tx.from) throw new Error('só o dono aprova');
        if (!isValidAddress(tx.to)) throw new Error('aprovado inválido');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        col.approvals[tokenId] = tx.to;
        break;
      }

      case 'NFT_BURN': {
        if (height < CHAIN.NFT_HEIGHT) throw new Error('NFT ainda não ativo');
        const col = this.nfts[tx.data?.collection];
        if (!col) throw new Error('coleção inexistente');
        const tokenId = String(tx.data?.tokenId);
        const nft = col.tokens[tokenId];
        if (!nft) throw new Error('NFT inexistente');
        if (nft.owner !== tx.from) throw new Error('só o dono queima');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        delete col.tokens[tokenId];
        delete col.approvals[tokenId];
        break;
      }

      // ---- EAV-NS: serviço de nomes (nome legível -> endereço) ----
      case 'NAME_REGISTER': {
        if (height < CHAIN.NAME_HEIGHT) throw new Error('serviço de nomes ainda não ativo');
        const name = String(tx.data?.name ?? '').toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(name)) throw new Error('nome inválido (3-32, [a-z0-9-], sem hífen nas pontas)');
        if (this.names[name]) throw new Error('nome já registrado');
        const target = tx.data?.target ?? tx.from;
        if (!isValidAddress(target)) throw new Error('endereço-alvo inválido');
        const cost = CHAIN.NAME_REGISTER_COST;
        if (acc.balance < fee + cost) throw new Error('saldo insuficiente para registrar');
        acc.balance -= fee + cost;
        this.totalBurned += cost; // custo de registro é queimado (anti-squatting)
        this.names[name] = { owner: tx.from, target, registeredAt: tx.timestamp };
        break;
      }

      case 'NAME_UPDATE': {
        if (height < CHAIN.NAME_HEIGHT) throw new Error('serviço de nomes ainda não ativo');
        const name = String(tx.data?.name ?? '').toLowerCase();
        const rec = this.names[name];
        if (!rec) throw new Error('nome inexistente');
        if (rec.owner !== tx.from) throw new Error('só o dono do nome atualiza');
        const target = tx.data?.target;
        if (!isValidAddress(target)) throw new Error('endereço-alvo inválido');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        rec.target = target;
        break;
      }

      case 'NAME_TRANSFER': {
        if (height < CHAIN.NAME_HEIGHT) throw new Error('serviço de nomes ainda não ativo');
        const name = String(tx.data?.name ?? '').toLowerCase();
        const rec = this.names[name];
        if (!rec) throw new Error('nome inexistente');
        if (rec.owner !== tx.from) throw new Error('só o dono do nome transfere');
        if (!isValidAddress(tx.to)) throw new Error('novo dono inválido');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        rec.owner = tx.to;
        break;
      }

      case 'NAME_RELEASE': {
        if (height < CHAIN.NAME_HEIGHT) throw new Error('serviço de nomes ainda não ativo');
        const name = String(tx.data?.name ?? '').toLowerCase();
        const rec = this.names[name];
        if (!rec) throw new Error('nome inexistente');
        if (rec.owner !== tx.from) throw new Error('só o dono do nome libera');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        delete this.names[name];
        break;
      }

      case 'TOKEN_APPROVE': {
        const token = this.tokens[tx.data.token];
        if (!token) throw new Error('token EAV20 inexistente');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        (token.allowances[tx.from] ??= {})[tx.to] = amount;
        break;
      }

      case 'TOKEN_TRANSFER_FROM': {
        const token = this.tokens[tx.data.token];
        if (!token) throw new Error('token EAV20 inexistente');
        const owner = tx.data.owner;
        if (!isValidAddress(owner)) throw new Error('endereço do dono inválido');
        this.#tokenGuard(token, owner, tx.to, tx.from); // pausa + blacklist
        if (amount <= 0n) throw new Error('valor do token deve ser positivo');
        const allowance = token.allowances[owner]?.[tx.from] ?? 0n;
        if (allowance < amount) throw new Error('allowance insuficiente');
        const ownerBalance = token.balances[owner] ?? 0n;
        if (this.#tokenAvailable(token, owner, height) < amount) throw new Error('saldo do token insuficiente ou congelado');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        token.allowances[owner][tx.from] = allowance - amount;
        token.balances[owner] = ownerBalance - amount;
        token.balances[tx.to] = (token.balances[tx.to] ?? 0n) + amount;
        break;
      }

      case 'AI_TASK': {
        const { prompt, model, oracle: assignedOracle } = tx.data;
        if (typeof prompt !== 'string' || prompt.length === 0) throw new Error('prompt obrigatório');
        if (Buffer.byteLength(prompt) > CHAIN.MAX_AI_PROMPT_BYTES) throw new Error('prompt excede o limite');
        if (amount <= 0n) throw new Error('recompensa da tarefa deve ser positiva');
        // Oráculo designado obrigatório: o solicitante escolhe em quem confia; só
        // esse oráculo pode resgatar a recompensa. Impede que qualquer oráculo
        // registrado saque o escrow com um output lixo.
        if (!isValidAddress(assignedOracle)) throw new Error('AI_TASK exige um oráculo designado (data.oracle)');
        if (acc.balance < amount + fee) throw new Error('saldo insuficiente para escrow da recompensa');
        acc.balance -= amount + fee;
        this.aiTasks[tx.id] = {
          id: tx.id,
          requester: tx.from,
          assignedOracle,
          model: typeof model === 'string' ? model : null,
          prompt,
          params: tx.data.params ?? null,
          reward: amount,
          status: 'PENDING',
          createdAt: blockTs,
          // H-2: expiração ancorada no timestamp REAL do bloco (validado por drift),
          // não no tx.timestamp que o remetente controla (permitiria refund prematuro).
          expiresAt: blockTs + CHAIN.AI_TASK_TIMEOUT_MS,
          oracle: null,
          resultHash: null,
          output: null,
          completedAt: null,
        };
        break;
      }

      case 'ORACLE_REGISTER': {
        const isNew = !this.oracles[tx.from];
        if (isNew && amount < CHAIN.MIN_ORACLE_STAKE) {
          throw new Error(`stake mínimo de oráculo é ${CHAIN.MIN_ORACLE_STAKE} e7`);
        }
        if (acc.balance < amount + fee) throw new Error('saldo insuficiente');
        acc.balance -= amount + fee;
        const oracle = (this.oracles[tx.from] ??= {
          address: tx.from,
          stake: 0n,
          tasksCompleted: 0,
          bridgeTransfers: 0,
          registeredAt: tx.timestamp,
          endpoint: null,
        });
        oracle.stake += amount;
        if (typeof tx.data.endpoint === 'string') oracle.endpoint = tx.data.endpoint;
        break;
      }

      case 'AI_RESULT': {
        const oracle = this.oracles[tx.from];
        if (!oracle) throw new Error('remetente não é um oráculo de IA registrado');
        const task = this.aiTasks[tx.data.taskId];
        if (!task) throw new Error('tarefa de IA inexistente');
        if (task.status !== 'PENDING') throw new Error('tarefa de IA já concluída');
        // Só o oráculo designado pela tarefa pode entregar o resultado.
        if (task.assignedOracle !== tx.from) throw new Error('remetente não é o oráculo designado para esta tarefa');
        const output = tx.data.output;
        if (typeof output !== 'string' || output.length === 0) throw new Error('output obrigatório');
        if (Buffer.byteLength(output) > CHAIN.MAX_AI_OUTPUT_BYTES) throw new Error('output excede o limite');
        task.status = 'DONE';
        task.oracle = tx.from;
        task.output = output;
        task.resultHash = eavHash(output);
        task.completedAt = tx.timestamp;
        task.prompt = null; task.params = null; // poda a ENTRADA (fica no tx AI_TASK) — limita o crescimento de estado
        oracle.tasksCompleted += 1;
        acc.balance += task.reward;
        break;
      }

      // Reembolso do escrow ao solicitante se a tarefa não foi atendida até o
      // prazo (evita fundos presos caso o oráculo designado suma).
      case 'AI_REFUND': {
        const task = this.aiTasks[tx.data.taskId];
        if (!task) throw new Error('tarefa de IA inexistente');
        if (task.requester !== tx.from) throw new Error('apenas o solicitante pode reembolsar');
        if (task.status !== 'PENDING') throw new Error('tarefa de IA não está pendente');
        if (blockTs < task.expiresAt) throw new Error('a tarefa ainda não expirou'); // H-2: usa timestamp do bloco
        task.status = 'REFUNDED';
        task.completedAt = tx.timestamp;
        task.prompt = null; task.params = null; // poda a ENTRADA (limita o crescimento de estado)
        acc.balance += task.reward;
        break;
      }

      // Ponte cross-chain: trava EAV7 (ou token EAV20) para liberação em outra
      // blockchain. O relayer observa este evento e efetua o pagamento externo.
      case 'BRIDGE_OUT': {
        const { targetChain, targetAddress, token } = tx.data;
        if (typeof targetChain !== 'string' || !/^[A-Z0-9_-]{2,32}$/i.test(targetChain)) {
          throw new Error('targetChain inválida');
        }
        if (typeof targetAddress !== 'string' || targetAddress.length < 4 || targetAddress.length > 128) {
          throw new Error('targetAddress inválido');
        }
        if (amount <= 0n) throw new Error('valor da ponte deve ser positivo');
        if (token != null) {
          const t = this.tokens[token];
          if (!t) throw new Error('token EAV20 inexistente');
          const balance = t.balances[tx.from] ?? 0n;
          if (balance < amount) throw new Error('saldo do token insuficiente');
          if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
          acc.balance -= fee;
          t.balances[tx.from] = balance - amount;
          this.bridge.lockedTokens[token] = (this.bridge.lockedTokens[token] ?? 0n) + amount;
        } else {
          if (acc.balance < amount + fee) throw new Error('saldo insuficiente');
          acc.balance -= amount + fee;
          this.bridge.lockedNative += amount;
        }
        this.bridge.transfers[tx.id] = {
          id: tx.id,
          direction: 'OUT',
          from: tx.from,
          targetChain: targetChain.toUpperCase(),
          targetAddress,
          token: token ?? null,
          amount,
          status: 'LOCKED',
          createdAt: tx.timestamp,
        };
        break;
      }

      // Liberação vinda de outra blockchain. Exige quórum de M-de-N relayers
      // AUTORIZADOS (allowlist da gênese) atestando o MESMO depósito. Cada
      // depósito de origem só é liberado uma vez, e nunca além do travado.
      // (d) Rotação do comitê da cadeia de origem: o comitê ATUAL assina o handoff para
      // um NOVO conjunto (epoch+1). Sem isto, um comitê semeado na gênese ficaria eterno
      // e obsoleto quando os validadores da origem mudassem. Verificado on-chain.
      case 'BRIDGE_COMMITTEE_UPDATE': {
        if (height < CHAIN.BRIDGE_PROOF_HEIGHT) throw new Error('rotação de comitê ainda não ativa');
        // Gate de relayer (como BRIDGE_IN/SETTLE): sem isto, qualquer conta financiada
        // dispararia até 200 `recover` secp256k1 por ~0 de energia (DoS de cripto).
        if (!this.bridgeRelayers[tx.from]) throw new Error('remetente não é um relayer de ponte autorizado');
        const chainKey = String(tx.data?.sourceChain ?? '').toUpperCase();
        const current = this.bridgeSourceCommittees[chainKey];
        if (!current || !current.quorum) throw new Error('comitê de origem inexistente');
        const nc = tx.data?.newCommittee;
        if (!nc || typeof nc !== 'object') throw new Error('novo comitê inválido');
        const members = (nc.members ?? []).map((m) => String(m).toLowerCase());
        const quorum = Number(nc.quorum);
        if (members.length === 0 || members.length > 200) throw new Error('nº de membros inválido');
        if (new Set(members).size !== members.length) throw new Error('membros duplicados');
        if (!Number.isSafeInteger(quorum) || quorum <= 0 || quorum > members.length) throw new Error('quorum inválido');
        const newEpoch = (current.epoch ?? 0) + 1;
        const digest = committeeUpdateDigest({ sourceChain: chainKey, epoch: newEpoch, members, quorum });
        const valid = verifyCommitteeProof(digest, tx.data?.sigs, current);
        if (valid < current.quorum) throw new Error(`handoff sem quórum do comitê atual (${valid}/${current.quorum})`);
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        this.bridgeSourceCommittees[chainKey] = { members, quorum, epoch: newEpoch };
        break;
      }

      case 'BRIDGE_IN': {
        if (!this.bridgeRelayers[tx.from]) throw new Error('remetente não é um relayer de ponte autorizado');
        const { sourceChain, sourceTxHash, token } = tx.data;
        if (typeof sourceChain !== 'string' || !/^[A-Z0-9_-]{2,32}$/i.test(sourceChain)) {
          throw new Error('sourceChain inválida');
        }
        if (typeof sourceTxHash !== 'string' || sourceTxHash.length < 4 || sourceTxHash.length > 128) {
          throw new Error('sourceTxHash inválida');
        }
        if (amount <= 0n) throw new Error('valor da ponte deve ser positivo');
        // M-2: chave de REPLAY (uma tx de origem processada UMA vez, independente do
        // que se alegue) separada da chave de ATESTAÇÃO (agrupada por to/amount/token
        // exatos). Assim um relayer malicioso que atesta valores errados cria um grupo
        // próprio que nunca atinge quórum, sem bloquear o quórum honesto do valor certo.
        const replayKey = `${sourceChain.toUpperCase()}:${sourceTxHash}`;
        const attKey = `${replayKey}:${tx.to}:${amount.toString()}:${token ?? 'NATIVE'}`;
        if (this.bridge.processedInbound[replayKey]) throw new Error('depósito de origem já processado (replay)');

        // --- validações antes de QUALQUER mutação (o clone do estado é reusado) ---
        const existing = this.bridge.attestations[attKey];
        if (existing && existing.relayers.includes(tx.from)) throw new Error('relayer já atestou este depósito');
        const attCount = (existing ? existing.relayers.length : 0) + 1;
        // Quórum efetivo: a partir do fork coordenado exige a MAIORIA dos relayers da
        // gênese (federação M-de-N), não mais um único (achado C1). Antes do fork mantém
        // o quórum antigo para o replay do histórico bater. `height` e a contagem de
        // relayers são estado de consenso → determinístico entre nós.
        const relayerCount = Object.keys(this.bridgeRelayers).length;
        const quorum =
          height >= CHAIN.BRIDGE_QUORUM_HEIGHT
            ? Math.max(CHAIN.BRIDGE_MIN_ATTESTATIONS, Math.floor(relayerCount / 2) + 1)
            : CHAIN.BRIDGE_MIN_ATTESTATIONS;
        // #3 (ponte trustless): acima do fork, a AUTORIDADE é a prova do comitê da
        // cadeia de origem. O relayer autorizado (anti-spam) apresenta assinaturas do
        // comitê sobre (to, amount, token, sourceTxHash); >= quorum do comitê libera na
        // hora — forjar exige as chaves do comitê, não a de um relayer. Sem prova
        // válida, NÃO libera (falha fechada).
        let proofRelease = false;
        if (height >= CHAIN.BRIDGE_PROOF_HEIGHT) {
          const committee = this.bridgeSourceCommittees[sourceChain.toUpperCase()];
          if (!committee || !committee.quorum) throw new Error(`sem comitê de origem registrado para ${sourceChain}`);
          const digest = bridgeEventDigest({ sourceChain, sourceTxHash, to: tx.to, amount, token });
          const validSigs = verifyCommitteeProof(digest, tx.data?.proof?.sigs, committee);
          if (validSigs < committee.quorum) {
            throw new Error(`prova do comitê insuficiente (${validSigs}/${committee.quorum})`);
          }
          proofRelease = true;
        }
        const willRelease = proofRelease || attCount >= quorum;
        if (willRelease) {
          if (token != null) {
            const t = this.tokens[token];
            if (!t) throw new Error('token EAV20 inexistente');
            if ((this.bridge.lockedTokens[token] ?? 0n) < amount) throw new Error('ponte não possui tokens travados suficientes');
          } else if (this.bridge.lockedNative < amount) {
            throw new Error('ponte não possui EAV7 travado suficiente');
          }
        }

        // --- mutação (todas as validações passaram) ---
        const att = (this.bridge.attestations[attKey] ??= { to: tx.to, amount: amount.toString(), token: token ?? null, relayers: [], createdAt: tx.timestamp });
        att.relayers.push(tx.from);

        if (!willRelease) {
          this.bridge.transfers[tx.id] = {
            id: tx.id, direction: 'IN', relayer: tx.from, to: tx.to,
            sourceChain: sourceChain.toUpperCase(), sourceTxHash, token: token ?? null,
            amount, status: 'ATTESTED', attestations: att.relayers.length,
            quorum, createdAt: tx.timestamp,
          };
          break;
        }

        if (token != null) {
          this.bridge.lockedTokens[token] -= amount;
          this.tokens[token].balances[tx.to] = (this.tokens[token].balances[tx.to] ?? 0n) + amount;
        } else {
          this.bridge.lockedNative -= amount;
          this.credit(tx.to, amount);
        }
        this.bridge.processedInbound[replayKey] = tx.id;
        delete this.bridge.attestations[attKey];
        this.bridge.transfers[tx.id] = {
          id: tx.id, direction: 'IN', relayer: tx.from, to: tx.to,
          sourceChain: sourceChain.toUpperCase(), sourceTxHash, token: token ?? null,
          amount, status: 'RELEASED', attestations: att.relayers.length, createdAt: tx.timestamp,
        };
        break;
      }

      // Confirmação idempotente de que um BRIDGE_OUT já foi pago na cadeia
      // externa. Marca a transferência como PAID para que o relayer não a pague
      // de novo após um reinício (o Set em memória não bastava).
      case 'BRIDGE_SETTLE': {
        if (!this.bridgeRelayers[tx.from]) throw new Error('remetente não é um relayer de ponte autorizado');
        const transfer = this.bridge.transfers[tx.data.transferId];
        if (!transfer || transfer.direction !== 'OUT') throw new Error('transferência OUT inexistente');
        if (transfer.status === 'PAID') throw new Error('transferência já liquidada');
        if (transfer.status !== 'LOCKED') throw new Error('transferência em estado inválido');
        transfer.status = 'PAID';
        transfer.settledBy = tx.from;
        transfer.externalTxHash = typeof tx.data.externalTxHash === 'string' ? tx.data.externalTxHash : null;
        transfer.settledAt = tx.timestamp;
        break;
      }

      // Contratos EAVM (deploy e chamada). A VM já rodou em #runEavmTx, mutando (ou
      // revertendo) o MUNDO DE CONTRATOS (this.contracts). Aqui só o saldo NATIVO:
      // debita valor+taxa; se a VM reverteu, o valor volta (o mundo já foi desfeito).
      case 'EAVM_DEPLOY':
      case 'EAVM_CALL': {
        // amount é 0 (non-payable nesta fase). Só a taxa (queimada). Se o saldo não
        // cobrir, reverte atomicamente o mundo de contratos antes de lançar.
        if (acc.balance < fee) { vm.world.revert(0); throw new Error('saldo insuficiente'); }
        acc.balance -= fee;
        // #33: emite os eventos (LOGs) da execução para o índice NODE-LOCAL (não-consenso).
        if (logSink && vm.logs?.length) for (const lg of vm.logs) logSink({ txId: tx.id, address: lg.address, topics: lg.topics, data: lg.data });
        break;
      }

      default:
        throw new Error(`tipo de transação não suportado: ${tx.type}`);
    }

    // Todas as validações passaram: commita a energia usada e QUEIMA a taxa
    // (não vai para o produtor — some do supply). Retorna 0 de taxa ao bloco.
    this.#commitEnergy(acc, height, energy);
    if (bw) this.#commitBandwidth(acc, height, bw); // #6
    this.totalBurned += fee;
    acc.nonce += 1;
    return 0n;
  }
}
