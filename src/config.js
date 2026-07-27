// Parâmetros do protocolo eav20 — rede EAV7.
//
// Tokenomics no padrão da Tron:
//   • supply gênese de 100 bilhões (como o TRX), 6 decimais
//   • recompensa de bloco de 16 EAV7 para o minerador/produtor (como os 16 TRX)
//   • até 27 validadores ativos (como os 27 Super Representatives)
//   • blocos de 1s — 3x mais rápido que os 3s da Tron
//   • stake zera as taxas (equivalente ao modelo de bandwidth por freeze da Tron)
//
// Valores monetários são BigInt na menor unidade "e7" (1 EAV7 = 1_000_000 e7),
// serializados como strings decimais dentro de transações e blocos.
const UNIT = 1_000_000n;

export const CHAIN = {
  // NAME/PROTOCOL/EAVM_CHAIN_ID são sobrescrevíveis por env para rodar redes
  // separadas (ex.: testnet) a partir do MESMO código, sem tocar a mainnet.
  // Mainnet não define essas envs → mantém os valores padrão.
  NAME: process.env.EAV7_NETWORK_NAME || 'EAV7',
  PROTOCOL: process.env.EAV7_PROTOCOL || 'eav20',
  PROTOCOL_VERSION: 1,
  // Prefixo de ENDEREÇO. É a marca da rede que o usuário lê e digita — fica.
  // Hashes NÃO usam prefixo: txid, hash de bloco e raízes são 64 hex minúsculos,
  // o formato que todo explorer e ferramenta do mercado já espera (idêntico ao
  // txid da TRON). Marcar hash com "E7" custava 8 bits do digest e não ajudava
  // ninguém: ninguém digita um txid nem precisa saber de que cadeia ele é.
  ADDRESS_PREFIX: 'E7',
  HASH_PREFIX: 'E7', // mantido só para compat de leitura; não é usado por eavHash
  SYMBOL: 'EAV7',
  DECIMALS: 6,
  UNIT,

  HASH_LENGTH: 64, // mesmo comprimento do txid da Tron, sempre iniciando com E7
  ADDRESS_LENGTH: 34, // mesmo comprimento do endereço da Tron, sempre iniciando com E7

  BLOCK_TIME_MS: 1_000,
  MAX_TXS_PER_BLOCK: 500,
  // Tolerância de relógio reduzida a ~1 slot: junto com a regra de "um bloco por
  // slot" (blockchain.addBlock) impede grinding de timestamp / farm de recompensa.
  MAX_CLOCK_DRIFT_MS: 2_000,
  // Tolerância para aceitar um bloco cujo slot esteja levemente à frente do
  // relógio do receptor (skew de relógio + latência de propagação entre nós).
  // Pequena o bastante para não permitir roubo de um slot inteiro (< 1 slot).
  SLOT_FUTURE_TOLERANCE_MS: 400,
  // A PARTIR desta altura, um bloco só é válido se produzido pelo produtor EXATO
  // do slot (round-robin) — impede um validador bizantino de produzir fora de turno
  // e forjar uma cadeia mais longa (achado C1 da auditoria). Blocos ANTES dela são
  // grandfathered (só exige ser validador ativo), para o replay do histórico —
  // produzido sob regras anteriores — continuar válido sem hard-fork destrutivo.
  STRICT_PRODUCER_HEIGHT: 49_500,
  // Um validador não produz se um peer estiver mais de N blocos à frente (ele
  // está atrasado e produziria um fork). O nó da ponta sempre produz.
  PRODUCE_LAG_TOLERANCE: 5,
  // Janela (em blocos) para procurar o ancestral comum ao reorganizar um topo
  // divergente. Generosa o bastante para cobrir forks longos acumulados em
  // incidentes de rede, mantendo-se abaixo de MAX_SYNC_BLOCKS.
  REORG_WINDOW: 5_000,
  // A cada N blocos o nó grava um snapshot do estado + índices (snapshot.json).
  // O boot parte do snapshot e replaya só o rabo — nunca a cadeia inteira.
  SNAPSHOT_INTERVAL_BLOCKS: 5_000,

  MAX_VALIDATORS: 27,
  MIN_VALIDATOR_STAKE: 1_000n * UNIT,
  // Unbonding (b): UNSTAKE reduz o stake NA HORA (perde voto/validação já), mas os fundos
  // só voltam ao saldo após UNBONDING_BLOCKS — impede sair-e-dumpar instantâneo e ataque
  // long-range. No gênese novo, ativo do bloco 0.
  UNBONDING_BLOCKS: 604_800, // ~7 dias a 1 bloco/s
  // Teto de saques em andamento por conta (a TRON usa 32). Sem ele, spam de UNSTAKE de
  // valor mínimo infla `unbonding`, que o blockTick varre INTEIRO a cada bloco — DoS de
  // estado controlado pelo atacante, que ainda engorda snapshot e stateRoot.
  MAX_UNBONDING_ENTRIES: 32,
  // Slashing (b): a partir de SLASHING_HEIGHT, provar assinatura dupla de um validador
  // (dois blocos válidos, mesmo produtor+altura, hashes diferentes) queima uma fração do
  // stake dele; o denunciante leva um prêmio dessa fração. Dá lastro econômico à finalidade.
  SLASHING_HEIGHT: 1_800_000,
  SLASH_PERCENT: 10, // % do stake do infrator queimado por assinatura dupla
  SLASH_REPORTER_PERCENT: 10, // % DA PENALIDADE paga ao denunciante (o resto queima)
  // Votação de validadores (#4, modelo dos 27 SRs da Tron): a partir de VOTING_HEIGHT,
  // detentores alocam seu poder de voto (= stake) a candidatos via tx VOTE, e o conjunto
  // ativo passa a ser o top-MAX_VALIDATORS por PESO = self-stake + votos recebidos. Sem
  // votos, degrada para top-por-stake (retrocompatível). No gênese novo = 0 (ativo já).
  VOTING_HEIGHT: 1_400_000,
  MAX_VOTE_TARGETS: 30, // nº máx. de candidatos numa única tx VOTE (anti-DoS de data)
  // Recompensa de eleitores: o produtor fica com a COMISSÃO (%), o resto da recompensa de
  // bloco é partilhado entre quem votou nele, proporcional aos votos (acumulador "reward
  // por voto", O(1) por bloco; o eleitor resgata com CLAIM_VOTER_REWARD). SET_COMMISSION
  // ajusta a comissão do validador. Sem votos, o produtor leva tudo (retrocompatível).
  DEFAULT_COMMISSION_PCT: 20,
  // Atraso para a comissão passar a valer. SEM ele, o validador sobe para 100% no bloco
  // anterior ao seu slot, captura a recompensa inteira dos eleitores e baixa de volta —
  // ataque verificado. A TRON evita adiando a mudança para o próximo período de
  // manutenção (<= 6h); aqui é uma fila explícita com o mesmo efeito.
  COMMISSION_DELAY_BLOCKS: 21_600, // ~6 h a 1 bloco/s
  REWARD_SCALE: 1_000_000_000_000_000_000n, // escala p/ o acumulador não truncar (dust vai ao produtor)
  // Tesouraria: % da recompensa de bloco desviado para um cofre governável (governança
  // gasta via proposta TREASURY_SPEND). 0 = desligado (retrocompatível); ajustável por governança.
  TREASURY_PCT: 0,
  // Permissões de conta / multi-sig (#5, modelo owner/active da Tron). A partir de
  // PERMISSIONS_HEIGHT uma conta pode virar multisig: define { threshold, keys{addr:peso} }
  // e passa a mover fundos/alterar permissão SÓ via propose/approve (M-de-N). No gênese
  // novo = 0 (ativo já).
  PERMISSIONS_HEIGHT: 1_500_000,
  MAX_PERMISSION_KEYS: 20,
  // Permissões v2 (docs/permissoes-v2.md). Acima desta altura:
  //   (a) ops multisig ganham VOTE / SET_COMMISSION / CLAIM_VOTER_REWARD — sem elas o voto
  //       de uma conta multisig ficaria preso, que é o motivo da trava `staked == 0`;
  //   (b) essa trava cai, liberando validador a ter permissões (pré-requisito do `witness`).
  PERMISSIONS_V2_HEIGHT: 1_900_000,
  // Timelock das mudanças ESTRUTURAIS de permissão. O dono escolhe o seu, respeitando o
  // piso — sem piso, configurar 0 anularia a janela de reação que é a defesa central.
  PERM_DELAY_MIN_BLOCKS: 3_600, // ~1 h
  PERM_DELAY_MAX_BLOCKS: 2_592_000, // ~30 dias
  PERM_DELAY_DEFAULT_BLOCKS: 43_200, // ~12 h
  // Permissões `active` por conta (a TRON permite 8). Cada uma com chaves, limiar e
  // escopo próprios — é o que permite uma chave por finalidade em vez de uma para tudo.
  MAX_ACTIVE_PERMISSIONS: 8,
  MAX_PERMISSION_NAME: 32, // bytes, mesmo limite da TRON
  // Governança on-chain (#9): a partir de GOVERNANCE_HEIGHT, validadores propõem
  // (GOV_PROPOSE) mudar um parâmetro GOVERNÁVEL e votam (GOV_VOTE); ao atingir 2/3+1 dos
  // validadores ativos, o valor é sobrescrito on-chain (state.params) — substitui o ajuste
  // manual por SSH. No gênese novo = 0 (ativo já).
  GOVERNANCE_HEIGHT: 1_700_000,
  GOV_MAX_VOTING_BLOCKS: 200_000, // janela máx. de votação (~2,3 dias a 1 bloco/s)
  // Timelock: proposta aprovada só APLICA após esta janela (dá tempo pros usuários
  // reagirem a uma mudança de parâmetro antes dela valer). Aplicação e poda acontecem
  // no tick de governança, por bloco.
  GOV_TIMELOCK_BLOCKS: Number(process.env.EAV7_GOV_TIMELOCK_BLOCKS) || 40_000, // ~11h a 1 bloco/s (env-override p/ testnet)
  MULTISIG_OP_TTL_BLOCKS: 100_000, // operação multisig pendente expira (evita lixo eterno)
  // Parâmetros que a governança pode alterar, com tipo e limites (anti-valor-absurdo).
  GOVERNABLE: {
    BLOCK_REWARD: { kind: 'bigint', min: 0n, max: 1_000n * UNIT },
    MIN_VALIDATOR_STAKE: { kind: 'bigint', min: 1n, max: 10_000_000n * UNIT },
    MAX_VALIDATORS: { kind: 'int', min: 1, max: 101 },
    FEE_EXEMPT_STAKE: { kind: 'bigint', min: 0n, max: 1_000_000n * UNIT },
    MIN_ORACLE_STAKE: { kind: 'bigint', min: 0n, max: 1_000_000n * UNIT },
    TREASURY_PCT: { kind: 'int', min: 0, max: 50 },
    BRIDGE_BREAKER_BPS: { kind: 'int', min: 100, max: 10_000 }, // 1%..100% do pool por janela
  },
  MIN_ORACLE_STAKE: 500n * UNIT,
  FEE_EXEMPT_STAKE: 100n * UNIT, // stake >= 100 EAV7 => transações com taxa zero

  BLOCK_REWARD: 16n * UNIT,
  // Emissão com halving (estilo Bitcoin): a recompensa de bloco cai pela metade
  // a cada intervalo, limitando a inflação de longo prazo. ~4 anos a 1 bloco/s.
  HALVING_INTERVAL_BLOCKS: 126_144_000,
  GENESIS_SUPPLY: 100_000_000_000n * UNIT,
  GENESIS_STAKE: 10_000n * UNIT,

  // Ponte: nº mínimo de relayers autorizados distintos que devem atestar um
  // depósito de origem antes da liberação (quórum M-de-N). 1 = comportamento antigo
  // (ponto único de falha). A PARTIR de BRIDGE_QUORUM_HEIGHT o quórum efetivo passa a
  // ser max(BRIDGE_MIN_ATTESTATIONS, maioria dos relayers da gênese) — vira federação
  // M-de-N de verdade, sem ponto único (achado C1). Depósitos ANTES do fork mantêm o
  // quórum antigo, para o replay do histórico continuar válido.
  BRIDGE_MIN_ATTESTATIONS: 1,
  // Altura de fork COORDENADO da ponte. Head de produção ~677k em 2026-07-14 (~1 bloco/s),
  // então esta altura PRECISA ser futura. 1.000.000 = ~3,7 dias de folga para o rollout
  // escalonado nos 3 nós. Todos os nós precisam da MESMA altura antes de a cadeia cruzá-la.
  // Exige ≥3 relayers na gênese para um quórum de maioria (ex.: 2-de-3) ter efeito.
  BRIDGE_QUORUM_HEIGHT: 1_000_000,
  // A PARTIR desta altura a ponte é TRUSTLESS (#3): BRIDGE_IN só libera com prova do
  // comitê da cadeia de origem (>= quorum de assinaturas sobre o evento), não mais por
  // confiança na federação de relayers. Fork COORDENADO; no gênese novo = 0 (ativo já).
  BRIDGE_PROOF_HEIGHT: 1_300_000,
  // A PARTIR desta altura o hash do bloco deriva SÓ do payload assinado (não das
  // assinaturas), tornando o id do bloco canônico e imune à maleabilidade de assinatura
  // (achado M1). Blocos antes do fork mantêm a fórmula antiga (grandfather). Head de
  // produção ~677k em 2026-07-14 → altura PRECISA ser futura. 1.000.000 = ~3,7 dias de
  // folga. Fork COORDENADO: mesmo valor nos 3 nós antes de a cadeia cruzá-la.
  CANONICAL_HASH_HEIGHT: 1_000_000,
  // A PARTIR desta altura o header carrega um `stateRoot` — compromisso Merkle do
  // estado APÓS o bloco — verificado no addBlock. Destrava prova de estado, light
  // clients e a ponte trustless (#1). Fork COORDENADO, acima do fork de consenso
  // anterior; ajustar para altura futura acordada antes do rollout.
  STATEROOT_HEIGHT: 1_200_000,
  // Finalidade BFT (#2): um bloco é FINAL quando >= 2/3+1 validadores DISTINTOS
  // construíram em cima dele (determinístico da própria cadeia). Um reorg não pode
  // reverter abaixo do finalizado. Só engaja com >= este nº de validadores ativos —
  // abaixo disso (dev/bootstrap de 1-2 nós) não há garantia BFT e a finalidade fica
  // desligada para não travar reorgs legítimos.
  FINALITY_MIN_VALIDATORS: 3,

  // Circuit breaker da ponte (auto-mitigação, guardrail de CONSENSO). A PARTIR de
  // BRIDGE_BREAKER_HEIGHT, a soma das LIBERAÇÕES (BRIDGE_IN) por ativo numa janela
  // deslizante de BRIDGE_BREAKER_WINDOW_BLOCKS não pode exceder BRIDGE_BREAKER_BPS
  // (basis points) do pool travado no início da janela. Excedeu → a liberação é
  // REJEITADA (falha fechada) até a janela abrir. Transforma um dreno total (relayer/
  // comitê comprometido — achado C1) num vazamento lento e observável, sem confiar em
  // nenhum ator. É DETERMINÍSTICO (altura + valores são estado de consenso → todos os
  // nós decidem igual, sem fork). O limite é GOVERNÁVEL (validadores ajustam por
  // GOV_PROPOSE). IMPORTANTE: NÃO entra em FORK_HEIGHTS — precisa ser altura FUTURA
  // acordada mesmo no gênese-ativo, senão muda a serialização de `state.bridge` (que
  // está no stateRoot) e quebraria o replay dos blocos já produzidos. Rollout
  // COORDENADO (mesmo valor nos 3 nós antes de a cadeia cruzá-la), como C1/M1.
  // Override por env p/ o ROLLOUT COORDENADO: define a MESMA altura futura nos 3 nós via
  // EAV7_BRIDGE_BREAKER_HEIGHT (systemd drop-in) sem editar código. Sem env = dormente (100M).
  BRIDGE_BREAKER_HEIGHT: Number(process.env.EAV7_BRIDGE_BREAKER_HEIGHT) || 100_000_000,
  BRIDGE_BREAKER_WINDOW_BLOCKS: 3_600, // ~1h a 1 bloco/s
  BRIDGE_BREAKER_BPS: 3_000, // 30% do pool por janela

  // Fase 6 — resultados de IA VERIFICÁVEIS por atestação (TEE / zkML). A PARTIR de
  // AI_TEE_HEIGHT, um AI_RESULT pode carregar uma ATESTAÇÃO: assinaturas de um conjunto
  // de atestadores REGISTRADO por governança (medida do enclave TEE ou verificador zk)
  // sobre o digest (taskId, resultHash, measurement). Com >= quórum de assinaturas
  // válidas, o resultado é aceito como VERIFICADO e liquida NA HORA — sem depender da
  // janela de desafio otimista (Fase 3) nem da reputação. Forjar exige as chaves de
  // atestação do enclave, não confiança no oráculo. A prova/quote é gerada OFF-CHAIN pela
  // infra do operador (enclave SGX/SEV/TDX ou prover zk); a EAV7 só VERIFICA a assinatura
  // do atestador registrado (determinístico, reusa verifyCommitteeProof da ponte #3).
  // IMPORTANTE: NÃO entra em FORK_HEIGHTS — altura FUTURA acordada mesmo no gênese-ativo,
  // senão o registro `aiAttesters` mudaria a serialização do stateRoot e quebraria o
  // replay dos blocos já produzidos. Rollout COORDENADO (mesmo valor nos 3 nós). zkML real
  // (verificar um SNARK on-chain) é follow-up — exige verificador de pareamento (não zero-dep).
  // Override por env p/ o ROLLOUT COORDENADO (idem breaker): EAV7_AI_TEE_HEIGHT idêntico nos 3 nós.
  AI_TEE_HEIGHT: Number(process.env.EAV7_AI_TEE_HEIGHT) || 100_000_000,
  MAX_AI_ATTESTER_MEMBERS: 32,

  // Rate limit por IP (usa CF-Connecting-IP atrás da Cloudflare).
  RATE_LIMIT_WINDOW_MS: 10_000,
  RATE_LIMIT_MAX: 240,

  MAX_DATA_BYTES: 64 * 1024,
  MAX_AI_PROMPT_BYTES: 8 * 1024,
  MAX_AI_OUTPUT_BYTES: 32 * 1024,
  // Prazo após o qual o solicitante pode reaver o escrow de uma tarefa de IA
  // não atendida (AI_REFUND), evitando fundos presos.
  AI_TASK_TIMEOUT_MS: 60 * 60_000,
  // IA que aprende + se auto-corrige (Fase 1). A PARTIR de AI_ACCOUNTABILITY_HEIGHT,
  // cada oráculo acumula reputação on-chain (completed/failed → score) e é
  // ECONOMICAMENTE responsabilizado: se a tarefa que ele foi designado expira sem
  // entrega e é reembolsada, ele perde reputação e é slashado em AI_ORACLE_SLASH,
  // que vai como COMPENSAÇÃO ao solicitante. Fork-gated (grandfather do histórico);
  // no gênese-ativo (testnet) nasce ligado.
  AI_ACCOUNTABILITY_HEIGHT: 1_760_000,
  AI_ORACLE_SLASH: 10n * UNIT, // penalidade por não-entrega (paga ao solicitante)
  // Quórum de oráculos com commit-reveal (Fase 2). A PARTIR de AI_QUORUM_HEIGHT, uma
  // AI_TASK pode exigir um QUÓRUM de N oráculos em vez de um único designado: os
  // oráculos COMMITAM hash(output|salt), depois REVELAM; quando N revelam o MESMO
  // resultado, a tarefa conclui e a recompensa é dividida entre eles. Elimina o ponto
  // único e o copie-e-cole (o commit trava a resposta antes de ver as dos outros).
  // Fork-gated; no gênese-ativo (testnet) nasce ligado.
  AI_QUORUM_HEIGHT: 1_780_000,
  AI_COMMIT_WINDOW_MS: 30 * 60_000, // janela de commit
  AI_REVEAL_WINDOW_MS: 30 * 60_000, // janela de reveal (após o commit fechar)
  MIN_AI_QUORUM: 2,
  MAX_AI_QUORUM: 21,
  // Janela de desafio (Fase 3 — verificação otimista). A PARTIR de AI_CHALLENGE_HEIGHT,
  // o resultado de um oráculo ÚNICO (AI_RESULT) fica em ESCROW numa janela: se ninguém
  // desafia, qualquer um liquida (AI_CLAIM) e o oráculo é pago; se alguém desafia
  // (AI_CHALLENGE, com fiança), um JÚRI de oráculos vota (AI_VERDICT) e o PERDEDOR é
  // slashado. Fork-gated; no gênese-ativo (testnet) nasce ligado.
  AI_CHALLENGE_HEIGHT: 1_800_000,
  AI_CHALLENGE_WINDOW_MS: 30 * 60_000, // janela para desafiar um resultado
  AI_VERDICT_WINDOW_MS: 30 * 60_000, // janela para o júri votar
  AI_CHALLENGE_BOND: 20n * UNIT, // fiança do desafiante (perde se o resultado for mantido)
  AI_VERDICT_QUORUM: 3, // nº de oráculos-jurados p/ decidir a disputa
  // Marketplace/leilão de oráculos (Fase 4). A PARTIR de AI_MARKET_HEIGHT, uma AI_TASK
  // pode ser ABERTA (data.open) com um ORÇAMENTO: oráculos dão lances (AI_BID, preço),
  // o solicitante adjudica ao melhor (AI_AWARD, por preço × reputação) e o excedente do
  // orçamento é devolvido. O ganhador entrega e passa pela janela de desafio (Fase 3).
  // Fork-gated; no gênese-ativo (testnet) nasce ligado.
  AI_MARKET_HEIGHT: 1_820_000,
  AI_BID_WINDOW_MS: 30 * 60_000, // janela para lances numa tarefa aberta
  // Resultados verificáveis/privados (Fase 5). A PARTIR de AI_PRIVATE_HEIGHT, o AI_RESULT
  // pode gravar SÓ o hash (`resultHash`) + um ponteiro opcional (`resultUri`) em vez do
  // output completo: o resultado real fica off-chain (cifrado p/ o solicitante em tarefas
  // `private`), verificável por qualquer um (hash(output) == resultHash). Estado enxuto +
  // privacidade. Fork-gated; no gênese-ativo (testnet) nasce ligado.
  AI_PRIVATE_HEIGHT: 1_840_000,
  MAX_AI_URI_BYTES: 512,

  // Limites anti-DoS (mempool, rede, RPC, respostas).
  MAX_MEMPOOL: 5_000,
  // Validade de uma transação no mempool. NÃO é consenso — é poda node-local.
  // Sem ela, uma tx com lacuna de nonce nunca executa e nunca sai: fica residente
  // para sempre, ocupando MAX_MEMPOOL e podendo ser reintroduzida meses depois num
  // contexto totalmente diferente. A TRON resolve isso com `expiration` no payload
  // (mudança de consenso); esta é a mitigação barata do mesmo problema.
  MEMPOOL_TTL_MS: 6 * 60 * 60 * 1000, // 6 h
  MAX_FUTURE_NONCE_GAP: 64,
  MAX_PEERS: 64,
  MAX_RPC_BATCH: 50,
  MAX_CHAIN_PAGE: 2_000,
  MAX_SYNC_BLOCKS: 10_000, // teto de blocos baixados por ciclo de sync (anti-OOM)
  MAX_SYNC_PAGE_BYTES: 16_000_000, // teto de bytes por página /chain lida de um peer (anti-OOM, H-4/L6). 2000 blocos típicos cabem folgado; corta a pressão de memória em sync multi-peer.
  MAX_TX_SCAN: 20_000, // teto de blocos varridos por consulta de transações
  MAX_LOG_INDEX: 100_000, // eventos EAVM mantidos no índice node-local (ring buffer, /logs)
  MAX_ALERT_CONTEXT_BYTES: 2_048,

  // EAVM — protocolo de contas externas próprio da EAV7 (MetaMask / Trust
  // Wallet via "rede customizada"). Essas carteiras exibem a moeda nativa com
  // 18 decimais; EAV7 usa 6 — 1 EAV7 = 10^18 unidades EAVM = 10^6 e7.
  EAVM_CHAIN_ID: Number(process.env.EAV7_EAVM_CHAIN_ID) || 72020,
  EAVM_WEI_PER_E7: 10n ** 12n,

  // ---- Modelo de recurso "Energia" (estilo Tron) ----
  // Cada conta tem energia GRÁTIS + energia por STAKE; a energia usada regenera
  // ao longo de REGEN_BLOCKS. Se falta energia para uma transação, ela QUEIMA
  // EAV7 (deflacionário) proporcional à energia em falta — a "taxa mais cara sem
  // energia". O campo `fee` da transação é o LIMITE de queima que o remetente
  // autoriza (feeLimit, como na Tron).
  // ---- Modelo de recursos: PROPORCIONAL a um teto global (modelo da TRON) ----
  //
  // A fórmula é a deles; os números são derivados da NOSSA realidade:
  //
  //     energia(conta) = ⌊ stake × TOTAL_ENERGY_LIMIT / (UNIT × TOTAL_ENERGY_WEIGHT) ⌋
  //
  // O que isso muda: a capacidade de cada um é uma FATIA de um bolo fixo, então a
  // sua energia cai quando outros stakeiam, sem você fazer nada. É o que permite ao
  // custo marginal de throughput subir com a demanda — no modelo absoluto anterior
  // (`FREE + stake`, ilimitado) não havia como precificar escassez de bloco.
  //
  // ARMADILHA EVITADA: a janela de recuperação da TRON é 28.800 slots, que vem de
  // `86.400.000 ms / 3.000 ms` — o bloco DELES. Nosso bloco é de 1s, então a mesma
  // fórmula dá 86.400. Copiar o número 28.800 daria janela de 8 horas em vez de 24,
  // e o erro só apareceria com a rede em uso.
  RESOURCE_WINDOW_BLOCKS: 86_400, // = 86.400.000 ms / BLOCK_TIME_MS

  ENERGY: {
    FREE: 10, // energia grátis por conta (regenera) — evita atrito de onboarding
    PER_STAKED_EAV7: 1, // legado do modelo absoluto; ver TOTAL_LIMIT abaixo
    // Teto global diário, derivado da capacidade MEDIDA de execução: ~51.900 de
    // energia por bloco (20% do orçamento de CPU) x 86.400 blocos. Não é o número
    // da TRON (180 bi) porque a capacidade de execução deles é outra — copiar o
    // valor seria prometer uma vazão que a nossa VM não entrega.
    TOTAL_LIMIT: 4_484_419_200,
    REGEN_BLOCKS: 86_400, // energia usada volta a 100% em ~24h (1 bloco/s)
    BURN_PER_ENERGY: 20_000n, // e7 queimados por unidade de energia em falta (0,02 EAV7)
    COST: {
      TRANSFER: 1, STAKE: 1, UNSTAKE: 1, VOTE: 1, EAVM_TRANSFER: 1,
      PERMISSION_UPDATE: 2, MULTISIG_PROPOSE: 2, MULTISIG_APPROVE: 1,
      PERMISSION_PROPOSE: 2, PERMISSION_APPROVE: 1, PERMISSION_VETO: 1,
      DELEGATE_RESOURCE: 1, UNDELEGATE_RESOURCE: 1,
      GOV_PROPOSE: 2, GOV_VOTE: 1, SLASH_DOUBLE_SIGN: 8, BRIDGE_COMMITTEE_UPDATE: 2, // SLASH custa (2 verifies híbridos) — anti-spam
      VESTING_CREATE: 2, VESTING_CLAIM: 1,
      SET_COMMISSION: 1, CLAIM_VOTER_REWARD: 1, META_TX: 3,
      TOKEN_TRANSFER: 2, TOKEN_TRANSFER_FROM: 2, TOKEN_APPROVE: 1, TOKEN_CREATE: 10,
      TOKEN_MINT: 2, TOKEN_BURN: 2, TOKEN_PAUSE: 1, TOKEN_UNPAUSE: 1, TOKEN_BLACKLIST: 1,
      TOKEN_FREEZE: 1, TOKEN_UNFREEZE: 1,
      NFT_CREATE: 10, NFT_MINT: 3, NFT_TRANSFER: 2, NFT_APPROVE: 1, NFT_BURN: 2,
      NAME_REGISTER: 3, NAME_UPDATE: 1, NAME_TRANSFER: 1, NAME_RELEASE: 1,
      AI_TASK: 5, AI_RESULT: 0, AI_REFUND: 0, ORACLE_REGISTER: 2, AI_COMMIT: 1, AI_REVEAL: 1,
      AI_CLAIM: 1, AI_CHALLENGE: 2, AI_VERDICT: 1, AI_BID: 1, AI_AWARD: 1,
      BRIDGE_OUT: 2, BRIDGE_IN: 0, BRIDGE_SETTLE: 0,
      EAVM_DEPLOY: 10, EAVM_CALL: 5, // custo BASE; a execução da VM soma gás/energia dinâmico
    },
  },
  // ---- Recurso "Bandwidth" (net) + delegação (#6, estilo Tron freeze v2) ----
  // Bandwidth é consumido pelo TAMANHO em bytes da transação (anti-spam por volume).
  // Grátis + bônus por resourceStake; regenera; a falta QUEIMA e7 por byte. A partir de
  // RESOURCE_HEIGHT. A capacidade de recurso (energia E bandwidth) usa resourceStake =
  // staked − delegadoOut + delegadoIn: delegar cede RECURSO a outra conta sem perder
  // poder de voto (dApps patrocinam taxas). No gênese novo = 0 (ativo já).
  RESOURCE_HEIGHT: 1_600_000,
  // Vesting / time-lock (evolução): trava fundos para um beneficiário com cliff + liberação
  // LINEAR ao longo de durationBlocks. Ideal para distribuição de time/investidor no gênese
  // (nasce vestido, não líquido). No gênese novo = 0 (ativo já).
  VESTING_HEIGHT: 1_650_000,
  MAX_VESTING_BLOCKS: 315_360_000, // ~10 anos a 1 bloco/s (teto de duração)
  // Meta-transações (evolução, gasless): um relayer embrulha a tx ASSINADA do usuário num
  // META_TX e PAGA a taxa; o efeito (TRANSFER/TOKEN_TRANSFER) roda como o usuário, com o
  // nonce dele. Onboarding sem o usuário ter EAV7. No gênese novo = 0 (ativo já).
  META_HEIGHT: 1_680_000,
  // Funções administrativas de token EAV20 (owner): mint (se mintable), burn, pause,
  // blacklist. E o padrão de NFT EAV721. No gênese novo = 0 (ativo já).
  TOKEN_ADMIN_HEIGHT: 1_700_000,
  NFT_HEIGHT: 1_720_000,
  MAX_NFT_URI_BYTES: 2_048,
  // Serviço de nomes EAV-NS (evolução): nomes legíveis -> endereço E7. No gênese novo = 0.
  NAME_HEIGHT: 1_740_000,
  NAME_REGISTER_COST: 1n * UNIT, // custo (queimado) de registrar um nome — anti-squatting
  BANDWIDTH: {
    FREE: 8_000, // bytes grátis por conta (cobre ~1 tx híbrida; regenera) — a assinatura ML-DSA é grande
    PER_STAKED_EAV7: 256, // legado do modelo absoluto; ver TOTAL_LIMIT abaixo
    // Teto global diário: 500 tx/bloco x 86.400 blocos x ~4.000 bytes de tx híbrida,
    // com a mesma repartição da TRON — 75% para o pool stakeado, 25% reservados à
    // cota gratuita. A tx é grande porque a assinatura ML-DSA é grande; dimensionar
    // com o tamanho de tx da TRON subestimaria a nossa banda em quase dez vezes.
    TOTAL_LIMIT: 129_600_000_000,
    PUBLIC_LIMIT: 43_200_000_000, // teto da cota GRATUITA somada de toda a rede
    REGEN_BLOCKS: 86_400, // banda usada volta a 100% em ~24h
    BURN_PER_BYTE: 5n, // e7 queimados por byte em falta (0,000005 EAV7/byte)
  },

  MAX_FEE_LIMIT: 100n * UNIT, // teto do limite de taxa autorizável (anti-erro de digitação)

  // ---- EAVM (VM de contratos) ----
  GAS_PER_ENERGY: 100, // 100 unidades de gás da VM = 1 de energia (contratos usam gás abundante)
  // Fase 2.3 — contratos EAVM PAGÁVEIS com LEDGER UNIFICADO. Acima desta altura o
  // saldo do mundo 0x deixa de ser um livro separado (a origem do achado A-3, em que
  // o valor entrava no contrato e não tinha caminho de volta) e passa a SER o saldo
  // da conta nativa correspondente, resolvida por decodeE7Dest ?? eavmToE7 — a mesma
  // regra que EAVM_TRANSFER já usa. Um livro só ⇒ supply conservado por construção e
  // fundos nunca presos. `contracts[].balance` permanece 0n sempre, então a
  // serialização do stateRoot NÃO muda: o fork é puramente comportamental.
  EAVM_VALUE_HEIGHT: 1_900_000,

  // Abre a EAVM para CONTRATOS pela rota EVM. Até aqui `envelope.js` recusava
  // deploy (`to` nulo) e qualquer calldata, então a VM — que sempre soube executar
  // contratos por EAVM_DEPLOY/EAVM_CALL nativos — era inalcançável por Hardhat,
  // ethers.js ou carteira. Consequência: um token só podia ser EAV20 nativo, sem
  // código-fonte para verificar. Mesmo beco em que a TRON deixou o TRC10; lá o
  // ecossistema todo migrou para TRC20 em Solidity, que aqui não era construível.
  //
  // A relaxação é STATELESS (envelope passa a aceitar as duas formas) e o gate é
  // STATEFUL: abaixo desta altura o State recusa contrato via esquema EAVM, então
  // nó velho e nó novo rejeitam igual — a divergência só começa no fork.
  EAVM_CONTRACTS_HEIGHT: 1_900_000,

  // Atualização da EAVM até Osaka, num fork só (multiplicar altura de fork por
  // opcode não ajuda ninguém e complica o rollout). Entra tudo junto:
  //   BLOCKHASH (0x40)  — faltava desde sempre; é opcode de 2015 e sem ele
  //                       commit-reveal, loteria e VRF caseiro travam
  //   Cancun            — TLOAD/TSTORE (0x5c/0x5d), MCOPY (0x5e),
  //                       BLOBHASH (0x49), BLOBBASEFEE (0x4a)
  //   Osaka             — CLZ (0x1e)
  //   precompiles       — ecAdd/ecMul/ecPairing (0x06-0x08) e blake2f (0x09)
  //
  // Sem os precompiles de pairing não existe zero-knowledge na EAVM (Groth16,
  // zk-rollup, prova de identidade) — é mais consequente que os opcodes de Cancun.
  EAVM_OSAKA_HEIGHT: 1_900_000,
  // Janela do histórico de hashes de bloco (EIP-2935). O BLOCKHASH clássico enxerga
  // 256 blocos; guardamos 8191 no anel porque é o que o EIP define e custa pouco.
  BLOCKHASH_HISTORY: 8191,
  BLOCKHASH_WINDOW: 256, // o que o opcode realmente serve, como em toda EVM

  // Multiplicador de gás dos precompiles BN254 (0x06-0x08).
  //
  // A tabela do EIP-1108 (150 / 6000 / 34000·k+45000) foi calibrada para pairing
  // em código NATIVO. O nosso é BigInt em JavaScript, e a diferença é medida, não
  // estimada: por unidade de gás o pairing custa ~13x mais CPU aqui do que um laço
  // aritmético comum. Com o teto de execução e blocos de 1s, uma transação cheia
  // de pairings ocuparia ~15 SEGUNDOS de CPU pagando gás de um bloco — travaria a
  // produção por 15 slots.
  //
  // Precificar pelo custo real é a saída determinística. A alternativa seria um
  // teto de tempo de parede (o MAX_CPU_TIME_OF_ONE_TX da TRON), mas tempo de parede
  // difere entre nós e um mesmo bloco poderia passar num nó e falhar noutro — cisão
  // de consenso. Gás é determinístico; tempo não é.
  //
  // Custo para o usuário: um Groth16 (2 pares) sai por ~1,5M de gás em vez de 113k.
  // Se um dia a EAVM ganhar pairing nativo, este multiplicador volta a 1.
  BN254_GAS_MULTIPLIER: 13n,
  // Teto de gás por execução, derivado do ORÇAMENTO DE CPU DO BLOCO, não de um
  // número redondo. Medição nesta base: o interpretador queima ~25.950 de gás por
  // milissegundo; 20% de um bloco de 1s dá ~5,19M de gás.
  //
  // O valor anterior era 30.000.000 — que leva 1,16s de CPU e, sozinho, estoura em
  // 6x o orçamento de um bloco de 1 segundo. Ninguém tinha atingido porque não há
  // contrato pesado na rede ainda; no dia em que houvesse, o produtor perderia o
  // slot. Quando a execução migrar para código nativo, este teto sobe junto — é
  // função da capacidade real, não uma constante arbitrária.
  MAX_EAVM_GAS: 5_190_000,
  MAX_CONTRACT_BYTES: 24_576, // tamanho máximo do bytecode de runtime (EIP-170)
  // Teto de calldata/bytecode de ENTRADA por transação. O envelope já limita o raw
  // a 8192 chars; este é o limite explícito do payload que a VM recebe.
  MAX_EAVM_CALLDATA: 3_072,
  // Tetos de `eth_getLogs`. Sem faixa máxima, uma consulta de 0 até o topo varre a
  // cadeia inteira por chamada — o DoS clássico desse método. A TRON usa o mesmo
  // padrão via `node.jsonrpc.maxBlockRange`.
  MAX_LOG_RANGE: 5_000,
  MAX_LOG_RESULTS: 10_000,

  // Tabela de referência de custo por tipo (usada como LIMITE padrão de queima na
  // carteira/CLI = custo de energia × BURN_PER_ENERGY). Mantida para compat.
  FEES: {
    TRANSFER: 10_000n, // 0.01 EAV7
    STAKE: 10_000n,
    UNSTAKE: 10_000n,
    VOTE: 10_000n,
    DELEGATE_RESOURCE: 10_000n,
    UNDELEGATE_RESOURCE: 10_000n,
    GOV_PROPOSE: 50_000n,
    GOV_VOTE: 10_000n,
    SLASH_DOUBLE_SIGN: 20_000n, // limite de queima p/ a denúncia (rate-limit via energia; o prêmio do slash compensa)
    VESTING_CREATE: 20_000n,
    VESTING_CLAIM: 10_000n,
    SET_COMMISSION: 10_000n,
    CLAIM_VOTER_REWARD: 10_000n,
    META_TX: 30_000n,
    BRIDGE_COMMITTEE_UPDATE: 20_000n,
    PERMISSION_UPDATE: 20_000n,
    PERMISSION_PROPOSE: 20_000n,
    PERMISSION_APPROVE: 10_000n,
    // Vetar precisa ser BARATO: se a defesa custar caro, ela não é usada na hora H.
    PERMISSION_VETO: 1_000n,
    MULTISIG_PROPOSE: 20_000n,
    MULTISIG_APPROVE: 10_000n,
    TOKEN_CREATE: 10n * UNIT,
    TOKEN_TRANSFER: 20_000n,
    TOKEN_APPROVE: 10_000n,
    TOKEN_TRANSFER_FROM: 20_000n,
    TOKEN_MINT: 20_000n,
    TOKEN_BURN: 20_000n,
    TOKEN_PAUSE: 10_000n,
    TOKEN_UNPAUSE: 10_000n,
    TOKEN_BLACKLIST: 10_000n,
    TOKEN_FREEZE: 10_000n,
    TOKEN_UNFREEZE: 10_000n,
    NFT_CREATE: 10n * UNIT,
    NFT_MINT: 30_000n,
    NFT_TRANSFER: 20_000n,
    NFT_APPROVE: 10_000n,
    NFT_BURN: 20_000n,
    NAME_REGISTER: 1n * UNIT, // registro custa 1 EAV7 (queimado) — anti-squatting
    NAME_UPDATE: 10_000n,
    NAME_TRANSFER: 10_000n,
    NAME_RELEASE: 10_000n,
    AI_TASK: 50_000n,
    AI_RESULT: 0n,
    AI_COMMIT: 10_000n,
    AI_REVEAL: 10_000n,
    AI_CLAIM: 10_000n,
    AI_CHALLENGE: 20_000n,
    AI_VERDICT: 10_000n,
    AI_BID: 10_000n,
    AI_AWARD: 10_000n,
    ORACLE_REGISTER: 10_000n,
    BRIDGE_OUT: 20_000n,
    BRIDGE_IN: 0n,
    BRIDGE_SETTLE: 0n,
    AI_REFUND: 0n,
    EAVM_TRANSFER: 10_000n,
    EAVM_DEPLOY: 200_000n, // limite de queima padrão (0.2 EAV7); execução pesada exige limite maior
    EAVM_CALL: 100_000n,
  },
};

// Gênese-ativo: com EAV7_GENESIS_ACTIVE=1, TODAS as features nascem no bloco 0 (todas
// as alturas de fork = 0). É o modo do relaunch e da testnet — um flag em vez de editar
// cada altura à mão. Deixa a cadeia ATUAL intacta (só liga quando o env está setado).
export const FORK_HEIGHTS = [
  'STRICT_PRODUCER_HEIGHT', 'CANONICAL_HASH_HEIGHT', 'STATEROOT_HEIGHT', 'BRIDGE_QUORUM_HEIGHT',
  'BRIDGE_PROOF_HEIGHT', 'VOTING_HEIGHT', 'PERMISSIONS_HEIGHT', 'RESOURCE_HEIGHT', 'GOVERNANCE_HEIGHT',
  'VESTING_HEIGHT', 'META_HEIGHT', 'TOKEN_ADMIN_HEIGHT', 'NFT_HEIGHT', 'NAME_HEIGHT',
  'AI_ACCOUNTABILITY_HEIGHT', 'AI_QUORUM_HEIGHT', 'AI_CHALLENGE_HEIGHT', 'AI_MARKET_HEIGHT',
  'AI_PRIVATE_HEIGHT', 'EAVM_VALUE_HEIGHT', 'PERMISSIONS_V2_HEIGHT',
  'EAVM_CONTRACTS_HEIGHT', 'EAVM_OSAKA_HEIGHT',
];
// SLASHING_HEIGHT é DELIBERADAMENTE excluído do gênese-ativo: a detecção de assinatura
// dupla ainda não distingue equivocação maliciosa de um validador honesto re-produzindo
// uma altura após um reorg (puniria honesto). A finalidade BFT (#2) já dá a garantia de
// segurança principal; ative o slashing só após endurecer a evidência anti-equivocação.
if (process.env.EAV7_GENESIS_ACTIVE === '1') {
  for (const k of FORK_HEIGHTS) CHAIN[k] = 0;
}

export const TX_TYPES = Object.freeze(Object.keys(CHAIN.FEES));

// Normaliza um valor monetário (bigint | number inteiro | string decimal) para BigInt.
export function parseAmount(value, field = 'valor') {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${field} não pode ser negativo`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} inválido: ${value}`);
    return BigInt(value);
  }
  if (isAmountString(value)) return BigInt(value);
  throw new Error(`${field} inválido: ${value}`);
}

export function isAmountString(value) {
  return typeof value === 'string' && value.length <= 30 && /^(0|[1-9]\d*)$/.test(value);
}

export function amountToString(value, field) {
  return parseAmount(value, field).toString();
}

// e7 (BigInt) -> string humana em EAV7, ex.: 16000000n -> "16"
export function formatEav7(e7) {
  const value = parseAmount(e7);
  const whole = value / UNIT;
  const frac = value % UNIT;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

// string humana em EAV7 (ex.: "12.5") -> e7 (BigInt)
export function eav7ToE7(text, field = 'valor') {
  const match = String(text).trim().match(/^(\d+)(?:[.,](\d{1,6}))?$/);
  if (!match) throw new Error(`${field} inválido: ${text} (use até 6 casas decimais)`);
  return BigInt(match[1]) * UNIT + BigInt((match[2] ?? '0').padEnd(6, '0'));
}

// JSON.stringify com suporte a BigInt (serializado como string decimal).
export function toJson(value, space) {
  return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), space);
}
