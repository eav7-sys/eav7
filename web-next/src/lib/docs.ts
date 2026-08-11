// Conteúdo da documentação — estático (front-end puro), fiel ao protocolo eav20.
export interface DocSection {
  h?: string;
  p?: string;
  kv?: [string, string][];
  code?: string;
}
export interface Doc {
  title: string;
  sub: string;
  sections: DocSection[];
}

export const DOCS: Record<string, Doc> = {
  sobre: {
    title: "Sobre o protocolo eav20",
    sub: "Visão geral técnica da blockchain EAV7",
    sections: [
      {
        p: "A EAV7 é uma blockchain de camada 1 com protocolo próprio eav20: consenso DPoS com finalidade BFT, segurança pós-quântica, state root para clientes leves, padrão de token EAV20 e NFT EAV721, serviço de nomes EAV-NS, governança on-chain com tesouraria, ponte cross-chain trustless e uma camada nativa de inteligência artificial.",
      },
      {
        h: "Parâmetros da rede",
        kv: [
          ["Moeda nativa", "EAV7 — 6 casas decimais (1 EAV7 = 1.000.000 e7)"],
          ["Suprimento", "100.000.000.000 EAV7 (com halving ~a cada 4 anos)"],
          ["Recompensa por bloco", "16 EAV7 (produtor + eleitores + tesouraria) + taxas"],
          ["Tempo de bloco", "1 segundo"],
          ["Consenso", "DPoS — até 51 validadores (governável, teto 101) eleitos por peso (stake + votos), finalidade BFT"],
          ["Hashes", "SHA3-256, sempre iniciando com E7"],
          ["Endereços", "E7 + 32 hex com checksum (34 caracteres)"],
          ["Assinatura", "eav7-hybrid-1 — secp256k1 + ML-DSA-44 (pós-quântica)"],
          ["Chain ID (EAVM)", "72020 (mainnet) · 72021 (testnet)"],
        ],
      },
      {
        h: "Tipos de transação (55)",
        p: "Nativo: TRANSFER, EAVM_TRANSFER. Consenso/staking: STAKE, UNSTAKE, VOTE, SET_COMMISSION, CLAIM_VOTER_REWARD, SLASH_DOUBLE_SIGN. Recursos: DELEGATE_RESOURCE, UNDELEGATE_RESOURCE. Permissões/multisig: PERMISSION_UPDATE, MULTISIG_PROPOSE, MULTISIG_APPROVE. Governança: GOV_PROPOSE, GOV_VOTE. Vesting/meta: VESTING_CREATE, VESTING_CLAIM, META_TX. Token EAV20: CREATE, TRANSFER, APPROVE, TRANSFER_FROM, MINT, BURN, PAUSE, UNPAUSE, BLACKLIST, FREEZE, UNFREEZE. NFT EAV721: CREATE, MINT, TRANSFER, APPROVE, BURN. Nomes EAV-NS: REGISTER, UPDATE, TRANSFER, RELEASE. IA (oráculos em 6 fases): AI_TASK, AI_COMMIT, AI_REVEAL, AI_CLAIM, AI_RESULT, AI_CHALLENGE, AI_VERDICT, AI_BID, AI_AWARD, AI_REFUND, ORACLE_REGISTER. Ponte: BRIDGE_OUT, BRIDGE_IN, BRIDGE_SETTLE, BRIDGE_COMMITTEE_UPDATE. EAVM: EAVM_DEPLOY, EAVM_CALL.",
      },
    ],
  },
  consenso: {
    title: "Consenso DPoS & nós",
    sub: "Como os blocos são produzidos e finalizados",
    sections: [
      {
        h: "Eleição por peso (stake + votos)",
        p: "Contas com stake ≥ 1.000 EAV7 entram na eleição; as de maior PESO (self-stake + votos recebidos via VOTE), até 51, tornam-se validadores ativos. Sem votos, degrada para top-por-stake.",
      },
      {
        h: "Produção e finalidade",
        kv: [
          ["Slot", "janela de 1 segundo — slot = floor(timestamp / 1000)"],
          ["Produtor esperado", "validadores[slot % N] (rodízio round-robin estrito)"],
          ["Um bloco por slot", "impede grinding de timestamp e inflação de emissão"],
          ["Finalidade BFT", "bloco final quando ≥ 2/3+1 validadores distintos constroem em cima"],
          ["Recompensa", "produtor fica com a comissão; o resto é partilhado com os eleitores"],
          ["Unbonding", "UNSTAKE remove voto/validação na hora; fundos voltam após ~7 dias"],
          ["Fork choice", "cadeia válida mais longa, limitada pela finalidade"],
        ],
      },
      {
        h: "Rodar um nó",
        code: "eav7-core init --mode validator --port 6070 \\\n  --peers https://outro-no:6070\neav7-core run",
      },
    ],
  },
  staking: {
    title: "Staking, votos & recompensas",
    sub: "Trave EAV7 para minerar, votar e zerar taxas",
    sections: [
      {
        h: "Como o stake funciona",
        kv: [
          ["≥ 100 EAV7 travados", "suas transações passam a ter taxa zero (recurso por freeze)"],
          ["≥ 1.000 EAV7 travados", "você entra na eleição de validadores"],
          ["Votar (VOTE)", "aloque seu poder de voto (= stake) a candidatos; eleva o peso deles"],
          ["Recompensa de eleitores", "o produtor fica com a comissão (padrão 20%); o resto é partilhado entre quem votou nele — resgate com CLAIM_VOTER_REWARD"],
          ["Unbonding", "o unstake libera os fundos ao saldo após ~7 dias (anti sair-e-dumpar)"],
        ],
      },
      {
        h: "Fazer stake pela CLI",
        code: "eav7-core stake --amount 1000 --wait\neav7-core unstake --amount 500 --wait",
      },
    ],
  },
  eavm: {
    title: "EAVM · MetaMask & Trust Wallet",
    sub: "A máquina de contas externa própria da EAV7",
    sections: [
      {
        h: "O que é o EAVM",
        p: "O EAVM é a máquina virtual da EAV7, compatível com EVM via JSON-RPC — o dialeto que carteiras universais entendem, permitindo usar a EAV7 na MetaMask e na Trust Wallet como rede customizada. Cada conta 0x… é mapeada de forma determinística para um endereço nativo E7…, e as duas identidades são a mesma conta.",
      },
      {
        h: "Adicionar a rede",
        kv: [
          ["RPC (mainnet)", "https://rpc.eavscan.com"],
          ["RPC (testnet)", "https://rpc-testnet.eavscan.com"],
          ["Chain ID", "72020 (mainnet) · 72021 (testnet)"],
          ["Símbolo", "EAV7"],
          ["Explorer", "https://eavscan.com"],
        ],
      },
    ],
  },
  token: {
    title: "Tokens EAV20 & NFTs EAV721",
    sub: "Ativos nativos do protocolo (EAV20 / EAV721, compatíveis com ERC-20 / ERC-721)",
    sections: [
      {
        p: "O EAV20 é o padrão de token fungível da rede; o EAV721 é o padrão de NFT. Ambos vivem no estado da cadeia (sem máquina virtual): são criados e movidos por transações assinadas.",
      },
      {
        h: "Operações do EAV20",
        kv: [
          ["create / transfer", "cria o token e transfere entre contas"],
          ["approve / transferFrom", "permite que um terceiro gaste um limite em seu nome"],
          ["mint / burn", "o dono emite (se mintável) ou destrói suprimento"],
          ["pause / blacklist / freeze", "controles administrativos do dono do token"],
        ],
      },
      {
        h: "EAV721 (NFT) & EAV-NS (nomes)",
        p: "EAV721: create (coleção), mint, transfer, approve, burn — com URI por token. EAV-NS: registre nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release).",
      },
      {
        h: "Criar um token",
        code: 'POST /tx  type=CREATE_TOKEN  (via carteira /wallet ou eav7-cli)\n  name "Meu Token" · symbol MTK · supply 1000000 · decimals 6',
      },
    ],
  },
  ponte: {
    title: "Ponte cross-chain trustless",
    sub: "Interligação com outras blockchains por prova de comitê",
    sections: [
      {
        p: "A ponte conecta a EAV7 a outras redes (ETH, BTC, …) por um modelo lock-and-release. A liberação de fundos NÃO depende da confiança em um relayer: exige prova criptográfica do evento de origem, assinada por um comitê (quórum M-de-N).",
      },
      {
        h: "Fluxo",
        kv: [
          ["BRIDGE_OUT", "trava EAV7 (ou token EAV20) e registra o destino externo"],
          ["BRIDGE_IN", "libera fundos mediante prova do comitê de origem (quórum M-de-N)"],
          ["BRIDGE_SETTLE", "marca a saída como paga on-chain (idempotente por sourceTxHash)"],
          ["BRIDGE_COMMITTEE_UPDATE", "rotaciona o comitê por handoff assinado pelo comitê atual"],
        ],
      },
    ],
  },
  seguranca: {
    title: "Segurança & IA nativa",
    sub: "Pós-quântica, finalidade BFT, oráculos verificáveis e auto-defesa",
    sections: [
      {
        h: "Assinatura híbrida pós-quântica",
        p: "Toda carteira, transação e bloco carrega duas assinaturas e a verificação exige as duas: ECDSA secp256k1 (maturidade) e ML-DSA-44 (FIPS 204, resistente a computadores quânticos). Forjar exigiria quebrar as duas primitivas ao mesmo tempo.",
      },
      {
        h: "Garantias de consenso",
        kv: [
          ["Finalidade BFT", "bloco final com ≥ 2/3+1 validadores distintos — reorg não reverte o finalizado"],
          ["State root", "compromisso Merkle do estado em cada header — habilita provas de conta"],
          ["Unbonding & slashing", "unstake com carência; assinatura dupla é penalizável no protocolo"],
          ["Auditoria", "código auditado por painel adversarial multi-agente (ver AUDITORIA.md)"],
        ],
      },
      {
        h: "Camada de IA — oráculos em 6 fases",
        p: "Oráculos on-chain que evoluem: nada depende de confiar num único ator. Cada fase é ativada por altura de fork (grandfather do histórico).",
        kv: [
          ["1 · Reputação + slashing", "reputação on-chain que evolui a cada tarefa; não-entrega é penalizada e compensa o solicitante"],
          ["2 · Quórum commit-reveal", "N oráculos comprometem hash(output) e revelam; concordando ≥ quórum, dividem a recompensa"],
          ["3 · Janela de desafio + júri", "verificação otimista: a recompensa fica em escrow; contestações (AI_CHALLENGE) vão a um júri (AI_VERDICT)"],
          ["4 · Marketplace / leilão", "tarefas abertas recebem lances (AI_BID); adjudica ao melhor por preço×reputação (AI_AWARD)"],
          ["5 · Resultados privados", "entrega só o hash do resultado (output off-chain, cifrado p/ o solicitante); verificável por hash"],
          ["6 · Atestação TEE/zk", "resultado com prova de enclave/zk de atestador registrado liquida NA HORA como verificado"],
        ],
      },
      {
        h: "Auto-defesa & evolução nativa (segura)",
        p: "A IA age sozinha SÓ no operacional e reversível; para consenso/irreversível (validadores, parâmetros, stake, código, tesouraria) ela apenas PROPÕE — a governança (2/3+1) ou um humano decide.",
        kv: [
          ["Sentinela 24h", "vigia reorgs/rollbacks, transferências gigantes, rajadas, mempool, concentração de produtores, saúde de validadores"],
          ["Score de validador", "desempenho derivado da cadeia (0-100, saudável/lento/degradado/offline) exposto no explorer"],
          ["Balanceador de gateway", "leituras públicas roteadas ao peer mais saudável quando o nó-gateway atrasa (operacional, reversível)"],
          ["Bloqueio de IP abusivo", "flood/tx inválida em série → bloqueio temporário com TTL (nunca bloqueia o túnel; reversível)"],
          ["Circuit breaker da ponte", "limita a velocidade de saída da ponte por janela — dreno total vira vazamento lento (consenso, gated)"],
          ["Conselheiro de governança", "a IA redige propostas (GOV_PROPOSE) quando um parâmetro sai do saudável — validadores votam"],
        ],
      },
    ],
  },
  api: {
    title: "API REST",
    sub: "Endpoints públicos do nó",
    sections: [
      {
        h: "Exemplo de chamada",
        p: "Todos os endpoints retornam JSON e aceitam CORS. Valores monetários vêm em e7 (1 EAV7 = 1.000.000 e7), como string decimal.",
        code: 'curl https://eavscan.com/status\n{ "chain": "EAV7", "protocol": "eav20", "finalizedHeight": ..., "treasury": ..., ... }',
      },
      {
        h: "Principais rotas",
        p: "/status (inclui forkHeights) · /blocks · /block/:ref · /txs · /tx/:id · /address/:E7 (+ /txs) · /validators (+ /validators/performance) · /tokens · /nfts · /names · /governance (+ /governance/advisories) · /treasury · /proof/:E7 (prova de conta) · /logs · /bridge/transfers · /ai/tasks · /ai/oracles · /security/alerts · /gateway · /guard · /search · /stats. Escrita: POST /tx · /eavm/tx.",
      },
      {
        h: "Rotas de observabilidade da IA/infra",
        kv: [
          ["/validators/performance", "score de desempenho por validador (produtividade, slots perdidos, latência, status)"],
          ["/governance/advisories", "propostas de governança que a IA redige (propose-only) p/ parâmetros fora do saudável"],
          ["/gateway", "estado do balanceador/failover de leitura (servindo local ou de um peer)"],
          ["/guard", "bloqueios de IP abusivo ativos (auto-mitigação operacional, com TTL)"],
        ],
      },
    ],
  },
};

export const DOC_SLUGS = Object.keys(DOCS);
