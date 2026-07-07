import { CHAIN } from '../config.js';
import { eavHash } from '../crypto/hash.js';
import { isValidAddress, deriveAddressFrom } from '../crypto/keys.js';
import { validateTokenParams } from '../token/eav20.js';
import { runEavm, EavmError } from '../eavm/vm.js';
import { createHost } from '../eavm/host.js';
import { keccak256 } from '../eavm/keccak.js';

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
    // Total de EAV7 (e7) queimado pelo modelo de energia (deflacionário) e total
    // MINTADO em recompensas de bloco. Supply real = GENESIS + minted − burned.
    this.totalBurned = 0n;
    this.totalMinted = 0n;
    // Mundo de contratos EAVM (espaço de endereço 0x): addr -> { code, storage, balance }.
    this.contracts = {};
  }

  getAccount(address) {
    // energyUsed/energyBlock: contabilidade do recurso Energia (ver #peekEnergy).
    return (this.accounts[address] ??= { balance: 0n, nonce: 0, staked: 0n, energyUsed: 0, energyBlock: 0 });
  }

  // Energia máxima de uma conta: cota grátis + bônus por stake (por EAV7 travado).
  maxEnergy(acc) {
    return CHAIN.ENERGY.FREE + Number(BigInt(acc?.staked ?? 0n) / CHAIN.UNIT) * CHAIN.ENERGY.PER_STAKED_EAV7;
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
  validators() {
    return Object.entries(this.accounts)
      .filter(([, acc]) => acc.staked >= CHAIN.MIN_VALIDATOR_STAKE && !acc.eavmManaged)
      .sort(([addrA, a], [addrB, b]) => {
        if (a.staked !== b.staked) return a.staked > b.staked ? -1 : 1;
        return addrA < addrB ? -1 : 1;
      })
      .slice(0, CHAIN.MAX_VALIDATORS)
      .map(([address, acc]) => ({ address, staked: acc.staked }));
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
    copy.totalBurned = this.totalBurned;
    copy.totalMinted = this.totalMinted;
    copy.contracts = structuredClone(this.contracts);
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
  applyTransaction(tx, height = 0, blockTs = 0) {
    // L3: valida o nonce ANTES de materializar a conta (não cria conta-fantasma
    // no clone reusado quando a tx lança). L2: reafirma o teto do fee no estado.
    const curNonce = this.accounts[tx.from]?.nonce ?? 0;
    if (tx.nonce !== curNonce + 1) {
      throw new Error(`nonce inválido (esperado ${curNonce + 1}, recebido ${tx.nonce})`);
    }
    if (BigInt(tx.fee) > CHAIN.MAX_FEE_LIMIT) throw new Error('limite de taxa (fee) acima do máximo permitido');
    const acc = this.getAccount(tx.from);
    const amount = BigInt(tx.amount);
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
    const fee = BigInt(energy.shortfall) * CHAIN.ENERGY.BURN_PER_ENERGY;
    if (fee > BigInt(tx.fee)) {
      if (vm) vm.world.revert(0); // atomicidade: desfaz o que a VM mutou antes de lançar (C-1/A-4)
      throw new Error('energia insuficiente e limite de taxa (fee) excedido — faça stake ou aumente o limite');
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

      case 'UNSTAKE': {
        if (amount <= 0n) throw new Error('unstake deve ser positivo');
        if (acc.staked < amount) throw new Error('stake insuficiente');
        if (acc.balance + amount < fee) throw new Error('saldo insuficiente para a taxa');
        acc.staked -= amount;
        // não permitir esvaziar o conjunto de validadores (halt permanente da cadeia)
        if (this.validators().length === 0) {
          acc.staked += amount;
          throw new Error('não é possível remover o último validador ativo da rede');
        }
        acc.balance += amount - fee;
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
          createdAt: tx.timestamp,
          balances: { [tx.from]: totalSupply },
          allowances: {},
        };
        break;
      }

      case 'TOKEN_TRANSFER': {
        const token = this.tokens[tx.data.token];
        if (!token) throw new Error('token EAV20 inexistente');
        if (amount <= 0n) throw new Error('valor do token deve ser positivo');
        const balance = token.balances[tx.from] ?? 0n;
        if (balance < amount) throw new Error('saldo do token insuficiente');
        if (acc.balance < fee) throw new Error('saldo insuficiente para a taxa');
        acc.balance -= fee;
        token.balances[tx.from] = balance - amount;
        token.balances[tx.to] = (token.balances[tx.to] ?? 0n) + amount;
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
        if (amount <= 0n) throw new Error('valor do token deve ser positivo');
        const allowance = token.allowances[owner]?.[tx.from] ?? 0n;
        if (allowance < amount) throw new Error('allowance insuficiente');
        const ownerBalance = token.balances[owner] ?? 0n;
        if (ownerBalance < amount) throw new Error('saldo do token insuficiente');
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
        const willRelease = attCount >= CHAIN.BRIDGE_MIN_ATTESTATIONS;
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
            quorum: CHAIN.BRIDGE_MIN_ATTESTATIONS, createdAt: tx.timestamp,
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
        break;
      }

      default:
        throw new Error(`tipo de transação não suportado: ${tx.type}`);
    }

    // Todas as validações passaram: commita a energia usada e QUEIMA a taxa
    // (não vai para o produtor — some do supply). Retorna 0 de taxa ao bloco.
    this.#commitEnergy(acc, height, energy);
    this.totalBurned += fee;
    acc.nonce += 1;
    return 0n;
  }
}
