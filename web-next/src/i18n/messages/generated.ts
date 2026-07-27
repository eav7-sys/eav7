import type { LocaleCode } from "../locales";

// Namespaces das telas internas, mesclados sobre o chrome em dictionary.ts.
// Gerado por scripts/merge-i18n.mjs a partir de _parts/. NÃO editar à mão.
export const generated: Record<LocaleCode, Record<string, unknown>> = {
  "pt": {
    "blocks_live": {
      "networkLabel": "cadeia eav20",
      "title": "Blocos",
      "live": "ao vivo",
      "blockTimeInfo": "um novo bloco a cada {n}s · consenso DPoS",
      "searchPlaceholder": "Buscar bloco por altura ou hash…",
      "stats": {
        "height": "Altura atual",
        "blockTime": "Tempo de bloco",
        "avgTx": "Txs / bloco (méd.)",
        "activeProducers": "Produtores ativos"
      },
      "latestBlocks": "Últimos blocos",
      "updating": "atualizando",
      "columns": {
        "block": "Bloco",
        "age": "Idade",
        "txs": "Txs",
        "producer": "Produtor",
        "reward": "Recompensa",
        "hash": "Hash"
      }
    },
    "comingSoon": {
      "badge": "em construção · sprint 4",
      "backToExplorer": "← voltar ao explorer"
    },
    "docs_api": {
      "badge": "API pública",
      "title": "Consulte a rede direto do nó",
      "baseUrl": "base URL",
      "tags": {
        "cors": "CORS habilitado",
        "units": "valores em e7",
        "noAuth": "sem autenticação"
      },
      "groups": {
        "read": "leitura",
        "write": "escrita"
      },
      "endpoints": {
        "status": "estado da rede: altura, altura finalizada (BFT), tesouraria, validadores, recompensa/bloco",
        "blocks": "últimos N blocos",
        "blockByHeight": "um bloco por altura ou hash",
        "txs": "transações recentes, paginadas",
        "tx": "uma transação por id",
        "address": "saldo, stake, nonce, papel, tokens e energia",
        "tokens": "lista de tokens EAV20 (ou /tokens/:id para detalhe)",
        "validators": "conjunto DPoS ativo (peso = stake + votos) + produtor do slot",
        "sendTx": "envia uma transação nativa assinada (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "envia transação pela camada EAVM (JSON-RPC compatível)",
        "addressTxs": "transações de um endereço, paginadas",
        "proof": "prova de conta (Merkle) contra o stateRoot — light clients",
        "name": "resolve um nome EAV-NS → endereço E7",
        "logs": "eventos/logs do EAVM (filtro por address e topic)",
        "contract": "metadados de verificação de um contrato EAVM",
        "verifyContract": "verifica um contrato: o bytecode deve bater com o código on-chain",
        "nfts": "coleções NFT EAV721 (ou /nfts/:id para detalhe)",
        "names": "nomes EAV-NS registrados",
        "validatorsPerf": "score de desempenho por validador (produtividade, slots perdidos, latência, status)",
        "governance": "parâmetros governáveis e propostas em votação",
        "governanceAdvisories": "propostas que a IA redige quando um parâmetro sai do saudável (propose-only)",
        "treasury": "saldo e percentual da tesouraria on-chain",
        "bridgeTransfers": "transferências da ponte cross-chain",
        "aiTasks": "tarefas da camada de IA (ou /ai/oracles para os oráculos)",
        "securityAlerts": "pareceres da sentinela de segurança 24h",
        "gateway": "estado do balanceador/failover de leitura do gateway",
        "guard": "bloqueios de IP abusivo ativos (auto-mitigação com TTL)",
        "stats": "agregados 24h: volume, série de tx, holders"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "rede customizada"
      },
      "title": "Use a EAV7 na sua carteira",
      "description": "A EAV7 fala o dialeto JSON-RPC que carteiras universais entendem — adicione a rede em um clique.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "qualquer carteira EVM"
      },
      "params": {
        "networkName": "Nome da rede",
        "rpcUrl": "URL do RPC",
        "chainId": "Chain ID",
        "symbol": "Símbolo",
        "explorer": "Explorer",
        "decimals": "Decimais"
      },
      "button": {
        "adding": "Adicionando…",
        "addToMetamask": "Adicionar à MetaMask",
        "addToTrust": "Adicionar na Trust Wallet",
        "openInMetamask": "Abrir na MetaMask"
      },
      "status": {
        "added": "rede adicionada!",
        "noWallet": "MetaMask não detectada — copie os dados ao lado.",
        "mobileHint": "No celular: abra pelo app da carteira para adicionar a rede.",
        "addManually": "Se falhar, adicione manualmente com os dados acima (rede customizada).",
        "otherWallets": "Usa outra carteira (Trust, etc.)? Adicione manualmente com os dados acima (rede customizada)."
      },
      "error": {
        "addFailed": "Não foi possível adicionar a rede.",
        "userRejected": "Você cancelou a operação na carteira."
      },
      "mapping": {
        "badge": "mesma conta",
        "title": "Duas identidades, uma conta",
        "labelEavm": "EAVM",
        "labelNative": "nativo",
        "desc1": "A MetaMask exibe o",
        "desc2": "; on-chain o saldo vive no",
        "desc3": "correspondente. São a mesma conta."
      },
      "steps": {
        "step1": "Clique em adicionar a rede EAV7",
        "step2": "Sua conta aparece como 0x… na carteira",
        "step3": "On-chain o saldo vive no E7 correspondente"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "tempo de bloco",
        "stat_validators_value": "até 27",
        "stat_validators_label": "validadores DPoS",
        "stat_supply_value": "100 bi",
        "stat_supply_label": "suprimento EAV7",
        "stat_reward_label": "EAV7 por bloco",
        "stat_quantum_value": "híbrida",
        "stat_quantum_label": "pós-quântica",
        "pillars_title": "pilares do protocolo",
        "pillar_consensus": "Consenso DPoS",
        "pillar_token_standard": "Padrão EAV20",
        "pillar_bridge": "Ponte cross-chain",
        "pillar_security": "Segurança & IA",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "padrão EAV20",
        "title": "Tokens nativos, sem máquina virtual",
        "description": "Equivalente ao TRC20: os tokens vivem direto no estado da cadeia e se movem por transações assinadas — rápido, barato e verificável.",
        "cta": "Ver tokens da rede"
      },
      "consenso": {
        "badge": "consenso DPoS",
        "title": "Um bloco novo a cada segundo",
        "description": "Os validadores se revezam por rodízio: a cada slot de 1s, um produtor esperado assina o próximo bloco. Sem grinding, sem espera.",
        "slot_now": "slot agora",
        "slot_offset": "slot +{n}",
        "fact_election_label": "Eleição",
        "fact_election_value": "27 maiores por peso (stake + votos, ≥ 1.000 EAV7)",
        "fact_production_label": "Produção",
        "fact_production_value": "validators[slot % N] · round-robin",
        "fact_fork_choice_label": "Fork choice",
        "fact_fork_choice_value": "cadeia válida mais longa",
        "cta": "Ver validadores ao vivo"
      },
      "ponte": {
        "title": "Como a ponte move valor entre redes",
        "arrow_pays": "paga",
        "node_external": "Rede externa",
        "step_bridge_out": "trava EAV7/token e registra o destino externo",
        "step_relayer": "observa a saída e paga na cadeia externa",
        "step_bridge_settle": "marca a saída como paga on-chain (idempotente)",
        "step_bridge_in": "libera fundos mediante prova do comitê de origem (quórum M-de-N), dedupe por sourceTxHash"
      },
      "seguranca": {
        "badge_hybrid": "assinatura híbrida",
        "title_hybrid": "Pós-quântica por design",
        "verify_both": "verificação exige as duas",
        "hybrid_description": "Toda carteira, transação e bloco carrega as duas assinaturas — ECDSA (maturidade) e ML-DSA-44 (FIPS 204, resistente a quântico). Forjar exigiria quebrar as duas primitivas ao mesmo tempo.",
        "badge_ai": "camada de IA",
        "title_ai": "Camada de IA em 6 fases",
        "sentinel_title": "Sentinela de segurança · 24h",
        "sentinel_description": "Um processo monitora a rede continuamente — reorganizações e rollbacks, transferências gigantes, rajadas, mempool, concentração de produtores, saúde de validadores e recomendações de governança — gravando pareceres no feed de segurança.",
        "sentinel_cta": "Ver na mineração",
        "phase1": "reputação",
        "phase2": "quórum",
        "phase3": "desafio + júri",
        "phase4": "marketplace",
        "phase5": "privado",
        "phase6": "atestação TEE/zk",
        "ai_description": "Oráculos on-chain que evoluem em 6 fases: da reputação e do quórum com commit-reveal à janela de desafio com júri, ao marketplace por leilão reverso, aos resultados privados por hash e à atestação TEE/zk que liquida na hora como verificado."
      },
      "staking": {
        "tier_fee_title": "Taxa zero",
        "tier_fee_desc": "Trave 100+ EAV7 e suas transações passam a ter taxa zero — a energia (bandwidth) é gerada pelo freeze e regenera com o tempo.",
        "tier_mine_title": "Minere blocos",
        "tier_mine_desc": "Trave 1.000+ EAV7 e entre na eleição DPoS. Ao produzir um bloco você recebe 16 EAV7 + as taxas do bloco, integralmente.",
        "reward_title": "Recompensa e unstake",
        "reward_desc": "A recompensa vai integralmente ao produtor do bloco. O unstake libera o valor de volta ao saldo — só não é permitido esvaziar o último validador da rede.",
        "cta_lock": "Travar EAV7",
        "cta_mining": "Ver mineração"
      },
      "tier_mine_desc": "Trave 1.000+ EAV7 e entre na eleição DPoS. Ao produzir um bloco, o produtor fica com a comissão (padrão 20%) e o restante é partilhado com os eleitores — sem votos, leva os 16 EAV7 + taxas por inteiro."
    },
    "energyGauge": {
      "ariaLabel": "Energia {available} de {max}",
      "title": "Energia",
      "description": "Recurso que cobre o custo das transações. Regenera com o tempo e cresce com EAV7 travado em stake."
    },
    "home_activityBars": {
      "ariaLabel": "Transações por bloco",
      "txsCount": "{n} txs"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "Visão geral",
        "blocks": "Blocos",
        "transactions": "Transações",
        "validators": "Validadores",
        "tokens": "Tokens"
      },
      "cols": {
        "block": "Bloco",
        "age": "Idade",
        "txs": "Txs",
        "producer": "Produtor",
        "reward": "Recompensa",
        "hash": "Hash"
      },
      "sidebar": {
        "explore": "Explorar",
        "network": "Rede"
      },
      "toolbar": {
        "filter": "Filtrar",
        "sort": "Ordenar",
        "live": "ao vivo"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "explorar",
      "title": "Tudo on-chain, em tempo real",
      "description": "Blocos e transações fluindo agora mesmo. Clique em qualquer item para investigar.",
      "viewBlocks": "Ver blocos",
      "viewTxs": "Ver transações"
    },
    "home_heartbeat": {
      "label": "batimento",
      "blockAgoPrefix": "bloco há",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} txs",
      "viewAll": "ver todos"
    },
    "home_hero": {
      "coin_alt": "Moeda EAV7",
      "title": "A nova era do explorador on-chain",
      "subtitle": "Blocos a cada 1 segundo, segurança pós-quântica e uma camada nativa de IA. Investigue blocos, transações, validadores e endereços em tempo real.",
      "search_placeholder": "Buscar bloco, transação ou endereço…",
      "search_button": "Explorar",
      "stat_height": "Altura",
      "stat_block": "Bloco",
      "stat_validators": "Validadores",
      "stat_mempool": "Mempool"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "Moeda EAV7",
        "titleBefore": "A blockchain EAV7, e",
        "titleHighlight": "além",
        "subtitle": "Consenso DPoS de 1 segundo, segurança pós-quântica e uma camada nativa de IA. Explore blocos, transações e validadores em tempo real.",
        "exploreNetwork": "Explorar a rede",
        "openWallet": "Abrir carteira",
        "scrollAriaLabel": "Rolar para o painel"
      },
      "vitals": {
        "height": "Altura",
        "blockTime": "Bloco",
        "validators": "Validadores"
      }
    },
    "home_inkBand": {
      "eyebrow": "interativo",
      "title": "Passe o mouse e revele",
      "subtitle": "a rede EAV7, além do bloco",
      "mobileHint": "no celular a arte aparece direto"
    },
    "home_latestTxs": {
      "title": "Últimas transações",
      "viewAll": "ver todas",
      "table": {
        "hash": "Hash",
        "type": "Tipo",
        "fromTo": "De → Para",
        "value": "Valor"
      },
      "empty": "nenhuma transação ainda"
    },
    "home_moments": {
      "sectionEyebrow": "por dentro do protocolo",
      "sectionTitle": "Uma L1 construída para durar",
      "items": {
        "security": {
          "eyebrow": "segurança",
          "titlePrefix": "Pronta para a era",
          "titleHighlight": "pós-quântica",
          "desc": "Cada carteira, transação e bloco carrega duas assinaturas — e a verificação exige as duas. Forjar exigiria quebrar as duas primitivas ao mesmo tempo.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "Endereço E7 derivado por SHA3-256"
        },
        "consensus": {
          "eyebrow": "consenso",
          "titlePrefix": "Um bloco a cada",
          "titleHighlight": "1 segundo",
          "desc": "Consenso DPoS com até 27 validadores (governável, teto 101) eleitos por peso (stake + votos), em rodízio determinístico — 3× mais rápido que a Tron, com liveness protegida.",
          "bullet1": "até 27 validadores (governável) · round-robin",
          "bullet2": "16 EAV7 de recompensa por bloco"
        },
        "intelligence": {
          "eyebrow": "inteligência",
          "titlePrefix": "Uma camada",
          "titleHighlight": "nativa de IA",
          "desc": "Oráculos on-chain em 6 fases: reputação e slashing, quórum com commit-reveal, janela de desafio com júri, marketplace por leilão reverso, resultados privados por hash e atestação TEE/zk que liquida na hora.",
          "bullet1": "quórum commit-reveal · desafio + júri · marketplace",
          "bullet2": "resultados atestados TEE/zk (verified)"
        },
        "assets": {
          "eyebrow": "ativos",
          "titlePrefix": "Tokens",
          "titleHighlight": "EAV20",
          "titleSuffix": "e ponte cross-chain",
          "desc": "Crie e mova tokens nativos (equivalentes ao TRC20) e conecte a EAV7 a outras redes por um modelo lock-and-release seguro e idempotente.",
          "bullet1": "Padrão EAV20 · create / transfer / approve",
          "bullet2": "Ponte TRON · ETH · BTC (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "tempo real",
      "title": "O pulso da rede",
      "subtitle": "A cada segundo um novo bloco. Acompanhe a rede EAV7 batendo em tempo real.",
      "stats": {
        "blockHeight": "Altura do bloco",
        "txLast30": "Txs · últimos 30 blocos",
        "mempool": "Mempool",
        "rewardPerBlock": "EAV7 / bloco"
      },
      "activity": {
        "title": "Atividade da rede",
        "txInLastBlocks": "transações nos últimos {n} blocos"
      },
      "slots": {
        "title": "Slots DPoS",
        "activeValidators": "validadores ativos",
        "supply": "supply {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "Total de contas"
        },
        "transactions": {
          "label": "Total de transações"
        },
        "volume": {
          "label": "Volume transferido"
        },
        "staked": {
          "label": "Total em stake"
        }
      },
      "ring": {
        "supplyLine1": "do supply",
        "supplyLine2": "travado em stake"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} de {max}"
    },
    "home_walletCta": {
      "eyebrow": "comece agora",
      "title": "Explore a rede EAV7 agora",
      "description": "Sua carteira é gerada e assinada no navegador com proteção pós-quântica — nunca sai do seu dispositivo. Envie, faça stake e minere direto pela web.",
      "createWallet": "Criar carteira",
      "exploreNetwork": "Explorar a rede"
    },
    "mining_live": {
      "badge_consensus": "DPoS · staking",
      "title": "Mineração",
      "live_badge": "ao vivo",
      "subtitle": "na EAV7 você minera travando EAV7 (stake) — sem hardware, sem gasto de energia",
      "stat_reward_block": "Recompensa / bloco",
      "stat_blocks_day": "Blocos / dia",
      "stat_daily_emission": "Emissão diária",
      "stat_already_mined": "Já minerado",
      "network_production": "produção da rede",
      "reward_per_block_caption": "recompensa a cada bloco (1s)",
      "annual_emission_caption": "emissão anual estimada",
      "next_block": "próximo bloco",
      "miners_label": "mineradores",
      "staked_label": "EAV7 travados",
      "block_time_label": "tempo de bloco",
      "ai_sentinel_badge": "sentinela de IA · 24h",
      "network_protected": "Rede protegida",
      "ai_monitoring_desc": "monitoramento contínuo por IA nativa",
      "alerts_analyzed": "alertas analisados",
      "active_oracles": "oráculos ativos",
      "pending_ai_tasks": "tarefas de IA pendentes",
      "cta_title": "Comece a minerar EAV7",
      "cta_description": "Trave EAV7 na sua carteira para virar minerador do consenso DPoS e receber recompensas a cada bloco produzido. Tudo self-custodial, com assinatura pós-quântica no navegador.",
      "cta_lock_button": "Travar EAV7",
      "cta_view_validators": "Ver validadores"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "Buscar",
      "dica": "bloco (número) · transação (E7…) · endereço (E7… ou 0x…)"
    },
    "netStatus": {
      "onlineTitle": "Rede EAV7 online · altura {height}",
      "offlineTitle": "Nó offline",
      "connecting": "conectando…"
    },
    "page_address": {
      "metaTitle": "Endereço {addr}… · EAV7 Scan",
      "eyebrow": "endereço",
      "title": "Endereço",
      "roleValidator": "Validador",
      "roleOracle": "Oráculo",
      "roleAccount": "Conta",
      "balance": "Saldo",
      "staked": "em stake",
      "nonce": "nonce",
      "feeExempt": "taxa zero",
      "available": "Disponível",
      "max": "máx {n}",
      "tokensTitle": "Tokens EAV20",
      "colToken": "Token",
      "colSymbol": "Símbolo",
      "colBalance": "Saldo",
      "txsTitle": "Transações",
      "colHash": "Hash",
      "colBlock": "Bloco",
      "colType": "Tipo",
      "colCounterparty": "Contraparte",
      "colValue": "Valor",
      "colDate": "Data",
      "out": "saída",
      "in": "entrada",
      "noTxs": "nenhuma transação para este endereço",
      "totalBalance": "saldo total: {n}",
      "nftsTitle": "NFTs (EAV721)",
      "colNftCollection": "Coleção",
      "colNftId": "Token",
      "namesTitle": "Nomes EAV-NS",
      "colNsName": "Nome",
      "colNsTarget": "Resolve para",
      "votesLabel": "Votos recebidos",
      "commissionLabel": "Comissão",
      "tabOverview": "Visão geral",
      "tabTransfers": "Transferências",
      "tabInternal": "Transferências internas",
      "tabStaking": "Staking e recursos",
      "tabContract": "Contrato",
      "tabPermissions": "Permissões",
      "tabAnalysis": "Análise",
      "internalNote": "Valor movido pela execução de um contrato. Não é uma transação assinada — por isso não tem hash próprio.",
      "internalEmpty": "nenhuma transferência interna",
      "colFrom": "De",
      "colTo": "Para",
      "colTx": "Transação",
      "stakingTitle": "Stake e recursos",
      "bandwidth": "Largura de banda",
      "energy": "Energia",
      "delegatedOut": "Delegado a terceiros",
      "delegatedIn": "Recebido em delegação",
      "unbondingTitle": "Em desbloqueio",
      "matureIn": "libera em {n} blocos",
      "votesCastTitle": "Votos emitidos",
      "votesReceived": "Votos recebidos",
      "vestingTitle": "Vesting",
      "permsNone": "conta de chave única — sem multi-assinatura",
      "permsThreshold": "Limiar",
      "colWeight": "Peso",
      "colKey": "Chave",
      "contractNone": "este endereço não é um contrato",
      "contractCodeSize": "Tamanho do código",
      "contractVerified": "Verificado",
      "contractUnverified": "Não verificado",
      "sent": "Enviado",
      "received": "Recebido",
      "feesPaid": "Taxas pagas",
      "txCount": "Transações",
      "firstSeen": "Primeira atividade",
      "lastSeen": "Última atividade",
      "byType": "Por tipo",
      "topCounterparties": "Principais contrapartes",
      "truncatedNote": "amostra limitada às transações mais recentes",
      "noData": "sem dados",
      "accountInfo": "Informações da conta",
      "accountType": "Tipo de conta",
      "createdAt": "Criada em",
      "totalTxs": "Total de transações",
      "tabTokenTx": "Transferências de token",
      "tokenTxEmpty": "nenhuma transferência de token",
      "roleContract": "Contrato",
      "roleMultisig": "Multi-assinatura",
      "holdings": "Participações",
      "colAsset": "Ativo",
      "assets": "Ativos",
      "transfersRow": "Transferências",
      "votesRow": "Votos",
      "claimable": "Recompensas resgatáveis",
      "tabApprovals": "Aprovações",
      "searchHoldings": "Buscar por nome, símbolo ou endereço…",
      "noHoldings": "nada aqui",
      "colSpender": "Autorizado",
      "colLimit": "Limite",
      "more": "Ver mais",
      "tabTokens": "Tokens",
      "tabTransactions": "Transações",
      "colAge": "Idade",
      "colResult": "Resultado",
      "resultOk": "Sucesso",
      "resultRevert": "Revertida",
      "summaryTx": "Total de {n} transações",
      "summaryTransfers": "Total de {n} transferências",
      "summaryInternal": "Total de {n} transferências internas",
      "filterAll": "Todos",
      "filterIn": "Entrada",
      "filterOut": "Saída",
      "summaryTokenTx": "Total de {n} transferências de token",
      "colParentHash": "Hash pai",
      "colResourceAmount": "Quantidade de recurso",
      "colStakedAmount": "EAV7 em stake",
      "colUpdatedAt": "Atualizado em",
      "stakeNote": "Na EAV7 um único stake concede energia E largura de banda ao mesmo tempo — não se escolhe um recurso, como na TRON.",
      "permsOperations": "Operações",
      "thisAccount": "esta conta",
      "summaryContracts": "Total de {n} contratos",
      "permsNote": "Na EAV7 o conjunto de operações vale para qualquer conta multisig — não há escopo por permissão como na TRON.",
      "permsDefault": "padrão",
      "permsDefaultNote": "Nenhuma multi-assinatura configurada. Esta é a autorização efetiva da conta: uma chave, uma assinatura."
    },
    "page_block": {
      "metaTitle": "Bloco #{height} · EAV7 Scan",
      "eyebrow": "bloco",
      "title": "Bloco #{height}",
      "sub": "{ago} atrás",
      "kv": {
        "height": "Altura",
        "date": "Data",
        "producer": "Produtor",
        "previousHash": "Hash anterior",
        "merkleRoot": "Merkle root (txs)",
        "txCount": "Transações",
        "protocol": "Protocolo",
        "scheme": "esquema",
        "finality": "Finalidade"
      },
      "txSectionTitle": "Transações do bloco",
      "table": {
        "hash": "Hash",
        "type": "Tipo",
        "from": "De",
        "to": "Para",
        "value": "Valor",
        "fee": "Taxa"
      },
      "emptyBlock": "bloco vazio",
      "finalized": "finalizado",
      "pending": "pendente"
    },
    "page_docs": {
      "metaTitleFallback": "Documentação · EAV7 Scan",
      "breadcrumb": "documentação",
      "terminal": "terminal",
      "onThisPage": "nesta página"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "Mineração · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "Esta página não existe na cadeia EAV7.",
      "backLink": "← voltar ao início"
    },
    "page_search": {
      "metaTitle": "Busca · EAV7 Scan",
      "title": "Nada encontrado",
      "notRecognizedPrefix": "Não reconhecemos",
      "notRecognizedSuffix": "como bloco, transação ou endereço EAV7.",
      "retryPlaceholder": "Tente novamente…",
      "whatCanSearch": "o que dá pra buscar",
      "blockLabel": "bloco",
      "blockDesc": "número da altura, ex.",
      "txLabel": "transação",
      "txDesc": "hash",
      "txChars": "(64 caracteres)",
      "addressLabel": "endereço",
      "addressLen34": "(34) ou",
      "or": "ou",
      "evmLabel": "(EAVM)",
      "backHome": "← voltar ao início"
    },
    "page_token": {
      "eyebrow": "Token EAV20",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "Token · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "Padrão",
      "mintable": "emissão aberta",
      "fixedSupply": "supply fixo",
      "paused": "pausado",
      "tabTransfers": "Transferências",
      "tabHolders": "Holders",
      "tabAnalysis": "Análise",
      "totalSupply": "Suprimento total",
      "holders": "Holders",
      "decimals": "Casas decimais",
      "status": "Situação",
      "statusActive": "Ativo",
      "statusPaused": "Pausado",
      "createdAt": "Criado em",
      "contract": "Contrato",
      "creator": "Criador",
      "owner": "Administrador",
      "mintableLabel": "Permite emitir mais",
      "yes": "sim",
      "no": "não",
      "summaryTransfers": "Total de {n} transferências",
      "summaryHolders": "{n} holders no total — exibindo os {shown} maiores",
      "colHash": "Hash",
      "colBlock": "Bloco",
      "colAge": "Idade",
      "colFrom": "De",
      "colTo": "Para",
      "colAmount": "Valor ({symbol})",
      "colRank": "#",
      "colAddress": "Endereço",
      "colBalance": "Saldo ({symbol})",
      "colShare": "Participação",
      "blacklisted": "bloqueado",
      "noTransfers": "Nenhuma transferência encontrada.",
      "noHolders": "Nenhum holder encontrado.",
      "top1": "Maior holder",
      "top10": "Top 10",
      "top50": "Top 50",
      "concentrationTitle": "Concentração de supply",
      "concentrationNote": "Quanto do suprimento está nas maiores carteiras. Um supply grande em poucas mãos tem risco de mercado diferente de um supply pulverizado — por isso a distribuição vale mais que o número total.",
      "largestHolder": "Maior holder:",
      "overviewTitle": "Visão geral",
      "basicInfoTitle": "Informações do contrato",
      "activityTitle": "Distribuição",
      "largestHolderShort": "Maior holder",
      "tabContract": "Contrato",
      "nativeTitle": "Token nativo do protocolo",
      "nativeBadge": "sem código arbitrário",
      "nativeNote": "Este token não é um contrato inteligente: ele é implementado pelo próprio protocolo. Não há Solidity, compilador nem bytecode para verificar — e também não há lógica oculta que alguém possa ter escrito. O comportamento é idêntico para todo token EAV20 e só muda por hard fork da rede.",
      "implementation": "Implementação",
      "implementationValue": "Nativa do consenso (padrão EAV20)",
      "sourceOfTruth": "Código do protocolo",
      "powersTitle": "O que o administrador pode fazer",
      "powersNote": "Num explorer de EVM você leria o código-fonte para descobrir isto. Aqui são campos de estado, então listamos direto. É o que realmente importa antes de confiar num token.",
      "powerMint": "Emitir mais unidades",
      "powerMintNote": "Aumenta o suprimento total e dilui quem já tem.",
      "powerPause": "Pausar transferências",
      "powerPauseNote": "Congela toda a movimentação do token de uma vez.",
      "powerBlacklist": "Bloquear endereços",
      "powerBlacklistNote": "Impede um endereço específico de enviar ou receber.",
      "powerFreeze": "Congelar saldo",
      "powerFreezeNote": "Trava parte do saldo de um endereço até uma data.",
      "powerYes": "pode",
      "powerNo": "não pode",
      "powerActiveNow": "ativo agora",
      "adminIs": "Administrador:",
      "restrictionsTitle": "Restrições em vigor",
      "frozenUntil": "até {when}"
    },
    "page_tx": {
      "metaTitle": "Transação {id}… · EAV7 Scan",
      "eyebrow": "transação",
      "title": "Transação",
      "status": "Status",
      "type": "Tipo",
      "block": "Bloco",
      "from": "De",
      "to": "Para",
      "value": "Valor",
      "fee": "Taxa",
      "nonce": "Nonce",
      "date": "Data",
      "scheme": "Esquema",
      "eavmLayer": "Camada EAVM (MetaMask)",
      "energy": "Energia",
      "energyUnit": "energia",
      "details": "Dados da transação"
    },
    "page_txs": {
      "metaTitle": "Transações · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "padrão EAV20",
        "title": "Tokens",
        "subtitle": "ativos nativos do protocolo eav20 — equivalente ao TRC20 da Tron"
      },
      "empty": {
        "title": "Nenhum token criado ainda",
        "description": "Tokens aparecem aqui assim que forem criados na rede via"
      },
      "stats": {
        "tokens": "Tokens EAV20",
        "holders": "Holders (total)",
        "supply": "Suprimento combinado",
        "standard": "Padrão"
      },
      "card": {
        "supply": "Suprimento",
        "holders": "Holders",
        "share": "participação",
        "creator": "criador"
      }
    },
    "txs_live": {
      "chainLabel": "cadeia eav20",
      "title": "Transações",
      "live": "ao vivo",
      "subtitleLive": "mais recentes primeiro · valores em EAV7",
      "subtitleOlder": "transações mais antigas · valores em EAV7",
      "searchPlaceholder": "Buscar tx, bloco ou endereço…",
      "cols": {
        "hash": "Hash",
        "block": "Bloco",
        "type": "Tipo",
        "from": "De",
        "to": "Para",
        "value": "Valor",
        "age": "Idade"
      },
      "stats": {
        "totalTx": "Total de transações",
        "mempool": "Na mempool",
        "volume": "Volume (EAV7)",
        "avgFee": "Taxa média"
      },
      "table": {
        "latest": "Últimas transações",
        "older": "Transações anteriores",
        "updating": "atualizando",
        "empty": "nenhuma transação encontrada",
        "count": "{n} transações",
        "loadMore": "Carregar mais antigas →",
        "genesis": "início da cadeia"
      }
    },
    "ui_copy": {
      "default_value": "valor",
      "aria_label": "Copiar {label}",
      "copied": "copiado ✓",
      "copy_label": "copiar {label}",
      "copy": "copiar"
    },
    "ui_explorerSearch": {
      "placeholder": "Buscar bloco, tx ou endereço…",
      "searchButton": "Buscar"
    },
    "validators_live": {
      "unavailable": "nó indisponível",
      "header": {
        "eyebrow": "consenso DPoS",
        "title": "Validadores",
        "live": "ao vivo",
        "subtitle": "{active} ativos de {max} slots · stake mínimo {min} EAV7 · rodízio a cada bloco"
      },
      "producer": {
        "label": "produtor do slot atual",
        "producingBlock": "produzindo o bloco"
      },
      "slot": {
        "label": "slot · {n}s",
        "staked": "{n} EAV7 em stake"
      },
      "rotation": {
        "label": "rodízio de produção"
      },
      "stats": {
        "activeValidators": "Validadores ativos",
        "rewardPerBlock": "Recompensa / bloco",
        "totalStaked": "Total em stake",
        "peers": "Peers na rede"
      },
      "ranking": {
        "title": "Conjunto ativo",
        "sortedBy": "ordenado por peso (stake + votos)",
        "producing": "produzindo",
        "active": "ativo",
        "stakedCaption": "EAV7 em stake",
        "votesCaption": "votos"
      },
      "health": {
        "summary": "saúde média {avg}/100 · {degraded} degradado(s)",
        "degradedBanner": "{n} validador(es) com desempenho degradado — a IA redigiu recomendação de governança (não executada; só a governança decide).",
        "status": {
          "healthy": "saudável",
          "lagging": "lento",
          "degraded": "degradado",
          "offline": "offline"
        }
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "segura"
      },
      "role": {
        "validator": "Validador",
        "oracle": "Oráculo",
        "account": "Conta EAV7"
      },
      "lock": {
        "button": "bloquear"
      },
      "balance": {
        "label": "saldo disponível"
      },
      "tier": {
        "validator": "Validador",
        "fee_zero": "Taxa zero",
        "standard": "Padrão"
      },
      "actions": {
        "send": "Enviar",
        "receive": "Receber",
        "stake": "Stake"
      },
      "stats": {
        "staked": "Em stake",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "Taxa",
        "fee_zero": "zero",
        "fee_standard": "padrão"
      },
      "tier_progress": {
        "label": "progresso do tier",
        "remaining_prefix": "faltam",
        "remaining_suffix": "para o tier {tier}"
      },
      "receive": {
        "title": "Receber EAV7",
        "description_before": "Compartilhe seu endereço",
        "description_after": "— a rede mapeia para o seu E7 nativo automaticamente.",
        "close": "fechar"
      },
      "activity": {
        "title": "Atividade recente",
        "sent": "Enviado",
        "received": "Recebido"
      },
      "addresses": {
        "hint": "use este 0x para receber (padrão EAVM/MetaMask)"
      },
      "tokens": {
        "title": "Tokens EAV20"
      },
      "footer": {
        "quantum": "pós-quântica · secp256k1 + ML-DSA-44",
        "logout": "sair / trocar"
      },
      "wipe": {
        "title": "Apagar esta carteira?",
        "description_before": "A carteira cifrada será removida",
        "description_bold": "deste navegador",
        "description_after": ". Você só consegue restaurar com o backup da chave privada — não há recuperação de senha.",
        "warning_before": "Confirme que você tem o",
        "warning_bold": "backup da chave",
        "warning_after": "antes de apagar.",
        "download_backup": "Baixar backup (.json)",
        "cancel": "Cancelar",
        "confirm": "Apagar carteira"
      },
      "faucet": {
        "button": "Pegar 100 EAV7 de teste",
        "loading": "Solicitando…",
        "ok": "100 EAV7 de teste enviados!",
        "error": "Falha no faucet"
      }
    },
    "wallet_addNet": {
      "title": "Usar na MetaMask / Trust",
      "description": "Adicione a rede EAV7 (chain 72020) na sua carteira EVM.",
      "adding": "adicionando…",
      "added": "✓ adicionada",
      "addButton": "Adicionar rede",
      "noWallet": "MetaMask não detectada neste navegador.",
      "error": "não foi possível adicionar a rede."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "só você controla",
        "on_device_title": "no dispositivo",
        "on_device_desc": "a chave nunca sai",
        "quantum_title": "pós-quântica",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "Backup",
        "password": "Senha",
        "ready": "Pronto"
      },
      "unlock": {
        "title": "Bem-vindo de volta",
        "subtitle": "Há uma carteira cifrada neste navegador. Informe a senha para desbloquear.",
        "password_placeholder": "senha",
        "error_wrong_password": "senha incorreta",
        "unlocking": "desbloqueando…",
        "unlock_button": "Desbloquear carteira",
        "wipe_confirm": "Apagar a carteira deste navegador? Tenha o backup da chave!",
        "wipe_button": "apagar e começar de novo"
      },
      "choose": {
        "title": "Sua carteira EAV7",
        "subtitle": "Uma carteira self-custodial: você é o único dono das suas chaves. Comece em segundos.",
        "create_title": "Criar nova carteira",
        "create_desc": "Gera uma chave nova neste dispositivo.",
        "import_title": "Importar chave",
        "import_desc": "Já tem uma chave privada? Restaure aqui."
      },
      "import": {
        "title": "Importar carteira",
        "subtitle": "Cole a chave privada e escolha uma senha para cifrá-la neste navegador.",
        "label": "Chave privada (0x + 64 hex)",
        "importing": "importando…",
        "button": "Importar",
        "back": "Voltar",
        "error_invalid_key": "chave privada inválida (esperado 0x + 64 hex)"
      },
      "create": {
        "title": "Faça o backup da sua chave",
        "subtitle": "Não há recuperação de senha. Quem tem a chave privada controla os fundos — guarde-a antes de continuar.",
        "warning_prefix": "Esta chave ",
        "warning_bold": "é a única forma",
        "warning_suffix": " de acessar seus fundos. Salve-a offline — nunca compartilhe com ninguém.",
        "address_label": "endereço E7",
        "private_key_label": "chave privada",
        "reveal": "revelar",
        "hide": "ocultar",
        "download_backup": "⭳ Baixar backup (.json)",
        "confirm_saved": "Guardei minha chave em local seguro",
        "creating": "criando…",
        "create_button": "Criar carteira",
        "confirm_hint": "confirme que guardou a chave",
        "back": "Voltar"
      },
      "errors": {
        "password_min": "a senha precisa de ao menos 6 caracteres",
        "password_mismatch": "as senhas não conferem",
        "save_error": "erro ao salvar"
      },
      "password": {
        "label": "Senha para cifrar (mín. 6 caracteres)",
        "placeholder": "senha",
        "confirm_placeholder": "confirmar senha",
        "mismatch": "as senhas não conferem",
        "strength": {
          "very_weak": "muito fraca",
          "weak": "fraca",
          "fair": "razoável",
          "good": "boa",
          "strong": "forte"
        }
      }
    },
    "wallet_send": {
      "title": "Enviar EAV7",
      "steps": {
        "destination": "Destino",
        "value": "Valor",
        "review": "Revisar"
      },
      "recipient": {
        "label": "Destino (0x… EAVM/MetaMask)",
        "paste": "colar",
        "valid": "✓ endereço válido",
        "invalid": "endereço 0x inválido"
      },
      "errors": {
        "needEvmAddress": "informe o 0x do destino (a carteira web assina no modelo EAVM)",
        "invalidAddress": "destino deve ser um endereço 0x (EAVM/MetaMask)",
        "needPositiveAmount": "informe um valor positivo",
        "insufficientBalance": "saldo insuficiente (considere a taxa)",
        "invalidAmount": "valor inválido",
        "sendFailed": "falha ao enviar"
      },
      "continue": "Continuar",
      "cancel": "Cancelar",
      "available": "disponível: {amount} EAV7",
      "percent": {
        "max": "MÁX"
      },
      "back": "Voltar",
      "sendingLabel": "enviando",
      "sendingTo": "para {addr}",
      "networkFee": "Taxa de rede",
      "balanceAfter": "Saldo depois",
      "quantumNote": "assinado neste dispositivo · proteção pós-quântica da rede",
      "confirmAndSign": "Confirmar e assinar",
      "signing": "assinando…",
      "transactionSent": {
        "title": "Transação enviada",
        "subtitle": "Confirma no próximo bloco (~1s)."
      },
      "close": "fechar"
    },
    "wallet_stake": {
      "title": "Stake",
      "subtitle": "≥ 100 EAV7 zera taxas · ≥ 1.000 vira minerador (16 EAV7/bloco produzido).",
      "tierZeroFee": {
        "label": "Taxa zero",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "Validador",
        "sub": "≥ 1.000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "em stake agora:",
      "warnValidator": "Isto derruba seu stake abaixo de 1.000 — você perde o status de validador.",
      "warnFeeReset": "Isto derruba seu stake abaixo de 100 — suas transações voltam a pagar taxa.",
      "warnConfirm": "entendi, remover mesmo assim →",
      "errInvalidAmount": "informe um valor positivo",
      "errInvalidValue": "valor inválido",
      "errFailedOp": "falha na operação",
      "sentTitle": "Operação enviada",
      "close": "fechar",
      "stakeBtn": "Fazer stake",
      "removeBtn": "Remover"
    }
  },
  "en": {
    "blocks_live": {
      "networkLabel": "eav20 chain",
      "title": "Blocks",
      "live": "live",
      "blockTimeInfo": "a new block every {n}s · DPoS consensus",
      "searchPlaceholder": "Search block by height or hash…",
      "stats": {
        "height": "Current height",
        "blockTime": "Block time",
        "avgTx": "Txs / block (avg.)",
        "activeProducers": "Active producers"
      },
      "latestBlocks": "Latest blocks",
      "updating": "updating",
      "columns": {
        "block": "Block",
        "age": "Age",
        "txs": "Txs",
        "producer": "Producer",
        "reward": "Reward",
        "hash": "Hash"
      }
    },
    "comingSoon": {
      "badge": "under construction · sprint 4",
      "backToExplorer": "← back to explorer"
    },
    "docs_api": {
      "badge": "Public API",
      "title": "Query the network straight from the node",
      "baseUrl": "base URL",
      "tags": {
        "cors": "CORS enabled",
        "units": "values in e7",
        "noAuth": "no authentication"
      },
      "groups": {
        "read": "read",
        "write": "write"
      },
      "endpoints": {
        "status": "network state: height, finalized height (BFT), treasury, validators, block reward",
        "blocks": "latest N blocks",
        "blockByHeight": "a block by height or hash",
        "txs": "recent transactions, paginated",
        "tx": "a transaction by id",
        "address": "balance, stake, nonce, role, tokens and energy",
        "tokens": "list of EAV20 tokens (or /tokens/:id for detail)",
        "validators": "active DPoS set (weight = stake + votes) + slot producer",
        "sendTx": "sends a signed native transaction (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "sends a transaction via the EAVM layer (JSON-RPC compatible)",
        "addressTxs": "transactions for an address, paginated",
        "proof": "account proof (Merkle) against the stateRoot — light clients",
        "name": "resolve an EAV-NS name → E7 address",
        "logs": "EAVM events/logs (filter by address and topic)",
        "contract": "verification metadata for an EAVM contract",
        "verifyContract": "verify a contract: bytecode must match the on-chain code",
        "nfts": "EAV721 NFT collections (or /nfts/:id for detail)",
        "names": "registered EAV-NS names",
        "validatorsPerf": "per-validator performance score (productivity, missed slots, latency, status)",
        "governance": "governable params and open proposals",
        "governanceAdvisories": "proposals the AI drafts when a param drifts out of a healthy range (propose-only)",
        "treasury": "on-chain treasury balance and cut",
        "bridgeTransfers": "cross-chain bridge transfers",
        "aiTasks": "AI-layer tasks (or /ai/oracles for the oracles)",
        "securityAlerts": "24/7 security sentinel alerts",
        "gateway": "read gateway load-balancer/failover state",
        "guard": "active abusive-IP blocks (auto-mitigation with TTL)",
        "stats": "24h aggregates: volume, tx series, holders"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "custom network"
      },
      "title": "Use EAV7 in your wallet",
      "description": "EAV7 speaks the JSON-RPC dialect that universal wallets understand — add the network in one click.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "any EVM wallet"
      },
      "params": {
        "networkName": "Network name",
        "rpcUrl": "RPC URL",
        "chainId": "Chain ID",
        "symbol": "Symbol",
        "explorer": "Explorer",
        "decimals": "Decimals"
      },
      "button": {
        "adding": "Adding…",
        "addToMetamask": "Add to MetaMask",
        "addToTrust": "Add to Trust Wallet",
        "openInMetamask": "Open in MetaMask"
      },
      "status": {
        "added": "network added!",
        "noWallet": "MetaMask not detected — copy the details alongside.",
        "mobileHint": "On mobile: open in your wallet app to add the network.",
        "addManually": "If it fails, add it manually with the details above (custom network).",
        "otherWallets": "Using another wallet (Trust, etc.)? Add it manually with the details above (custom network)."
      },
      "error": {
        "addFailed": "Could not add the network.",
        "userRejected": "You rejected the request in your wallet."
      },
      "mapping": {
        "badge": "same account",
        "title": "Two identities, one account",
        "labelEavm": "EAVM",
        "labelNative": "native",
        "desc1": "MetaMask displays the",
        "desc2": "; on-chain the balance lives in the",
        "desc3": "corresponding address. They're the same account."
      },
      "steps": {
        "step1": "Click to add the EAV7 network",
        "step2": "Your account appears as 0x… in the wallet",
        "step3": "On-chain the balance lives in the corresponding E7"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "block time",
        "stat_validators_value": "up to 27",
        "stat_validators_label": "DPoS validators",
        "stat_supply_value": "100B",
        "stat_supply_label": "EAV7 supply",
        "stat_reward_label": "EAV7 per block",
        "stat_quantum_value": "hybrid",
        "stat_quantum_label": "post-quantum",
        "pillars_title": "protocol pillars",
        "pillar_consensus": "DPoS Consensus",
        "pillar_token_standard": "EAV20 Standard",
        "pillar_bridge": "Cross-chain Bridge",
        "pillar_security": "Security & AI",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "EAV20 standard",
        "title": "Native tokens, no virtual machine",
        "description": "Equivalent to TRC20: tokens live directly in chain state and move through signed transactions — fast, cheap, and verifiable.",
        "cta": "View network tokens"
      },
      "consenso": {
        "badge": "DPoS consensus",
        "title": "A new block every second",
        "description": "Validators take turns in rotation: every 1s slot, an expected producer signs the next block. No grinding, no waiting.",
        "slot_now": "slot now",
        "slot_offset": "slot +{n}",
        "fact_election_label": "Election",
        "fact_election_value": "top 27 by weight (stake + votes, ≥ 1,000 EAV7)",
        "fact_production_label": "Production",
        "fact_production_value": "validators[slot % N] · round-robin",
        "fact_fork_choice_label": "Fork choice",
        "fact_fork_choice_value": "longest valid chain",
        "cta": "View live validators"
      },
      "ponte": {
        "title": "How the bridge moves value between networks",
        "arrow_pays": "pays",
        "node_external": "External network",
        "step_bridge_out": "locks EAV7/token and records the external destination",
        "step_relayer": "watches the outgoing bridge and pays on the external chain",
        "step_bridge_settle": "marks the outflow as paid on-chain (idempotent)",
        "step_bridge_in": "releases funds via a source-chain committee proof (M-of-N quorum), deduped by sourceTxHash"
      },
      "seguranca": {
        "badge_hybrid": "hybrid signature",
        "title_hybrid": "Post-quantum by design",
        "verify_both": "verification requires both",
        "hybrid_description": "Every wallet, transaction, and block carries both signatures — ECDSA (maturity) and ML-DSA-44 (FIPS 204, quantum-resistant). Forging would require breaking both primitives at once.",
        "badge_ai": "AI layer",
        "title_ai": "A 6-phase AI layer",
        "sentinel_title": "Security sentinel · 24h",
        "sentinel_description": "A process continuously monitors the network — reorgs and rollbacks, giant transfers, bursts, mempool, producer concentration, validator health and governance advisories — logging findings to the security feed.",
        "sentinel_cta": "View in mining",
        "phase1": "reputation",
        "phase2": "quorum",
        "phase3": "challenge + jury",
        "phase4": "marketplace",
        "phase5": "private",
        "phase6": "TEE/zk attestation",
        "ai_description": "On-chain oracles that evolve across 6 phases: from reputation and commit-reveal quorum to a challenge window with a jury, a reverse-auction marketplace, private hash-only results and TEE/zk attestation that settles instantly as verified."
      },
      "staking": {
        "tier_fee_title": "Zero fees",
        "tier_fee_desc": "Lock 100+ EAV7 and your transactions get zero fees — energy (bandwidth) is generated by the freeze and regenerates over time.",
        "tier_mine_title": "Mine blocks",
        "tier_mine_desc": "Lock 1,000+ EAV7 and enter the DPoS election. When you produce a block you receive 16 EAV7 plus the block fees, in full.",
        "reward_title": "Reward and unstake",
        "reward_desc": "The reward goes in full to the block producer. Unstaking releases the amount back to your balance — the network's last validator can't be emptied out.",
        "cta_lock": "Lock EAV7",
        "cta_mining": "View mining"
      },
      "tier_mine_desc": "Lock 1,000+ EAV7 and enter the DPoS election. When you produce a block, the producer keeps the commission (default 20%) and the rest is shared with voters — with no votes, you get the full 16 EAV7 plus fees."
    },
    "energyGauge": {
      "ariaLabel": "Energy {available} of {max}",
      "title": "Energy",
      "description": "Resource that covers transaction costs. Regenerates over time and grows with EAV7 locked in stake."
    },
    "home_activityBars": {
      "ariaLabel": "Transactions per block",
      "txsCount": "{n} txs"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "Overview",
        "blocks": "Blocks",
        "transactions": "Transactions",
        "validators": "Validators",
        "tokens": "Tokens"
      },
      "cols": {
        "block": "Block",
        "age": "Age",
        "txs": "Txs",
        "producer": "Producer",
        "reward": "Reward",
        "hash": "Hash"
      },
      "sidebar": {
        "explore": "Explore",
        "network": "Network"
      },
      "toolbar": {
        "filter": "Filter",
        "sort": "Sort",
        "live": "live"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "explore",
      "title": "Everything on-chain, in real time",
      "description": "Blocks and transactions flowing right now. Click any item to investigate.",
      "viewBlocks": "View blocks",
      "viewTxs": "View transactions"
    },
    "home_heartbeat": {
      "label": "heartbeat",
      "blockAgoPrefix": "block",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} txs",
      "viewAll": "view all"
    },
    "home_hero": {
      "coin_alt": "EAV7 Coin",
      "title": "The new era of the on-chain explorer",
      "subtitle": "Blocks every 1 second, post-quantum security, and a native AI layer. Investigate blocks, transactions, validators, and addresses in real time.",
      "search_placeholder": "Search block, transaction, or address…",
      "search_button": "Explore",
      "stat_height": "Height",
      "stat_block": "Block",
      "stat_validators": "Validators",
      "stat_mempool": "Mempool"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "EAV7 Coin",
        "titleBefore": "The EAV7 blockchain, and",
        "titleHighlight": "beyond",
        "subtitle": "1-second DPoS consensus, post-quantum security, and a native AI layer. Explore blocks, transactions, and validators in real time.",
        "exploreNetwork": "Explore the network",
        "openWallet": "Open wallet",
        "scrollAriaLabel": "Scroll to the panel"
      },
      "vitals": {
        "height": "Height",
        "blockTime": "Block",
        "validators": "Validators"
      }
    },
    "home_inkBand": {
      "eyebrow": "interactive",
      "title": "Hover to reveal",
      "subtitle": "the EAV7 network, beyond the block",
      "mobileHint": "on mobile the art appears directly"
    },
    "home_latestTxs": {
      "title": "Latest transactions",
      "viewAll": "view all",
      "table": {
        "hash": "Hash",
        "type": "Type",
        "fromTo": "From → To",
        "value": "Value"
      },
      "empty": "no transactions yet"
    },
    "home_moments": {
      "sectionEyebrow": "inside the protocol",
      "sectionTitle": "An L1 built to last",
      "items": {
        "security": {
          "eyebrow": "security",
          "titlePrefix": "Ready for the",
          "titleHighlight": "post-quantum era",
          "desc": "Every wallet, transaction, and block carries two signatures — and verification requires both. Forging one would mean breaking both primitives at once.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "E7 address derived via SHA3-256"
        },
        "consensus": {
          "eyebrow": "consensus",
          "titlePrefix": "A block every",
          "titleHighlight": "1 second",
          "desc": "DPoS consensus with up to 27 validators (governable, max 101) elected by weight (stake + votes), in a deterministic rotation — 3× faster than Tron, with protected liveness.",
          "bullet1": "up to 27 validators (governable) · round-robin",
          "bullet2": "16 EAV7 reward per block"
        },
        "intelligence": {
          "eyebrow": "intelligence",
          "titlePrefix": "A",
          "titleHighlight": "native AI layer",
          "desc": "A 6-phase on-chain oracle layer: reputation and slashing, commit-reveal quorum, a challenge window with a jury, a reverse-auction marketplace, private hash-only results and TEE/zk attestation that settles instantly.",
          "bullet1": "commit-reveal quorum · challenge + jury · marketplace",
          "bullet2": "attested TEE/zk results (verified)"
        },
        "assets": {
          "eyebrow": "assets",
          "titlePrefix": "Tokens",
          "titleHighlight": "EAV20",
          "titleSuffix": "and a cross-chain bridge",
          "desc": "Create and move native tokens (TRC20-equivalent) and connect EAV7 to other networks through a secure, idempotent lock-and-release model.",
          "bullet1": "EAV20 standard · create / transfer / approve",
          "bullet2": "TRON · ETH · BTC bridge (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "real time",
      "title": "The network's pulse",
      "subtitle": "A new block every second. Watch the EAV7 network beating in real time.",
      "stats": {
        "blockHeight": "Block height",
        "txLast30": "Txs · last 30 blocks",
        "mempool": "Mempool",
        "rewardPerBlock": "EAV7 / block"
      },
      "activity": {
        "title": "Network activity",
        "txInLastBlocks": "transactions in the last {n} blocks"
      },
      "slots": {
        "title": "DPoS slots",
        "activeValidators": "active validators",
        "supply": "supply {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "Total accounts"
        },
        "transactions": {
          "label": "Total transactions"
        },
        "volume": {
          "label": "Volume transferred"
        },
        "staked": {
          "label": "Total staked"
        }
      },
      "ring": {
        "supplyLine1": "of supply",
        "supplyLine2": "locked in stake"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} of {max}"
    },
    "home_walletCta": {
      "eyebrow": "get started now",
      "title": "Explore the EAV7 network now",
      "description": "Your wallet is generated and signed in the browser with post-quantum protection — it never leaves your device. Send, stake, and mine right from the web.",
      "createWallet": "Create wallet",
      "exploreNetwork": "Explore the network"
    },
    "mining_live": {
      "badge_consensus": "DPoS · staking",
      "title": "Mining",
      "live_badge": "live",
      "subtitle": "on EAV7 you mine by locking EAV7 (stake) — no hardware, no energy cost",
      "stat_reward_block": "Reward / block",
      "stat_blocks_day": "Blocks / day",
      "stat_daily_emission": "Daily emission",
      "stat_already_mined": "Already mined",
      "network_production": "network output",
      "reward_per_block_caption": "reward per block (1s)",
      "annual_emission_caption": "estimated annual emission",
      "next_block": "next block",
      "miners_label": "miners",
      "staked_label": "EAV7 staked",
      "block_time_label": "block time",
      "ai_sentinel_badge": "AI sentinel · 24h",
      "network_protected": "Network protected",
      "ai_monitoring_desc": "continuous monitoring by native AI",
      "alerts_analyzed": "alerts analyzed",
      "active_oracles": "active oracles",
      "pending_ai_tasks": "pending AI tasks",
      "cta_title": "Start mining EAV7",
      "cta_description": "Lock EAV7 in your wallet to become a miner in the DPoS consensus and earn rewards for every block produced. All self-custodial, with post-quantum signing in the browser.",
      "cta_lock_button": "Lock EAV7",
      "cta_view_validators": "View validators"
    },
    "nav_extra": {
      "nfts": "EAV721 NFTs",
      "nftsDesc": "NFT collections on the network",
      "names": "EAV-NS Names",
      "namesDesc": "Human-readable names → address",
      "governance": "Governance",
      "governanceDesc": "Proposals, parameters and treasury"
    },
    "nav_headerSearch": {
      "buscar": "Search",
      "dica": "block (number) · transaction (E7…) · address (E7… or 0x…)"
    },
    "netStatus": {
      "onlineTitle": "EAV7 network online · height {height}",
      "offlineTitle": "Node offline",
      "connecting": "connecting…"
    },
    "page_address": {
      "metaTitle": "Address {addr}… · EAV7 Scan",
      "eyebrow": "address",
      "title": "Address",
      "roleValidator": "Validator",
      "roleOracle": "Oracle",
      "roleAccount": "Account",
      "balance": "Balance",
      "staked": "staked",
      "nonce": "nonce",
      "feeExempt": "zero fee",
      "available": "Available",
      "max": "max {n}",
      "tokensTitle": "EAV20 Tokens",
      "colToken": "Token",
      "colSymbol": "Symbol",
      "colBalance": "Balance",
      "txsTitle": "Transactions",
      "colHash": "Hash",
      "colBlock": "Block",
      "colType": "Type",
      "colCounterparty": "Counterparty",
      "colValue": "Value",
      "colDate": "Date",
      "out": "out",
      "in": "in",
      "noTxs": "no transactions for this address",
      "totalBalance": "total balance: {n}",
      "nftsTitle": "NFTs (EAV721)",
      "colNftCollection": "Collection",
      "colNftId": "Token",
      "namesTitle": "EAV-NS names",
      "colNsName": "Name",
      "colNsTarget": "Resolves to",
      "votesLabel": "Votes received",
      "commissionLabel": "Commission",
      "tabOverview": "Overview",
      "tabTransfers": "Transfers",
      "tabInternal": "Internal transfers",
      "tabStaking": "Staking & resources",
      "tabContract": "Contract",
      "tabPermissions": "Permissions",
      "tabAnalysis": "Analysis",
      "internalNote": "Value moved by contract execution. Not a signed transaction — which is why it has no hash of its own.",
      "internalEmpty": "no internal transfers",
      "colFrom": "From",
      "colTo": "To",
      "colTx": "Transaction",
      "stakingTitle": "Stake & resources",
      "bandwidth": "Bandwidth",
      "energy": "Energy",
      "delegatedOut": "Delegated out",
      "delegatedIn": "Delegated in",
      "unbondingTitle": "Unbonding",
      "matureIn": "unlocks in {n} blocks",
      "votesCastTitle": "Votes cast",
      "votesReceived": "Votes received",
      "vestingTitle": "Vesting",
      "permsNone": "single-key account — no multi-signature",
      "permsThreshold": "Threshold",
      "colWeight": "Weight",
      "colKey": "Key",
      "contractNone": "this address is not a contract",
      "contractCodeSize": "Code size",
      "contractVerified": "Verified",
      "contractUnverified": "Unverified",
      "sent": "Sent",
      "received": "Received",
      "feesPaid": "Fees paid",
      "txCount": "Transactions",
      "firstSeen": "First activity",
      "lastSeen": "Last activity",
      "byType": "By type",
      "topCounterparties": "Top counterparties",
      "truncatedNote": "sample limited to the most recent transactions",
      "noData": "no data",
      "accountInfo": "Account info",
      "accountType": "Account type",
      "createdAt": "Created",
      "totalTxs": "Total transactions",
      "tabTokenTx": "Token transfers",
      "tokenTxEmpty": "no token transfers",
      "roleContract": "Contract",
      "roleMultisig": "Multi-signature",
      "holdings": "Holdings",
      "colAsset": "Asset",
      "assets": "Assets",
      "transfersRow": "Transfers",
      "votesRow": "Votes",
      "claimable": "Claimable rewards",
      "tabApprovals": "Approvals",
      "searchHoldings": "Search by name, symbol or address…",
      "noHoldings": "nothing here",
      "colSpender": "Spender",
      "colLimit": "Allowance",
      "more": "See more",
      "tabTokens": "Tokens",
      "tabTransactions": "Transactions",
      "colAge": "Age",
      "colResult": "Result",
      "resultOk": "Success",
      "resultRevert": "Reverted",
      "summaryTx": "A total of {n} transactions",
      "summaryTransfers": "A total of {n} transfers",
      "summaryInternal": "A total of {n} internal transfers",
      "filterAll": "All",
      "filterIn": "In",
      "filterOut": "Out",
      "summaryTokenTx": "A total of {n} token transfers",
      "colParentHash": "Parent hash",
      "colResourceAmount": "Resource amount",
      "colStakedAmount": "Staked EAV7",
      "colUpdatedAt": "Updated at",
      "stakeNote": "In EAV7 a single stake grants energy AND bandwidth at once — you do not pick a resource, unlike TRON.",
      "permsOperations": "Operations",
      "thisAccount": "this account",
      "summaryContracts": "A total of {n} contracts",
      "permsNote": "In EAV7 the operation set applies to any multisig account — there is no per-permission scoping as in TRON.",
      "permsDefault": "default",
      "permsDefaultNote": "No multi-signature configured. This is the account’s effective authorization: one key, one signature."
    },
    "page_block": {
      "metaTitle": "Block #{height} · EAV7 Scan",
      "eyebrow": "block",
      "title": "Block #{height}",
      "sub": "{ago} ago",
      "kv": {
        "height": "Height",
        "date": "Date",
        "producer": "Producer",
        "previousHash": "Previous hash",
        "merkleRoot": "Merkle root (txs)",
        "txCount": "Transactions",
        "protocol": "Protocol",
        "scheme": "scheme",
        "finality": "Finality"
      },
      "txSectionTitle": "Block transactions",
      "table": {
        "hash": "Hash",
        "type": "Type",
        "from": "From",
        "to": "To",
        "value": "Value",
        "fee": "Fee"
      },
      "emptyBlock": "empty block",
      "finalized": "finalized",
      "pending": "pending"
    },
    "page_docs": {
      "metaTitleFallback": "Documentation · EAV7 Scan",
      "breadcrumb": "documentation",
      "terminal": "terminal",
      "onThisPage": "on this page"
    },
    "page_governance": {
      "metaTitle": "On-chain governance · EAV7 Scan",
      "eyebrow": "on-chain governance",
      "title": "Governance & Treasury",
      "subtitle": "Validators propose and vote parameter changes (2/3+1); a governable vault receives part of the reward",
      "treasuryTitle": "Treasury",
      "treasuryBalance": "Vault balance",
      "treasuryPct": "% of block reward",
      "validators": "active validators",
      "paramsTitle": "Active (governed) parameters",
      "noParams": "No parameter overridden by governance — all at protocol defaults",
      "colParam": "Parameter",
      "colValue": "Value",
      "proposalsTitle": "Proposals",
      "colProposer": "Proposer",
      "colStatus": "Status",
      "colVotes": "Votes",
      "colDeadline": "Deadline (block)",
      "noProposals": "No active or closed proposal"
    },
    "page_mining": {
      "metaTitle": "Mining · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Names · EAV7 Scan",
      "eyebrow": "name service",
      "title": "EAV-NS",
      "subtitle": "Human-readable names that resolve to an E7 address (register, update, transfer, release)",
      "colName": "Name",
      "colTarget": "Resolves to",
      "colOwner": "Owner",
      "empty": "No name registered yet"
    },
    "page_nfts": {
      "metaTitle": "EAV721 NFTs · EAV7 Scan",
      "eyebrow": "EAV721 standard",
      "title": "NFTs",
      "subtitle": "EAV721 collections (TRC721 equivalent) minted on the EAV7 network",
      "colCollection": "Collection",
      "colSymbol": "Symbol",
      "colSupply": "Minted",
      "colOwner": "Creator",
      "empty": "No EAV721 collection minted yet",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Owner",
      "colUri": "URI",
      "supplyLabel": "minted",
      "back": "all collections"
    },
    "page_notFound": {
      "description": "This page does not exist on the EAV7 chain.",
      "backLink": "← back to home"
    },
    "page_search": {
      "metaTitle": "Search · EAV7 Scan",
      "title": "Nothing found",
      "notRecognizedPrefix": "We didn't recognize",
      "notRecognizedSuffix": "as a block, transaction, or EAV7 address.",
      "retryPlaceholder": "Try again…",
      "whatCanSearch": "what you can search",
      "blockLabel": "block",
      "blockDesc": "block height number, e.g.",
      "txLabel": "transaction",
      "txDesc": "hash",
      "txChars": "(64 characters)",
      "addressLabel": "address",
      "addressLen34": "(34) or",
      "or": "or",
      "evmLabel": "(EAVM)",
      "backHome": "← back to home"
    },
    "page_token": {
      "eyebrow": "EAV20 token",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "Token · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "Standard",
      "mintable": "mintable",
      "fixedSupply": "fixed supply",
      "paused": "paused",
      "tabTransfers": "Transfers",
      "tabHolders": "Holders",
      "tabAnalysis": "Analysis",
      "totalSupply": "Total supply",
      "holders": "Holders",
      "decimals": "Decimals",
      "status": "Status",
      "statusActive": "Active",
      "statusPaused": "Paused",
      "createdAt": "Created",
      "contract": "Contract",
      "creator": "Creator",
      "owner": "Admin",
      "mintableLabel": "Can mint more",
      "yes": "yes",
      "no": "no",
      "summaryTransfers": "A total of {n} transfers",
      "summaryHolders": "{n} holders in total — showing the top {shown}",
      "colHash": "Hash",
      "colBlock": "Block",
      "colAge": "Age",
      "colFrom": "From",
      "colTo": "To",
      "colAmount": "Amount ({symbol})",
      "colRank": "#",
      "colAddress": "Address",
      "colBalance": "Balance ({symbol})",
      "colShare": "Share",
      "blacklisted": "blocked",
      "noTransfers": "No transfers found.",
      "noHolders": "No holders found.",
      "top1": "Largest holder",
      "top10": "Top 10",
      "top50": "Top 50",
      "concentrationTitle": "Supply concentration",
      "concentrationNote": "How much of the supply sits in the largest wallets. A large supply held by a few carries different market risk than a widely distributed one — which is why distribution matters more than the headline number.",
      "largestHolder": "Largest holder:",
      "overviewTitle": "Overview",
      "basicInfoTitle": "Contract info",
      "activityTitle": "Distribution",
      "largestHolderShort": "Largest holder",
      "tabContract": "Contract",
      "nativeTitle": "Protocol-native token",
      "nativeBadge": "no arbitrary code",
      "nativeNote": "This token is not a smart contract: it is implemented by the protocol itself. There is no Solidity, compiler or bytecode to verify — and equally no hidden logic anyone could have written. Behaviour is identical for every EAV20 token and changes only through a network hard fork.",
      "implementation": "Implementation",
      "implementationValue": "Native to consensus (EAV20 standard)",
      "sourceOfTruth": "Protocol source",
      "powersTitle": "What the admin can do",
      "powersNote": "On an EVM explorer you would read the source to find this out. Here these are state fields, so we list them directly. This is what actually matters before trusting a token.",
      "powerMint": "Mint more units",
      "powerMintNote": "Increases total supply and dilutes existing holders.",
      "powerPause": "Pause transfers",
      "powerPauseNote": "Freezes all movement of the token at once.",
      "powerBlacklist": "Block addresses",
      "powerBlacklistNote": "Stops a specific address from sending or receiving.",
      "powerFreeze": "Freeze balance",
      "powerFreezeNote": "Locks part of an address's balance until a date.",
      "powerYes": "can",
      "powerNo": "cannot",
      "powerActiveNow": "active now",
      "adminIs": "Admin:",
      "restrictionsTitle": "Restrictions in force",
      "frozenUntil": "until {when}"
    },
    "page_tx": {
      "metaTitle": "Transaction {id}… · EAV7 Scan",
      "eyebrow": "transaction",
      "title": "Transaction",
      "status": "Status",
      "type": "Type",
      "block": "Block",
      "from": "From",
      "to": "To",
      "value": "Value",
      "fee": "Fee",
      "nonce": "Nonce",
      "date": "Date",
      "scheme": "Scheme",
      "eavmLayer": "EAVM Layer (MetaMask)",
      "energy": "Energy",
      "energyUnit": "energy",
      "details": "Transaction data"
    },
    "page_txs": {
      "metaTitle": "Transactions · EAV7 Scan"
    },
    "secSentinel": {
      "title": "AI sentinel reports",
      "sub": "The 24/7 security sentinel monitors the network and publishes analyses in real time: reorgs and chain rollbacks, huge transfers, transaction bursts and mempool floods, producer concentration, validator health (degraded/recovered) and governance advisories.",
      "live": "live",
      "reports": "Recent reports",
      "loading": "Loading reports…",
      "empty": "No reports yet — the sentinel publishes analyses continuously.",
      "stat_reports": "reports",
      "stat_oracles": "oracles",
      "stat_tasks": "AI tasks",
      "sev": {
        "critical": "critical",
        "warning": "warning",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "EAV20 standard",
        "title": "Tokens",
        "subtitle": "native assets of the eav20 protocol — equivalent to Tron's TRC20"
      },
      "empty": {
        "title": "No tokens created yet",
        "description": "Tokens appear here as soon as they are created on the network via"
      },
      "stats": {
        "tokens": "EAV20 Tokens",
        "holders": "Holders (total)",
        "supply": "Combined supply",
        "standard": "Standard"
      },
      "card": {
        "supply": "Supply",
        "holders": "Holders",
        "share": "share",
        "creator": "creator"
      }
    },
    "txs_live": {
      "chainLabel": "eav20 chain",
      "title": "Transactions",
      "live": "live",
      "subtitleLive": "newest first · values in EAV7",
      "subtitleOlder": "older transactions · values in EAV7",
      "searchPlaceholder": "Search tx, block or address…",
      "cols": {
        "hash": "Hash",
        "block": "Block",
        "type": "Type",
        "from": "From",
        "to": "To",
        "value": "Value",
        "age": "Age"
      },
      "stats": {
        "totalTx": "Total transactions",
        "mempool": "In mempool",
        "volume": "Volume (EAV7)",
        "avgFee": "Average fee"
      },
      "table": {
        "latest": "Latest transactions",
        "older": "Previous transactions",
        "updating": "updating",
        "empty": "no transactions found",
        "count": "{n} transactions",
        "loadMore": "Load older →",
        "genesis": "start of chain"
      }
    },
    "ui_copy": {
      "default_value": "value",
      "aria_label": "Copy {label}",
      "copied": "copied ✓",
      "copy_label": "copy {label}",
      "copy": "copy"
    },
    "ui_explorerSearch": {
      "placeholder": "Search block, tx or address…",
      "searchButton": "Search"
    },
    "validators_live": {
      "unavailable": "node unavailable",
      "header": {
        "eyebrow": "DPoS consensus",
        "title": "Validators",
        "live": "live",
        "subtitle": "{active} active out of {max} slots · minimum stake {min} EAV7 · rotation every block"
      },
      "producer": {
        "label": "current slot producer",
        "producingBlock": "producing block"
      },
      "slot": {
        "label": "slot · {n}s",
        "staked": "{n} EAV7 staked"
      },
      "rotation": {
        "label": "production rotation"
      },
      "stats": {
        "activeValidators": "Active validators",
        "rewardPerBlock": "Reward / block",
        "totalStaked": "Total staked",
        "peers": "Network peers"
      },
      "ranking": {
        "title": "Active set",
        "sortedBy": "sorted by weight (stake + votes)",
        "producing": "producing",
        "active": "active",
        "stakedCaption": "EAV7 staked",
        "votesCaption": "votes"
      },
      "health": {
        "summary": "avg health {avg}/100 · {degraded} degraded",
        "degradedBanner": "{n} validator(s) underperforming — the AI drafted a governance recommendation (not executed; only governance decides).",
        "status": {
          "healthy": "healthy",
          "lagging": "lagging",
          "degraded": "degraded",
          "offline": "offline"
        }
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "secure"
      },
      "role": {
        "validator": "Validator",
        "oracle": "Oracle",
        "account": "EAV7 Account"
      },
      "lock": {
        "button": "lock"
      },
      "balance": {
        "label": "available balance"
      },
      "tier": {
        "validator": "Validator",
        "fee_zero": "Zero fee",
        "standard": "Standard"
      },
      "actions": {
        "send": "Send",
        "receive": "Receive",
        "stake": "Stake"
      },
      "stats": {
        "staked": "Staked",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "Fee",
        "fee_zero": "zero",
        "fee_standard": "standard"
      },
      "tier_progress": {
        "label": "tier progress",
        "remaining_prefix": "remaining",
        "remaining_suffix": "to reach {tier} tier"
      },
      "receive": {
        "title": "Receive EAV7",
        "description_before": "Share your address",
        "description_after": "— the network maps it to your native E7 automatically.",
        "close": "close"
      },
      "activity": {
        "title": "Recent activity",
        "sent": "Sent",
        "received": "Received"
      },
      "addresses": {
        "hint": "use this 0x to receive (EAVM/MetaMask standard)"
      },
      "tokens": {
        "title": "EAV20 Tokens"
      },
      "footer": {
        "quantum": "post-quantum · secp256k1 + ML-DSA-44",
        "logout": "sign out / switch"
      },
      "wipe": {
        "title": "Delete this wallet?",
        "description_before": "The encrypted wallet will be removed",
        "description_bold": "from this browser",
        "description_after": ". You can only restore it with your private key backup — there is no password recovery.",
        "warning_before": "Confirm you have the",
        "warning_bold": "key backup",
        "warning_after": "before deleting.",
        "download_backup": "Download backup (.json)",
        "cancel": "Cancel",
        "confirm": "Delete wallet"
      },
      "faucet": {
        "button": "Get 100 test EAV7",
        "loading": "Requesting…",
        "ok": "100 test EAV7 sent!",
        "error": "Faucet failed"
      }
    },
    "wallet_addNet": {
      "title": "Use in MetaMask / Trust",
      "description": "Add the EAV7 network (chain 72020) to your EVM wallet.",
      "adding": "adding…",
      "added": "✓ added",
      "addButton": "Add network",
      "noWallet": "MetaMask not detected in this browser.",
      "error": "could not add the network."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "only you are in control",
        "on_device_title": "on-device",
        "on_device_desc": "the key never leaves",
        "quantum_title": "quantum-safe",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "Backup",
        "password": "Password",
        "ready": "Ready"
      },
      "unlock": {
        "title": "Welcome back",
        "subtitle": "There is an encrypted wallet in this browser. Enter your password to unlock it.",
        "password_placeholder": "password",
        "error_wrong_password": "incorrect password",
        "unlocking": "unlocking…",
        "unlock_button": "Unlock wallet",
        "wipe_confirm": "Delete the wallet from this browser? Make sure you have the key backup!",
        "wipe_button": "delete and start over"
      },
      "choose": {
        "title": "Your EAV7 wallet",
        "subtitle": "A self-custodial wallet: you are the sole owner of your keys. Get started in seconds.",
        "create_title": "Create new wallet",
        "create_desc": "Generates a new key on this device.",
        "import_title": "Import key",
        "import_desc": "Already have a private key? Restore it here."
      },
      "import": {
        "title": "Import wallet",
        "subtitle": "Paste the private key and choose a password to encrypt it in this browser.",
        "label": "Private key (0x + 64 hex)",
        "importing": "importing…",
        "button": "Import",
        "back": "Back",
        "error_invalid_key": "invalid private key (expected 0x + 64 hex)"
      },
      "create": {
        "title": "Back up your key",
        "subtitle": "There is no password recovery. Whoever holds the private key controls the funds — save it before continuing.",
        "warning_prefix": "This key ",
        "warning_bold": "is the only way",
        "warning_suffix": " to access your funds. Save it offline — never share it with anyone.",
        "address_label": "E7 address",
        "private_key_label": "private key",
        "reveal": "reveal",
        "hide": "hide",
        "download_backup": "⭳ Download backup (.json)",
        "confirm_saved": "I saved my key in a safe place",
        "creating": "creating…",
        "create_button": "Create wallet",
        "confirm_hint": "confirm you saved the key",
        "back": "Back"
      },
      "errors": {
        "password_min": "password must be at least 6 characters",
        "password_mismatch": "passwords do not match",
        "save_error": "error saving"
      },
      "password": {
        "label": "Password to encrypt (min. 6 characters)",
        "placeholder": "password",
        "confirm_placeholder": "confirm password",
        "mismatch": "passwords do not match",
        "strength": {
          "very_weak": "very weak",
          "weak": "weak",
          "fair": "fair",
          "good": "good",
          "strong": "strong"
        }
      }
    },
    "wallet_send": {
      "title": "Send EAV7",
      "steps": {
        "destination": "Destination",
        "value": "Amount",
        "review": "Review"
      },
      "recipient": {
        "label": "Destination (0x… EAVM/MetaMask)",
        "paste": "paste",
        "valid": "✓ valid address",
        "invalid": "invalid 0x address"
      },
      "errors": {
        "needEvmAddress": "enter the destination's 0x address (the web wallet signs in the EAVM model)",
        "invalidAddress": "destination must be a 0x address (EAVM/MetaMask)",
        "needPositiveAmount": "enter a positive amount",
        "insufficientBalance": "insufficient balance (consider the fee)",
        "invalidAmount": "invalid amount",
        "sendFailed": "failed to send"
      },
      "continue": "Continue",
      "cancel": "Cancel",
      "available": "available: {amount} EAV7",
      "percent": {
        "max": "MAX"
      },
      "back": "Back",
      "sendingLabel": "sending",
      "sendingTo": "to {addr}",
      "networkFee": "Network fee",
      "balanceAfter": "Balance after",
      "quantumNote": "signed on this device · post-quantum network protection",
      "confirmAndSign": "Confirm and sign",
      "signing": "signing…",
      "transactionSent": {
        "title": "Transaction sent",
        "subtitle": "Confirms in the next block (~1s)."
      },
      "close": "close"
    },
    "wallet_stake": {
      "title": "Stake",
      "subtitle": "≥ 100 EAV7 waives fees · ≥ 1,000 becomes a validator (16 EAV7/block produced).",
      "tierZeroFee": {
        "label": "Zero fee",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "Validator",
        "sub": "≥ 1,000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "currently staked:",
      "warnValidator": "This drops your stake below 1,000 — you'll lose validator status.",
      "warnFeeReset": "This drops your stake below 100 — your transactions will pay fees again.",
      "warnConfirm": "understood, remove anyway →",
      "errInvalidAmount": "enter a positive amount",
      "errInvalidValue": "invalid amount",
      "errFailedOp": "operation failed",
      "sentTitle": "Operation sent",
      "close": "close",
      "stakeBtn": "Stake",
      "removeBtn": "Remove"
    }
  },
  "es": {
    "blocks_live": {
      "networkLabel": "cadena eav20",
      "title": "Bloques",
      "live": "en vivo",
      "blockTimeInfo": "un nuevo bloque cada {n}s · consenso DPoS",
      "searchPlaceholder": "Buscar bloque por altura o hash…",
      "stats": {
        "height": "Altura actual",
        "blockTime": "Tiempo de bloque",
        "avgTx": "Txs / bloque (prom.)",
        "activeProducers": "Productores activos"
      },
      "latestBlocks": "Últimos bloques",
      "updating": "actualizando",
      "columns": {
        "block": "Bloque",
        "age": "Antigüedad",
        "txs": "Txs",
        "producer": "Productor",
        "reward": "Recompensa",
        "hash": "Hash"
      }
    },
    "comingSoon": {
      "badge": "en construcción · sprint 4",
      "backToExplorer": "← volver al explorer"
    },
    "docs_api": {
      "badge": "API pública",
      "title": "Consulta la red directo desde el nodo",
      "baseUrl": "URL base",
      "tags": {
        "cors": "CORS habilitado",
        "units": "valores en e7",
        "noAuth": "sin autenticación"
      },
      "groups": {
        "read": "lectura",
        "write": "escritura"
      },
      "endpoints": {
        "status": "estado de la red: altura, validadores, mempool, recompensa/bloque",
        "blocks": "últimos N bloques",
        "blockByHeight": "un bloque por altura o hash",
        "txs": "transacciones recientes, paginadas",
        "tx": "una transacción por id",
        "address": "saldo, stake, nonce, rol, tokens y energía",
        "tokens": "lista de tokens EAV20 (o /tokens/:id para detalle)",
        "validators": "conjunto DPoS activo + productor del slot",
        "sendTx": "envía una transacción nativa firmada (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "envía una transacción por la capa EAVM (compatible con JSON-RPC)"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "red personalizada"
      },
      "title": "Usa la EAV7 en tu billetera",
      "description": "La EAV7 habla el dialecto JSON-RPC que las billeteras universales entienden — agrega la red en un clic.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "cualquier billetera EVM"
      },
      "params": {
        "networkName": "Nombre de la red",
        "rpcUrl": "URL del RPC",
        "chainId": "Chain ID",
        "symbol": "Símbolo",
        "explorer": "Explorer",
        "decimals": "Decimales"
      },
      "button": {
        "adding": "Agregando…",
        "addToMetamask": "Agregar a MetaMask"
      },
      "status": {
        "added": "¡red agregada!",
        "noWallet": "MetaMask no detectada — copia los datos al lado."
      },
      "error": {
        "addFailed": "no se pudo agregar la red"
      },
      "mapping": {
        "badge": "misma cuenta",
        "title": "Dos identidades, una cuenta",
        "labelEavm": "EAVM",
        "labelNative": "nativo",
        "desc1": "MetaMask muestra el",
        "desc2": "; on-chain el saldo vive en el",
        "desc3": "correspondiente. Son la misma cuenta."
      },
      "steps": {
        "step1": "Haz clic para agregar la red EAV7",
        "step2": "Tu cuenta aparece como 0x… en la billetera",
        "step3": "On-chain el saldo vive en el E7 correspondiente"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "tiempo de bloque",
        "stat_validators_value": "hasta 27",
        "stat_validators_label": "validadores DPoS",
        "stat_supply_value": "100 mil M",
        "stat_supply_label": "suministro EAV7",
        "stat_reward_label": "EAV7 por bloque",
        "stat_quantum_value": "híbrida",
        "stat_quantum_label": "poscuántica",
        "pillars_title": "pilares del protocolo",
        "pillar_consensus": "Consenso DPoS",
        "pillar_token_standard": "Estándar EAV20",
        "pillar_bridge": "Puente cross-chain",
        "pillar_security": "Seguridad & IA",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "estándar EAV20",
        "title": "Tokens nativos, sin máquina virtual",
        "description": "Equivalente a TRC20: los tokens viven directamente en el estado de la cadena y se mueven mediante transacciones firmadas — rápido, económico y verificable.",
        "cta": "Ver tokens de la red"
      },
      "consenso": {
        "badge": "consenso DPoS",
        "title": "Un bloque nuevo cada segundo",
        "description": "Los validadores se turnan por rotación: en cada slot de 1s, un productor esperado firma el próximo bloque. Sin grinding, sin espera.",
        "slot_now": "slot ahora",
        "slot_offset": "slot +{n}",
        "fact_election_label": "Elección",
        "fact_election_value": "los 27 mayores por stake (≥ 1.000 EAV7)",
        "fact_production_label": "Producción",
        "fact_production_value": "validators[slot % N] · round-robin",
        "fact_fork_choice_label": "Fork choice",
        "fact_fork_choice_value": "cadena válida más larga",
        "cta": "Ver validadores en vivo"
      },
      "ponte": {
        "title": "Cómo el puente mueve valor entre redes",
        "arrow_pays": "paga",
        "node_external": "Red externa",
        "step_bridge_out": "bloquea EAV7/token y registra el destino externo",
        "step_relayer": "observa la salida y paga en la cadena externa",
        "step_bridge_settle": "marca la salida como pagada on-chain (idempotente)",
        "step_bridge_in": "libera fondos desde afuera, deduplicado por sourceTxHash"
      },
      "seguranca": {
        "badge_hybrid": "firma híbrida",
        "title_hybrid": "Poscuántica por diseño",
        "verify_both": "la verificación exige ambas",
        "hybrid_description": "Cada billetera, transacción y bloque lleva ambas firmas — ECDSA (madurez) y ML-DSA-44 (FIPS 204, resistente a lo cuántico). Falsificar exigiría romper ambas primitivas a la vez.",
        "badge_ai": "capa de IA",
        "title_ai": "Oráculos con escrow on-chain",
        "sentinel_title": "Centinela de seguridad · 24h",
        "sentinel_description": "Un proceso monitorea la red continuamente — reorganizaciones, transferencias gigantes, ráfagas de transacciones y concentración de productores — registrando informes en el feed de seguridad.",
        "sentinel_cta": "Ver en la minería"
      },
      "staking": {
        "tier_fee_title": "Comisión cero",
        "tier_fee_desc": "Bloquea 100+ EAV7 y tus transacciones pasan a tener comisión cero — la energía (bandwidth) se genera al congelar y se regenera con el tiempo.",
        "tier_mine_title": "Mina bloques",
        "tier_mine_desc": "Bloquea 1.000+ EAV7 y entra en la elección DPoS. Al producir un bloque recibes 16 EAV7 más las comisiones del bloque, íntegramente.",
        "reward_title": "Recompensa y unstake",
        "reward_desc": "La recompensa va íntegramente al productor del bloque. El unstake libera el valor de vuelta a tu saldo — no está permitido vaciar al último validador de la red.",
        "cta_lock": "Bloquear EAV7",
        "cta_mining": "Ver minería"
      }
    },
    "energyGauge": {
      "ariaLabel": "Energía {available} de {max}",
      "title": "Energía",
      "description": "Recurso que cubre el costo de las transacciones. Se regenera con el tiempo y crece con EAV7 bloqueado en staking."
    },
    "home_activityBars": {
      "ariaLabel": "Transacciones por bloque",
      "txsCount": "{n} txs"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "Visión general",
        "blocks": "Bloques",
        "transactions": "Transacciones",
        "validators": "Validadores",
        "tokens": "Tokens"
      },
      "cols": {
        "block": "Bloque",
        "age": "Antigüedad",
        "txs": "Txs",
        "producer": "Productor",
        "reward": "Recompensa",
        "hash": "Hash"
      },
      "sidebar": {
        "explore": "Explorar",
        "network": "Red"
      },
      "toolbar": {
        "filter": "Filtrar",
        "sort": "Ordenar",
        "live": "en vivo"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "explorar",
      "title": "Todo on-chain, en tiempo real",
      "description": "Bloques y transacciones fluyendo ahora mismo. Haz clic en cualquier elemento para investigar.",
      "viewBlocks": "Ver bloques",
      "viewTxs": "Ver transacciones"
    },
    "home_heartbeat": {
      "label": "latido",
      "blockAgoPrefix": "bloque hace",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} txs",
      "viewAll": "ver todos"
    },
    "home_hero": {
      "coin_alt": "Moneda EAV7",
      "title": "La nueva era del explorador on-chain",
      "subtitle": "Bloques cada 1 segundo, seguridad poscuántica y una capa nativa de IA. Investiga bloques, transacciones, validadores y direcciones en tiempo real.",
      "search_placeholder": "Buscar bloque, transacción o dirección…",
      "search_button": "Explorar",
      "stat_height": "Altura",
      "stat_block": "Bloque",
      "stat_validators": "Validadores",
      "stat_mempool": "Mempool"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "Moneda EAV7",
        "titleBefore": "La blockchain EAV7, y",
        "titleHighlight": "más allá",
        "subtitle": "Consenso DPoS de 1 segundo, seguridad poscuántica y una capa nativa de IA. Explora bloques, transacciones y validadores en tiempo real.",
        "exploreNetwork": "Explorar la red",
        "openWallet": "Abrir billetera",
        "scrollAriaLabel": "Desplazarse al panel"
      },
      "vitals": {
        "height": "Altura",
        "blockTime": "Bloque",
        "validators": "Validadores"
      }
    },
    "home_inkBand": {
      "eyebrow": "interactivo",
      "title": "Pasa el mouse y revela",
      "subtitle": "la red EAV7, más allá del bloque",
      "mobileHint": "en el móvil el arte aparece directamente"
    },
    "home_latestTxs": {
      "title": "Últimas transacciones",
      "viewAll": "ver todas",
      "table": {
        "hash": "Hash",
        "type": "Tipo",
        "fromTo": "De → Para",
        "value": "Valor"
      },
      "empty": "aún no hay transacciones"
    },
    "home_moments": {
      "sectionEyebrow": "dentro del protocolo",
      "sectionTitle": "Una L1 construida para durar",
      "items": {
        "security": {
          "eyebrow": "seguridad",
          "titlePrefix": "Preparada para la era",
          "titleHighlight": "poscuántica",
          "desc": "Cada billetera, transacción y bloque lleva dos firmas — y la verificación exige ambas. Falsificarla requeriría romper las dos primitivas a la vez.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "Dirección E7 derivada por SHA3-256"
        },
        "consensus": {
          "eyebrow": "consenso",
          "titlePrefix": "Un bloque cada",
          "titleHighlight": "1 segundo",
          "desc": "Consenso DPoS con hasta 27 validadores elegidos por stake, en rotación determinística — 3 veces más rápido que Tron, con liveness protegida.",
          "bullet1": "27 validadores · round-robin por slot",
          "bullet2": "16 EAV7 de recompensa por bloque"
        },
        "intelligence": {
          "eyebrow": "inteligencia",
          "titlePrefix": "Una capa",
          "titleHighlight": "nativa de IA",
          "desc": "Oráculos on-chain con escrow: las tareas de IA se publican, se resuelven por el oráculo designado y se liquidan de forma verificable — todo dentro del protocolo.",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "Hash del resultado registrado on-chain"
        },
        "assets": {
          "eyebrow": "activos",
          "titlePrefix": "Tokens",
          "titleHighlight": "EAV20",
          "titleSuffix": "y puente cross-chain",
          "desc": "Crea y mueve tokens nativos (equivalentes a TRC20) y conecta EAV7 con otras redes mediante un modelo lock-and-release seguro e idempotente.",
          "bullet1": "Estándar EAV20 · create / transfer / approve",
          "bullet2": "Puente TRON · ETH · BTC (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "tiempo real",
      "title": "El pulso de la red",
      "subtitle": "Un nuevo bloque cada segundo. Sigue a la red EAV7 latiendo en tiempo real.",
      "stats": {
        "blockHeight": "Altura del bloque",
        "txLast30": "Txs · últimos 30 bloques",
        "mempool": "Mempool",
        "rewardPerBlock": "EAV7 / bloque"
      },
      "activity": {
        "title": "Actividad de la red",
        "txInLastBlocks": "transacciones en los últimos {n} bloques"
      },
      "slots": {
        "title": "Slots DPoS",
        "activeValidators": "validadores activos",
        "supply": "suministro {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "Total de cuentas"
        },
        "transactions": {
          "label": "Total de transacciones"
        },
        "volume": {
          "label": "Volumen transferido"
        },
        "staked": {
          "label": "Total en stake"
        }
      },
      "ring": {
        "supplyLine1": "del suministro",
        "supplyLine2": "bloqueado en stake"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} de {max}"
    },
    "home_walletCta": {
      "eyebrow": "empieza ahora",
      "title": "Explora la red EAV7 ahora",
      "description": "Tu billetera se genera y firma en el navegador con protección post-cuántica — nunca sale de tu dispositivo. Envía, haz staking y mina directo desde la web.",
      "createWallet": "Crear billetera",
      "exploreNetwork": "Explorar la red"
    },
    "mining_live": {
      "badge_consensus": "DPoS · staking",
      "title": "Minería",
      "live_badge": "en vivo",
      "subtitle": "en EAV7 minas bloqueando EAV7 (stake) — sin hardware, sin gasto de energía",
      "stat_reward_block": "Recompensa / bloque",
      "stat_blocks_day": "Bloques / día",
      "stat_daily_emission": "Emisión diaria",
      "stat_already_mined": "Ya minado",
      "network_production": "producción de la red",
      "reward_per_block_caption": "recompensa por cada bloque (1s)",
      "annual_emission_caption": "emisión anual estimada",
      "next_block": "próximo bloque",
      "miners_label": "mineros",
      "staked_label": "EAV7 bloqueados",
      "block_time_label": "tiempo de bloque",
      "ai_sentinel_badge": "centinela de IA · 24h",
      "network_protected": "Red protegida",
      "ai_monitoring_desc": "monitoreo continuo por IA nativa",
      "alerts_analyzed": "alertas analizadas",
      "active_oracles": "oráculos activos",
      "pending_ai_tasks": "tareas de IA pendientes",
      "cta_title": "Empieza a minar EAV7",
      "cta_description": "Bloquea EAV7 en tu billetera para convertirte en minero del consenso DPoS y recibir recompensas por cada bloque producido. Todo self-custodial, con firma poscuántica en el navegador.",
      "cta_lock_button": "Bloquear EAV7",
      "cta_view_validators": "Ver validadores"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "Buscar",
      "dica": "bloque (número) · transacción (E7…) · dirección (E7… o 0x…)"
    },
    "netStatus": {
      "onlineTitle": "Red EAV7 en línea · altura {height}",
      "offlineTitle": "Nodo fuera de línea",
      "connecting": "conectando…"
    },
    "page_address": {
      "metaTitle": "Dirección {addr}… · EAV7 Scan",
      "eyebrow": "dirección",
      "title": "Dirección",
      "roleValidator": "Validador",
      "roleOracle": "Oráculo",
      "roleAccount": "Cuenta",
      "balance": "Saldo",
      "staked": "en staking",
      "nonce": "nonce",
      "feeExempt": "tarifa cero",
      "available": "Disponible",
      "max": "máx {n}",
      "tokensTitle": "Tokens EAV20",
      "colToken": "Token",
      "colSymbol": "Símbolo",
      "colBalance": "Saldo",
      "txsTitle": "Transacciones",
      "colHash": "Hash",
      "colBlock": "Bloque",
      "colType": "Tipo",
      "colCounterparty": "Contraparte",
      "colValue": "Valor",
      "colDate": "Fecha",
      "out": "salida",
      "in": "entrada",
      "noTxs": "no hay transacciones para esta dirección",
      "totalBalance": "saldo total: {n}",
      "tabOverview": "Resumen",
      "tabTransfers": "Transferencias",
      "tabInternal": "Transferencias internas",
      "tabStaking": "Staking y recursos",
      "tabContract": "Contrato",
      "tabPermissions": "Permisos",
      "tabAnalysis": "Análisis",
      "internalNote": "Valor movido por la ejecución de un contrato. No es una transacción firmada, por eso no tiene hash propio.",
      "internalEmpty": "sin transferencias internas",
      "colFrom": "De",
      "colTo": "Para",
      "colTx": "Transacción",
      "stakingTitle": "Stake y recursos",
      "bandwidth": "Ancho de banda",
      "energy": "Energía",
      "delegatedOut": "Delegado a terceros",
      "delegatedIn": "Recibido en delegación",
      "unbondingTitle": "En desbloqueo",
      "matureIn": "se libera en {n} bloques",
      "votesCastTitle": "Votos emitidos",
      "votesReceived": "Votos recibidos",
      "vestingTitle": "Vesting",
      "permsNone": "cuenta de clave única — sin multifirma",
      "permsThreshold": "Umbral",
      "colWeight": "Peso",
      "colKey": "Clave",
      "contractNone": "esta dirección no es un contrato",
      "contractCodeSize": "Tamaño del código",
      "contractVerified": "Verificado",
      "contractUnverified": "No verificado",
      "sent": "Enviado",
      "received": "Recibido",
      "feesPaid": "Comisiones pagadas",
      "txCount": "Transacciones",
      "firstSeen": "Primera actividad",
      "lastSeen": "Última actividad",
      "byType": "Por tipo",
      "topCounterparties": "Principales contrapartes",
      "truncatedNote": "muestra limitada a las transacciones más recientes",
      "noData": "sin datos",
      "nftsTitle": "NFTs (EAV721)",
      "colNftCollection": "Colección",
      "colNftId": "Token",
      "namesTitle": "Nombres EAV-NS",
      "colNsName": "Nombre",
      "colNsTarget": "Resuelve a",
      "votesLabel": "Votos recibidos",
      "commissionLabel": "Comisión",
      "accountInfo": "Información de la cuenta",
      "accountType": "Tipo de cuenta",
      "createdAt": "Creada",
      "totalTxs": "Total de transacciones",
      "tabTokenTx": "Transferencias de token",
      "tokenTxEmpty": "sin transferencias de token",
      "roleContract": "Contrato",
      "roleMultisig": "Multifirma",
      "holdings": "Participaciones",
      "colAsset": "Activo",
      "assets": "Activos",
      "transfersRow": "Transferencias",
      "votesRow": "Votos",
      "claimable": "Recompensas reclamables",
      "tabApprovals": "Aprobaciones",
      "searchHoldings": "Buscar por nombre, símbolo o dirección…",
      "noHoldings": "nada aquí",
      "colSpender": "Autorizado",
      "colLimit": "Límite",
      "more": "Ver más",
      "tabTokens": "Tokens",
      "tabTransactions": "Transacciones",
      "colAge": "Antigüedad",
      "colResult": "Resultado",
      "resultOk": "Éxito",
      "resultRevert": "Revertida",
      "summaryTx": "Total de {n} transacciones",
      "summaryTransfers": "Total de {n} transferencias",
      "summaryInternal": "Total de {n} transferencias internas",
      "filterAll": "Todos",
      "filterIn": "Entrada",
      "filterOut": "Salida",
      "summaryTokenTx": "Total de {n} transferencias de token",
      "colParentHash": "Hash padre",
      "colResourceAmount": "Cantidad de recurso",
      "colStakedAmount": "EAV7 en stake",
      "colUpdatedAt": "Actualizado",
      "stakeNote": "En EAV7 un único stake otorga energía Y ancho de banda a la vez — no se elige un recurso, a diferencia de TRON.",
      "permsOperations": "Operaciones",
      "thisAccount": "esta cuenta",
      "summaryContracts": "Total de {n} contratos",
      "permsNote": "En EAV7 el conjunto de operaciones aplica a cualquier cuenta multifirma — no hay alcance por permiso como en TRON.",
      "permsDefault": "predeterminado",
      "permsDefaultNote": "Sin multifirma configurada. Esta es la autorización efectiva de la cuenta: una clave, una firma."
    },
    "page_block": {
      "metaTitle": "Bloque #{height} · EAV7 Scan",
      "eyebrow": "bloque",
      "title": "Bloque #{height}",
      "sub": "hace {ago}",
      "kv": {
        "height": "Altura",
        "date": "Fecha",
        "producer": "Productor",
        "previousHash": "Hash anterior",
        "merkleRoot": "Merkle root (txs)",
        "txCount": "Transacciones",
        "protocol": "Protocolo",
        "scheme": "esquema"
      },
      "txSectionTitle": "Transacciones del bloque",
      "table": {
        "hash": "Hash",
        "type": "Tipo",
        "from": "De",
        "to": "Para",
        "value": "Valor",
        "fee": "Tarifa"
      },
      "emptyBlock": "bloque vacío"
    },
    "page_docs": {
      "metaTitleFallback": "Documentación · EAV7 Scan",
      "breadcrumb": "documentación",
      "terminal": "terminal",
      "onThisPage": "en esta página"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "Minería · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "Esta página no existe en la cadena EAV7.",
      "backLink": "← volver al inicio"
    },
    "page_search": {
      "metaTitle": "Buscar · EAV7 Scan",
      "title": "No se encontró nada",
      "notRecognizedPrefix": "No reconocimos",
      "notRecognizedSuffix": "como bloque, transacción o dirección EAV7.",
      "retryPlaceholder": "Inténtalo de nuevo…",
      "whatCanSearch": "qué puedes buscar",
      "blockLabel": "bloque",
      "blockDesc": "número de altura, ej.",
      "txLabel": "transacción",
      "txDesc": "hash",
      "txChars": "(64 caracteres)",
      "addressLabel": "dirección",
      "addressLen34": "(34) o",
      "or": "o",
      "evmLabel": "(EAVM)",
      "backHome": "← volver al inicio"
    },
    "page_token": {
      "eyebrow": "Token EAV20",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "Token · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "Estándar",
      "mintable": "emisión abierta",
      "fixedSupply": "suministro fijo",
      "paused": "pausado",
      "tabTransfers": "Transferencias",
      "tabHolders": "Holders",
      "tabAnalysis": "Análisis",
      "totalSupply": "Suministro total",
      "holders": "Holders",
      "decimals": "Decimales",
      "status": "Situación",
      "statusActive": "Activo",
      "statusPaused": "Pausado",
      "createdAt": "Creado",
      "contract": "Contrato",
      "creator": "Creador",
      "owner": "Administrador",
      "mintableLabel": "Puede emitir más",
      "yes": "sí",
      "no": "no",
      "summaryTransfers": "Total de {n} transferencias",
      "summaryHolders": "{n} holders en total — mostrando los {shown} mayores",
      "colHash": "Hash",
      "colBlock": "Bloque",
      "colAge": "Antigüedad",
      "colFrom": "De",
      "colTo": "Para",
      "colAmount": "Valor ({symbol})",
      "colRank": "#",
      "colAddress": "Dirección",
      "colBalance": "Saldo ({symbol})",
      "colShare": "Participación",
      "blacklisted": "bloqueado",
      "noTransfers": "No se encontraron transferencias.",
      "noHolders": "No se encontraron holders.",
      "top1": "Mayor holder",
      "top10": "Top 10",
      "top50": "Top 50",
      "concentrationTitle": "Concentración del suministro",
      "concentrationNote": "Cuánto del suministro está en las mayores carteras. Un suministro grande en pocas manos tiene un riesgo de mercado distinto al de uno distribuido — por eso la distribución importa más que el número total.",
      "largestHolder": "Mayor holder:",
      "overviewTitle": "Visión general",
      "basicInfoTitle": "Información del contrato",
      "activityTitle": "Distribución",
      "largestHolderShort": "Mayor holder",
      "tabContract": "Contrato",
      "nativeTitle": "Token nativo del protocolo",
      "nativeBadge": "sin código arbitrario",
      "nativeNote": "Este token no es un contrato inteligente: lo implementa el propio protocolo. No hay Solidity, compilador ni bytecode que verificar — y tampoco lógica oculta que alguien haya podido escribir. El comportamiento es idéntico para todo token EAV20 y solo cambia con un hard fork de la red.",
      "implementation": "Implementación",
      "implementationValue": "Nativa del consenso (estándar EAV20)",
      "sourceOfTruth": "Código del protocolo",
      "powersTitle": "Qué puede hacer el administrador",
      "powersNote": "En un explorador EVM leerías el código fuente para averiguarlo. Aquí son campos de estado, así que los listamos directamente. Es lo que realmente importa antes de confiar en un token.",
      "powerMint": "Emitir más unidades",
      "powerMintNote": "Aumenta el suministro total y diluye a los tenedores actuales.",
      "powerPause": "Pausar transferencias",
      "powerPauseNote": "Congela todo el movimiento del token de una vez.",
      "powerBlacklist": "Bloquear direcciones",
      "powerBlacklistNote": "Impide que una dirección concreta envíe o reciba.",
      "powerFreeze": "Congelar saldo",
      "powerFreezeNote": "Bloquea parte del saldo de una dirección hasta una fecha.",
      "powerYes": "puede",
      "powerNo": "no puede",
      "powerActiveNow": "activo ahora",
      "adminIs": "Administrador:",
      "restrictionsTitle": "Restricciones vigentes",
      "frozenUntil": "hasta {when}"
    },
    "page_tx": {
      "metaTitle": "Transacción {id}… · EAV7 Scan",
      "eyebrow": "transacción",
      "title": "Transacción",
      "status": "Estado",
      "type": "Tipo",
      "block": "Bloque",
      "from": "De",
      "to": "Para",
      "value": "Valor",
      "fee": "Comisión",
      "nonce": "Nonce",
      "date": "Fecha",
      "scheme": "Esquema",
      "eavmLayer": "Capa EAVM (MetaMask)",
      "energy": "Energía",
      "energyUnit": "energía"
    },
    "page_txs": {
      "metaTitle": "Transacciones · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "estándar EAV20",
        "title": "Tokens",
        "subtitle": "activos nativos del protocolo eav20 — equivalente al TRC20 de Tron"
      },
      "empty": {
        "title": "Aún no se han creado tokens",
        "description": "Los tokens aparecen aquí en cuanto se crean en la red mediante"
      },
      "stats": {
        "tokens": "Tokens EAV20",
        "holders": "Holders (total)",
        "supply": "Suministro combinado",
        "standard": "Estándar"
      },
      "card": {
        "supply": "Suministro",
        "holders": "Holders",
        "share": "participación",
        "creator": "creador"
      }
    },
    "txs_live": {
      "chainLabel": "cadena eav20",
      "title": "Transacciones",
      "live": "en vivo",
      "subtitleLive": "más recientes primero · valores en EAV7",
      "subtitleOlder": "transacciones más antiguas · valores en EAV7",
      "searchPlaceholder": "Buscar tx, bloque o dirección…",
      "cols": {
        "hash": "Hash",
        "block": "Bloque",
        "type": "Tipo",
        "from": "De",
        "to": "Para",
        "value": "Valor",
        "age": "Antigüedad"
      },
      "stats": {
        "totalTx": "Total de transacciones",
        "mempool": "En mempool",
        "volume": "Volumen (EAV7)",
        "avgFee": "Tarifa media"
      },
      "table": {
        "latest": "Últimas transacciones",
        "older": "Transacciones anteriores",
        "updating": "actualizando",
        "empty": "no se encontraron transacciones",
        "count": "{n} transacciones",
        "loadMore": "Cargar más antiguas →",
        "genesis": "inicio de la cadena"
      }
    },
    "ui_copy": {
      "default_value": "valor",
      "aria_label": "Copiar {label}",
      "copied": "copiado ✓",
      "copy_label": "copiar {label}",
      "copy": "copiar"
    },
    "ui_explorerSearch": {
      "placeholder": "Buscar bloque, tx o dirección…",
      "searchButton": "Buscar"
    },
    "validators_live": {
      "unavailable": "nodo no disponible",
      "header": {
        "eyebrow": "consenso DPoS",
        "title": "Validadores",
        "live": "en vivo",
        "subtitle": "{active} activos de {max} slots · stake mínimo {min} EAV7 · rotación en cada bloque"
      },
      "producer": {
        "label": "productor del slot actual",
        "producingBlock": "produciendo el bloque"
      },
      "slot": {
        "label": "slot · {n}s",
        "staked": "{n} EAV7 en stake"
      },
      "rotation": {
        "label": "rotación de producción"
      },
      "stats": {
        "activeValidators": "Validadores activos",
        "rewardPerBlock": "Recompensa / bloque",
        "totalStaked": "Total en stake",
        "peers": "Peers en la red"
      },
      "ranking": {
        "title": "Conjunto activo",
        "sortedBy": "ordenado por stake",
        "producing": "produciendo",
        "active": "activo",
        "stakedCaption": "EAV7 en stake"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "segura"
      },
      "role": {
        "validator": "Validador",
        "oracle": "Oráculo",
        "account": "Cuenta EAV7"
      },
      "lock": {
        "button": "bloquear"
      },
      "balance": {
        "label": "saldo disponible"
      },
      "tier": {
        "validator": "Validador",
        "fee_zero": "Comisión cero",
        "standard": "Estándar"
      },
      "actions": {
        "send": "Enviar",
        "receive": "Recibir",
        "stake": "Stake"
      },
      "stats": {
        "staked": "En stake",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "Comisión",
        "fee_zero": "cero",
        "fee_standard": "estándar"
      },
      "tier_progress": {
        "label": "progreso del nivel",
        "remaining_prefix": "faltan",
        "remaining_suffix": "para el nivel {tier}"
      },
      "receive": {
        "title": "Recibir EAV7",
        "description_before": "Comparte tu dirección",
        "description_after": "— la red la asigna automáticamente a tu E7 nativo.",
        "close": "cerrar"
      },
      "activity": {
        "title": "Actividad reciente",
        "sent": "Enviado",
        "received": "Recibido"
      },
      "addresses": {
        "hint": "usa este 0x para recibir (estándar EAVM/MetaMask)"
      },
      "tokens": {
        "title": "Tokens EAV20"
      },
      "footer": {
        "quantum": "poscuántica · secp256k1 + ML-DSA-44",
        "logout": "salir / cambiar"
      },
      "wipe": {
        "title": "¿Eliminar esta cartera?",
        "description_before": "La cartera cifrada se eliminará",
        "description_bold": "de este navegador",
        "description_after": ". Solo puedes restaurarla con el backup de la clave privada — no hay recuperación de contraseña.",
        "warning_before": "Confirma que tienes el",
        "warning_bold": "backup de la clave",
        "warning_after": "antes de eliminar.",
        "download_backup": "Descargar backup (.json)",
        "cancel": "Cancelar",
        "confirm": "Eliminar cartera"
      }
    },
    "wallet_addNet": {
      "title": "Usar en MetaMask / Trust",
      "description": "Agrega la red EAV7 (chain 72020) a tu billetera EVM.",
      "adding": "agregando…",
      "added": "✓ agregada",
      "addButton": "Agregar red",
      "noWallet": "MetaMask no detectada en este navegador.",
      "error": "no se pudo agregar la red."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "solo tú tienes el control",
        "on_device_title": "en el dispositivo",
        "on_device_desc": "la clave nunca sale",
        "quantum_title": "resistente a cuántica",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "Copia",
        "password": "Contraseña",
        "ready": "Listo"
      },
      "unlock": {
        "title": "Bienvenido de nuevo",
        "subtitle": "Hay una billetera cifrada en este navegador. Ingresa la contraseña para desbloquearla.",
        "password_placeholder": "contraseña",
        "error_wrong_password": "contraseña incorrecta",
        "unlocking": "desbloqueando…",
        "unlock_button": "Desbloquear billetera",
        "wipe_confirm": "¿Eliminar la billetera de este navegador? ¡Asegúrate de tener la copia de la clave!",
        "wipe_button": "eliminar y empezar de nuevo"
      },
      "choose": {
        "title": "Tu billetera EAV7",
        "subtitle": "Una billetera self-custodial: eres el único dueño de tus claves. Empieza en segundos.",
        "create_title": "Crear nueva billetera",
        "create_desc": "Genera una clave nueva en este dispositivo.",
        "import_title": "Importar clave",
        "import_desc": "¿Ya tienes una clave privada? Restáurala aquí."
      },
      "import": {
        "title": "Importar billetera",
        "subtitle": "Pega la clave privada y elige una contraseña para cifrarla en este navegador.",
        "label": "Clave privada (0x + 64 hex)",
        "importing": "importando…",
        "button": "Importar",
        "back": "Volver",
        "error_invalid_key": "clave privada inválida (se esperaba 0x + 64 hex)"
      },
      "create": {
        "title": "Haz la copia de seguridad de tu clave",
        "subtitle": "No hay recuperación de contraseña. Quien tenga la clave privada controla los fondos — guárdala antes de continuar.",
        "warning_prefix": "Esta clave ",
        "warning_bold": "es la única forma",
        "warning_suffix": " de acceder a tus fondos. Guárdala fuera de línea — nunca la compartas con nadie.",
        "address_label": "dirección E7",
        "private_key_label": "clave privada",
        "reveal": "revelar",
        "hide": "ocultar",
        "download_backup": "⭳ Descargar copia (.json)",
        "confirm_saved": "Guardé mi clave en un lugar seguro",
        "creating": "creando…",
        "create_button": "Crear billetera",
        "confirm_hint": "confirma que guardaste la clave",
        "back": "Volver"
      },
      "errors": {
        "password_min": "la contraseña necesita al menos 6 caracteres",
        "password_mismatch": "las contraseñas no coinciden",
        "save_error": "error al guardar"
      },
      "password": {
        "label": "Contraseña para cifrar (mín. 6 caracteres)",
        "placeholder": "contraseña",
        "confirm_placeholder": "confirmar contraseña",
        "mismatch": "las contraseñas no coinciden",
        "strength": {
          "very_weak": "muy débil",
          "weak": "débil",
          "fair": "razonable",
          "good": "buena",
          "strong": "fuerte"
        }
      }
    },
    "wallet_send": {
      "title": "Enviar EAV7",
      "steps": {
        "destination": "Destino",
        "value": "Monto",
        "review": "Revisar"
      },
      "recipient": {
        "label": "Destino (0x… EAVM/MetaMask)",
        "paste": "pegar",
        "valid": "✓ dirección válida",
        "invalid": "dirección 0x inválida"
      },
      "errors": {
        "needEvmAddress": "indique el 0x del destino (la billetera web firma en el modelo EAVM)",
        "invalidAddress": "el destino debe ser una dirección 0x (EAVM/MetaMask)",
        "needPositiveAmount": "indique un monto positivo",
        "insufficientBalance": "saldo insuficiente (considere la tarifa)",
        "invalidAmount": "monto inválido",
        "sendFailed": "error al enviar"
      },
      "continue": "Continuar",
      "cancel": "Cancelar",
      "available": "disponible: {amount} EAV7",
      "percent": {
        "max": "MÁX"
      },
      "back": "Volver",
      "sendingLabel": "enviando",
      "sendingTo": "a {addr}",
      "networkFee": "Tarifa de red",
      "balanceAfter": "Saldo después",
      "quantumNote": "firmado en este dispositivo · protección postcuántica de la red",
      "confirmAndSign": "Confirmar y firmar",
      "signing": "firmando…",
      "transactionSent": {
        "title": "Transacción enviada",
        "subtitle": "Se confirma en el próximo bloque (~1s)."
      },
      "close": "cerrar"
    },
    "wallet_stake": {
      "title": "Stake",
      "subtitle": "≥ 100 EAV7 elimina comisiones · ≥ 1.000 te convierte en minero (16 EAV7/bloque producido).",
      "tierZeroFee": {
        "label": "Comisión cero",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "Validador",
        "sub": "≥ 1.000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "en stake ahora:",
      "warnValidator": "Esto reduce tu stake por debajo de 1.000 — perderás el estatus de validador.",
      "warnFeeReset": "Esto reduce tu stake por debajo de 100 — tus transacciones volverán a pagar comisión.",
      "warnConfirm": "entendido, eliminar de todos modos →",
      "errInvalidAmount": "ingresa un valor positivo",
      "errInvalidValue": "valor inválido",
      "errFailedOp": "la operación falló",
      "sentTitle": "Operación enviada",
      "close": "cerrar",
      "stakeBtn": "Hacer stake",
      "removeBtn": "Eliminar"
    }
  },
  "zh": {
    "blocks_live": {
      "networkLabel": "eav20 链",
      "title": "区块",
      "live": "实时",
      "blockTimeInfo": "每 {n} 秒产生一个新区块 · DPoS 共识",
      "searchPlaceholder": "按高度或哈希搜索区块…",
      "stats": {
        "height": "当前高度",
        "blockTime": "出块时间",
        "avgTx": "每区块交易数（均值）",
        "activeProducers": "活跃生产者"
      },
      "latestBlocks": "最新区块",
      "updating": "更新中",
      "columns": {
        "block": "区块",
        "age": "时间",
        "txs": "交易数",
        "producer": "生产者",
        "reward": "奖励",
        "hash": "哈希"
      }
    },
    "comingSoon": {
      "badge": "建设中 · 第 4 个冲刺",
      "backToExplorer": "← 返回浏览器"
    },
    "docs_api": {
      "badge": "公共 API",
      "title": "直接从节点查询网络",
      "baseUrl": "基础 URL",
      "tags": {
        "cors": "已启用 CORS",
        "units": "数值以 e7 表示",
        "noAuth": "无需身份验证"
      },
      "groups": {
        "read": "读取",
        "write": "写入"
      },
      "endpoints": {
        "status": "网络状态：高度、验证者、内存池、区块奖励",
        "blocks": "最近 N 个区块",
        "blockByHeight": "按高度或哈希查询区块",
        "txs": "最近的交易，分页",
        "tx": "按 id 查询交易",
        "address": "余额、质押、nonce、角色、代币和能量",
        "tokens": "EAV20 代币列表（或 /tokens/:id 查看详情）",
        "validators": "活跃的 DPoS 集合 + 出块者",
        "sendTx": "发送已签名的原生交易（secp256k1 + ML-DSA-44）",
        "sendEavmTx": "通过 EAVM 层发送交易（兼容 JSON-RPC）"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "自定义网络"
      },
      "title": "在你的钱包中使用 EAV7",
      "description": "EAV7 使用通用钱包能理解的 JSON-RPC 方言——一键添加网络。",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "任意 EVM 钱包"
      },
      "params": {
        "networkName": "网络名称",
        "rpcUrl": "RPC 网址",
        "chainId": "链 ID",
        "symbol": "代币符号",
        "explorer": "浏览器",
        "decimals": "小数位数"
      },
      "button": {
        "adding": "添加中…",
        "addToMetamask": "添加到 MetaMask"
      },
      "status": {
        "added": "网络已添加!",
        "noWallet": "未检测到 MetaMask —— 请复制旁边的信息。"
      },
      "error": {
        "addFailed": "无法添加该网络"
      },
      "mapping": {
        "badge": "同一账户",
        "title": "两种身份,一个账户",
        "labelEavm": "EAVM",
        "labelNative": "原生",
        "desc1": "MetaMask 显示的是",
        "desc2": ";链上余额则存放在对应的",
        "desc3": "地址中。两者是同一个账户。"
      },
      "steps": {
        "step1": "点击添加 EAV7 网络",
        "step2": "你的账户会以 0x… 的形式显示在钱包中",
        "step3": "链上余额存放在对应的 E7 地址中"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "出块时间",
        "stat_validators_value": "最多27个",
        "stat_validators_label": "DPoS 验证者",
        "stat_supply_value": "1000亿",
        "stat_supply_label": "EAV7 供应量",
        "stat_reward_label": "每区块 EAV7",
        "stat_quantum_value": "混合式",
        "stat_quantum_label": "后量子",
        "pillars_title": "协议支柱",
        "pillar_consensus": "DPoS 共识",
        "pillar_token_standard": "EAV20 标准",
        "pillar_bridge": "跨链桥",
        "pillar_security": "安全与AI",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "EAV20 标准",
        "title": "原生代币,无需虚拟机",
        "description": "相当于 TRC20:代币直接存在于链状态中,通过签名交易转移 — 快速、低成本、可验证。",
        "cta": "查看网络代币"
      },
      "consenso": {
        "badge": "DPoS 共识",
        "title": "每秒产生一个新区块",
        "description": "验证者按轮次交替出块:每个1秒的时段,预期的出块者对下一个区块签名。无需算力竞争,无需等待。",
        "slot_now": "当前时段",
        "slot_offset": "+{n} 时段",
        "fact_election_label": "选举",
        "fact_election_value": "按质押排名前27名(≥ 1,000 EAV7)",
        "fact_production_label": "出块",
        "fact_production_value": "validators[slot % N] · 轮询制",
        "fact_fork_choice_label": "分叉选择",
        "fact_fork_choice_value": "最长有效链",
        "cta": "查看实时验证者"
      },
      "ponte": {
        "title": "跨链桥如何在网络间转移价值",
        "arrow_pays": "支付",
        "node_external": "外部网络",
        "step_bridge_out": "锁定 EAV7/代币并记录外部目标地址",
        "step_relayer": "监测转出请求并在外部链上支付",
        "step_bridge_settle": "在链上标记该转出为已支付(幂等)",
        "step_bridge_in": "释放外部资金,按 sourceTxHash 去重"
      },
      "seguranca": {
        "badge_hybrid": "混合签名",
        "title_hybrid": "设计即后量子",
        "verify_both": "验证需要两者兼备",
        "hybrid_description": "每个钱包、交易和区块都携带两种签名 — ECDSA(成熟稳定)和 ML-DSA-44(FIPS 204,抗量子)。伪造需要同时破解两种加密原语。",
        "badge_ai": "AI 层",
        "title_ai": "带链上托管的预言机",
        "sentinel_title": "安全哨兵 · 24小时",
        "sentinel_description": "一个进程持续监控网络 — 重组、巨额转账、交易激增和出块者集中度 — 并将结果记录到安全动态中。",
        "sentinel_cta": "在挖矿页查看"
      },
      "staking": {
        "tier_fee_title": "零手续费",
        "tier_fee_desc": "锁定100+ EAV7,你的交易将享受零手续费 — 能量(带宽)通过冻结产生,并随时间恢复。",
        "tier_mine_title": "挖矿出块",
        "tier_mine_desc": "锁定1,000+ EAV7即可参与DPoS选举。出块后你将全额获得16 EAV7加上该区块的手续费。",
        "reward_title": "奖励与解锁",
        "reward_desc": "奖励全额发放给出块者。解锁会将金额释放回你的余额 — 但不允许清空网络中最后一个验证者。",
        "cta_lock": "锁定 EAV7",
        "cta_mining": "查看挖矿"
      }
    },
    "energyGauge": {
      "ariaLabel": "能量 {available} / {max}",
      "title": "能量",
      "description": "用于支付交易费用的资源。随时间恢复,并随质押锁定的EAV7增长。"
    },
    "home_activityBars": {
      "ariaLabel": "每个区块的交易数",
      "txsCount": "{n} 笔交易"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "概览",
        "blocks": "区块",
        "transactions": "交易",
        "validators": "验证者",
        "tokens": "代币"
      },
      "cols": {
        "block": "区块",
        "age": "时间",
        "txs": "交易数",
        "producer": "出块者",
        "reward": "奖励",
        "hash": "哈希"
      },
      "sidebar": {
        "explore": "浏览",
        "network": "网络"
      },
      "toolbar": {
        "filter": "筛选",
        "sort": "排序",
        "live": "实时"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "浏览",
      "title": "链上一切,实时呈现",
      "description": "区块和交易正在实时流动。点击任意项目即可查看详情。",
      "viewBlocks": "查看区块",
      "viewTxs": "查看交易"
    },
    "home_heartbeat": {
      "label": "心跳",
      "blockAgoPrefix": "区块于",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} 笔交易",
      "viewAll": "查看全部"
    },
    "home_hero": {
      "coin_alt": "EAV7 代币",
      "title": "链上浏览器的新时代",
      "subtitle": "每 1 秒出块，后量子安全性，原生 AI 层。实时查询区块、交易、验证者和地址。",
      "search_placeholder": "搜索区块、交易或地址…",
      "search_button": "探索",
      "stat_height": "高度",
      "stat_block": "出块时间",
      "stat_validators": "验证者",
      "stat_mempool": "内存池"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "EAV7 代币",
        "titleBefore": "EAV7 区块链，以及",
        "titleHighlight": "更多",
        "subtitle": "1秒DPoS共识、后量子安全和原生AI层。实时探索区块、交易和验证者。",
        "exploreNetwork": "探索网络",
        "openWallet": "打开钱包",
        "scrollAriaLabel": "滚动到面板"
      },
      "vitals": {
        "height": "高度",
        "blockTime": "出块时间",
        "validators": "验证者"
      }
    },
    "home_inkBand": {
      "eyebrow": "互动",
      "title": "移动鼠标以揭示",
      "subtitle": "EAV7 网络,超越区块",
      "mobileHint": "在手机上图案会直接显示"
    },
    "home_latestTxs": {
      "title": "最新交易",
      "viewAll": "查看全部",
      "table": {
        "hash": "哈希",
        "type": "类型",
        "fromTo": "从 → 到",
        "value": "金额"
      },
      "empty": "暂无交易"
    },
    "home_moments": {
      "sectionEyebrow": "协议内部",
      "sectionTitle": "为持久而生的 L1",
      "items": {
        "security": {
          "eyebrow": "安全",
          "titlePrefix": "为",
          "titleHighlight": "后量子时代",
          "desc": "每个钱包、交易和区块都携带两个签名——验证需要同时满足两者。伪造需要同时破解两种密码学原语。",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "通过 SHA3-256 派生的 E7 地址"
        },
        "consensus": {
          "eyebrow": "共识",
          "titlePrefix": "每",
          "titleHighlight": "1 秒",
          "desc": "DPoS 共识机制,最多 27 个按质押选出的验证者,确定性轮换——比 Tron 快 3 倍,且具备受保护的活性。",
          "bullet1": "27 个验证者 · 按插槽轮询",
          "bullet2": "每区块奖励 16 EAV7"
        },
        "intelligence": {
          "eyebrow": "智能",
          "titlePrefix": "一层",
          "titleHighlight": "原生 AI",
          "desc": "带托管的链上预言机:AI 任务被发布、由指定的预言机解决,并以可验证的方式结算——全部在协议内完成。",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "结果哈希记录在链上"
        },
        "assets": {
          "eyebrow": "资产",
          "titlePrefix": "代币",
          "titleHighlight": "EAV20",
          "titleSuffix": "与跨链桥",
          "desc": "创建和转移原生代币(等同于 TRC20),并通过安全、幂等的锁定释放模型将 EAV7 连接到其他网络。",
          "bullet1": "EAV20 标准 · create / transfer / approve",
          "bullet2": "TRON · ETH · BTC 跨链桥(锁定释放)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "实时",
      "title": "网络脉动",
      "subtitle": "每秒一个新区块。实时关注 EAV7 网络的跳动。",
      "stats": {
        "blockHeight": "区块高度",
        "txLast30": "交易数 · 最近 30 个区块",
        "mempool": "内存池",
        "rewardPerBlock": "EAV7 / 区块"
      },
      "activity": {
        "title": "网络活动",
        "txInLastBlocks": "最近 {n} 个区块的交易数"
      },
      "slots": {
        "title": "DPoS 席位",
        "activeValidators": "活跃验证者",
        "supply": "流通量 {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "账户总数"
        },
        "transactions": {
          "label": "交易总数"
        },
        "volume": {
          "label": "转账总量"
        },
        "staked": {
          "label": "质押总量"
        }
      },
      "ring": {
        "supplyLine1": "占总供应量",
        "supplyLine2": "已锁定质押"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} / {max}"
    },
    "home_walletCta": {
      "eyebrow": "立即开始",
      "title": "立即探索 EAV7 网络",
      "description": "您的钱包在浏览器中生成并签名,具备后量子保护——永远不会离开您的设备。直接通过网页发送、质押和挖矿。",
      "createWallet": "创建钱包",
      "exploreNetwork": "探索网络"
    },
    "mining_live": {
      "badge_consensus": "DPoS · 质押",
      "title": "挖矿",
      "live_badge": "实时",
      "subtitle": "在 EAV7 上,您通过锁定 EAV7(质押)进行挖矿——无需硬件,无能源消耗",
      "stat_reward_block": "每区块奖励",
      "stat_blocks_day": "每日区块数",
      "stat_daily_emission": "每日发行量",
      "stat_already_mined": "已挖出",
      "network_production": "网络产出",
      "reward_per_block_caption": "每个区块奖励(1秒)",
      "annual_emission_caption": "预计年发行量",
      "next_block": "下一个区块",
      "miners_label": "矿工",
      "staked_label": "已锁定 EAV7",
      "block_time_label": "出块时间",
      "ai_sentinel_badge": "AI 哨兵 · 24小时",
      "network_protected": "网络受保护",
      "ai_monitoring_desc": "原生 AI 持续监控",
      "alerts_analyzed": "已分析警报",
      "active_oracles": "活跃预言机",
      "pending_ai_tasks": "待处理 AI 任务",
      "cta_title": "开始挖矿 EAV7",
      "cta_description": "在您的钱包中锁定 EAV7,成为 DPoS 共识的矿工,并为每个生成的区块获得奖励。全程自托管,浏览器内进行后量子签名。",
      "cta_lock_button": "锁定 EAV7",
      "cta_view_validators": "查看验证者"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "搜索",
      "dica": "区块（编号）· 交易（E7…）· 地址（E7… 或 0x…）"
    },
    "netStatus": {
      "onlineTitle": "EAV7 网络在线 · 高度 {height}",
      "offlineTitle": "节点离线",
      "connecting": "连接中…"
    },
    "page_address": {
      "metaTitle": "地址 {addr}… · EAV7 Scan",
      "eyebrow": "地址",
      "title": "地址",
      "roleValidator": "验证者",
      "roleOracle": "预言机",
      "roleAccount": "账户",
      "balance": "余额",
      "staked": "质押中",
      "nonce": "nonce",
      "feeExempt": "零手续费",
      "available": "可用",
      "max": "最大 {n}",
      "tokensTitle": "EAV20 代币",
      "colToken": "代币",
      "colSymbol": "符号",
      "colBalance": "余额",
      "txsTitle": "交易",
      "colHash": "哈希",
      "colBlock": "区块",
      "colType": "类型",
      "colCounterparty": "对手方",
      "colValue": "金额",
      "colDate": "日期",
      "out": "转出",
      "in": "转入",
      "noTxs": "该地址暂无交易",
      "totalBalance": "总余额：{n}",
      "tabOverview": "概览",
      "tabTransfers": "转账",
      "tabInternal": "内部转账",
      "tabStaking": "质押与资源",
      "tabContract": "合约",
      "tabPermissions": "权限",
      "tabAnalysis": "分析",
      "internalNote": "由合约执行移动的价值。它不是已签名的交易，因此没有自己的哈希。",
      "internalEmpty": "无内部转账",
      "colFrom": "从",
      "colTo": "至",
      "colTx": "交易",
      "stakingTitle": "质押与资源",
      "bandwidth": "带宽",
      "energy": "能量",
      "delegatedOut": "代理出",
      "delegatedIn": "代理入",
      "unbondingTitle": "解锁中",
      "matureIn": "{n} 个区块后解锁",
      "votesCastTitle": "已投票",
      "votesReceived": "获得投票",
      "vestingTitle": "锁仓释放",
      "permsNone": "单密钥账户 — 无多重签名",
      "permsThreshold": "阈值",
      "colWeight": "权重",
      "colKey": "密钥",
      "contractNone": "该地址不是合约",
      "contractCodeSize": "代码大小",
      "contractVerified": "已验证",
      "contractUnverified": "未验证",
      "sent": "发送",
      "received": "接收",
      "feesPaid": "已付手续费",
      "txCount": "交易数",
      "firstSeen": "首次活动",
      "lastSeen": "最近活动",
      "byType": "按类型",
      "topCounterparties": "主要交易对手",
      "truncatedNote": "样本仅限于最近的交易",
      "noData": "无数据",
      "nftsTitle": "NFT (EAV721)",
      "colNftCollection": "系列",
      "colNftId": "代币",
      "namesTitle": "EAV-NS 域名",
      "colNsName": "名称",
      "colNsTarget": "解析到",
      "votesLabel": "获得投票",
      "commissionLabel": "佣金",
      "accountInfo": "账户信息",
      "accountType": "账户类型",
      "createdAt": "创建于",
      "totalTxs": "交易总数",
      "tabTokenTx": "代币转账",
      "tokenTxEmpty": "无代币转账",
      "roleContract": "合约",
      "roleMultisig": "多重签名",
      "holdings": "持仓",
      "colAsset": "资产",
      "assets": "资产",
      "transfersRow": "转账",
      "votesRow": "投票",
      "claimable": "可领取奖励",
      "tabApprovals": "授权",
      "searchHoldings": "按名称、符号或地址搜索…",
      "noHoldings": "暂无内容",
      "colSpender": "被授权方",
      "colLimit": "额度",
      "more": "查看更多",
      "tabTokens": "代币",
      "tabTransactions": "交易",
      "colAge": "时间",
      "colResult": "结果",
      "resultOk": "成功",
      "resultRevert": "已回滚",
      "summaryTx": "共 {n} 笔交易",
      "summaryTransfers": "共 {n} 笔转账",
      "summaryInternal": "共 {n} 笔内部转账",
      "filterAll": "全部",
      "filterIn": "转入",
      "filterOut": "转出",
      "summaryTokenTx": "共 {n} 笔代币转账",
      "colParentHash": "父哈希",
      "colResourceAmount": "资源数量",
      "colStakedAmount": "质押的 EAV7",
      "colUpdatedAt": "更新于",
      "stakeNote": "在 EAV7 中，一次质押同时授予能量和带宽 — 与 TRON 不同，无需选择资源类型。",
      "permsOperations": "操作",
      "thisAccount": "当前账户",
      "summaryContracts": "共 {n} 个合约",
      "permsNote": "在 EAV7 中操作集适用于任何多签账户 — 不像 TRON 那样按权限划分范围。",
      "permsDefault": "默认",
      "permsDefaultNote": "未配置多重签名。这是账户的有效授权：一个密钥，一个签名。"
    },
    "page_block": {
      "metaTitle": "区块 #{height} · EAV7 Scan",
      "eyebrow": "区块",
      "title": "区块 #{height}",
      "sub": "{ago}前",
      "kv": {
        "height": "高度",
        "date": "日期",
        "producer": "生产者",
        "previousHash": "上一个哈希",
        "merkleRoot": "Merkle 根 (交易)",
        "txCount": "交易数",
        "protocol": "协议",
        "scheme": "方案"
      },
      "txSectionTitle": "区块交易",
      "table": {
        "hash": "哈希",
        "type": "类型",
        "from": "发送方",
        "to": "接收方",
        "value": "金额",
        "fee": "手续费"
      },
      "emptyBlock": "空区块"
    },
    "page_docs": {
      "metaTitleFallback": "文档 · EAV7 Scan",
      "breadcrumb": "文档",
      "terminal": "终端",
      "onThisPage": "本页内容"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "挖矿 · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "此页面在 EAV7 链上不存在。",
      "backLink": "← 返回首页"
    },
    "page_search": {
      "metaTitle": "搜索 · EAV7 Scan",
      "title": "未找到结果",
      "notRecognizedPrefix": "我们无法将",
      "notRecognizedSuffix": "识别为区块、交易或 EAV7 地址。",
      "retryPlaceholder": "再试一次…",
      "whatCanSearch": "可以搜索什么",
      "blockLabel": "区块",
      "blockDesc": "区块高度编号，例如",
      "txLabel": "交易",
      "txDesc": "哈希",
      "txChars": "（64 个字符）",
      "addressLabel": "地址",
      "addressLen34": "（34 位）或",
      "or": "或",
      "evmLabel": "（EAVM）",
      "backHome": "← 返回首页"
    },
    "page_token": {
      "eyebrow": "EAV20 代币",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "代币 · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "标准",
      "mintable": "可增发",
      "fixedSupply": "固定供应",
      "paused": "已暂停",
      "tabTransfers": "转账",
      "tabHolders": "持有者",
      "tabAnalysis": "分析",
      "totalSupply": "总供应量",
      "holders": "持有者",
      "decimals": "小数位",
      "status": "状态",
      "statusActive": "正常",
      "statusPaused": "已暂停",
      "createdAt": "创建时间",
      "contract": "合约",
      "creator": "创建者",
      "owner": "管理员",
      "mintableLabel": "可增发",
      "yes": "是",
      "no": "否",
      "summaryTransfers": "共 {n} 笔转账",
      "summaryHolders": "共 {n} 位持有者 — 显示前 {shown} 位",
      "colHash": "哈希",
      "colBlock": "区块",
      "colAge": "时间",
      "colFrom": "从",
      "colTo": "至",
      "colAmount": "数量 ({symbol})",
      "colRank": "#",
      "colAddress": "地址",
      "colBalance": "余额 ({symbol})",
      "colShare": "占比",
      "blacklisted": "已封禁",
      "noTransfers": "未找到转账记录。",
      "noHolders": "未找到持有者。",
      "top1": "最大持有者",
      "top10": "前 10",
      "top50": "前 50",
      "concentrationTitle": "供应集中度",
      "concentrationNote": "最大钱包持有的供应量占比。大量供应集中在少数人手中，其市场风险与广泛分散的供应完全不同——因此分布比总量更重要。",
      "largestHolder": "最大持有者：",
      "overviewTitle": "概览",
      "basicInfoTitle": "合约信息",
      "activityTitle": "分布",
      "largestHolderShort": "最大持有者",
      "tabContract": "合约",
      "nativeTitle": "协议原生代币",
      "nativeBadge": "无任意代码",
      "nativeNote": "该代币不是智能合约，而是由协议本身实现。没有 Solidity、编译器或字节码需要验证——同样也不存在任何人可能写入的隐藏逻辑。所有 EAV20 代币行为一致，仅通过网络硬分叉才会改变。",
      "implementation": "实现方式",
      "implementationValue": "共识原生（EAV20 标准）",
      "sourceOfTruth": "协议源码",
      "powersTitle": "管理员可以做什么",
      "powersNote": "在 EVM 浏览器中，你需要阅读源码才能了解这些。这里它们是状态字段，因此直接列出。信任一个代币之前，这才是真正重要的。",
      "powerMint": "增发单位",
      "powerMintNote": "增加总供应量并稀释现有持有者。",
      "powerPause": "暂停转账",
      "powerPauseNote": "一次性冻结该代币的所有流转。",
      "powerBlacklist": "封禁地址",
      "powerBlacklistNote": "阻止特定地址发送或接收。",
      "powerFreeze": "冻结余额",
      "powerFreezeNote": "将某地址的部分余额锁定至指定日期。",
      "powerYes": "可以",
      "powerNo": "不可以",
      "powerActiveNow": "当前生效",
      "adminIs": "管理员：",
      "restrictionsTitle": "生效中的限制",
      "frozenUntil": "至 {when}"
    },
    "page_tx": {
      "metaTitle": "交易 {id}… · EAV7 Scan",
      "eyebrow": "交易",
      "title": "交易",
      "status": "状态",
      "type": "类型",
      "block": "区块",
      "from": "发送方",
      "to": "接收方",
      "value": "金额",
      "fee": "手续费",
      "nonce": "Nonce",
      "date": "日期",
      "scheme": "方案",
      "eavmLayer": "EAVM 层 (MetaMask)",
      "energy": "能量",
      "energyUnit": "能量"
    },
    "page_txs": {
      "metaTitle": "交易 · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "EAV20 标准",
        "title": "代币",
        "subtitle": "eav20 协议的原生资产 — 相当于波场的 TRC20"
      },
      "empty": {
        "title": "尚未创建任何代币",
        "description": "代币一旦在网络上创建即会显示在此处，创建方式为"
      },
      "stats": {
        "tokens": "EAV20 代币",
        "holders": "持有人（总计）",
        "supply": "合计供应量",
        "standard": "标准"
      },
      "card": {
        "supply": "供应量",
        "holders": "持有人",
        "share": "占比",
        "creator": "创建者"
      }
    },
    "txs_live": {
      "chainLabel": "eav20 链",
      "title": "交易",
      "live": "实时",
      "subtitleLive": "最新优先 · 数值单位为 EAV7",
      "subtitleOlder": "较早的交易 · 数值单位为 EAV7",
      "searchPlaceholder": "搜索交易、区块或地址…",
      "cols": {
        "hash": "哈希",
        "block": "区块",
        "type": "类型",
        "from": "发送方",
        "to": "接收方",
        "value": "金额",
        "age": "时间"
      },
      "stats": {
        "totalTx": "交易总数",
        "mempool": "内存池中",
        "volume": "交易量 (EAV7)",
        "avgFee": "平均手续费"
      },
      "table": {
        "latest": "最新交易",
        "older": "历史交易",
        "updating": "更新中",
        "empty": "未找到交易",
        "count": "{n} 笔交易",
        "loadMore": "加载更早 →",
        "genesis": "链的起点"
      }
    },
    "ui_copy": {
      "default_value": "值",
      "aria_label": "复制{label}",
      "copied": "已复制 ✓",
      "copy_label": "复制{label}",
      "copy": "复制"
    },
    "ui_explorerSearch": {
      "placeholder": "搜索区块、交易或地址…",
      "searchButton": "搜索"
    },
    "validators_live": {
      "unavailable": "节点不可用",
      "header": {
        "eyebrow": "DPoS 共识",
        "title": "验证者",
        "live": "实时",
        "subtitle": "{active} 个活跃 / 共 {max} 个席位 · 最低质押 {min} EAV7 · 每个区块轮换"
      },
      "producer": {
        "label": "当前时段出块者",
        "producingBlock": "正在生成区块"
      },
      "slot": {
        "label": "时段 · {n}秒",
        "staked": "质押 {n} EAV7"
      },
      "rotation": {
        "label": "出块轮换"
      },
      "stats": {
        "activeValidators": "活跃验证者",
        "rewardPerBlock": "每区块奖励",
        "totalStaked": "总质押量",
        "peers": "网络节点数"
      },
      "ranking": {
        "title": "活跃集合",
        "sortedBy": "按质押量排序",
        "producing": "出块中",
        "active": "活跃",
        "stakedCaption": "EAV7 质押"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "安全"
      },
      "role": {
        "validator": "验证者",
        "oracle": "预言机",
        "account": "EAV7 账户"
      },
      "lock": {
        "button": "锁定"
      },
      "balance": {
        "label": "可用余额"
      },
      "tier": {
        "validator": "验证者",
        "fee_zero": "零手续费",
        "standard": "标准"
      },
      "actions": {
        "send": "发送",
        "receive": "接收",
        "stake": "质押"
      },
      "stats": {
        "staked": "质押中",
        "staked_suffix": "EAV7",
        "nonce": "序号",
        "fee": "手续费",
        "fee_zero": "零",
        "fee_standard": "标准"
      },
      "tier_progress": {
        "label": "等级进度",
        "remaining_prefix": "还差",
        "remaining_suffix": "达到{tier}等级"
      },
      "receive": {
        "title": "接收 EAV7",
        "description_before": "分享您的地址",
        "description_after": "—网络会自动映射到您的原生 E7。",
        "close": "关闭"
      },
      "activity": {
        "title": "最近活动",
        "sent": "已发送",
        "received": "已接收"
      },
      "addresses": {
        "hint": "使用此 0x 地址接收（EAVM/MetaMask 标准）"
      },
      "tokens": {
        "title": "EAV20 代币"
      },
      "footer": {
        "quantum": "后量子 · secp256k1 + ML-DSA-44",
        "logout": "退出/切换"
      },
      "wipe": {
        "title": "删除此钱包？",
        "description_before": "加密钱包将从",
        "description_bold": "此浏览器中",
        "description_after": "移除。您只能通过私钥备份恢复——没有密码恢复功能。",
        "warning_before": "请确认您已拥有",
        "warning_bold": "密钥备份",
        "warning_after": "再进行删除。",
        "download_backup": "下载备份（.json）",
        "cancel": "取消",
        "confirm": "删除钱包"
      }
    },
    "wallet_addNet": {
      "title": "在 MetaMask / Trust 中使用",
      "description": "将 EAV7 网络(链 72020)添加到您的 EVM 钱包。",
      "adding": "添加中…",
      "added": "✓ 已添加",
      "addButton": "添加网络",
      "noWallet": "此浏览器未检测到 MetaMask。",
      "error": "无法添加该网络。"
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "只有你能掌控",
        "on_device_title": "本地保存",
        "on_device_desc": "私钥永不外泄",
        "quantum_title": "抗量子",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "备份",
        "password": "密码",
        "ready": "完成"
      },
      "unlock": {
        "title": "欢迎回来",
        "subtitle": "此浏览器中存有一个加密钱包。请输入密码以解锁。",
        "password_placeholder": "密码",
        "error_wrong_password": "密码错误",
        "unlocking": "解锁中…",
        "unlock_button": "解锁钱包",
        "wipe_confirm": "确定要删除此浏览器中的钱包吗？请确保已备份私钥！",
        "wipe_button": "删除并重新开始"
      },
      "choose": {
        "title": "你的 EAV7 钱包",
        "subtitle": "一个自托管钱包：只有你拥有自己的私钥。几秒钟即可开始。",
        "create_title": "创建新钱包",
        "create_desc": "在此设备上生成新的私钥。",
        "import_title": "导入私钥",
        "import_desc": "已有私钥？在此恢复。"
      },
      "import": {
        "title": "导入钱包",
        "subtitle": "粘贴私钥并设置密码，在此浏览器中对其加密。",
        "label": "私钥（0x + 64位十六进制）",
        "importing": "导入中…",
        "button": "导入",
        "back": "返回",
        "error_invalid_key": "私钥无效（应为 0x + 64位十六进制）"
      },
      "create": {
        "title": "备份你的私钥",
        "subtitle": "密码无法找回。拥有私钥即可控制资金 — 请在继续之前妥善保存。",
        "warning_prefix": "这个私钥",
        "warning_bold": "是访问资金的唯一方式",
        "warning_suffix": "。请离线保存 — 切勿与任何人分享。",
        "address_label": "E7 地址",
        "private_key_label": "私钥",
        "reveal": "显示",
        "hide": "隐藏",
        "download_backup": "⭳ 下载备份 (.json)",
        "confirm_saved": "我已将私钥保存在安全的地方",
        "creating": "创建中…",
        "create_button": "创建钱包",
        "confirm_hint": "请先确认已保存私钥",
        "back": "返回"
      },
      "errors": {
        "password_min": "密码至少需要6个字符",
        "password_mismatch": "两次密码不一致",
        "save_error": "保存时出错"
      },
      "password": {
        "label": "加密密码（最少6个字符）",
        "placeholder": "密码",
        "confirm_placeholder": "确认密码",
        "mismatch": "两次密码不一致",
        "strength": {
          "very_weak": "非常弱",
          "weak": "弱",
          "fair": "一般",
          "good": "良好",
          "strong": "强"
        }
      }
    },
    "wallet_send": {
      "title": "发送 EAV7",
      "steps": {
        "destination": "目标地址",
        "value": "金额",
        "review": "确认"
      },
      "recipient": {
        "label": "目标地址（0x… EAVM/MetaMask）",
        "paste": "粘贴",
        "valid": "✓ 地址有效",
        "invalid": "0x 地址无效"
      },
      "errors": {
        "needEvmAddress": "请输入目标的 0x 地址（网页钱包按 EAVM 模型签名）",
        "invalidAddress": "目标必须是 0x 地址（EAVM/MetaMask）",
        "needPositiveAmount": "请输入一个正数金额",
        "insufficientBalance": "余额不足（请考虑手续费）",
        "invalidAmount": "金额无效",
        "sendFailed": "发送失败"
      },
      "continue": "继续",
      "cancel": "取消",
      "available": "可用余额：{amount} EAV7",
      "percent": {
        "max": "最大"
      },
      "back": "返回",
      "sendingLabel": "发送中",
      "sendingTo": "发送至 {addr}",
      "networkFee": "网络手续费",
      "balanceAfter": "之后余额",
      "quantumNote": "已在本设备签名 · 网络具备后量子保护",
      "confirmAndSign": "确认并签名",
      "signing": "签名中…",
      "transactionSent": {
        "title": "交易已发送",
        "subtitle": "将在下一个区块确认（约 1 秒）。"
      },
      "close": "关闭"
    },
    "wallet_stake": {
      "title": "质押",
      "subtitle": "≥ 100 EAV7 免手续费 · ≥ 1,000 成为验证者(每产出一个区块获得 16 EAV7)。",
      "tierZeroFee": {
        "label": "零手续费",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "验证者",
        "sub": "≥ 1,000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "当前质押:",
      "warnValidator": "这将使您的质押降至 1,000 以下——您将失去验证者身份。",
      "warnFeeReset": "这将使您的质押降至 100 以下——您的交易将重新收取手续费。",
      "warnConfirm": "我知道了,仍然移除 →",
      "errInvalidAmount": "请输入一个正数",
      "errInvalidValue": "金额无效",
      "errFailedOp": "操作失败",
      "sentTitle": "操作已发送",
      "close": "关闭",
      "stakeBtn": "质押",
      "removeBtn": "移除"
    }
  },
  "fr": {
    "blocks_live": {
      "networkLabel": "chaîne eav20",
      "title": "Blocs",
      "live": "en direct",
      "blockTimeInfo": "un nouveau bloc toutes les {n}s · consensus DPoS",
      "searchPlaceholder": "Rechercher un bloc par hauteur ou hash…",
      "stats": {
        "height": "Hauteur actuelle",
        "blockTime": "Temps de bloc",
        "avgTx": "Txs / bloc (moy.)",
        "activeProducers": "Producteurs actifs"
      },
      "latestBlocks": "Derniers blocs",
      "updating": "mise à jour",
      "columns": {
        "block": "Bloc",
        "age": "Âge",
        "txs": "Txs",
        "producer": "Producteur",
        "reward": "Récompense",
        "hash": "Hash"
      }
    },
    "comingSoon": {
      "badge": "en construction · sprint 4",
      "backToExplorer": "← retour à l'explorateur"
    },
    "docs_api": {
      "badge": "API publique",
      "title": "Consultez le réseau directement depuis le nœud",
      "baseUrl": "URL de base",
      "tags": {
        "cors": "CORS activé",
        "units": "valeurs en e7",
        "noAuth": "sans authentification"
      },
      "groups": {
        "read": "lecture",
        "write": "écriture"
      },
      "endpoints": {
        "status": "état du réseau : hauteur, validateurs, mempool, récompense/bloc",
        "blocks": "N derniers blocs",
        "blockByHeight": "un bloc par hauteur ou hash",
        "txs": "transactions récentes, paginées",
        "tx": "une transaction par id",
        "address": "solde, stake, nonce, rôle, tokens et énergie",
        "tokens": "liste des tokens EAV20 (ou /tokens/:id pour le détail)",
        "validators": "ensemble DPoS actif + producteur du slot",
        "sendTx": "envoie une transaction native signée (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "envoie une transaction via la couche EAVM (compatible JSON-RPC)"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "réseau personnalisé"
      },
      "title": "Utilisez l'EAV7 dans votre portefeuille",
      "description": "L'EAV7 parle le dialecte JSON-RPC que les portefeuilles universels comprennent — ajoutez le réseau en un clic.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "n'importe quel portefeuille EVM"
      },
      "params": {
        "networkName": "Nom du réseau",
        "rpcUrl": "URL du RPC",
        "chainId": "Chain ID",
        "symbol": "Symbole",
        "explorer": "Explorer",
        "decimals": "Décimales"
      },
      "button": {
        "adding": "Ajout en cours…",
        "addToMetamask": "Ajouter à MetaMask"
      },
      "status": {
        "added": "réseau ajouté !",
        "noWallet": "MetaMask non détectée — copiez les données ci-contre."
      },
      "error": {
        "addFailed": "impossible d'ajouter le réseau"
      },
      "mapping": {
        "badge": "même compte",
        "title": "Deux identités, un seul compte",
        "labelEavm": "EAVM",
        "labelNative": "natif",
        "desc1": "MetaMask affiche le",
        "desc2": "; on-chain le solde vit dans le",
        "desc3": "correspondant. C'est le même compte."
      },
      "steps": {
        "step1": "Cliquez pour ajouter le réseau EAV7",
        "step2": "Votre compte apparaît sous la forme 0x… dans le portefeuille",
        "step3": "On-chain le solde vit dans l'E7 correspondant"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "temps de bloc",
        "stat_validators_value": "jusqu'à 27",
        "stat_validators_label": "validateurs DPoS",
        "stat_supply_value": "100 Md",
        "stat_supply_label": "offre EAV7",
        "stat_reward_label": "EAV7 par bloc",
        "stat_quantum_value": "hybride",
        "stat_quantum_label": "post-quantique",
        "pillars_title": "piliers du protocole",
        "pillar_consensus": "Consensus DPoS",
        "pillar_token_standard": "Norme EAV20",
        "pillar_bridge": "Pont cross-chain",
        "pillar_security": "Sécurité & IA",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "norme EAV20",
        "title": "Tokens natifs, sans machine virtuelle",
        "description": "Équivalent au TRC20 : les tokens vivent directement dans l'état de la chaîne et se déplacent via des transactions signées — rapide, économique et vérifiable.",
        "cta": "Voir les tokens du réseau"
      },
      "consenso": {
        "badge": "consensus DPoS",
        "title": "Un nouveau bloc chaque seconde",
        "description": "Les validateurs se relaient à tour de rôle : à chaque slot de 1s, un producteur attendu signe le prochain bloc. Sans grinding, sans attente.",
        "slot_now": "slot actuel",
        "slot_offset": "slot +{n}",
        "fact_election_label": "Élection",
        "fact_election_value": "les 27 plus gros par stake (≥ 1 000 EAV7)",
        "fact_production_label": "Production",
        "fact_production_value": "validators[slot % N] · round-robin",
        "fact_fork_choice_label": "Fork choice",
        "fact_fork_choice_value": "chaîne valide la plus longue",
        "cta": "Voir les validateurs en direct"
      },
      "ponte": {
        "title": "Comment le pont déplace de la valeur entre réseaux",
        "arrow_pays": "paie",
        "node_external": "Réseau externe",
        "step_bridge_out": "verrouille EAV7/token et enregistre la destination externe",
        "step_relayer": "surveille la sortie et paie sur la chaîne externe",
        "step_bridge_settle": "marque la sortie comme payée on-chain (idempotent)",
        "step_bridge_in": "libère les fonds venant de l'extérieur, dédupliqué par sourceTxHash"
      },
      "seguranca": {
        "badge_hybrid": "signature hybride",
        "title_hybrid": "Post-quantique par conception",
        "verify_both": "la vérification exige les deux",
        "hybrid_description": "Chaque portefeuille, transaction et bloc porte les deux signatures — ECDSA (maturité) et ML-DSA-44 (FIPS 204, résistante au quantique). Une falsification exigerait de casser les deux primitives à la fois.",
        "badge_ai": "couche IA",
        "title_ai": "Oracles avec séquestre on-chain",
        "sentinel_title": "Sentinelle de sécurité · 24h",
        "sentinel_description": "Un processus surveille le réseau en continu — réorganisations, transferts massifs, rafales de transactions et concentration des producteurs — en consignant ses constats dans le flux de sécurité.",
        "sentinel_cta": "Voir dans le minage"
      },
      "staking": {
        "tier_fee_title": "Frais zéro",
        "tier_fee_desc": "Verrouillez 100+ EAV7 et vos transactions passent à des frais nuls — l'énergie (bandwidth) est générée par le gel et se régénère avec le temps.",
        "tier_mine_title": "Miner des blocs",
        "tier_mine_desc": "Verrouillez 1 000+ EAV7 et entrez dans l'élection DPoS. En produisant un bloc, vous recevez 16 EAV7 plus les frais du bloc, intégralement.",
        "reward_title": "Récompense et unstake",
        "reward_desc": "La récompense revient intégralement au producteur du bloc. L'unstake libère la valeur vers votre solde — il est interdit de vider le dernier validateur du réseau.",
        "cta_lock": "Verrouiller EAV7",
        "cta_mining": "Voir le minage"
      }
    },
    "energyGauge": {
      "ariaLabel": "Énergie {available} sur {max}",
      "title": "Énergie",
      "description": "Ressource qui couvre le coût des transactions. Se régénère avec le temps et augmente avec l'EAV7 verrouillé en staking."
    },
    "home_activityBars": {
      "ariaLabel": "Transactions par bloc",
      "txsCount": "{n} tx"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "Vue d'ensemble",
        "blocks": "Blocs",
        "transactions": "Transactions",
        "validators": "Validateurs",
        "tokens": "Jetons"
      },
      "cols": {
        "block": "Bloc",
        "age": "Âge",
        "txs": "Txs",
        "producer": "Producteur",
        "reward": "Récompense",
        "hash": "Hash"
      },
      "sidebar": {
        "explore": "Explorer",
        "network": "Réseau"
      },
      "toolbar": {
        "filter": "Filtrer",
        "sort": "Trier",
        "live": "en direct"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "explorer",
      "title": "Tout on-chain, en temps réel",
      "description": "Blocs et transactions qui défilent en ce moment même. Cliquez sur un élément pour l'examiner.",
      "viewBlocks": "Voir les blocs",
      "viewTxs": "Voir les transactions"
    },
    "home_heartbeat": {
      "label": "pouls",
      "blockAgoPrefix": "bloc il y a",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} tx",
      "viewAll": "voir tout"
    },
    "home_hero": {
      "coin_alt": "Pièce EAV7",
      "title": "La nouvelle ère de l'explorateur on-chain",
      "subtitle": "Des blocs toutes les 1 seconde, une sécurité post-quantique et une couche d'IA native. Explorez blocs, transactions, validateurs et adresses en temps réel.",
      "search_placeholder": "Rechercher un bloc, une transaction ou une adresse…",
      "search_button": "Explorer",
      "stat_height": "Hauteur",
      "stat_block": "Bloc",
      "stat_validators": "Validateurs",
      "stat_mempool": "Mempool"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "Pièce EAV7",
        "titleBefore": "La blockchain EAV7, et",
        "titleHighlight": "au-delà",
        "subtitle": "Consensus DPoS d'1 seconde, sécurité post-quantique et une couche IA native. Explorez blocs, transactions et validateurs en temps réel.",
        "exploreNetwork": "Explorer le réseau",
        "openWallet": "Ouvrir le portefeuille",
        "scrollAriaLabel": "Défiler vers le panneau"
      },
      "vitals": {
        "height": "Hauteur",
        "blockTime": "Bloc",
        "validators": "Validateurs"
      }
    },
    "home_inkBand": {
      "eyebrow": "interactif",
      "title": "Passez la souris pour révéler",
      "subtitle": "le réseau EAV7, au-delà du bloc",
      "mobileHint": "sur mobile, l'illustration apparaît directement"
    },
    "home_latestTxs": {
      "title": "Dernières transactions",
      "viewAll": "voir tout",
      "table": {
        "hash": "Hash",
        "type": "Type",
        "fromTo": "De → Vers",
        "value": "Valeur"
      },
      "empty": "aucune transaction pour le moment"
    },
    "home_moments": {
      "sectionEyebrow": "au cœur du protocole",
      "sectionTitle": "Une L1 conçue pour durer",
      "items": {
        "security": {
          "eyebrow": "sécurité",
          "titlePrefix": "Prête pour l'ère",
          "titleHighlight": "post-quantique",
          "desc": "Chaque portefeuille, transaction et bloc porte deux signatures — et la vérification exige les deux. Falsifier nécessiterait de casser les deux primitives à la fois.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "Adresse E7 dérivée par SHA3-256"
        },
        "consensus": {
          "eyebrow": "consensus",
          "titlePrefix": "Un bloc toutes les",
          "titleHighlight": "1 seconde",
          "desc": "Consensus DPoS avec jusqu'à 27 validateurs élus par mise, en rotation déterministe — 3x plus rapide que Tron, avec une liveness protégée.",
          "bullet1": "27 validateurs · round-robin par slot",
          "bullet2": "16 EAV7 de récompense par bloc"
        },
        "intelligence": {
          "eyebrow": "intelligence",
          "titlePrefix": "Une couche",
          "titleHighlight": "IA native",
          "desc": "Oracles on-chain avec séquestre : les tâches d'IA sont publiées, résolues par l'oracle désigné et réglées de manière vérifiable — le tout au sein du protocole.",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "Hash du résultat enregistré on-chain"
        },
        "assets": {
          "eyebrow": "actifs",
          "titlePrefix": "Tokens",
          "titleHighlight": "EAV20",
          "titleSuffix": "et pont cross-chain",
          "desc": "Créez et déplacez des tokens natifs (équivalents à TRC20) et connectez EAV7 à d'autres réseaux via un modèle lock-and-release sécurisé et idempotent.",
          "bullet1": "Standard EAV20 · create / transfer / approve",
          "bullet2": "Pont TRON · ETH · BTC (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "temps réel",
      "title": "Le pouls du réseau",
      "subtitle": "Un nouveau bloc chaque seconde. Suivez le réseau EAV7 battre en temps réel.",
      "stats": {
        "blockHeight": "Hauteur du bloc",
        "txLast30": "Tx · 30 derniers blocs",
        "mempool": "Mempool",
        "rewardPerBlock": "EAV7 / bloc"
      },
      "activity": {
        "title": "Activité du réseau",
        "txInLastBlocks": "transactions sur les {n} derniers blocs"
      },
      "slots": {
        "title": "Emplacements DPoS",
        "activeValidators": "validateurs actifs",
        "supply": "offre {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "Total des comptes"
        },
        "transactions": {
          "label": "Total des transactions"
        },
        "volume": {
          "label": "Volume transféré"
        },
        "staked": {
          "label": "Total en staking"
        }
      },
      "ring": {
        "supplyLine1": "de l'offre",
        "supplyLine2": "verrouillée en staking"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} sur {max}"
    },
    "home_walletCta": {
      "eyebrow": "commencez maintenant",
      "title": "Explorez le réseau EAV7 maintenant",
      "description": "Votre portefeuille est généré et signé dans le navigateur avec une protection post-quantique — il ne quitte jamais votre appareil. Envoyez, misez et minez directement depuis le web.",
      "createWallet": "Créer un portefeuille",
      "exploreNetwork": "Explorer le réseau"
    },
    "mining_live": {
      "badge_consensus": "DPoS · staking",
      "title": "Minage",
      "live_badge": "en direct",
      "subtitle": "sur EAV7, vous minez en verrouillant des EAV7 (stake) — sans matériel, sans consommation d'énergie",
      "stat_reward_block": "Récompense / bloc",
      "stat_blocks_day": "Blocs / jour",
      "stat_daily_emission": "Émission quotidienne",
      "stat_already_mined": "Déjà miné",
      "network_production": "production du réseau",
      "reward_per_block_caption": "récompense à chaque bloc (1s)",
      "annual_emission_caption": "émission annuelle estimée",
      "next_block": "prochain bloc",
      "miners_label": "mineurs",
      "staked_label": "EAV7 verrouillés",
      "block_time_label": "temps de bloc",
      "ai_sentinel_badge": "sentinelle IA · 24h",
      "network_protected": "Réseau protégé",
      "ai_monitoring_desc": "surveillance continue par IA native",
      "alerts_analyzed": "alertes analysées",
      "active_oracles": "oracles actifs",
      "pending_ai_tasks": "tâches IA en attente",
      "cta_title": "Commencez à miner EAV7",
      "cta_description": "Verrouillez des EAV7 dans votre portefeuille pour devenir mineur du consensus DPoS et recevoir des récompenses à chaque bloc produit. Tout en self-custody, avec signature post-quantique dans le navigateur.",
      "cta_lock_button": "Verrouiller EAV7",
      "cta_view_validators": "Voir les validateurs"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "Rechercher",
      "dica": "bloc (numéro) · transaction (E7…) · adresse (E7… ou 0x…)"
    },
    "netStatus": {
      "onlineTitle": "Réseau EAV7 en ligne · hauteur {height}",
      "offlineTitle": "Nœud hors ligne",
      "connecting": "connexion…"
    },
    "page_address": {
      "metaTitle": "Adresse {addr}… · EAV7 Scan",
      "eyebrow": "adresse",
      "title": "Adresse",
      "roleValidator": "Validateur",
      "roleOracle": "Oracle",
      "roleAccount": "Compte",
      "balance": "Solde",
      "staked": "en staking",
      "nonce": "nonce",
      "feeExempt": "frais zéro",
      "available": "Disponible",
      "max": "max {n}",
      "tokensTitle": "Jetons EAV20",
      "colToken": "Jeton",
      "colSymbol": "Symbole",
      "colBalance": "Solde",
      "txsTitle": "Transactions",
      "colHash": "Hash",
      "colBlock": "Bloc",
      "colType": "Type",
      "colCounterparty": "Contrepartie",
      "colValue": "Valeur",
      "colDate": "Date",
      "out": "sortant",
      "in": "entrant",
      "noTxs": "aucune transaction pour cette adresse",
      "totalBalance": "solde total : {n}",
      "tabOverview": "Vue d'ensemble",
      "tabTransfers": "Transferts",
      "tabInternal": "Transferts internes",
      "tabStaking": "Staking et ressources",
      "tabContract": "Contrat",
      "tabPermissions": "Permissions",
      "tabAnalysis": "Analyse",
      "internalNote": "Valeur déplacée par l'exécution d'un contrat. Ce n'est pas une transaction signée — d'où l'absence de hachage propre.",
      "internalEmpty": "aucun transfert interne",
      "colFrom": "De",
      "colTo": "Vers",
      "colTx": "Transaction",
      "stakingTitle": "Stake et ressources",
      "bandwidth": "Bande passante",
      "energy": "Énergie",
      "delegatedOut": "Délégué à des tiers",
      "delegatedIn": "Reçu en délégation",
      "unbondingTitle": "En déblocage",
      "matureIn": "débloqué dans {n} blocs",
      "votesCastTitle": "Votes émis",
      "votesReceived": "Votes reçus",
      "vestingTitle": "Vesting",
      "permsNone": "compte à clé unique — sans multisignature",
      "permsThreshold": "Seuil",
      "colWeight": "Poids",
      "colKey": "Clé",
      "contractNone": "cette adresse n'est pas un contrat",
      "contractCodeSize": "Taille du code",
      "contractVerified": "Vérifié",
      "contractUnverified": "Non vérifié",
      "sent": "Envoyé",
      "received": "Reçu",
      "feesPaid": "Frais payés",
      "txCount": "Transactions",
      "firstSeen": "Première activité",
      "lastSeen": "Dernière activité",
      "byType": "Par type",
      "topCounterparties": "Principales contreparties",
      "truncatedNote": "échantillon limité aux transactions les plus récentes",
      "noData": "aucune donnée",
      "nftsTitle": "NFT (EAV721)",
      "colNftCollection": "Collection",
      "colNftId": "Jeton",
      "namesTitle": "Noms EAV-NS",
      "colNsName": "Nom",
      "colNsTarget": "Résout vers",
      "votesLabel": "Votes reçus",
      "commissionLabel": "Commission",
      "accountInfo": "Informations du compte",
      "accountType": "Type de compte",
      "createdAt": "Créé le",
      "totalTxs": "Total des transactions",
      "tabTokenTx": "Transferts de jetons",
      "tokenTxEmpty": "aucun transfert de jeton",
      "roleContract": "Contrat",
      "roleMultisig": "Multisignature",
      "holdings": "Avoirs",
      "colAsset": "Actif",
      "assets": "Actifs",
      "transfersRow": "Transferts",
      "votesRow": "Votes",
      "claimable": "Récompenses réclamables",
      "tabApprovals": "Autorisations",
      "searchHoldings": "Rechercher par nom, symbole ou adresse…",
      "noHoldings": "rien ici",
      "colSpender": "Autorisé",
      "colLimit": "Plafond",
      "more": "Voir plus",
      "tabTokens": "Jetons",
      "tabTransactions": "Transactions",
      "colAge": "Âge",
      "colResult": "Résultat",
      "resultOk": "Succès",
      "resultRevert": "Annulée",
      "summaryTx": "Total de {n} transactions",
      "summaryTransfers": "Total de {n} transferts",
      "summaryInternal": "Total de {n} transferts internes",
      "filterAll": "Tous",
      "filterIn": "Entrée",
      "filterOut": "Sortie",
      "summaryTokenTx": "Total de {n} transferts de jetons",
      "colParentHash": "Hachage parent",
      "colResourceAmount": "Quantité de ressource",
      "colStakedAmount": "EAV7 en stake",
      "colUpdatedAt": "Mis à jour",
      "stakeNote": "Sur EAV7 un seul stake accorde énergie ET bande passante — on ne choisit pas de ressource, contrairement à TRON.",
      "permsOperations": "Opérations",
      "thisAccount": "ce compte",
      "summaryContracts": "Total de {n} contrats",
      "permsNote": "Sur EAV7 l'ensemble d'opérations s'applique à tout compte multisignature — il n'y a pas de portée par permission comme sur TRON.",
      "permsDefault": "par défaut",
      "permsDefaultNote": "Aucune multisignature configurée. Voici l’autorisation effective du compte : une clé, une signature."
    },
    "page_block": {
      "metaTitle": "Bloc #{height} · EAV7 Scan",
      "eyebrow": "bloc",
      "title": "Bloc #{height}",
      "sub": "il y a {ago}",
      "kv": {
        "height": "Hauteur",
        "date": "Date",
        "producer": "Producteur",
        "previousHash": "Hash précédent",
        "merkleRoot": "Racine de Merkle (txs)",
        "txCount": "Transactions",
        "protocol": "Protocole",
        "scheme": "schéma"
      },
      "txSectionTitle": "Transactions du bloc",
      "table": {
        "hash": "Hash",
        "type": "Type",
        "from": "De",
        "to": "Vers",
        "value": "Valeur",
        "fee": "Frais"
      },
      "emptyBlock": "bloc vide"
    },
    "page_docs": {
      "metaTitleFallback": "Documentation · EAV7 Scan",
      "breadcrumb": "documentation",
      "terminal": "terminal",
      "onThisPage": "sur cette page"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "Minage · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "Cette page n'existe pas sur la chaîne EAV7.",
      "backLink": "← retour à l'accueil"
    },
    "page_search": {
      "metaTitle": "Recherche · EAV7 Scan",
      "title": "Aucun résultat",
      "notRecognizedPrefix": "Nous n'avons pas reconnu",
      "notRecognizedSuffix": "comme bloc, transaction ou adresse EAV7.",
      "retryPlaceholder": "Réessayez…",
      "whatCanSearch": "que pouvez-vous rechercher",
      "blockLabel": "bloc",
      "blockDesc": "numéro de hauteur, ex.",
      "txLabel": "transaction",
      "txDesc": "hash",
      "txChars": "(64 caractères)",
      "addressLabel": "adresse",
      "addressLen34": "(34) ou",
      "or": "ou",
      "evmLabel": "(EAVM)",
      "backHome": "← retour à l'accueil"
    },
    "page_token": {
      "eyebrow": "Jeton EAV20",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "Jeton · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "Standard",
      "mintable": "émission ouverte",
      "fixedSupply": "offre fixe",
      "paused": "en pause",
      "tabTransfers": "Transferts",
      "tabHolders": "Détenteurs",
      "tabAnalysis": "Analyse",
      "totalSupply": "Offre totale",
      "holders": "Détenteurs",
      "decimals": "Décimales",
      "status": "Statut",
      "statusActive": "Actif",
      "statusPaused": "En pause",
      "createdAt": "Créé le",
      "contract": "Contrat",
      "creator": "Créateur",
      "owner": "Administrateur",
      "mintableLabel": "Peut émettre davantage",
      "yes": "oui",
      "no": "non",
      "summaryTransfers": "Total de {n} transferts",
      "summaryHolders": "{n} détenteurs au total — affichage des {shown} plus grands",
      "colHash": "Hash",
      "colBlock": "Bloc",
      "colAge": "Âge",
      "colFrom": "De",
      "colTo": "À",
      "colAmount": "Montant ({symbol})",
      "colRank": "#",
      "colAddress": "Adresse",
      "colBalance": "Solde ({symbol})",
      "colShare": "Part",
      "blacklisted": "bloqué",
      "noTransfers": "Aucun transfert trouvé.",
      "noHolders": "Aucun détenteur trouvé.",
      "top1": "Plus grand détenteur",
      "top10": "Top 10",
      "top50": "Top 50",
      "concentrationTitle": "Concentration de l'offre",
      "concentrationNote": "Part de l'offre détenue par les plus grands portefeuilles. Une offre importante entre peu de mains présente un risque de marché différent d'une offre largement répartie — la distribution compte donc plus que le chiffre total.",
      "largestHolder": "Plus grand détenteur :",
      "overviewTitle": "Vue d'ensemble",
      "basicInfoTitle": "Informations du contrat",
      "activityTitle": "Distribution",
      "largestHolderShort": "Plus grand détenteur",
      "tabContract": "Contrat",
      "nativeTitle": "Jeton natif du protocole",
      "nativeBadge": "aucun code arbitraire",
      "nativeNote": "Ce jeton n'est pas un contrat intelligent : il est implémenté par le protocole lui-même. Il n'y a ni Solidity, ni compilateur, ni bytecode à vérifier — et pas davantage de logique cachée que quelqu'un aurait pu écrire. Le comportement est identique pour tout jeton EAV20 et ne change que par un hard fork du réseau.",
      "implementation": "Implémentation",
      "implementationValue": "Native au consensus (standard EAV20)",
      "sourceOfTruth": "Source du protocole",
      "powersTitle": "Ce que l'administrateur peut faire",
      "powersNote": "Sur un explorateur EVM, vous liriez le code source pour le découvrir. Ici ce sont des champs d'état, nous les listons donc directement. C'est ce qui compte vraiment avant de faire confiance à un jeton.",
      "powerMint": "Émettre davantage",
      "powerMintNote": "Augmente l'offre totale et dilue les détenteurs actuels.",
      "powerPause": "Suspendre les transferts",
      "powerPauseNote": "Gèle d'un coup tout mouvement du jeton.",
      "powerBlacklist": "Bloquer des adresses",
      "powerBlacklistNote": "Empêche une adresse précise d'envoyer ou de recevoir.",
      "powerFreeze": "Geler un solde",
      "powerFreezeNote": "Verrouille une partie du solde d'une adresse jusqu'à une date.",
      "powerYes": "peut",
      "powerNo": "ne peut pas",
      "powerActiveNow": "actif maintenant",
      "adminIs": "Administrateur :",
      "restrictionsTitle": "Restrictions en vigueur",
      "frozenUntil": "jusqu'au {when}"
    },
    "page_tx": {
      "metaTitle": "Transaction {id}… · EAV7 Scan",
      "eyebrow": "transaction",
      "title": "Transaction",
      "status": "Statut",
      "type": "Type",
      "block": "Bloc",
      "from": "De",
      "to": "Vers",
      "value": "Valeur",
      "fee": "Frais",
      "nonce": "Nonce",
      "date": "Date",
      "scheme": "Schéma",
      "eavmLayer": "Couche EAVM (MetaMask)",
      "energy": "Énergie",
      "energyUnit": "énergie"
    },
    "page_txs": {
      "metaTitle": "Transactions · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "norme EAV20",
        "title": "Tokens",
        "subtitle": "actifs natifs du protocole eav20 — équivalent au TRC20 de Tron"
      },
      "empty": {
        "title": "Aucun token créé pour le moment",
        "description": "Les tokens apparaissent ici dès qu'ils sont créés sur le réseau via"
      },
      "stats": {
        "tokens": "Tokens EAV20",
        "holders": "Détenteurs (total)",
        "supply": "Offre combinée",
        "standard": "Norme"
      },
      "card": {
        "supply": "Offre",
        "holders": "Détenteurs",
        "share": "part",
        "creator": "créateur"
      }
    },
    "txs_live": {
      "chainLabel": "chaîne eav20",
      "title": "Transactions",
      "live": "en direct",
      "subtitleLive": "les plus récentes en premier · valeurs en EAV7",
      "subtitleOlder": "transactions plus anciennes · valeurs en EAV7",
      "searchPlaceholder": "Rechercher tx, bloc ou adresse…",
      "cols": {
        "hash": "Hash",
        "block": "Bloc",
        "type": "Type",
        "from": "De",
        "to": "Vers",
        "value": "Valeur",
        "age": "Âge"
      },
      "stats": {
        "totalTx": "Total des transactions",
        "mempool": "Dans la mempool",
        "volume": "Volume (EAV7)",
        "avgFee": "Frais moyens"
      },
      "table": {
        "latest": "Dernières transactions",
        "older": "Transactions précédentes",
        "updating": "mise à jour",
        "empty": "aucune transaction trouvée",
        "count": "{n} transactions",
        "loadMore": "Charger plus anciennes →",
        "genesis": "début de la chaîne"
      }
    },
    "ui_copy": {
      "default_value": "valeur",
      "aria_label": "Copier {label}",
      "copied": "copié ✓",
      "copy_label": "copier {label}",
      "copy": "copier"
    },
    "ui_explorerSearch": {
      "placeholder": "Rechercher un bloc, une tx ou une adresse…",
      "searchButton": "Rechercher"
    },
    "validators_live": {
      "unavailable": "nœud indisponible",
      "header": {
        "eyebrow": "consensus DPoS",
        "title": "Validateurs",
        "live": "en direct",
        "subtitle": "{active} actifs sur {max} emplacements · stake minimum {min} EAV7 · rotation à chaque bloc"
      },
      "producer": {
        "label": "producteur du slot actuel",
        "producingBlock": "production du bloc"
      },
      "slot": {
        "label": "slot · {n}s",
        "staked": "{n} EAV7 en stake"
      },
      "rotation": {
        "label": "rotation de production"
      },
      "stats": {
        "activeValidators": "Validateurs actifs",
        "rewardPerBlock": "Récompense / bloc",
        "totalStaked": "Total en stake",
        "peers": "Pairs du réseau"
      },
      "ranking": {
        "title": "Ensemble actif",
        "sortedBy": "trié par stake",
        "producing": "production",
        "active": "actif",
        "stakedCaption": "EAV7 en stake"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "sécurisée"
      },
      "role": {
        "validator": "Validateur",
        "oracle": "Oracle",
        "account": "Compte EAV7"
      },
      "lock": {
        "button": "verrouiller"
      },
      "balance": {
        "label": "solde disponible"
      },
      "tier": {
        "validator": "Validateur",
        "fee_zero": "Frais zéro",
        "standard": "Standard"
      },
      "actions": {
        "send": "Envoyer",
        "receive": "Recevoir",
        "stake": "Stake"
      },
      "stats": {
        "staked": "En stake",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "Frais",
        "fee_zero": "zéro",
        "fee_standard": "standard"
      },
      "tier_progress": {
        "label": "progression du palier",
        "remaining_prefix": "il manque",
        "remaining_suffix": "pour le palier {tier}"
      },
      "receive": {
        "title": "Recevoir des EAV7",
        "description_before": "Partagez votre adresse",
        "description_after": "— le réseau la fait correspondre automatiquement à votre E7 natif.",
        "close": "fermer"
      },
      "activity": {
        "title": "Activité récente",
        "sent": "Envoyé",
        "received": "Reçu"
      },
      "addresses": {
        "hint": "utilisez ce 0x pour recevoir (standard EAVM/MetaMask)"
      },
      "tokens": {
        "title": "Jetons EAV20"
      },
      "footer": {
        "quantum": "post-quantique · secp256k1 + ML-DSA-44",
        "logout": "déconnexion / changer"
      },
      "wipe": {
        "title": "Supprimer ce portefeuille ?",
        "description_before": "Le portefeuille chiffré sera supprimé",
        "description_bold": "de ce navigateur",
        "description_after": ". Vous ne pouvez le restaurer qu'avec la sauvegarde de la clé privée — il n'y a pas de récupération de mot de passe.",
        "warning_before": "Confirmez que vous avez la",
        "warning_bold": "sauvegarde de la clé",
        "warning_after": "avant de supprimer.",
        "download_backup": "Télécharger la sauvegarde (.json)",
        "cancel": "Annuler",
        "confirm": "Supprimer le portefeuille"
      }
    },
    "wallet_addNet": {
      "title": "Utiliser avec MetaMask / Trust",
      "description": "Ajoutez le réseau EAV7 (chaîne 72020) à votre portefeuille EVM.",
      "adding": "ajout en cours…",
      "added": "✓ ajouté",
      "addButton": "Ajouter le réseau",
      "noWallet": "MetaMask non détecté dans ce navigateur.",
      "error": "impossible d'ajouter le réseau."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "vous seul avez le contrôle",
        "on_device_title": "sur l'appareil",
        "on_device_desc": "la clé ne sort jamais",
        "quantum_title": "post-quantique",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "Sauvegarde",
        "password": "Mot de passe",
        "ready": "Prêt"
      },
      "unlock": {
        "title": "Content de vous revoir",
        "subtitle": "Un portefeuille chiffré existe dans ce navigateur. Saisissez le mot de passe pour le déverrouiller.",
        "password_placeholder": "mot de passe",
        "error_wrong_password": "mot de passe incorrect",
        "unlocking": "déverrouillage…",
        "unlock_button": "Déverrouiller le portefeuille",
        "wipe_confirm": "Supprimer le portefeuille de ce navigateur ? Assurez-vous d'avoir la sauvegarde de la clé !",
        "wipe_button": "supprimer et recommencer"
      },
      "choose": {
        "title": "Votre portefeuille EAV7",
        "subtitle": "Un portefeuille self-custodial : vous êtes le seul propriétaire de vos clés. Commencez en quelques secondes.",
        "create_title": "Créer un nouveau portefeuille",
        "create_desc": "Génère une nouvelle clé sur cet appareil.",
        "import_title": "Importer une clé",
        "import_desc": "Vous avez déjà une clé privée ? Restaurez-la ici."
      },
      "import": {
        "title": "Importer un portefeuille",
        "subtitle": "Collez la clé privée et choisissez un mot de passe pour la chiffrer dans ce navigateur.",
        "label": "Clé privée (0x + 64 hex)",
        "importing": "importation…",
        "button": "Importer",
        "back": "Retour",
        "error_invalid_key": "clé privée invalide (0x + 64 hex attendu)"
      },
      "create": {
        "title": "Sauvegardez votre clé",
        "subtitle": "Il n'y a pas de récupération de mot de passe. Quiconque détient la clé privée contrôle les fonds — sauvegardez-la avant de continuer.",
        "warning_prefix": "Cette clé ",
        "warning_bold": "est le seul moyen",
        "warning_suffix": " d'accéder à vos fonds. Sauvegardez-la hors ligne — ne la partagez jamais avec qui que ce soit.",
        "address_label": "adresse E7",
        "private_key_label": "clé privée",
        "reveal": "révéler",
        "hide": "masquer",
        "download_backup": "⭳ Télécharger la sauvegarde (.json)",
        "confirm_saved": "J'ai sauvegardé ma clé en lieu sûr",
        "creating": "création…",
        "create_button": "Créer le portefeuille",
        "confirm_hint": "confirmez que vous avez sauvegardé la clé",
        "back": "Retour"
      },
      "errors": {
        "password_min": "le mot de passe doit contenir au moins 6 caractères",
        "password_mismatch": "les mots de passe ne correspondent pas",
        "save_error": "erreur lors de l'enregistrement"
      },
      "password": {
        "label": "Mot de passe pour chiffrer (min. 6 caractères)",
        "placeholder": "mot de passe",
        "confirm_placeholder": "confirmer le mot de passe",
        "mismatch": "les mots de passe ne correspondent pas",
        "strength": {
          "very_weak": "très faible",
          "weak": "faible",
          "fair": "correct",
          "good": "bon",
          "strong": "fort"
        }
      }
    },
    "wallet_send": {
      "title": "Envoyer des EAV7",
      "steps": {
        "destination": "Destination",
        "value": "Montant",
        "review": "Vérifier"
      },
      "recipient": {
        "label": "Destination (0x… EAVM/MetaMask)",
        "paste": "coller",
        "valid": "✓ adresse valide",
        "invalid": "adresse 0x invalide"
      },
      "errors": {
        "needEvmAddress": "indiquez le 0x de la destination (le portefeuille web signe selon le modèle EAVM)",
        "invalidAddress": "la destination doit être une adresse 0x (EAVM/MetaMask)",
        "needPositiveAmount": "indiquez un montant positif",
        "insufficientBalance": "solde insuffisant (tenez compte des frais)",
        "invalidAmount": "montant invalide",
        "sendFailed": "échec de l'envoi"
      },
      "continue": "Continuer",
      "cancel": "Annuler",
      "available": "disponible : {amount} EAV7",
      "percent": {
        "max": "MAX"
      },
      "back": "Retour",
      "sendingLabel": "envoi en cours",
      "sendingTo": "à {addr}",
      "networkFee": "Frais de réseau",
      "balanceAfter": "Solde après",
      "quantumNote": "signé sur cet appareil · protection post-quantique du réseau",
      "confirmAndSign": "Confirmer et signer",
      "signing": "signature…",
      "transactionSent": {
        "title": "Transaction envoyée",
        "subtitle": "Confirmation au prochain bloc (~1 s)."
      },
      "close": "fermer"
    },
    "wallet_stake": {
      "title": "Stake",
      "subtitle": "≥ 100 EAV7 supprime les frais · ≥ 1 000 devient mineur (16 EAV7/bloc produit).",
      "tierZeroFee": {
        "label": "Frais nuls",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "Validateur",
        "sub": "≥ 1 000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "en stake actuellement :",
      "warnValidator": "Cela fait descendre votre stake sous 1 000 — vous perdrez le statut de validateur.",
      "warnFeeReset": "Cela fait descendre votre stake sous 100 — vos transactions redeviendront payantes.",
      "warnConfirm": "compris, retirer quand même →",
      "errInvalidAmount": "indiquez un montant positif",
      "errInvalidValue": "montant invalide",
      "errFailedOp": "échec de l'opération",
      "sentTitle": "Opération envoyée",
      "close": "fermer",
      "stakeBtn": "Mettre en stake",
      "removeBtn": "Retirer"
    }
  },
  "de": {
    "blocks_live": {
      "networkLabel": "eav20-Kette",
      "title": "Blöcke",
      "live": "live",
      "blockTimeInfo": "alle {n}s ein neuer Block · DPoS-Konsens",
      "searchPlaceholder": "Block nach Höhe oder Hash suchen…",
      "stats": {
        "height": "Aktuelle Höhe",
        "blockTime": "Blockzeit",
        "avgTx": "Txs / Block (Ø)",
        "activeProducers": "Aktive Produzenten"
      },
      "latestBlocks": "Neueste Blöcke",
      "updating": "aktualisiert",
      "columns": {
        "block": "Block",
        "age": "Alter",
        "txs": "Txs",
        "producer": "Produzent",
        "reward": "Belohnung",
        "hash": "Hash"
      }
    },
    "comingSoon": {
      "badge": "im Aufbau · Sprint 4",
      "backToExplorer": "← zurück zum Explorer"
    },
    "docs_api": {
      "badge": "Öffentliche API",
      "title": "Fragen Sie das Netzwerk direkt vom Node ab",
      "baseUrl": "Basis-URL",
      "tags": {
        "cors": "CORS aktiviert",
        "units": "Werte in e7",
        "noAuth": "keine Authentifizierung"
      },
      "groups": {
        "read": "lesen",
        "write": "schreiben"
      },
      "endpoints": {
        "status": "Netzwerkstatus: Höhe, Validatoren, Mempool, Blockbelohnung",
        "blocks": "letzte N Blöcke",
        "blockByHeight": "ein Block nach Höhe oder Hash",
        "txs": "aktuelle Transaktionen, paginiert",
        "tx": "eine Transaktion nach id",
        "address": "Guthaben, Stake, Nonce, Rolle, Tokens und Energie",
        "tokens": "Liste der EAV20-Tokens (oder /tokens/:id für Details)",
        "validators": "aktives DPoS-Set + Slot-Produzent",
        "sendTx": "sendet eine signierte native Transaktion (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "sendet eine Transaktion über die EAVM-Schicht (JSON-RPC-kompatibel)"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "benutzerdefiniertes netzwerk"
      },
      "title": "Nutze EAV7 in deiner Wallet",
      "description": "EAV7 spricht den JSON-RPC-Dialekt, den universelle Wallets verstehen — füge das Netzwerk mit einem Klick hinzu.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "jede EVM-Wallet"
      },
      "params": {
        "networkName": "Netzwerkname",
        "rpcUrl": "RPC-URL",
        "chainId": "Chain ID",
        "symbol": "Symbol",
        "explorer": "Explorer",
        "decimals": "Dezimalstellen"
      },
      "button": {
        "adding": "Wird hinzugefügt…",
        "addToMetamask": "Zu MetaMask hinzufügen"
      },
      "status": {
        "added": "Netzwerk hinzugefügt!",
        "noWallet": "MetaMask nicht erkannt — kopiere die Daten daneben."
      },
      "error": {
        "addFailed": "Netzwerk konnte nicht hinzugefügt werden"
      },
      "mapping": {
        "badge": "gleiches konto",
        "title": "Zwei Identitäten, ein Konto",
        "labelEavm": "EAVM",
        "labelNative": "nativ",
        "desc1": "MetaMask zeigt die",
        "desc2": "; on-chain lebt das Guthaben in der entsprechenden",
        "desc3": "Adresse. Es ist dasselbe Konto."
      },
      "steps": {
        "step1": "Klicke, um das EAV7-Netzwerk hinzuzufügen",
        "step2": "Dein Konto erscheint als 0x… in der Wallet",
        "step3": "On-chain lebt das Guthaben in der entsprechenden E7"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "Blockzeit",
        "stat_validators_value": "bis zu 27",
        "stat_validators_label": "DPoS-Validatoren",
        "stat_supply_value": "100 Mrd.",
        "stat_supply_label": "EAV7-Angebot",
        "stat_reward_label": "EAV7 pro Block",
        "stat_quantum_value": "hybrid",
        "stat_quantum_label": "post-quantum",
        "pillars_title": "Säulen des Protokolls",
        "pillar_consensus": "DPoS-Konsens",
        "pillar_token_standard": "EAV20-Standard",
        "pillar_bridge": "Cross-Chain-Bridge",
        "pillar_security": "Sicherheit & KI",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "EAV20-Standard",
        "title": "Native Tokens, ohne virtuelle Maschine",
        "description": "Äquivalent zu TRC20: Die Tokens existieren direkt im Chain-State und bewegen sich durch signierte Transaktionen — schnell, günstig und verifizierbar.",
        "cta": "Netzwerk-Tokens ansehen"
      },
      "consenso": {
        "badge": "DPoS-Konsens",
        "title": "Jede Sekunde ein neuer Block",
        "description": "Validatoren wechseln sich im Rundlauf ab: In jedem 1-Sekunden-Slot signiert ein erwarteter Produzent den nächsten Block. Kein Grinding, kein Warten.",
        "slot_now": "Slot jetzt",
        "slot_offset": "Slot +{n}",
        "fact_election_label": "Wahl",
        "fact_election_value": "die 27 größten nach Stake (≥ 1.000 EAV7)",
        "fact_production_label": "Produktion",
        "fact_production_value": "validators[slot % N] · Round-Robin",
        "fact_fork_choice_label": "Fork Choice",
        "fact_fork_choice_value": "längste gültige Kette",
        "cta": "Validatoren live ansehen"
      },
      "ponte": {
        "title": "Wie die Bridge Werte zwischen Netzwerken bewegt",
        "arrow_pays": "zahlt",
        "node_external": "Externes Netzwerk",
        "step_bridge_out": "sperrt EAV7/Token und speichert das externe Ziel",
        "step_relayer": "beobachtet den Ausgang und zahlt auf der externen Chain",
        "step_bridge_settle": "markiert den Ausgang als on-chain bezahlt (idempotent)",
        "step_bridge_in": "gibt Gelder von außen frei, dedupliziert nach sourceTxHash"
      },
      "seguranca": {
        "badge_hybrid": "hybride Signatur",
        "title_hybrid": "Post-Quantum by Design",
        "verify_both": "Verifizierung erfordert beide",
        "hybrid_description": "Jede Wallet, Transaktion und jeder Block trägt beide Signaturen — ECDSA (Reife) und ML-DSA-44 (FIPS 204, quantenresistent). Eine Fälschung würde das Brechen beider Primitive gleichzeitig erfordern.",
        "badge_ai": "KI-Schicht",
        "title_ai": "Orakel mit On-Chain-Treuhand",
        "sentinel_title": "Sicherheits-Sentinel · 24h",
        "sentinel_description": "Ein Prozess überwacht das Netzwerk kontinuierlich — Reorganisationen, riesige Transfers, Transaktionsschübe und Produzenten-Konzentration — und protokolliert Befunde im Sicherheits-Feed.",
        "sentinel_cta": "Im Mining ansehen"
      },
      "staking": {
        "tier_fee_title": "Null Gebühren",
        "tier_fee_desc": "Sperren Sie 100+ EAV7 und Ihre Transaktionen erhalten null Gebühren — Energie (Bandwidth) wird durch das Freeze erzeugt und regeneriert sich mit der Zeit.",
        "tier_mine_title": "Blöcke minen",
        "tier_mine_desc": "Sperren Sie 1.000+ EAV7 und nehmen Sie an der DPoS-Wahl teil. Beim Produzieren eines Blocks erhalten Sie 16 EAV7 plus die Blockgebühren, vollständig.",
        "reward_title": "Belohnung und Unstake",
        "reward_desc": "Die Belohnung geht vollständig an den Blockproduzenten. Unstake gibt den Betrag zurück auf Ihr Guthaben — den letzten Validator des Netzwerks zu leeren ist nicht erlaubt.",
        "cta_lock": "EAV7 sperren",
        "cta_mining": "Mining ansehen"
      }
    },
    "energyGauge": {
      "ariaLabel": "Energie {available} von {max}",
      "title": "Energie",
      "description": "Ressource, die die Transaktionskosten deckt. Regeneriert sich mit der Zeit und wächst mit im Staking gesperrtem EAV7."
    },
    "home_activityBars": {
      "ariaLabel": "Transaktionen pro Block",
      "txsCount": "{n} Tx"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "Übersicht",
        "blocks": "Blöcke",
        "transactions": "Transaktionen",
        "validators": "Validatoren",
        "tokens": "Tokens"
      },
      "cols": {
        "block": "Block",
        "age": "Alter",
        "txs": "Txs",
        "producer": "Produzent",
        "reward": "Belohnung",
        "hash": "Hash"
      },
      "sidebar": {
        "explore": "Erkunden",
        "network": "Netzwerk"
      },
      "toolbar": {
        "filter": "Filtern",
        "sort": "Sortieren",
        "live": "live"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "erkunden",
      "title": "Alles On-Chain, in Echtzeit",
      "description": "Blöcke und Transaktionen fließen gerade jetzt. Klicke auf ein Element, um es zu untersuchen.",
      "viewBlocks": "Blöcke ansehen",
      "viewTxs": "Transaktionen ansehen"
    },
    "home_heartbeat": {
      "label": "herzschlag",
      "blockAgoPrefix": "Block vor",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} Tx",
      "viewAll": "alle anzeigen"
    },
    "home_hero": {
      "coin_alt": "EAV7-Münze",
      "title": "Die neue Ära des On-Chain-Explorers",
      "subtitle": "Blöcke alle 1 Sekunde, postquantensichere Sicherheit und eine native KI-Ebene. Untersuchen Sie Blöcke, Transaktionen, Validatoren und Adressen in Echtzeit.",
      "search_placeholder": "Block, Transaktion oder Adresse suchen…",
      "search_button": "Erkunden",
      "stat_height": "Höhe",
      "stat_block": "Block",
      "stat_validators": "Validatoren",
      "stat_mempool": "Mempool"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "EAV7-Münze",
        "titleBefore": "Die EAV7-Blockchain, und",
        "titleHighlight": "darüber hinaus",
        "subtitle": "1-Sekunden-DPoS-Konsens, postquantensichere Verschlüsselung und eine native KI-Ebene. Erkunde Blöcke, Transaktionen und Validatoren in Echtzeit.",
        "exploreNetwork": "Netzwerk erkunden",
        "openWallet": "Wallet öffnen",
        "scrollAriaLabel": "Zum Bereich scrollen"
      },
      "vitals": {
        "height": "Höhe",
        "blockTime": "Block",
        "validators": "Validatoren"
      }
    },
    "home_inkBand": {
      "eyebrow": "interaktiv",
      "title": "Maus bewegen zum Enthüllen",
      "subtitle": "das EAV7-Netzwerk, jenseits des Blocks",
      "mobileHint": "auf dem Handy erscheint die Grafik direkt"
    },
    "home_latestTxs": {
      "title": "Neueste Transaktionen",
      "viewAll": "alle anzeigen",
      "table": {
        "hash": "Hash",
        "type": "Typ",
        "fromTo": "Von → An",
        "value": "Wert"
      },
      "empty": "noch keine Transaktionen"
    },
    "home_moments": {
      "sectionEyebrow": "im Inneren des Protokolls",
      "sectionTitle": "Eine L1, die für die Ewigkeit gebaut ist",
      "items": {
        "security": {
          "eyebrow": "sicherheit",
          "titlePrefix": "Bereit für das",
          "titleHighlight": "postquantenzeitalter",
          "desc": "Jede Wallet, Transaktion und jeder Block trägt zwei Signaturen — und die Verifizierung erfordert beide. Eine Fälschung würde bedeuten, beide Primitive gleichzeitig zu brechen.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "E7-Adresse abgeleitet über SHA3-256"
        },
        "consensus": {
          "eyebrow": "konsens",
          "titlePrefix": "Ein Block alle",
          "titleHighlight": "1 Sekunde",
          "desc": "DPoS-Konsens mit bis zu 27 durch Stake gewählten Validatoren in deterministischer Rotation — 3x schneller als Tron, mit geschützter Liveness.",
          "bullet1": "27 Validatoren · Round-Robin pro Slot",
          "bullet2": "16 EAV7 Belohnung pro Block"
        },
        "intelligence": {
          "eyebrow": "intelligenz",
          "titlePrefix": "Eine",
          "titleHighlight": "native KI-Schicht",
          "desc": "On-Chain-Orakel mit Treuhand: KI-Aufgaben werden veröffentlicht, vom zuständigen Orakel gelöst und nachweisbar abgerechnet — alles innerhalb des Protokolls.",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "Ergebnis-Hash on-chain gespeichert"
        },
        "assets": {
          "eyebrow": "vermögenswerte",
          "titlePrefix": "Tokens",
          "titleHighlight": "EAV20",
          "titleSuffix": "und Cross-Chain-Bridge",
          "desc": "Erstelle und bewege native Tokens (äquivalent zu TRC20) und verbinde EAV7 über ein sicheres, idempotentes Lock-and-Release-Modell mit anderen Netzwerken.",
          "bullet1": "EAV20-Standard · create / transfer / approve",
          "bullet2": "Bridge TRON · ETH · BTC (Lock-and-Release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "Echtzeit",
      "title": "Der Puls des Netzwerks",
      "subtitle": "Jede Sekunde ein neuer Block. Verfolge das EAV7-Netzwerk in Echtzeit.",
      "stats": {
        "blockHeight": "Blockhöhe",
        "txLast30": "Txs · letzte 30 Blöcke",
        "mempool": "Mempool",
        "rewardPerBlock": "EAV7 / Block"
      },
      "activity": {
        "title": "Netzwerkaktivität",
        "txInLastBlocks": "Transaktionen in den letzten {n} Blöcken"
      },
      "slots": {
        "title": "DPoS-Slots",
        "activeValidators": "aktive Validatoren",
        "supply": "Umlauf {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "Konten gesamt"
        },
        "transactions": {
          "label": "Transaktionen gesamt"
        },
        "volume": {
          "label": "Übertragenes Volumen"
        },
        "staked": {
          "label": "Gesamt gestaked"
        }
      },
      "ring": {
        "supplyLine1": "des Angebots",
        "supplyLine2": "im Staking gebunden"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} von {max}"
    },
    "home_walletCta": {
      "eyebrow": "jetzt loslegen",
      "title": "Entdecke jetzt das EAV7-Netzwerk",
      "description": "Deine Wallet wird im Browser mit postquantensicherem Schutz erstellt und signiert — sie verlässt niemals dein Gerät. Sende, staken und mine direkt über das Web.",
      "createWallet": "Wallet erstellen",
      "exploreNetwork": "Netzwerk erkunden"
    },
    "mining_live": {
      "badge_consensus": "DPoS · Staking",
      "title": "Mining",
      "live_badge": "live",
      "subtitle": "bei EAV7 minen Sie, indem Sie EAV7 sperren (Staking) — ohne Hardware, ohne Energieverbrauch",
      "stat_reward_block": "Belohnung / Block",
      "stat_blocks_day": "Blöcke / Tag",
      "stat_daily_emission": "Tägliche Ausgabe",
      "stat_already_mined": "Bereits gemined",
      "network_production": "Netzwerkleistung",
      "reward_per_block_caption": "Belohnung pro Block (1s)",
      "annual_emission_caption": "geschätzte jährliche Ausgabe",
      "next_block": "nächster Block",
      "miners_label": "Miner",
      "staked_label": "EAV7 gesperrt",
      "block_time_label": "Blockzeit",
      "ai_sentinel_badge": "KI-Wächter · 24h",
      "network_protected": "Netzwerk geschützt",
      "ai_monitoring_desc": "kontinuierliche Überwachung durch native KI",
      "alerts_analyzed": "analysierte Warnungen",
      "active_oracles": "aktive Orakel",
      "pending_ai_tasks": "ausstehende KI-Aufgaben",
      "cta_title": "Beginnen Sie mit dem Mining von EAV7",
      "cta_description": "Sperren Sie EAV7 in Ihrer Wallet, um Miner im DPoS-Konsens zu werden und Belohnungen für jeden erzeugten Block zu erhalten. Alles self-custodial, mit postquantensicherer Signatur im Browser.",
      "cta_lock_button": "EAV7 sperren",
      "cta_view_validators": "Validatoren ansehen"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "Suchen",
      "dica": "Block (Nummer) · Transaktion (E7…) · Adresse (E7… oder 0x…)"
    },
    "netStatus": {
      "onlineTitle": "EAV7-Netzwerk online · Höhe {height}",
      "offlineTitle": "Knoten offline",
      "connecting": "verbinden…"
    },
    "page_address": {
      "metaTitle": "Adresse {addr}… · EAV7 Scan",
      "eyebrow": "adresse",
      "title": "Adresse",
      "roleValidator": "Validator",
      "roleOracle": "Orakel",
      "roleAccount": "Konto",
      "balance": "Guthaben",
      "staked": "gestaked",
      "nonce": "nonce",
      "feeExempt": "gebührenfrei",
      "available": "Verfügbar",
      "max": "max {n}",
      "tokensTitle": "EAV20-Token",
      "colToken": "Token",
      "colSymbol": "Symbol",
      "colBalance": "Guthaben",
      "txsTitle": "Transaktionen",
      "colHash": "Hash",
      "colBlock": "Block",
      "colType": "Typ",
      "colCounterparty": "Gegenpartei",
      "colValue": "Wert",
      "colDate": "Datum",
      "out": "ausgehend",
      "in": "eingehend",
      "noTxs": "keine Transaktionen für diese Adresse",
      "totalBalance": "Gesamtguthaben: {n}",
      "tabOverview": "Überblick",
      "tabTransfers": "Transfers",
      "tabInternal": "Interne Transfers",
      "tabStaking": "Staking und Ressourcen",
      "tabContract": "Vertrag",
      "tabPermissions": "Berechtigungen",
      "tabAnalysis": "Analyse",
      "internalNote": "Durch Vertragsausführung bewegter Wert. Keine signierte Transaktion — deshalb ohne eigenen Hash.",
      "internalEmpty": "keine internen Transfers",
      "colFrom": "Von",
      "colTo": "An",
      "colTx": "Transaktion",
      "stakingTitle": "Stake und Ressourcen",
      "bandwidth": "Bandbreite",
      "energy": "Energie",
      "delegatedOut": "Delegiert an Dritte",
      "delegatedIn": "Delegation erhalten",
      "unbondingTitle": "In Freigabe",
      "matureIn": "freigegeben in {n} Blöcken",
      "votesCastTitle": "Abgegebene Stimmen",
      "votesReceived": "Erhaltene Stimmen",
      "vestingTitle": "Vesting",
      "permsNone": "Konto mit einem Schlüssel — keine Multisignatur",
      "permsThreshold": "Schwelle",
      "colWeight": "Gewicht",
      "colKey": "Schlüssel",
      "contractNone": "diese Adresse ist kein Vertrag",
      "contractCodeSize": "Codegröße",
      "contractVerified": "Verifiziert",
      "contractUnverified": "Nicht verifiziert",
      "sent": "Gesendet",
      "received": "Empfangen",
      "feesPaid": "Gezahlte Gebühren",
      "txCount": "Transaktionen",
      "firstSeen": "Erste Aktivität",
      "lastSeen": "Letzte Aktivität",
      "byType": "Nach Typ",
      "topCounterparties": "Wichtigste Gegenparteien",
      "truncatedNote": "Stichprobe auf die neuesten Transaktionen begrenzt",
      "noData": "keine Daten",
      "nftsTitle": "NFTs (EAV721)",
      "colNftCollection": "Sammlung",
      "colNftId": "Token",
      "namesTitle": "EAV-NS-Namen",
      "colNsName": "Name",
      "colNsTarget": "Verweist auf",
      "votesLabel": "Erhaltene Stimmen",
      "commissionLabel": "Provision",
      "accountInfo": "Kontoinformationen",
      "accountType": "Kontotyp",
      "createdAt": "Erstellt",
      "totalTxs": "Transaktionen gesamt",
      "tabTokenTx": "Token-Transfers",
      "tokenTxEmpty": "keine Token-Transfers",
      "roleContract": "Vertrag",
      "roleMultisig": "Multisignatur",
      "holdings": "Bestände",
      "colAsset": "Vermögenswert",
      "assets": "Vermögenswerte",
      "transfersRow": "Transfers",
      "votesRow": "Stimmen",
      "claimable": "Abrufbare Belohnungen",
      "tabApprovals": "Freigaben",
      "searchHoldings": "Nach Name, Symbol oder Adresse suchen…",
      "noHoldings": "nichts vorhanden",
      "colSpender": "Berechtigt",
      "colLimit": "Limit",
      "more": "Mehr anzeigen",
      "tabTokens": "Token",
      "tabTransactions": "Transaktionen",
      "colAge": "Alter",
      "colResult": "Ergebnis",
      "resultOk": "Erfolg",
      "resultRevert": "Zurückgesetzt",
      "summaryTx": "Insgesamt {n} Transaktionen",
      "summaryTransfers": "Insgesamt {n} Transfers",
      "summaryInternal": "Insgesamt {n} interne Transfers",
      "filterAll": "Alle",
      "filterIn": "Eingang",
      "filterOut": "Ausgang",
      "summaryTokenTx": "Insgesamt {n} Token-Transfers",
      "colParentHash": "Eltern-Hash",
      "colResourceAmount": "Ressourcenmenge",
      "colStakedAmount": "Gestaktes EAV7",
      "colUpdatedAt": "Aktualisiert",
      "stakeNote": "Bei EAV7 gewährt ein einziger Stake Energie UND Bandbreite zugleich — anders als bei TRON wird keine Ressource gewählt.",
      "permsOperations": "Operationen",
      "thisAccount": "dieses Konto",
      "summaryContracts": "Insgesamt {n} Verträge",
      "permsNote": "Bei EAV7 gilt der Operationssatz für jedes Multisig-Konto — es gibt keine Begrenzung pro Berechtigung wie bei TRON.",
      "permsDefault": "Standard",
      "permsDefaultNote": "Keine Multisignatur konfiguriert. Dies ist die effektive Autorisierung des Kontos: ein Schlüssel, eine Signatur."
    },
    "page_block": {
      "metaTitle": "Block #{height} · EAV7 Scan",
      "eyebrow": "block",
      "title": "Block #{height}",
      "sub": "vor {ago}",
      "kv": {
        "height": "Höhe",
        "date": "Datum",
        "producer": "Produzent",
        "previousHash": "Vorheriger Hash",
        "merkleRoot": "Merkle-Root (Txs)",
        "txCount": "Transaktionen",
        "protocol": "Protokoll",
        "scheme": "Schema"
      },
      "txSectionTitle": "Transaktionen des Blocks",
      "table": {
        "hash": "Hash",
        "type": "Typ",
        "from": "Von",
        "to": "An",
        "value": "Wert",
        "fee": "Gebühr"
      },
      "emptyBlock": "leerer Block"
    },
    "page_docs": {
      "metaTitleFallback": "Dokumentation · EAV7 Scan",
      "breadcrumb": "Dokumentation",
      "terminal": "Terminal",
      "onThisPage": "auf dieser Seite"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "Mining · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "Diese Seite existiert nicht auf der EAV7-Chain.",
      "backLink": "← zurück zur Startseite"
    },
    "page_search": {
      "metaTitle": "Suche · EAV7 Scan",
      "title": "Nichts gefunden",
      "notRecognizedPrefix": "Wir konnten",
      "notRecognizedSuffix": "nicht als Block, Transaktion oder EAV7-Adresse erkennen.",
      "retryPlaceholder": "Erneut versuchen…",
      "whatCanSearch": "wonach du suchen kannst",
      "blockLabel": "Block",
      "blockDesc": "Höhennummer, z. B.",
      "txLabel": "Transaktion",
      "txDesc": "Hash",
      "txChars": "(64 Zeichen)",
      "addressLabel": "Adresse",
      "addressLen34": "(34) oder",
      "or": "oder",
      "evmLabel": "(EAVM)",
      "backHome": "← zurück zur Startseite"
    },
    "page_token": {
      "eyebrow": "EAV20-Token",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "Token · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "Standard",
      "mintable": "nachprägbar",
      "fixedSupply": "feste Menge",
      "paused": "pausiert",
      "tabTransfers": "Transfers",
      "tabHolders": "Inhaber",
      "tabAnalysis": "Analyse",
      "totalSupply": "Gesamtmenge",
      "holders": "Inhaber",
      "decimals": "Nachkommastellen",
      "status": "Status",
      "statusActive": "Aktiv",
      "statusPaused": "Pausiert",
      "createdAt": "Erstellt",
      "contract": "Vertrag",
      "creator": "Ersteller",
      "owner": "Administrator",
      "mintableLabel": "Kann nachprägen",
      "yes": "ja",
      "no": "nein",
      "summaryTransfers": "Insgesamt {n} Transfers",
      "summaryHolders": "{n} Inhaber insgesamt — die größten {shown} werden angezeigt",
      "colHash": "Hash",
      "colBlock": "Block",
      "colAge": "Alter",
      "colFrom": "Von",
      "colTo": "An",
      "colAmount": "Betrag ({symbol})",
      "colRank": "#",
      "colAddress": "Adresse",
      "colBalance": "Guthaben ({symbol})",
      "colShare": "Anteil",
      "blacklisted": "gesperrt",
      "noTransfers": "Keine Transfers gefunden.",
      "noHolders": "Keine Inhaber gefunden.",
      "top1": "Größter Inhaber",
      "top10": "Top 10",
      "top50": "Top 50",
      "concentrationTitle": "Konzentration der Menge",
      "concentrationNote": "Wie viel der Menge in den größten Wallets liegt. Eine große Menge in wenigen Händen birgt ein anderes Marktrisiko als eine breit gestreute — deshalb zählt die Verteilung mehr als die Gesamtzahl.",
      "largestHolder": "Größter Inhaber:",
      "overviewTitle": "Überblick",
      "basicInfoTitle": "Vertragsdaten",
      "activityTitle": "Verteilung",
      "largestHolderShort": "Größter Inhaber",
      "tabContract": "Vertrag",
      "nativeTitle": "Protokolleigener Token",
      "nativeBadge": "kein beliebiger Code",
      "nativeNote": "Dieser Token ist kein Smart Contract, sondern wird vom Protokoll selbst umgesetzt. Es gibt kein Solidity, keinen Compiler und keinen Bytecode zu verifizieren — und ebenso wenig verborgene Logik, die jemand geschrieben haben könnte. Das Verhalten ist für jeden EAV20-Token identisch und ändert sich nur durch einen Hard Fork des Netzwerks.",
      "implementation": "Umsetzung",
      "implementationValue": "Konsens-nativ (EAV20-Standard)",
      "sourceOfTruth": "Protokoll-Quellcode",
      "powersTitle": "Was der Administrator tun kann",
      "powersNote": "In einem EVM-Explorer würden Sie dafür den Quellcode lesen. Hier sind es Zustandsfelder, daher listen wir sie direkt auf. Genau das zählt, bevor man einem Token vertraut.",
      "powerMint": "Weitere Einheiten prägen",
      "powerMintNote": "Erhöht die Gesamtmenge und verwässert bestehende Inhaber.",
      "powerPause": "Transfers pausieren",
      "powerPauseNote": "Friert jede Bewegung des Tokens auf einmal ein.",
      "powerBlacklist": "Adressen sperren",
      "powerBlacklistNote": "Hindert eine bestimmte Adresse am Senden oder Empfangen.",
      "powerFreeze": "Guthaben einfrieren",
      "powerFreezeNote": "Sperrt einen Teil des Guthabens einer Adresse bis zu einem Datum.",
      "powerYes": "kann",
      "powerNo": "kann nicht",
      "powerActiveNow": "jetzt aktiv",
      "adminIs": "Administrator:",
      "restrictionsTitle": "Geltende Beschränkungen",
      "frozenUntil": "bis {when}"
    },
    "page_tx": {
      "metaTitle": "Transaktion {id}… · EAV7 Scan",
      "eyebrow": "transaktion",
      "title": "Transaktion",
      "status": "Status",
      "type": "Typ",
      "block": "Block",
      "from": "Von",
      "to": "An",
      "value": "Wert",
      "fee": "Gebühr",
      "nonce": "Nonce",
      "date": "Datum",
      "scheme": "Schema",
      "eavmLayer": "EAVM-Schicht (MetaMask)",
      "energy": "Energie",
      "energyUnit": "Energie"
    },
    "page_txs": {
      "metaTitle": "Transaktionen · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "EAV20-Standard",
        "title": "Tokens",
        "subtitle": "native Assets des eav20-Protokolls — entspricht dem TRC20 von Tron"
      },
      "empty": {
        "title": "Noch keine Tokens erstellt",
        "description": "Tokens erscheinen hier, sobald sie im Netzwerk erstellt wurden, über"
      },
      "stats": {
        "tokens": "EAV20-Tokens",
        "holders": "Halter (gesamt)",
        "supply": "Kombiniertes Angebot",
        "standard": "Standard"
      },
      "card": {
        "supply": "Angebot",
        "holders": "Halter",
        "share": "Anteil",
        "creator": "Ersteller"
      }
    },
    "txs_live": {
      "chainLabel": "eav20-Chain",
      "title": "Transaktionen",
      "live": "live",
      "subtitleLive": "neueste zuerst · Werte in EAV7",
      "subtitleOlder": "ältere Transaktionen · Werte in EAV7",
      "searchPlaceholder": "Tx, Block oder Adresse suchen…",
      "cols": {
        "hash": "Hash",
        "block": "Block",
        "type": "Typ",
        "from": "Von",
        "to": "An",
        "value": "Wert",
        "age": "Alter"
      },
      "stats": {
        "totalTx": "Transaktionen gesamt",
        "mempool": "In der Mempool",
        "volume": "Volumen (EAV7)",
        "avgFee": "Durchschnittsgebühr"
      },
      "table": {
        "latest": "Neueste Transaktionen",
        "older": "Frühere Transaktionen",
        "updating": "wird aktualisiert",
        "empty": "keine Transaktionen gefunden",
        "count": "{n} Transaktionen",
        "loadMore": "Ältere laden →",
        "genesis": "Beginn der Chain"
      }
    },
    "ui_copy": {
      "default_value": "Wert",
      "aria_label": "{label} kopieren",
      "copied": "kopiert ✓",
      "copy_label": "{label} kopieren",
      "copy": "kopieren"
    },
    "ui_explorerSearch": {
      "placeholder": "Block, Tx oder Adresse suchen…",
      "searchButton": "Suchen"
    },
    "validators_live": {
      "unavailable": "Knoten nicht verfügbar",
      "header": {
        "eyebrow": "DPoS-Konsens",
        "title": "Validatoren",
        "live": "live",
        "subtitle": "{active} aktiv von {max} Slots · Mindeststake {min} EAV7 · Rotation bei jedem Block"
      },
      "producer": {
        "label": "Produzent des aktuellen Slots",
        "producingBlock": "erzeugt Block"
      },
      "slot": {
        "label": "Slot · {n}s",
        "staked": "{n} EAV7 gestaked"
      },
      "rotation": {
        "label": "Produktionsrotation"
      },
      "stats": {
        "activeValidators": "Aktive Validatoren",
        "rewardPerBlock": "Belohnung / Block",
        "totalStaked": "Gesamt gestaked",
        "peers": "Netzwerk-Peers"
      },
      "ranking": {
        "title": "Aktives Set",
        "sortedBy": "sortiert nach Stake",
        "producing": "erzeugt",
        "active": "aktiv",
        "stakedCaption": "EAV7 gestaked"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "sicher"
      },
      "role": {
        "validator": "Validator",
        "oracle": "Orakel",
        "account": "EAV7-Konto"
      },
      "lock": {
        "button": "sperren"
      },
      "balance": {
        "label": "verfügbares Guthaben"
      },
      "tier": {
        "validator": "Validator",
        "fee_zero": "Gebührenfrei",
        "standard": "Standard"
      },
      "actions": {
        "send": "Senden",
        "receive": "Empfangen",
        "stake": "Stake"
      },
      "stats": {
        "staked": "Gestaked",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "Gebühr",
        "fee_zero": "keine",
        "fee_standard": "Standard"
      },
      "tier_progress": {
        "label": "Stufenfortschritt",
        "remaining_prefix": "fehlen noch",
        "remaining_suffix": "bis Stufe {tier}"
      },
      "receive": {
        "title": "EAV7 empfangen",
        "description_before": "Teile deine Adresse",
        "description_after": "— das Netzwerk ordnet sie automatisch deinem nativen E7 zu.",
        "close": "schließen"
      },
      "activity": {
        "title": "Letzte Aktivität",
        "sent": "Gesendet",
        "received": "Empfangen"
      },
      "addresses": {
        "hint": "verwende dieses 0x, um zu empfangen (EAVM/MetaMask-Standard)"
      },
      "tokens": {
        "title": "EAV20-Token"
      },
      "footer": {
        "quantum": "postquanten · secp256k1 + ML-DSA-44",
        "logout": "abmelden / wechseln"
      },
      "wipe": {
        "title": "Diese Wallet löschen?",
        "description_before": "Die verschlüsselte Wallet wird",
        "description_bold": "aus diesem Browser",
        "description_after": " entfernt. Du kannst sie nur mit dem Backup des privaten Schlüssels wiederherstellen — es gibt keine Passwort-Wiederherstellung.",
        "warning_before": "Bestätige, dass du das",
        "warning_bold": "Schlüssel-Backup",
        "warning_after": "hast, bevor du löschst.",
        "download_backup": "Backup herunterladen (.json)",
        "cancel": "Abbrechen",
        "confirm": "Wallet löschen"
      }
    },
    "wallet_addNet": {
      "title": "In MetaMask / Trust verwenden",
      "description": "Fügen Sie das EAV7-Netzwerk (Chain 72020) zu Ihrer EVM-Wallet hinzu.",
      "adding": "wird hinzugefügt…",
      "added": "✓ hinzugefügt",
      "addButton": "Netzwerk hinzufügen",
      "noWallet": "MetaMask in diesem Browser nicht erkannt.",
      "error": "das Netzwerk konnte nicht hinzugefügt werden."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "nur du hast die Kontrolle",
        "on_device_title": "auf dem Gerät",
        "on_device_desc": "der Schlüssel verlässt es nie",
        "quantum_title": "quantensicher",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "Backup",
        "password": "Passwort",
        "ready": "Fertig"
      },
      "unlock": {
        "title": "Willkommen zurück",
        "subtitle": "In diesem Browser ist eine verschlüsselte Wallet gespeichert. Gib das Passwort ein, um sie zu entsperren.",
        "password_placeholder": "Passwort",
        "error_wrong_password": "falsches Passwort",
        "unlocking": "wird entsperrt…",
        "unlock_button": "Wallet entsperren",
        "wipe_confirm": "Wallet aus diesem Browser löschen? Stelle sicher, dass du das Schlüssel-Backup hast!",
        "wipe_button": "löschen und neu starten"
      },
      "choose": {
        "title": "Deine EAV7-Wallet",
        "subtitle": "Eine self-custodial Wallet: Du bist der alleinige Besitzer deiner Schlüssel. Starte in Sekunden.",
        "create_title": "Neue Wallet erstellen",
        "create_desc": "Erzeugt einen neuen Schlüssel auf diesem Gerät.",
        "import_title": "Schlüssel importieren",
        "import_desc": "Hast du schon einen privaten Schlüssel? Hier wiederherstellen."
      },
      "import": {
        "title": "Wallet importieren",
        "subtitle": "Füge den privaten Schlüssel ein und wähle ein Passwort, um ihn in diesem Browser zu verschlüsseln.",
        "label": "Privater Schlüssel (0x + 64 hex)",
        "importing": "wird importiert…",
        "button": "Importieren",
        "back": "Zurück",
        "error_invalid_key": "ungültiger privater Schlüssel (erwartet 0x + 64 hex)"
      },
      "create": {
        "title": "Sichere deinen Schlüssel",
        "subtitle": "Es gibt keine Passwortwiederherstellung. Wer den privaten Schlüssel besitzt, kontrolliert die Gelder — sichere ihn, bevor du fortfährst.",
        "warning_prefix": "Dieser Schlüssel ",
        "warning_bold": "ist der einzige Weg",
        "warning_suffix": ", auf deine Gelder zuzugreifen. Speichere ihn offline — teile ihn niemals mit jemandem.",
        "address_label": "E7-Adresse",
        "private_key_label": "privater Schlüssel",
        "reveal": "anzeigen",
        "hide": "verbergen",
        "download_backup": "⭳ Backup herunterladen (.json)",
        "confirm_saved": "Ich habe meinen Schlüssel sicher aufbewahrt",
        "creating": "wird erstellt…",
        "create_button": "Wallet erstellen",
        "confirm_hint": "bestätige, dass du den Schlüssel gesichert hast",
        "back": "Zurück"
      },
      "errors": {
        "password_min": "das Passwort muss mindestens 6 Zeichen haben",
        "password_mismatch": "die Passwörter stimmen nicht überein",
        "save_error": "Fehler beim Speichern"
      },
      "password": {
        "label": "Passwort zum Verschlüsseln (mind. 6 Zeichen)",
        "placeholder": "Passwort",
        "confirm_placeholder": "Passwort bestätigen",
        "mismatch": "die Passwörter stimmen nicht überein",
        "strength": {
          "very_weak": "sehr schwach",
          "weak": "schwach",
          "fair": "mäßig",
          "good": "gut",
          "strong": "stark"
        }
      }
    },
    "wallet_send": {
      "title": "EAV7 senden",
      "steps": {
        "destination": "Ziel",
        "value": "Betrag",
        "review": "Prüfen"
      },
      "recipient": {
        "label": "Ziel (0x… EAVM/MetaMask)",
        "paste": "einfügen",
        "valid": "✓ gültige Adresse",
        "invalid": "ungültige 0x-Adresse"
      },
      "errors": {
        "needEvmAddress": "geben Sie die 0x-Adresse des Ziels an (die Web-Wallet signiert im EAVM-Modell)",
        "invalidAddress": "das Ziel muss eine 0x-Adresse sein (EAVM/MetaMask)",
        "needPositiveAmount": "geben Sie einen positiven Betrag an",
        "insufficientBalance": "unzureichendes Guthaben (Gebühr berücksichtigen)",
        "invalidAmount": "ungültiger Betrag",
        "sendFailed": "Senden fehlgeschlagen"
      },
      "continue": "Weiter",
      "cancel": "Abbrechen",
      "available": "verfügbar: {amount} EAV7",
      "percent": {
        "max": "MAX"
      },
      "back": "Zurück",
      "sendingLabel": "wird gesendet",
      "sendingTo": "an {addr}",
      "networkFee": "Netzwerkgebühr",
      "balanceAfter": "Guthaben danach",
      "quantumNote": "auf diesem Gerät signiert · postquantenschutz des Netzwerks",
      "confirmAndSign": "Bestätigen und signieren",
      "signing": "wird signiert…",
      "transactionSent": {
        "title": "Transaktion gesendet",
        "subtitle": "Bestätigung im nächsten Block (~1 s)."
      },
      "close": "schließen"
    },
    "wallet_stake": {
      "title": "Stake",
      "subtitle": "≥ 100 EAV7 entfällt die Gebühr · ≥ 1.000 wirst du Validator (16 EAV7/erzeugtem Block).",
      "tierZeroFee": {
        "label": "Keine Gebühr",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "Validator",
        "sub": "≥ 1.000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "aktuell gestaked:",
      "warnValidator": "Dadurch sinkt dein Stake unter 1.000 — du verlierst den Validator-Status.",
      "warnFeeReset": "Dadurch sinkt dein Stake unter 100 — deine Transaktionen kosten wieder Gebühren.",
      "warnConfirm": "verstanden, trotzdem entfernen →",
      "errInvalidAmount": "gib einen positiven Betrag ein",
      "errInvalidValue": "ungültiger Betrag",
      "errFailedOp": "Vorgang fehlgeschlagen",
      "sentTitle": "Vorgang gesendet",
      "close": "schließen",
      "stakeBtn": "Staken",
      "removeBtn": "Entfernen"
    }
  },
  "ja": {
    "blocks_live": {
      "networkLabel": "eav20 チェーン",
      "title": "ブロック",
      "live": "ライブ",
      "blockTimeInfo": "{n}秒ごとに新しいブロック · DPoSコンセンサス",
      "searchPlaceholder": "高さまたはハッシュでブロックを検索…",
      "stats": {
        "height": "現在の高さ",
        "blockTime": "ブロック時間",
        "avgTx": "Txs / ブロック（平均）",
        "activeProducers": "アクティブなプロデューサー"
      },
      "latestBlocks": "最新のブロック",
      "updating": "更新中",
      "columns": {
        "block": "ブロック",
        "age": "経過時間",
        "txs": "Txs",
        "producer": "プロデューサー",
        "reward": "報酬",
        "hash": "ハッシュ"
      }
    },
    "comingSoon": {
      "badge": "工事中 · スプリント4",
      "backToExplorer": "← エクスプローラーに戻る"
    },
    "docs_api": {
      "badge": "パブリック API",
      "title": "ノードから直接ネットワークを照会",
      "baseUrl": "ベース URL",
      "tags": {
        "cors": "CORS 有効",
        "units": "値は e7 単位",
        "noAuth": "認証なし"
      },
      "groups": {
        "read": "読み取り",
        "write": "書き込み"
      },
      "endpoints": {
        "status": "ネットワーク状態：高さ、バリデータ、メンプール、ブロック報酬",
        "blocks": "直近 N ブロック",
        "blockByHeight": "高さまたはハッシュでブロックを取得",
        "txs": "最近のトランザクション（ページネーション対応）",
        "tx": "id によるトランザクション取得",
        "address": "残高、ステーク、nonce、ロール、トークン、エネルギー",
        "tokens": "EAV20 トークン一覧（詳細は /tokens/:id）",
        "validators": "アクティブな DPoS セット + スロットプロデューサー",
        "sendTx": "署名済みネイティブトランザクションを送信（secp256k1 + ML-DSA-44）",
        "sendEavmTx": "EAVM レイヤー経由でトランザクションを送信（JSON-RPC 互換）"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "カスタムネットワーク"
      },
      "title": "ウォレットで EAV7 を使う",
      "description": "EAV7 は汎用ウォレットが理解できる JSON-RPC 方言を話します — ワンクリックでネットワークを追加。",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "任意の EVM ウォレット"
      },
      "params": {
        "networkName": "ネットワーク名",
        "rpcUrl": "RPC URL",
        "chainId": "チェーン ID",
        "symbol": "シンボル",
        "explorer": "エクスプローラー",
        "decimals": "小数桁数"
      },
      "button": {
        "adding": "追加中…",
        "addToMetamask": "MetaMask に追加"
      },
      "status": {
        "added": "ネットワークを追加しました!",
        "noWallet": "MetaMask が検出されません — 隣のデータをコピーしてください。"
      },
      "error": {
        "addFailed": "ネットワークを追加できませんでした"
      },
      "mapping": {
        "badge": "同一アカウント",
        "title": "2つのID、1つのアカウント",
        "labelEavm": "EAVM",
        "labelNative": "ネイティブ",
        "desc1": "MetaMask には",
        "desc2": "が表示されます。オンチェーンでは残高は対応する",
        "desc3": "に存在します。同じアカウントです。"
      },
      "steps": {
        "step1": "クリックして EAV7 ネットワークを追加",
        "step2": "アカウントはウォレット内で 0x… として表示されます",
        "step3": "オンチェーンの残高は対応する E7 に存在します"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "ブロック生成時間",
        "stat_validators_value": "最大27",
        "stat_validators_label": "DPoSバリデータ",
        "stat_supply_value": "1000億",
        "stat_supply_label": "EAV7供給量",
        "stat_reward_label": "ブロックあたりEAV7",
        "stat_quantum_value": "ハイブリッド",
        "stat_quantum_label": "耐量子",
        "pillars_title": "プロトコルの柱",
        "pillar_consensus": "DPoSコンセンサス",
        "pillar_token_standard": "EAV20規格",
        "pillar_bridge": "クロスチェーンブリッジ",
        "pillar_security": "セキュリティ&AI",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "EAV20規格",
        "title": "仮想マシン不要のネイティブトークン",
        "description": "TRC20相当:トークンはチェーンの状態に直接存在し、署名付きトランザクションで移動します — 高速・低コスト・検証可能。",
        "cta": "ネットワークのトークンを見る"
      },
      "consenso": {
        "badge": "DPoSコンセンサス",
        "title": "毎秒新しいブロックが生成",
        "description": "バリデータは順番に交代します:1秒ごとのスロットで、予定されたプロデューサーが次のブロックに署名します。グラインディングも待機も不要です。",
        "slot_now": "現在のスロット",
        "slot_offset": "スロット +{n}",
        "fact_election_label": "選出",
        "fact_election_value": "ステーク上位27者(≥ 1,000 EAV7)",
        "fact_production_label": "生成",
        "fact_production_value": "validators[slot % N] · ラウンドロビン",
        "fact_fork_choice_label": "フォーク選択",
        "fact_fork_choice_value": "最長の有効チェーン",
        "cta": "ライブでバリデータを見る"
      },
      "ponte": {
        "title": "ブリッジがネットワーク間で価値を移動する仕組み",
        "arrow_pays": "支払い",
        "node_external": "外部ネットワーク",
        "step_bridge_out": "EAV7/トークンをロックし、外部の送金先を記録",
        "step_relayer": "出金を監視し、外部チェーンで支払う",
        "step_bridge_settle": "出金をオンチェーンで支払い済みとしてマーク(冪等)",
        "step_bridge_in": "外部からの資金を解放、sourceTxHashで重複排除"
      },
      "seguranca": {
        "badge_hybrid": "ハイブリッド署名",
        "title_hybrid": "設計段階から耐量子",
        "verify_both": "検証には両方が必要",
        "hybrid_description": "すべてのウォレット、トランザクション、ブロックには2つの署名が含まれます — ECDSA(成熟)とML-DSA-44(FIPS 204、耐量子)。偽造には両方のプリミティブを同時に破る必要があります。",
        "badge_ai": "AIレイヤー",
        "title_ai": "オンチェーンエスクロー付きオラクル",
        "sentinel_title": "セキュリティ監視 · 24時間",
        "sentinel_description": "プロセスがネットワークを継続的に監視します — リオーグ、巨額送金、トランザクションの急増、プロデューサーの集中 — 結果をセキュリティフィードに記録します。",
        "sentinel_cta": "マイニングで見る"
      },
      "staking": {
        "tier_fee_title": "手数料ゼロ",
        "tier_fee_desc": "100 EAV7以上をロックすると取引手数料がゼロになります — エネルギー(帯域幅)はフリーズにより生成され、時間とともに回復します。",
        "tier_mine_title": "ブロックをマイニング",
        "tier_mine_desc": "1,000 EAV7以上をロックしてDPoS選出に参加します。ブロックを生成すると16 EAV7とそのブロックの手数料を全額受け取れます。",
        "reward_title": "報酬とアンステーク",
        "reward_desc": "報酬はブロック生成者に全額支払われます。アンステークすると残高に金額が戻ります — ネットワーク最後のバリデータを空にすることはできません。",
        "cta_lock": "EAV7をロック",
        "cta_mining": "マイニングを見る"
      }
    },
    "energyGauge": {
      "ariaLabel": "エネルギー {available} / {max}",
      "title": "エネルギー",
      "description": "取引コストを賄うリソース。時間とともに回復し、ステーキングでロックされたEAV7に応じて増加します。"
    },
    "home_activityBars": {
      "ariaLabel": "ブロックごとのトランザクション数",
      "txsCount": "{n} 件のトランザクション"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "概要",
        "blocks": "ブロック",
        "transactions": "トランザクション",
        "validators": "バリデーター",
        "tokens": "トークン"
      },
      "cols": {
        "block": "ブロック",
        "age": "経過時間",
        "txs": "Txs",
        "producer": "生成者",
        "reward": "報酬",
        "hash": "ハッシュ"
      },
      "sidebar": {
        "explore": "エクスプローラー",
        "network": "ネットワーク"
      },
      "toolbar": {
        "filter": "フィルター",
        "sort": "並び替え",
        "live": "ライブ"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "エクスプローラー",
      "title": "オンチェーンのすべてをリアルタイムで",
      "description": "ブロックとトランザクションが今まさに流れています。項目をクリックして詳細を確認しましょう。",
      "viewBlocks": "ブロックを見る",
      "viewTxs": "トランザクションを見る"
    },
    "home_heartbeat": {
      "label": "ハートビート",
      "blockAgoPrefix": "ブロック",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} 件のトランザクション",
      "viewAll": "すべて表示"
    },
    "home_hero": {
      "coin_alt": "EAV7コイン",
      "title": "オンチェーンエクスプローラーの新時代",
      "subtitle": "1秒ごとのブロック生成、ポスト量子セキュリティ、ネイティブAIレイヤー。ブロック、トランザクション、バリデーター、アドレスをリアルタイムで調査できます。",
      "search_placeholder": "ブロック、トランザクション、アドレスを検索…",
      "search_button": "探索する",
      "stat_height": "高さ",
      "stat_block": "ブロック時間",
      "stat_validators": "バリデーター",
      "stat_mempool": "メモリプール"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "EAV7コイン",
        "titleBefore": "EAV7ブロックチェーン、そして",
        "titleHighlight": "その先へ",
        "subtitle": "1秒のDPoSコンセンサス、耐量子セキュリティ、ネイティブAIレイヤー。ブロック、トランザクション、バリデーターをリアルタイムで探索できます。",
        "exploreNetwork": "ネットワークを探索",
        "openWallet": "ウォレットを開く",
        "scrollAriaLabel": "パネルへスクロール"
      },
      "vitals": {
        "height": "ブロック高",
        "blockTime": "ブロック時間",
        "validators": "バリデーター"
      }
    },
    "home_inkBand": {
      "eyebrow": "インタラクティブ",
      "title": "マウスを合わせて表示",
      "subtitle": "EAV7ネットワーク、ブロックの先へ",
      "mobileHint": "モバイルではアートがそのまま表示されます"
    },
    "home_latestTxs": {
      "title": "最新のトランザクション",
      "viewAll": "すべて表示",
      "table": {
        "hash": "ハッシュ",
        "type": "種類",
        "fromTo": "送信元 → 送信先",
        "value": "金額"
      },
      "empty": "まだトランザクションがありません"
    },
    "home_moments": {
      "sectionEyebrow": "プロトコルの内側",
      "sectionTitle": "長く続くために作られたL1",
      "items": {
        "security": {
          "eyebrow": "セキュリティ",
          "titlePrefix": "備える",
          "titleHighlight": "ポスト量子時代",
          "desc": "すべてのウォレット、トランザクション、ブロックは2つの署名を持ち——検証には両方が必要です。偽造するには両方のプリミティブを同時に破る必要があります。",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "SHA3-256で導出されたE7アドレス"
        },
        "consensus": {
          "eyebrow": "コンセンサス",
          "titlePrefix": "毎",
          "titleHighlight": "1秒ごとにブロック生成",
          "desc": "ステークで選出される最大27のバリデータによる決定論的ローテーションのDPoSコンセンサス——Tronより3倍高速で、ライブネスが保護されています。",
          "bullet1": "27バリデータ · スロットごとのラウンドロビン",
          "bullet2": "ブロックごとに16 EAV7の報酬"
        },
        "intelligence": {
          "eyebrow": "インテリジェンス",
          "titlePrefix": "ネイティブな",
          "titleHighlight": "AIレイヤー",
          "desc": "エスクロー付きのオンチェーンオラクル: AIタスクが公開され、指定のオラクルによって解決され、検証可能な形で決済されます——すべてプロトコル内で。",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "結果ハッシュがオンチェーンに記録"
        },
        "assets": {
          "eyebrow": "アセット",
          "titlePrefix": "トークン",
          "titleHighlight": "EAV20",
          "titleSuffix": "とクロスチェーンブリッジ",
          "desc": "ネイティブトークン(TRC20相当)を作成・移動し、安全でべき等なロックアンドリリースモデルによってEAV7を他のネットワークに接続します。",
          "bullet1": "EAV20標準 · create / transfer / approve",
          "bullet2": "TRON · ETH · BTCブリッジ (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "リアルタイム",
      "title": "ネットワークの鼓動",
      "subtitle": "毎秒新しいブロックが生成されます。EAV7ネットワークの鼓動をリアルタイムで確認しましょう。",
      "stats": {
        "blockHeight": "ブロック高",
        "txLast30": "取引数 · 直近30ブロック",
        "mempool": "メンプール",
        "rewardPerBlock": "EAV7 / ブロック"
      },
      "activity": {
        "title": "ネットワークアクティビティ",
        "txInLastBlocks": "直近{n}ブロックの取引数"
      },
      "slots": {
        "title": "DPoSスロット",
        "activeValidators": "アクティブなバリデーター",
        "supply": "供給量 {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "アカウント総数"
        },
        "transactions": {
          "label": "取引総数"
        },
        "volume": {
          "label": "転送量"
        },
        "staked": {
          "label": "ステーキング総量"
        }
      },
      "ring": {
        "supplyLine1": "の供給量が",
        "supplyLine2": "ステークにロック中"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{max}中{value}"
    },
    "home_walletCta": {
      "eyebrow": "今すぐ始める",
      "title": "今すぐEAV7ネットワークを探索",
      "description": "ウォレットはブラウザ内でポスト量子保護のもと生成・署名され、デバイスから外部に出ることはありません。送金、ステーキング、マイニングもすべてウェブから直接行えます。",
      "createWallet": "ウォレットを作成",
      "exploreNetwork": "ネットワークを探索"
    },
    "mining_live": {
      "badge_consensus": "DPoS · ステーキング",
      "title": "マイニング",
      "live_badge": "ライブ",
      "subtitle": "EAV7では、EAV7をロック(ステーク)することでマイニングします — ハードウェア不要、エネルギー消費なし",
      "stat_reward_block": "ブロックあたりの報酬",
      "stat_blocks_day": "1日あたりのブロック数",
      "stat_daily_emission": "1日の発行量",
      "stat_already_mined": "採掘済み",
      "network_production": "ネットワーク生産量",
      "reward_per_block_caption": "各ブロック(1秒)の報酬",
      "annual_emission_caption": "推定年間発行量",
      "next_block": "次のブロック",
      "miners_label": "マイナー",
      "staked_label": "ロック済み EAV7",
      "block_time_label": "ブロック時間",
      "ai_sentinel_badge": "AIセンチネル · 24時間",
      "network_protected": "ネットワーク保護済み",
      "ai_monitoring_desc": "ネイティブAIによる継続監視",
      "alerts_analyzed": "分析済みアラート",
      "active_oracles": "アクティブなオラクル",
      "pending_ai_tasks": "保留中のAIタスク",
      "cta_title": "EAV7のマイニングを始める",
      "cta_description": "ウォレットでEAV7をロックしてDPoSコンセンサスのマイナーとなり、生成されるブロックごとに報酬を受け取りましょう。すべて自己管理型で、ブラウザ上でポスト量子署名を行います。",
      "cta_lock_button": "EAV7をロック",
      "cta_view_validators": "バリデーターを見る"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "検索",
      "dica": "ブロック（番号）・トランザクション（E7…）・アドレス（E7… または 0x…）"
    },
    "netStatus": {
      "onlineTitle": "EAV7ネットワーク オンライン · 高さ {height}",
      "offlineTitle": "ノードオフライン",
      "connecting": "接続中…"
    },
    "page_address": {
      "metaTitle": "アドレス {addr}… · EAV7 Scan",
      "eyebrow": "アドレス",
      "title": "アドレス",
      "roleValidator": "バリデーター",
      "roleOracle": "オラクル",
      "roleAccount": "アカウント",
      "balance": "残高",
      "staked": "ステーク中",
      "nonce": "nonce",
      "feeExempt": "手数料無料",
      "available": "利用可能",
      "max": "最大 {n}",
      "tokensTitle": "EAV20トークン",
      "colToken": "トークン",
      "colSymbol": "シンボル",
      "colBalance": "残高",
      "txsTitle": "トランザクション",
      "colHash": "ハッシュ",
      "colBlock": "ブロック",
      "colType": "種類",
      "colCounterparty": "取引先",
      "colValue": "金額",
      "colDate": "日付",
      "out": "送金",
      "in": "受取",
      "noTxs": "このアドレスの取引はありません",
      "totalBalance": "合計残高: {n}",
      "tabOverview": "概要",
      "tabTransfers": "送受信",
      "tabInternal": "内部送金",
      "tabStaking": "ステーキングとリソース",
      "tabContract": "コントラクト",
      "tabPermissions": "権限",
      "tabAnalysis": "分析",
      "internalNote": "コントラクトの実行によって移動した価値です。署名済みトランザクションではないため、固有のハッシュを持ちません。",
      "internalEmpty": "内部送金はありません",
      "colFrom": "送信元",
      "colTo": "送信先",
      "colTx": "トランザクション",
      "stakingTitle": "ステークとリソース",
      "bandwidth": "帯域幅",
      "energy": "エネルギー",
      "delegatedOut": "委任した量",
      "delegatedIn": "委任された量",
      "unbondingTitle": "アンボンディング中",
      "matureIn": "{n} ブロック後に解除",
      "votesCastTitle": "投じた票",
      "votesReceived": "獲得票",
      "vestingTitle": "ベスティング",
      "permsNone": "単一鍵アカウント — マルチシグなし",
      "permsThreshold": "しきい値",
      "colWeight": "重み",
      "colKey": "鍵",
      "contractNone": "このアドレスはコントラクトではありません",
      "contractCodeSize": "コードサイズ",
      "contractVerified": "検証済み",
      "contractUnverified": "未検証",
      "sent": "送信",
      "received": "受信",
      "feesPaid": "支払手数料",
      "txCount": "トランザクション数",
      "firstSeen": "最初の活動",
      "lastSeen": "最後の活動",
      "byType": "タイプ別",
      "topCounterparties": "主な取引相手",
      "truncatedNote": "最近のトランザクションに限定したサンプルです",
      "noData": "データなし",
      "nftsTitle": "NFT (EAV721)",
      "colNftCollection": "コレクション",
      "colNftId": "トークン",
      "namesTitle": "EAV-NS 名",
      "colNsName": "名前",
      "colNsTarget": "解決先",
      "votesLabel": "獲得票",
      "commissionLabel": "手数料率",
      "accountInfo": "アカウント情報",
      "accountType": "アカウント種別",
      "createdAt": "作成日",
      "totalTxs": "トランザクション総数",
      "tabTokenTx": "トークン送受信",
      "tokenTxEmpty": "トークン送受信はありません",
      "roleContract": "コントラクト",
      "roleMultisig": "マルチシグ",
      "holdings": "保有",
      "colAsset": "資産",
      "assets": "資産",
      "transfersRow": "送受信",
      "votesRow": "投票",
      "claimable": "受取可能な報酬",
      "tabApprovals": "承認",
      "searchHoldings": "名前・シンボル・アドレスで検索…",
      "noHoldings": "該当なし",
      "colSpender": "承認先",
      "colLimit": "上限",
      "more": "もっと見る",
      "tabTokens": "トークン",
      "tabTransactions": "トランザクション",
      "colAge": "経過",
      "colResult": "結果",
      "resultOk": "成功",
      "resultRevert": "リバート",
      "summaryTx": "合計 {n} 件のトランザクション",
      "summaryTransfers": "合計 {n} 件の送受信",
      "summaryInternal": "合計 {n} 件の内部送金",
      "filterAll": "すべて",
      "filterIn": "受取",
      "filterOut": "送付",
      "summaryTokenTx": "合計 {n} 件のトークン送受信",
      "colParentHash": "親ハッシュ",
      "colResourceAmount": "リソース量",
      "colStakedAmount": "ステーク中の EAV7",
      "colUpdatedAt": "更新日時",
      "stakeNote": "EAV7 では 1 回のステークでエネルギーと帯域幅の両方が付与されます — TRON と異なりリソースを選びません。",
      "permsOperations": "操作",
      "thisAccount": "このアカウント",
      "summaryContracts": "合計 {n} 件のコントラクト",
      "permsNote": "EAV7 では操作セットはすべてのマルチシグ口座に適用されます — TRON のような権限ごとのスコープはありません。",
      "permsDefault": "既定",
      "permsDefaultNote": "マルチシグは未設定です。これがアカウントの実効的な認可です — 鍵ひとつ、署名ひとつ。"
    },
    "page_block": {
      "metaTitle": "ブロック #{height} · EAV7 Scan",
      "eyebrow": "ブロック",
      "title": "ブロック #{height}",
      "sub": "{ago}前",
      "kv": {
        "height": "高さ",
        "date": "日付",
        "producer": "生成者",
        "previousHash": "前のハッシュ",
        "merkleRoot": "Merkleルート (トランザクション)",
        "txCount": "トランザクション数",
        "protocol": "プロトコル",
        "scheme": "スキーム"
      },
      "txSectionTitle": "ブロックのトランザクション",
      "table": {
        "hash": "ハッシュ",
        "type": "種別",
        "from": "送信元",
        "to": "宛先",
        "value": "金額",
        "fee": "手数料"
      },
      "emptyBlock": "空のブロック"
    },
    "page_docs": {
      "metaTitleFallback": "ドキュメント · EAV7 Scan",
      "breadcrumb": "ドキュメント",
      "terminal": "ターミナル",
      "onThisPage": "このページの内容"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "マイニング · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "このページはEAV7チェーン上に存在しません。",
      "backLink": "← ホームに戻る"
    },
    "page_search": {
      "metaTitle": "検索 · EAV7 Scan",
      "title": "見つかりませんでした",
      "notRecognizedPrefix": "",
      "notRecognizedSuffix": "は、ブロック、トランザクション、または EAV7 アドレスとして認識できませんでした。",
      "retryPlaceholder": "もう一度お試しください…",
      "whatCanSearch": "検索できるもの",
      "blockLabel": "ブロック",
      "blockDesc": "ブロック高の番号、例：",
      "txLabel": "トランザクション",
      "txDesc": "ハッシュ",
      "txChars": "（64文字）",
      "addressLabel": "アドレス",
      "addressLen34": "（34）または",
      "or": "または",
      "evmLabel": "（EAVM）",
      "backHome": "← ホームに戻る"
    },
    "page_token": {
      "eyebrow": "EAV20 トークン",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "トークン · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "規格",
      "mintable": "追加発行可",
      "fixedSupply": "供給固定",
      "paused": "停止中",
      "tabTransfers": "送金",
      "tabHolders": "保有者",
      "tabAnalysis": "分析",
      "totalSupply": "総供給量",
      "holders": "保有者",
      "decimals": "小数桁",
      "status": "状態",
      "statusActive": "稼働中",
      "statusPaused": "停止中",
      "createdAt": "作成日時",
      "contract": "コントラクト",
      "creator": "作成者",
      "owner": "管理者",
      "mintableLabel": "追加発行が可能",
      "yes": "はい",
      "no": "いいえ",
      "summaryTransfers": "合計 {n} 件の送金",
      "summaryHolders": "保有者は合計 {n} 名 — 上位 {shown} 名を表示",
      "colHash": "ハッシュ",
      "colBlock": "ブロック",
      "colAge": "経過",
      "colFrom": "送信元",
      "colTo": "送信先",
      "colAmount": "数量 ({symbol})",
      "colRank": "#",
      "colAddress": "アドレス",
      "colBalance": "残高 ({symbol})",
      "colShare": "比率",
      "blacklisted": "ブロック済み",
      "noTransfers": "送金が見つかりません。",
      "noHolders": "保有者が見つかりません。",
      "top1": "最大保有者",
      "top10": "上位 10",
      "top50": "上位 50",
      "concentrationTitle": "供給の集中度",
      "concentrationNote": "供給量のうち大口ウォレットが占める割合です。少数に集中した大量の供給は、広く分散した供給とは市場リスクが異なります。総量よりも分布のほうが重要です。",
      "largestHolder": "最大保有者：",
      "overviewTitle": "概要",
      "basicInfoTitle": "コントラクト情報",
      "activityTitle": "分布",
      "largestHolderShort": "最大保有者",
      "tabContract": "コントラクト",
      "nativeTitle": "プロトコルネイティブトークン",
      "nativeBadge": "任意コードなし",
      "nativeNote": "このトークンはスマートコントラクトではなく、プロトコル自体によって実装されています。検証すべき Solidity・コンパイラ・バイトコードは存在せず、誰かが書き込んだ隠れたロジックも存在しません。動作はすべての EAV20 トークンで同一で、ネットワークのハードフォークによってのみ変わります。",
      "implementation": "実装",
      "implementationValue": "コンセンサスネイティブ（EAV20 標準）",
      "sourceOfTruth": "プロトコルのソース",
      "powersTitle": "管理者にできること",
      "powersNote": "EVM のエクスプローラーではソースコードを読んで調べる内容です。ここでは状態フィールドなので直接一覧にしています。トークンを信頼する前に本当に重要なのはこの点です。",
      "powerMint": "追加発行",
      "powerMintNote": "総供給量が増え、既存の保有者が希薄化します。",
      "powerPause": "送金の停止",
      "powerPauseNote": "このトークンのすべての移動を一括で凍結します。",
      "powerBlacklist": "アドレスの遮断",
      "powerBlacklistNote": "特定のアドレスの送受信を禁止します。",
      "powerFreeze": "残高の凍結",
      "powerFreezeNote": "アドレスの残高の一部を指定日まで固定します。",
      "powerYes": "可能",
      "powerNo": "不可",
      "powerActiveNow": "現在有効",
      "adminIs": "管理者：",
      "restrictionsTitle": "有効な制限",
      "frozenUntil": "{when} まで"
    },
    "page_tx": {
      "metaTitle": "トランザクション {id}… · EAV7 Scan",
      "eyebrow": "トランザクション",
      "title": "トランザクション",
      "status": "ステータス",
      "type": "種類",
      "block": "ブロック",
      "from": "送信元",
      "to": "送信先",
      "value": "金額",
      "fee": "手数料",
      "nonce": "Nonce",
      "date": "日時",
      "scheme": "スキーム",
      "eavmLayer": "EAVM レイヤー (MetaMask)",
      "energy": "エネルギー",
      "energyUnit": "エネルギー"
    },
    "page_txs": {
      "metaTitle": "トランザクション · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "EAV20 規格",
        "title": "トークン",
        "subtitle": "eav20プロトコルのネイティブ資産 — Tronの TRC20 に相当"
      },
      "empty": {
        "title": "まだトークンが作成されていません",
        "description": "トークンはネットワーク上で作成されると即座にここに表示されます。作成方法は"
      },
      "stats": {
        "tokens": "EAV20 トークン",
        "holders": "保有者（合計）",
        "supply": "合計供給量",
        "standard": "規格"
      },
      "card": {
        "supply": "供給量",
        "holders": "保有者",
        "share": "割合",
        "creator": "作成者"
      }
    },
    "txs_live": {
      "chainLabel": "eav20 チェーン",
      "title": "トランザクション",
      "live": "ライブ",
      "subtitleLive": "新しい順 · 単位は EAV7",
      "subtitleOlder": "過去のトランザクション · 単位は EAV7",
      "searchPlaceholder": "トランザクション、ブロック、アドレスを検索…",
      "cols": {
        "hash": "ハッシュ",
        "block": "ブロック",
        "type": "種別",
        "from": "送信元",
        "to": "送信先",
        "value": "金額",
        "age": "経過時間"
      },
      "stats": {
        "totalTx": "総トランザクション数",
        "mempool": "メンプール内",
        "volume": "取引量 (EAV7)",
        "avgFee": "平均手数料"
      },
      "table": {
        "latest": "最新のトランザクション",
        "older": "過去のトランザクション",
        "updating": "更新中",
        "empty": "トランザクションが見つかりません",
        "count": "{n} 件のトランザクション",
        "loadMore": "さらに古いものを読み込む →",
        "genesis": "チェーンの起点"
      }
    },
    "ui_copy": {
      "default_value": "値",
      "aria_label": "{label}をコピー",
      "copied": "コピーしました ✓",
      "copy_label": "{label}をコピー",
      "copy": "コピー"
    },
    "ui_explorerSearch": {
      "placeholder": "ブロック、取引、アドレスを検索…",
      "searchButton": "検索"
    },
    "validators_live": {
      "unavailable": "ノードが利用できません",
      "header": {
        "eyebrow": "DPoS コンセンサス",
        "title": "バリデーター",
        "live": "ライブ",
        "subtitle": "{max} スロット中 {active} がアクティブ · 最低ステーク {min} EAV7 · ブロックごとにローテーション"
      },
      "producer": {
        "label": "現在のスロットの生成者",
        "producingBlock": "ブロックを生成中"
      },
      "slot": {
        "label": "スロット · {n}秒",
        "staked": "{n} EAV7 をステーク"
      },
      "rotation": {
        "label": "生成ローテーション"
      },
      "stats": {
        "activeValidators": "アクティブなバリデーター",
        "rewardPerBlock": "ブロックあたりの報酬",
        "totalStaked": "合計ステーク量",
        "peers": "ネットワークピア数"
      },
      "ranking": {
        "title": "アクティブセット",
        "sortedBy": "ステーク順",
        "producing": "生成中",
        "active": "アクティブ",
        "stakedCaption": "EAV7 ステーク"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "安全"
      },
      "role": {
        "validator": "バリデーター",
        "oracle": "オラクル",
        "account": "EAV7アカウント"
      },
      "lock": {
        "button": "ロック"
      },
      "balance": {
        "label": "利用可能残高"
      },
      "tier": {
        "validator": "バリデーター",
        "fee_zero": "手数料無料",
        "standard": "スタンダード"
      },
      "actions": {
        "send": "送金",
        "receive": "受け取る",
        "stake": "ステーク"
      },
      "stats": {
        "staked": "ステーク中",
        "staked_suffix": "EAV7",
        "nonce": "ノンス",
        "fee": "手数料",
        "fee_zero": "無料",
        "fee_standard": "標準"
      },
      "tier_progress": {
        "label": "ティアの進捗",
        "remaining_prefix": "残り",
        "remaining_suffix": "で{tier}ティアに到達"
      },
      "receive": {
        "title": "EAV7を受け取る",
        "description_before": "アドレスを共有してください",
        "description_after": "— ネットワークが自動的にネイティブE7に変換します。",
        "close": "閉じる"
      },
      "activity": {
        "title": "最近のアクティビティ",
        "sent": "送信済み",
        "received": "受信済み"
      },
      "addresses": {
        "hint": "受け取りにはこの0xを使用してください（EAVM/MetaMask標準）"
      },
      "tokens": {
        "title": "EAV20トークン"
      },
      "footer": {
        "quantum": "耐量子 · secp256k1 + ML-DSA-44",
        "logout": "ログアウト / 切り替え"
      },
      "wipe": {
        "title": "このウォレットを削除しますか？",
        "description_before": "暗号化されたウォレットは",
        "description_bold": "このブラウザから",
        "description_after": "削除されます。秘密鍵のバックアップでのみ復元できます — パスワードの復旧はありません。",
        "warning_before": "削除する前に",
        "warning_bold": "鍵のバックアップ",
        "warning_after": "を保有していることを確認してください。",
        "download_backup": "バックアップをダウンロード（.json）",
        "cancel": "キャンセル",
        "confirm": "ウォレットを削除"
      }
    },
    "wallet_addNet": {
      "title": "MetaMask / Trust で使用",
      "description": "EAV7 ネットワーク(チェーン 72020)を EVM ウォレットに追加します。",
      "adding": "追加中…",
      "added": "✓ 追加済み",
      "addButton": "ネットワークを追加",
      "noWallet": "このブラウザでは MetaMask が検出されませんでした。",
      "error": "ネットワークを追加できませんでした。"
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "管理するのはあなただけ",
        "on_device_title": "端末内保管",
        "on_device_desc": "秘密鍵は外部に出ません",
        "quantum_title": "耐量子",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "バックアップ",
        "password": "パスワード",
        "ready": "完了"
      },
      "unlock": {
        "title": "おかえりなさい",
        "subtitle": "このブラウザに暗号化されたウォレットがあります。パスワードを入力してロックを解除してください。",
        "password_placeholder": "パスワード",
        "error_wrong_password": "パスワードが正しくありません",
        "unlocking": "ロック解除中…",
        "unlock_button": "ウォレットのロックを解除",
        "wipe_confirm": "このブラウザのウォレットを削除しますか？秘密鍵のバックアップがあることを確認してください！",
        "wipe_button": "削除してやり直す"
      },
      "choose": {
        "title": "あなたのEAV7ウォレット",
        "subtitle": "自己管理型ウォレット：鍵の所有者はあなただけです。数秒で始められます。",
        "create_title": "新しいウォレットを作成",
        "create_desc": "この端末で新しい鍵を生成します。",
        "import_title": "鍵をインポート",
        "import_desc": "すでに秘密鍵をお持ちですか？ここから復元してください。"
      },
      "import": {
        "title": "ウォレットをインポート",
        "subtitle": "秘密鍵を貼り付け、このブラウザで暗号化するパスワードを設定してください。",
        "label": "秘密鍵（0x + 64桁の16進数）",
        "importing": "インポート中…",
        "button": "インポート",
        "back": "戻る",
        "error_invalid_key": "無効な秘密鍵です（0x + 64桁の16進数が必要）"
      },
      "create": {
        "title": "鍵をバックアップしてください",
        "subtitle": "パスワードの復旧はできません。秘密鍵を持つ者が資金を管理します — 続行する前に必ず保存してください。",
        "warning_prefix": "この鍵は",
        "warning_bold": "資金にアクセスする唯一の方法",
        "warning_suffix": "です。オフラインで保存し、誰とも共有しないでください。",
        "address_label": "E7アドレス",
        "private_key_label": "秘密鍵",
        "reveal": "表示",
        "hide": "非表示",
        "download_backup": "⭳ バックアップをダウンロード (.json)",
        "confirm_saved": "鍵を安全な場所に保存しました",
        "creating": "作成中…",
        "create_button": "ウォレットを作成",
        "confirm_hint": "鍵を保存したことを確認してください",
        "back": "戻る"
      },
      "errors": {
        "password_min": "パスワードは6文字以上必要です",
        "password_mismatch": "パスワードが一致しません",
        "save_error": "保存中にエラーが発生しました"
      },
      "password": {
        "label": "暗号化用パスワード（最低6文字）",
        "placeholder": "パスワード",
        "confirm_placeholder": "パスワードを確認",
        "mismatch": "パスワードが一致しません",
        "strength": {
          "very_weak": "非常に弱い",
          "weak": "弱い",
          "fair": "普通",
          "good": "良い",
          "strong": "強い"
        }
      }
    },
    "wallet_send": {
      "title": "EAV7を送る",
      "steps": {
        "destination": "送付先",
        "value": "金額",
        "review": "確認"
      },
      "recipient": {
        "label": "送付先（0x… EAVM/MetaMask）",
        "paste": "貼り付け",
        "valid": "✓ 有効なアドレス",
        "invalid": "無効な0xアドレス"
      },
      "errors": {
        "needEvmAddress": "送付先の0xアドレスを入力してください（ウェブウォレットはEAVMモデルで署名します）",
        "invalidAddress": "送付先は0xアドレスである必要があります（EAVM/MetaMask）",
        "needPositiveAmount": "正の金額を入力してください",
        "insufficientBalance": "残高不足です（手数料をご考慮ください）",
        "invalidAmount": "金額が無効です",
        "sendFailed": "送信に失敗しました"
      },
      "continue": "続ける",
      "cancel": "キャンセル",
      "available": "利用可能: {amount} EAV7",
      "percent": {
        "max": "最大"
      },
      "back": "戻る",
      "sendingLabel": "送信中",
      "sendingTo": "{addr} へ",
      "networkFee": "ネットワーク手数料",
      "balanceAfter": "送信後の残高",
      "quantumNote": "この端末で署名済み · ネットワークはポスト量子保護対応",
      "confirmAndSign": "確認して署名",
      "signing": "署名中…",
      "transactionSent": {
        "title": "取引を送信しました",
        "subtitle": "次のブロックで確認されます（約1秒）。"
      },
      "close": "閉じる"
    },
    "wallet_stake": {
      "title": "ステーク",
      "subtitle": "≥ 100 EAV7 で手数料無料 · ≥ 1,000 でバリデーターに(ブロック生成ごとに16 EAV7)。",
      "tierZeroFee": {
        "label": "手数料ゼロ",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "バリデーター",
        "sub": "≥ 1,000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "現在のステーク:",
      "warnValidator": "これによりステークが1,000未満になり、バリデーター資格を失います。",
      "warnFeeReset": "これによりステークが100未満になり、取引に再び手数料がかかります。",
      "warnConfirm": "了解、それでも解除する →",
      "errInvalidAmount": "正の値を入力してください",
      "errInvalidValue": "無効な値です",
      "errFailedOp": "操作に失敗しました",
      "sentTitle": "操作を送信しました",
      "close": "閉じる",
      "stakeBtn": "ステークする",
      "removeBtn": "解除する"
    }
  },
  "ru": {
    "blocks_live": {
      "networkLabel": "сеть eav20",
      "title": "Блоки",
      "live": "в реальном времени",
      "blockTimeInfo": "новый блок каждые {n} с · консенсус DPoS",
      "searchPlaceholder": "Поиск блока по высоте или хешу…",
      "stats": {
        "height": "Текущая высота",
        "blockTime": "Время блока",
        "avgTx": "Тр. / блок (средн.)",
        "activeProducers": "Активные производители"
      },
      "latestBlocks": "Последние блоки",
      "updating": "обновление",
      "columns": {
        "block": "Блок",
        "age": "Возраст",
        "txs": "Тр.",
        "producer": "Производитель",
        "reward": "Награда",
        "hash": "Хеш"
      }
    },
    "comingSoon": {
      "badge": "в разработке · спринт 4",
      "backToExplorer": "← вернуться в обозреватель"
    },
    "docs_api": {
      "badge": "Публичный API",
      "title": "Запрашивайте сеть напрямую с узла",
      "baseUrl": "базовый URL",
      "tags": {
        "cors": "CORS включён",
        "units": "значения в e7",
        "noAuth": "без аутентификации"
      },
      "groups": {
        "read": "чтение",
        "write": "запись"
      },
      "endpoints": {
        "status": "состояние сети: высота, валидаторы, мемпул, награда за блок",
        "blocks": "последние N блоков",
        "blockByHeight": "блок по высоте или хешу",
        "txs": "последние транзакции с пагинацией",
        "tx": "транзакция по id",
        "address": "баланс, стейк, nonce, роль, токены и энергия",
        "tokens": "список токенов EAV20 (или /tokens/:id для деталей)",
        "validators": "активный набор DPoS + производитель слота",
        "sendTx": "отправляет подписанную нативную транзакцию (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "отправляет транзакцию через слой EAVM (совместим с JSON-RPC)"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "пользовательская сеть"
      },
      "title": "Используйте EAV7 в своём кошельке",
      "description": "EAV7 говорит на диалекте JSON-RPC, понятном универсальным кошелькам — добавьте сеть в один клик.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "любой EVM-кошелёк"
      },
      "params": {
        "networkName": "Имя сети",
        "rpcUrl": "URL RPC",
        "chainId": "Chain ID",
        "symbol": "Символ",
        "explorer": "Обозреватель",
        "decimals": "Десятичные знаки"
      },
      "button": {
        "adding": "Добавление…",
        "addToMetamask": "Добавить в MetaMask"
      },
      "status": {
        "added": "сеть добавлена!",
        "noWallet": "MetaMask не обнаружена — скопируйте данные рядом."
      },
      "error": {
        "addFailed": "не удалось добавить сеть"
      },
      "mapping": {
        "badge": "один и тот же аккаунт",
        "title": "Две идентичности, один аккаунт",
        "labelEavm": "EAVM",
        "labelNative": "нативный",
        "desc1": "MetaMask отображает",
        "desc2": "; в блокчейне баланс хранится в соответствующем",
        "desc3": "адресе. Это один и тот же аккаунт."
      },
      "steps": {
        "step1": "Нажмите, чтобы добавить сеть EAV7",
        "step2": "Ваш аккаунт отображается в кошельке как 0x…",
        "step3": "В блокчейне баланс хранится в соответствующем E7"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "время блока",
        "stat_validators_value": "до 27",
        "stat_validators_label": "валидаторы DPoS",
        "stat_supply_value": "100 млрд",
        "stat_supply_label": "предложение EAV7",
        "stat_reward_label": "EAV7 за блок",
        "stat_quantum_value": "гибридная",
        "stat_quantum_label": "постквантовая",
        "pillars_title": "основы протокола",
        "pillar_consensus": "Консенсус DPoS",
        "pillar_token_standard": "Стандарт EAV20",
        "pillar_bridge": "Кросс-чейн мост",
        "pillar_security": "Безопасность и ИИ",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "стандарт EAV20",
        "title": "Нативные токены без виртуальной машины",
        "description": "Аналог TRC20: токены живут прямо в состоянии цепи и перемещаются через подписанные транзакции — быстро, дёшево и проверяемо.",
        "cta": "Смотреть токены сети"
      },
      "consenso": {
        "badge": "консенсус DPoS",
        "title": "Новый блок каждую секунду",
        "description": "Валидаторы сменяют друг друга по очереди: в каждом слоте по 1с ожидаемый производитель подписывает следующий блок. Без грайндинга, без ожидания.",
        "slot_now": "слот сейчас",
        "slot_offset": "слот +{n}",
        "fact_election_label": "Выборы",
        "fact_election_value": "топ-27 по ставке (≥ 1000 EAV7)",
        "fact_production_label": "Производство",
        "fact_production_value": "validators[slot % N] · round-robin",
        "fact_fork_choice_label": "Выбор форка",
        "fact_fork_choice_value": "самая длинная валидная цепь",
        "cta": "Смотреть валидаторов в реальном времени"
      },
      "ponte": {
        "title": "Как мост перемещает ценность между сетями",
        "arrow_pays": "платит",
        "node_external": "Внешняя сеть",
        "step_bridge_out": "блокирует EAV7/токен и фиксирует внешний адрес назначения",
        "step_relayer": "отслеживает вывод и платит во внешней цепи",
        "step_bridge_settle": "помечает вывод как оплаченный on-chain (идемпотентно)",
        "step_bridge_in": "высвобождает средства извне, с дедупликацией по sourceTxHash"
      },
      "seguranca": {
        "badge_hybrid": "гибридная подпись",
        "title_hybrid": "Постквантовая по замыслу",
        "verify_both": "проверка требует обе",
        "hybrid_description": "Каждый кошелёк, транзакция и блок несут обе подписи — ECDSA (зрелость) и ML-DSA-44 (FIPS 204, устойчивая к квантовым атакам). Подделка потребовала бы взлома обеих примитивов одновременно.",
        "badge_ai": "слой ИИ",
        "title_ai": "Оракулы с эскроу on-chain",
        "sentinel_title": "Страж безопасности · 24ч",
        "sentinel_description": "Процесс непрерывно отслеживает сеть — реорганизации, крупные переводы, всплески транзакций и концентрацию производителей — записывая заключения в ленту безопасности.",
        "sentinel_cta": "Смотреть в разделе майнинга"
      },
      "staking": {
        "tier_fee_title": "Нулевая комиссия",
        "tier_fee_desc": "Заблокируйте 100+ EAV7, и ваши транзакции станут бесплатными — энергия (bandwidth) генерируется заморозкой и восстанавливается со временем.",
        "tier_mine_title": "Добывайте блоки",
        "tier_mine_desc": "Заблокируйте 1000+ EAV7 и участвуйте в выборах DPoS. Произведя блок, вы получаете 16 EAV7 плюс комиссии блока целиком.",
        "reward_title": "Награда и анстейк",
        "reward_desc": "Награда полностью достаётся производителю блока. Анстейк возвращает сумму на баланс — опустошать последнего валидатора сети запрещено.",
        "cta_lock": "Заблокировать EAV7",
        "cta_mining": "Смотреть майнинг"
      }
    },
    "energyGauge": {
      "ariaLabel": "Энергия {available} из {max}",
      "title": "Энергия",
      "description": "Ресурс, покрывающий стоимость транзакций. Восстанавливается со временем и растёт вместе с заблокированным в стейкинге EAV7."
    },
    "home_activityBars": {
      "ariaLabel": "Транзакции по блокам",
      "txsCount": "{n} тр."
    },
    "home_appShowcase": {
      "nav": {
        "overview": "Обзор",
        "blocks": "Блоки",
        "transactions": "Транзакции",
        "validators": "Валидаторы",
        "tokens": "Токены"
      },
      "cols": {
        "block": "Блок",
        "age": "Возраст",
        "txs": "Тр-ции",
        "producer": "Производитель",
        "reward": "Награда",
        "hash": "Хеш"
      },
      "sidebar": {
        "explore": "Обзор",
        "network": "Сеть"
      },
      "toolbar": {
        "filter": "Фильтр",
        "sort": "Сортировка",
        "live": "в реальном времени"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "исследовать",
      "title": "Всё on-chain, в реальном времени",
      "description": "Блоки и транзакции проходят прямо сейчас. Нажмите на любой элемент, чтобы изучить его.",
      "viewBlocks": "Смотреть блоки",
      "viewTxs": "Смотреть транзакции"
    },
    "home_heartbeat": {
      "label": "пульс",
      "blockAgoPrefix": "блок",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} тр.",
      "viewAll": "смотреть все"
    },
    "home_hero": {
      "coin_alt": "Монета EAV7",
      "title": "Новая эра ончейн-обозревателя",
      "subtitle": "Блоки каждую 1 секунду, постквантовая безопасность и встроенный слой ИИ. Исследуйте блоки, транзакции, валидаторов и адреса в реальном времени.",
      "search_placeholder": "Поиск блока, транзакции или адреса…",
      "search_button": "Исследовать",
      "stat_height": "Высота",
      "stat_block": "Блок",
      "stat_validators": "Валидаторы",
      "stat_mempool": "Мемпул"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "Монета EAV7",
        "titleBefore": "Блокчейн EAV7, и",
        "titleHighlight": "не только",
        "subtitle": "Консенсус DPoS с блоком в 1 секунду, постквантовая безопасность и встроенный слой ИИ. Изучайте блоки, транзакции и валидаторов в реальном времени.",
        "exploreNetwork": "Исследовать сеть",
        "openWallet": "Открыть кошелёк",
        "scrollAriaLabel": "Прокрутить к панели"
      },
      "vitals": {
        "height": "Высота",
        "blockTime": "Блок",
        "validators": "Валидаторы"
      }
    },
    "home_inkBand": {
      "eyebrow": "интерактивно",
      "title": "Наведите курсор, чтобы открыть",
      "subtitle": "сеть EAV7, за пределами блока",
      "mobileHint": "на мобильном изображение отображается сразу"
    },
    "home_latestTxs": {
      "title": "Последние транзакции",
      "viewAll": "смотреть все",
      "table": {
        "hash": "Хеш",
        "type": "Тип",
        "fromTo": "От → Кому",
        "value": "Сумма"
      },
      "empty": "транзакций пока нет"
    },
    "home_moments": {
      "sectionEyebrow": "внутри протокола",
      "sectionTitle": "L1, созданный, чтобы служить долго",
      "items": {
        "security": {
          "eyebrow": "безопасность",
          "titlePrefix": "Готовы к",
          "titleHighlight": "постквантовой эпохе",
          "desc": "Каждый кошелёк, транзакция и блок несёт две подписи — и проверка требует обеих. Подделка потребовала бы взлома обоих примитивов одновременно.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "Адрес E7, полученный через SHA3-256"
        },
        "consensus": {
          "eyebrow": "консенсус",
          "titlePrefix": "Блок каждую",
          "titleHighlight": "1 секунду",
          "desc": "Консенсус DPoS с до 27 валидаторами, избранными по ставке, в детерминированной ротации — в 3 раза быстрее Tron, с защищённой ливнесс.",
          "bullet1": "27 валидаторов · round-robin по слоту",
          "bullet2": "16 EAV7 вознаграждения за блок"
        },
        "intelligence": {
          "eyebrow": "интеллект",
          "titlePrefix": "Нативный",
          "titleHighlight": "слой ИИ",
          "desc": "Ончейн-оракулы с эскроу: задачи ИИ публикуются, решаются назначенным оракулом и проверяемо расчитываются — всё внутри протокола.",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "Хэш результата записан ончейн"
        },
        "assets": {
          "eyebrow": "активы",
          "titlePrefix": "Токены",
          "titleHighlight": "EAV20",
          "titleSuffix": "и кросс-чейн мост",
          "desc": "Создавайте и перемещайте нативные токены (эквивалент TRC20) и подключайте EAV7 к другим сетям через безопасную идемпотентную модель lock-and-release.",
          "bullet1": "Стандарт EAV20 · create / transfer / approve",
          "bullet2": "Мост TRON · ETH · BTC (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "реальное время",
      "title": "Пульс сети",
      "subtitle": "Новый блок каждую секунду. Следите за биением сети EAV7 в реальном времени.",
      "stats": {
        "blockHeight": "Высота блока",
        "txLast30": "Тр-ции · последние 30 блоков",
        "mempool": "Мемпул",
        "rewardPerBlock": "EAV7 / блок"
      },
      "activity": {
        "title": "Активность сети",
        "txInLastBlocks": "транзакций за последние {n} блоков"
      },
      "slots": {
        "title": "Слоты DPoS",
        "activeValidators": "активных валидаторов",
        "supply": "предложение {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "Всего аккаунтов"
        },
        "transactions": {
          "label": "Всего транзакций"
        },
        "volume": {
          "label": "Объём переводов"
        },
        "staked": {
          "label": "Всего в стейкинге"
        }
      },
      "ring": {
        "supplyLine1": "от предложения",
        "supplyLine2": "заблокировано в стейкинге"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} из {max}"
    },
    "home_walletCta": {
      "eyebrow": "начните прямо сейчас",
      "title": "Исследуйте сеть EAV7 прямо сейчас",
      "description": "Ваш кошелёк создаётся и подписывается в браузере с постквантовой защитой — он никогда не покидает ваше устройство. Отправляйте, стейкайте и майните прямо через веб.",
      "createWallet": "Создать кошелёк",
      "exploreNetwork": "Исследовать сеть"
    },
    "mining_live": {
      "badge_consensus": "DPoS · стейкинг",
      "title": "Майнинг",
      "live_badge": "в реальном времени",
      "subtitle": "в EAV7 вы майните, блокируя EAV7 (стейк) — без оборудования, без затрат энергии",
      "stat_reward_block": "Награда / блок",
      "stat_blocks_day": "Блоков / день",
      "stat_daily_emission": "Дневная эмиссия",
      "stat_already_mined": "Уже добыто",
      "network_production": "производство сети",
      "reward_per_block_caption": "награда за каждый блок (1с)",
      "annual_emission_caption": "расчётная годовая эмиссия",
      "next_block": "следующий блок",
      "miners_label": "майнеры",
      "staked_label": "EAV7 заблокировано",
      "block_time_label": "время блока",
      "ai_sentinel_badge": "ИИ-страж · 24ч",
      "network_protected": "Сеть защищена",
      "ai_monitoring_desc": "непрерывный мониторинг встроенным ИИ",
      "alerts_analyzed": "проанализировано оповещений",
      "active_oracles": "активные оракулы",
      "pending_ai_tasks": "ожидающие задачи ИИ",
      "cta_title": "Начните майнить EAV7",
      "cta_description": "Заблокируйте EAV7 в своём кошельке, чтобы стать майнером консенсуса DPoS и получать награды за каждый произведённый блок. Всё self-custodial, с постквантовой подписью в браузере.",
      "cta_lock_button": "Заблокировать EAV7",
      "cta_view_validators": "Смотреть валидаторов"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "Поиск",
      "dica": "блок (номер) · транзакция (E7…) · адрес (E7… или 0x…)"
    },
    "netStatus": {
      "onlineTitle": "Сеть EAV7 онлайн · высота {height}",
      "offlineTitle": "Узел офлайн",
      "connecting": "подключение…"
    },
    "page_address": {
      "metaTitle": "Адрес {addr}… · EAV7 Scan",
      "eyebrow": "адрес",
      "title": "Адрес",
      "roleValidator": "Валидатор",
      "roleOracle": "Оракул",
      "roleAccount": "Счёт",
      "balance": "Баланс",
      "staked": "в стейкинге",
      "nonce": "nonce",
      "feeExempt": "нулевая комиссия",
      "available": "Доступно",
      "max": "макс {n}",
      "tokensTitle": "Токены EAV20",
      "colToken": "Токен",
      "colSymbol": "Символ",
      "colBalance": "Баланс",
      "txsTitle": "Транзакции",
      "colHash": "Хэш",
      "colBlock": "Блок",
      "colType": "Тип",
      "colCounterparty": "Контрагент",
      "colValue": "Сумма",
      "colDate": "Дата",
      "out": "исходящая",
      "in": "входящая",
      "noTxs": "нет транзакций для этого адреса",
      "totalBalance": "общий баланс: {n}",
      "tabOverview": "Обзор",
      "tabTransfers": "Переводы",
      "tabInternal": "Внутренние переводы",
      "tabStaking": "Стейкинг и ресурсы",
      "tabContract": "Контракт",
      "tabPermissions": "Разрешения",
      "tabAnalysis": "Анализ",
      "internalNote": "Средства, перемещённые исполнением контракта. Это не подписанная транзакция, поэтому у неё нет собственного хеша.",
      "internalEmpty": "внутренних переводов нет",
      "colFrom": "От",
      "colTo": "Кому",
      "colTx": "Транзакция",
      "stakingTitle": "Стейк и ресурсы",
      "bandwidth": "Пропускная способность",
      "energy": "Энергия",
      "delegatedOut": "Делегировано другим",
      "delegatedIn": "Получено в делегирование",
      "unbondingTitle": "В разблокировке",
      "matureIn": "разблокируется через {n} блоков",
      "votesCastTitle": "Отданные голоса",
      "votesReceived": "Полученные голоса",
      "vestingTitle": "Вестинг",
      "permsNone": "аккаунт с одним ключом — без мультиподписи",
      "permsThreshold": "Порог",
      "colWeight": "Вес",
      "colKey": "Ключ",
      "contractNone": "этот адрес не является контрактом",
      "contractCodeSize": "Размер кода",
      "contractVerified": "Проверен",
      "contractUnverified": "Не проверен",
      "sent": "Отправлено",
      "received": "Получено",
      "feesPaid": "Уплачено комиссий",
      "txCount": "Транзакции",
      "firstSeen": "Первая активность",
      "lastSeen": "Последняя активность",
      "byType": "По типу",
      "topCounterparties": "Основные контрагенты",
      "truncatedNote": "выборка ограничена последними транзакциями",
      "noData": "нет данных",
      "nftsTitle": "NFT (EAV721)",
      "colNftCollection": "Коллекция",
      "colNftId": "Токен",
      "namesTitle": "Имена EAV-NS",
      "colNsName": "Имя",
      "colNsTarget": "Указывает на",
      "votesLabel": "Полученные голоса",
      "commissionLabel": "Комиссия",
      "accountInfo": "Информация об аккаунте",
      "accountType": "Тип аккаунта",
      "createdAt": "Создан",
      "totalTxs": "Всего транзакций",
      "tabTokenTx": "Переводы токенов",
      "tokenTxEmpty": "переводов токенов нет",
      "roleContract": "Контракт",
      "roleMultisig": "Мультиподпись",
      "holdings": "Активы",
      "colAsset": "Актив",
      "assets": "Активы",
      "transfersRow": "Переводы",
      "votesRow": "Голоса",
      "claimable": "Доступные награды",
      "tabApprovals": "Разрешения",
      "searchHoldings": "Поиск по имени, символу или адресу…",
      "noHoldings": "здесь пусто",
      "colSpender": "Получатель прав",
      "colLimit": "Лимит",
      "more": "Показать ещё",
      "tabTokens": "Токены",
      "tabTransactions": "Транзакции",
      "colAge": "Возраст",
      "colResult": "Результат",
      "resultOk": "Успех",
      "resultRevert": "Откат",
      "summaryTx": "Всего {n} транзакций",
      "summaryTransfers": "Всего {n} переводов",
      "summaryInternal": "Всего {n} внутренних переводов",
      "filterAll": "Все",
      "filterIn": "Входящие",
      "filterOut": "Исходящие",
      "summaryTokenTx": "Всего {n} переводов токенов",
      "colParentHash": "Родительский хеш",
      "colResourceAmount": "Объём ресурса",
      "colStakedAmount": "EAV7 в стейке",
      "colUpdatedAt": "Обновлено",
      "stakeNote": "В EAV7 один стейк даёт и энергию, и пропускную способность одновременно — в отличие от TRON, ресурс не выбирается.",
      "permsOperations": "Операции",
      "thisAccount": "этот аккаунт",
      "summaryContracts": "Всего {n} контрактов",
      "permsNote": "В EAV7 набор операций действует для любого мультиподписного аккаунта — нет разграничения по разрешениям, как в TRON.",
      "permsDefault": "по умолчанию",
      "permsDefaultNote": "Мультиподпись не настроена. Это фактическая авторизация аккаунта: один ключ, одна подпись."
    },
    "page_block": {
      "metaTitle": "Блок #{height} · EAV7 Scan",
      "eyebrow": "блок",
      "title": "Блок #{height}",
      "sub": "{ago} назад",
      "kv": {
        "height": "Высота",
        "date": "Дата",
        "producer": "Производитель",
        "previousHash": "Предыдущий хеш",
        "merkleRoot": "Merkle-корень (тр.)",
        "txCount": "Транзакции",
        "protocol": "Протокол",
        "scheme": "схема"
      },
      "txSectionTitle": "Транзакции блока",
      "table": {
        "hash": "Хеш",
        "type": "Тип",
        "from": "От",
        "to": "Кому",
        "value": "Сумма",
        "fee": "Комиссия"
      },
      "emptyBlock": "пустой блок"
    },
    "page_docs": {
      "metaTitleFallback": "Документация · EAV7 Scan",
      "breadcrumb": "документация",
      "terminal": "терминал",
      "onThisPage": "на этой странице"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "Майнинг · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "Эта страница не существует в цепочке EAV7.",
      "backLink": "← вернуться на главную"
    },
    "page_search": {
      "metaTitle": "Поиск · EAV7 Scan",
      "title": "Ничего не найдено",
      "notRecognizedPrefix": "Мы не распознали",
      "notRecognizedSuffix": "как блок, транзакцию или адрес EAV7.",
      "retryPlaceholder": "Попробуйте снова…",
      "whatCanSearch": "что можно искать",
      "blockLabel": "блок",
      "blockDesc": "номер высоты, напр.",
      "txLabel": "транзакция",
      "txDesc": "хеш",
      "txChars": "(64 символа)",
      "addressLabel": "адрес",
      "addressLen34": "(34) или",
      "or": "или",
      "evmLabel": "(EAVM)",
      "backHome": "← вернуться на главную"
    },
    "page_token": {
      "eyebrow": "Токен EAV20",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "Токен · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "Стандарт",
      "mintable": "открытая эмиссия",
      "fixedSupply": "фиксированная эмиссия",
      "paused": "приостановлен",
      "tabTransfers": "Переводы",
      "tabHolders": "Держатели",
      "tabAnalysis": "Анализ",
      "totalSupply": "Общая эмиссия",
      "holders": "Держатели",
      "decimals": "Знаков после запятой",
      "status": "Статус",
      "statusActive": "Активен",
      "statusPaused": "Приостановлен",
      "createdAt": "Создан",
      "contract": "Контракт",
      "creator": "Создатель",
      "owner": "Администратор",
      "mintableLabel": "Может выпускать ещё",
      "yes": "да",
      "no": "нет",
      "summaryTransfers": "Всего {n} переводов",
      "summaryHolders": "Всего {n} держателей — показаны крупнейшие {shown}",
      "colHash": "Хеш",
      "colBlock": "Блок",
      "colAge": "Возраст",
      "colFrom": "От",
      "colTo": "Кому",
      "colAmount": "Сумма ({symbol})",
      "colRank": "#",
      "colAddress": "Адрес",
      "colBalance": "Баланс ({symbol})",
      "colShare": "Доля",
      "blacklisted": "заблокирован",
      "noTransfers": "Переводы не найдены.",
      "noHolders": "Держатели не найдены.",
      "top1": "Крупнейший держатель",
      "top10": "Топ-10",
      "top50": "Топ-50",
      "concentrationTitle": "Концентрация эмиссии",
      "concentrationNote": "Какая часть эмиссии находится в крупнейших кошельках. Большая эмиссия в немногих руках несёт иной рыночный риск, чем широко распределённая — поэтому распределение важнее общей цифры.",
      "largestHolder": "Крупнейший держатель:",
      "overviewTitle": "Обзор",
      "basicInfoTitle": "Данные контракта",
      "activityTitle": "Распределение",
      "largestHolderShort": "Крупнейший держатель",
      "tabContract": "Контракт",
      "nativeTitle": "Нативный токен протокола",
      "nativeBadge": "без произвольного кода",
      "nativeNote": "Этот токен не является смарт-контрактом: он реализован самим протоколом. Нет ни Solidity, ни компилятора, ни байт-кода для проверки — равно как и скрытой логики, которую кто-то мог бы написать. Поведение одинаково для любого токена EAV20 и меняется только через хардфорк сети.",
      "implementation": "Реализация",
      "implementationValue": "Нативная для консенсуса (стандарт EAV20)",
      "sourceOfTruth": "Исходный код протокола",
      "powersTitle": "Что может администратор",
      "powersNote": "В EVM-обозревателе вы читали бы исходный код, чтобы это выяснить. Здесь это поля состояния, поэтому мы перечисляем их напрямую. Именно это важно перед тем, как доверять токену.",
      "powerMint": "Выпускать новые единицы",
      "powerMintNote": "Увеличивает общую эмиссию и размывает текущих держателей.",
      "powerPause": "Приостановить переводы",
      "powerPauseNote": "Замораживает всё движение токена разом.",
      "powerBlacklist": "Блокировать адреса",
      "powerBlacklistNote": "Запрещает конкретному адресу отправлять и получать.",
      "powerFreeze": "Заморозить баланс",
      "powerFreezeNote": "Блокирует часть баланса адреса до определённой даты.",
      "powerYes": "может",
      "powerNo": "не может",
      "powerActiveNow": "действует сейчас",
      "adminIs": "Администратор:",
      "restrictionsTitle": "Действующие ограничения",
      "frozenUntil": "до {when}"
    },
    "page_tx": {
      "metaTitle": "Транзакция {id}… · EAV7 Scan",
      "eyebrow": "транзакция",
      "title": "Транзакция",
      "status": "Статус",
      "type": "Тип",
      "block": "Блок",
      "from": "От",
      "to": "Кому",
      "value": "Сумма",
      "fee": "Комиссия",
      "nonce": "Nonce",
      "date": "Дата",
      "scheme": "Схема",
      "eavmLayer": "Слой EAVM (MetaMask)",
      "energy": "Энергия",
      "energyUnit": "энергии"
    },
    "page_txs": {
      "metaTitle": "Транзакции · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "стандарт EAV20",
        "title": "Токены",
        "subtitle": "нативные активы протокола eav20 — аналог TRC20 в сети Tron"
      },
      "empty": {
        "title": "Токены пока не созданы",
        "description": "Токены появятся здесь сразу после создания в сети через"
      },
      "stats": {
        "tokens": "Токены EAV20",
        "holders": "Холдеры (всего)",
        "supply": "Совокупное предложение",
        "standard": "Стандарт"
      },
      "card": {
        "supply": "Предложение",
        "holders": "Холдеры",
        "share": "доля",
        "creator": "создатель"
      }
    },
    "txs_live": {
      "chainLabel": "цепочка eav20",
      "title": "Транзакции",
      "live": "в реальном времени",
      "subtitleLive": "сначала новые · значения в EAV7",
      "subtitleOlder": "более старые транзакции · значения в EAV7",
      "searchPlaceholder": "Поиск tx, блока или адреса…",
      "cols": {
        "hash": "Хеш",
        "block": "Блок",
        "type": "Тип",
        "from": "От",
        "to": "Кому",
        "value": "Сумма",
        "age": "Возраст"
      },
      "stats": {
        "totalTx": "Всего транзакций",
        "mempool": "В мемпуле",
        "volume": "Объём (EAV7)",
        "avgFee": "Средняя комиссия"
      },
      "table": {
        "latest": "Последние транзакции",
        "older": "Предыдущие транзакции",
        "updating": "обновление",
        "empty": "транзакции не найдены",
        "count": "{n} транзакций",
        "loadMore": "Загрузить более старые →",
        "genesis": "начало цепочки"
      }
    },
    "ui_copy": {
      "default_value": "значение",
      "aria_label": "Копировать {label}",
      "copied": "скопировано ✓",
      "copy_label": "копировать {label}",
      "copy": "копировать"
    },
    "ui_explorerSearch": {
      "placeholder": "Поиск блока, транзакции или адреса…",
      "searchButton": "Поиск"
    },
    "validators_live": {
      "unavailable": "узел недоступен",
      "header": {
        "eyebrow": "консенсус DPoS",
        "title": "Валидаторы",
        "live": "в реальном времени",
        "subtitle": "{active} активных из {max} слотов · минимальный стейк {min} EAV7 · ротация каждый блок"
      },
      "producer": {
        "label": "производитель текущего слота",
        "producingBlock": "производит блок"
      },
      "slot": {
        "label": "слот · {n}с",
        "staked": "{n} EAV7 в стейке"
      },
      "rotation": {
        "label": "ротация производства"
      },
      "stats": {
        "activeValidators": "Активные валидаторы",
        "rewardPerBlock": "Награда / блок",
        "totalStaked": "Всего в стейке",
        "peers": "Пиры сети"
      },
      "ranking": {
        "title": "Активный набор",
        "sortedBy": "отсортировано по стейку",
        "producing": "производит",
        "active": "активен",
        "stakedCaption": "EAV7 в стейке"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "защищено"
      },
      "role": {
        "validator": "Валидатор",
        "oracle": "Оракул",
        "account": "Счёт EAV7"
      },
      "lock": {
        "button": "заблокировать"
      },
      "balance": {
        "label": "доступный баланс"
      },
      "tier": {
        "validator": "Валидатор",
        "fee_zero": "Нулевая комиссия",
        "standard": "Стандарт"
      },
      "actions": {
        "send": "Отправить",
        "receive": "Получить",
        "stake": "Стейк"
      },
      "stats": {
        "staked": "В стейке",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "Комиссия",
        "fee_zero": "ноль",
        "fee_standard": "стандарт"
      },
      "tier_progress": {
        "label": "прогресс уровня",
        "remaining_prefix": "осталось",
        "remaining_suffix": "до уровня «{tier}»"
      },
      "receive": {
        "title": "Получить EAV7",
        "description_before": "Поделитесь своим адресом",
        "description_after": "— сеть автоматически сопоставит его с вашим нативным E7.",
        "close": "закрыть"
      },
      "activity": {
        "title": "Недавняя активность",
        "sent": "Отправлено",
        "received": "Получено"
      },
      "addresses": {
        "hint": "используйте этот 0x для получения (стандарт EAVM/MetaMask)"
      },
      "tokens": {
        "title": "Токены EAV20"
      },
      "footer": {
        "quantum": "постквантовая · secp256k1 + ML-DSA-44",
        "logout": "выйти / сменить"
      },
      "wipe": {
        "title": "Удалить этот кошелёк?",
        "description_before": "Зашифрованный кошелёк будет удалён",
        "description_bold": "из этого браузера",
        "description_after": ". Восстановить его можно только с помощью резервной копии приватного ключа — восстановление пароля невозможно.",
        "warning_before": "Убедитесь, что у вас есть",
        "warning_bold": "резервная копия ключа",
        "warning_after": "перед удалением.",
        "download_backup": "Скачать резервную копию (.json)",
        "cancel": "Отмена",
        "confirm": "Удалить кошелёк"
      }
    },
    "wallet_addNet": {
      "title": "Использовать в MetaMask / Trust",
      "description": "Добавьте сеть EAV7 (chain 72020) в свой EVM-кошелёк.",
      "adding": "добавление…",
      "added": "✓ добавлено",
      "addButton": "Добавить сеть",
      "noWallet": "MetaMask не обнаружен в этом браузере.",
      "error": "не удалось добавить сеть."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "контроль только у вас",
        "on_device_title": "на устройстве",
        "on_device_desc": "ключ никогда не покидает его",
        "quantum_title": "постквантовая защита",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "Резервная копия",
        "password": "Пароль",
        "ready": "Готово"
      },
      "unlock": {
        "title": "С возвращением",
        "subtitle": "В этом браузере есть зашифрованный кошелёк. Введите пароль, чтобы разблокировать его.",
        "password_placeholder": "пароль",
        "error_wrong_password": "неверный пароль",
        "unlocking": "разблокировка…",
        "unlock_button": "Разблокировать кошелёк",
        "wipe_confirm": "Удалить кошелёк из этого браузера? Убедитесь, что у вас есть резервная копия ключа!",
        "wipe_button": "удалить и начать заново"
      },
      "choose": {
        "title": "Ваш кошелёк EAV7",
        "subtitle": "Self-custodial кошелёк: только вы владеете своими ключами. Начните за секунды.",
        "create_title": "Создать новый кошелёк",
        "create_desc": "Генерирует новый ключ на этом устройстве.",
        "import_title": "Импортировать ключ",
        "import_desc": "Уже есть приватный ключ? Восстановите его здесь."
      },
      "import": {
        "title": "Импорт кошелька",
        "subtitle": "Вставьте приватный ключ и выберите пароль, чтобы зашифровать его в этом браузере.",
        "label": "Приватный ключ (0x + 64 hex)",
        "importing": "импорт…",
        "button": "Импортировать",
        "back": "Назад",
        "error_invalid_key": "неверный приватный ключ (ожидается 0x + 64 hex)"
      },
      "create": {
        "title": "Сделайте резервную копию ключа",
        "subtitle": "Восстановление пароля невозможно. Тот, кто владеет приватным ключом, контролирует средства — сохраните его перед продолжением.",
        "warning_prefix": "Этот ключ ",
        "warning_bold": "является единственным способом",
        "warning_suffix": " доступа к вашим средствам. Сохраните его в офлайне — никогда никому не передавайте.",
        "address_label": "адрес E7",
        "private_key_label": "приватный ключ",
        "reveal": "показать",
        "hide": "скрыть",
        "download_backup": "⭳ Скачать резервную копию (.json)",
        "confirm_saved": "Я сохранил свой ключ в надёжном месте",
        "creating": "создание…",
        "create_button": "Создать кошелёк",
        "confirm_hint": "подтвердите, что сохранили ключ",
        "back": "Назад"
      },
      "errors": {
        "password_min": "пароль должен содержать минимум 6 символов",
        "password_mismatch": "пароли не совпадают",
        "save_error": "ошибка при сохранении"
      },
      "password": {
        "label": "Пароль для шифрования (мин. 6 символов)",
        "placeholder": "пароль",
        "confirm_placeholder": "подтвердите пароль",
        "mismatch": "пароли не совпадают",
        "strength": {
          "very_weak": "очень слабый",
          "weak": "слабый",
          "fair": "средний",
          "good": "хороший",
          "strong": "надёжный"
        }
      }
    },
    "wallet_send": {
      "title": "Отправить EAV7",
      "steps": {
        "destination": "Получатель",
        "value": "Сумма",
        "review": "Проверка"
      },
      "recipient": {
        "label": "Получатель (0x… EAVM/MetaMask)",
        "paste": "вставить",
        "valid": "✓ адрес действителен",
        "invalid": "недействительный адрес 0x"
      },
      "errors": {
        "needEvmAddress": "укажите 0x-адрес получателя (веб-кошелёк подписывает по модели EAVM)",
        "invalidAddress": "получатель должен быть адресом 0x (EAVM/MetaMask)",
        "needPositiveAmount": "укажите положительную сумму",
        "insufficientBalance": "недостаточно средств (учтите комиссию)",
        "invalidAmount": "неверная сумма",
        "sendFailed": "не удалось отправить"
      },
      "continue": "Продолжить",
      "cancel": "Отмена",
      "available": "доступно: {amount} EAV7",
      "percent": {
        "max": "МАКС"
      },
      "back": "Назад",
      "sendingLabel": "отправка",
      "sendingTo": "получателю {addr}",
      "networkFee": "Комиссия сети",
      "balanceAfter": "Баланс после",
      "quantumNote": "подписано на этом устройстве · постквантовая защита сети",
      "confirmAndSign": "Подтвердить и подписать",
      "signing": "подписание…",
      "transactionSent": {
        "title": "Транзакция отправлена",
        "subtitle": "Подтвердится в следующем блоке (~1с)."
      },
      "close": "закрыть"
    },
    "wallet_stake": {
      "title": "Стейкинг",
      "subtitle": "≥ 100 EAV7 отменяет комиссии · ≥ 1000 делает вас майнером (16 EAV7/произведённый блок).",
      "tierZeroFee": {
        "label": "Без комиссии",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "Валидатор",
        "sub": "≥ 1000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "в стейкинге сейчас:",
      "warnValidator": "Это снизит ваш стейк ниже 1000 — вы потеряете статус валидатора.",
      "warnFeeReset": "Это снизит ваш стейк ниже 100 — ваши транзакции снова будут облагаться комиссией.",
      "warnConfirm": "понятно, всё равно убрать →",
      "errInvalidAmount": "введите положительное значение",
      "errInvalidValue": "неверное значение",
      "errFailedOp": "операция не удалась",
      "sentTitle": "Операция отправлена",
      "close": "закрыть",
      "stakeBtn": "Застейкать",
      "removeBtn": "Убрать"
    }
  },
  "ar": {
    "blocks_live": {
      "networkLabel": "سلسلة eav20",
      "title": "الكتل",
      "live": "مباشر",
      "blockTimeInfo": "كتلة جديدة كل {n} ثانية · إجماع DPoS",
      "searchPlaceholder": "ابحث عن كتلة حسب الارتفاع أو التجزئة…",
      "stats": {
        "height": "الارتفاع الحالي",
        "blockTime": "زمن الكتلة",
        "avgTx": "المعاملات / كتلة (متوسط)",
        "activeProducers": "المنتجون النشطون"
      },
      "latestBlocks": "أحدث الكتل",
      "updating": "جارٍ التحديث",
      "columns": {
        "block": "الكتلة",
        "age": "العمر",
        "txs": "المعاملات",
        "producer": "المنتج",
        "reward": "المكافأة",
        "hash": "التجزئة"
      }
    },
    "comingSoon": {
      "badge": "قيد الإنشاء · السبرنت 4",
      "backToExplorer": "← العودة إلى المتصفح"
    },
    "docs_api": {
      "badge": "واجهة برمجة عامة",
      "title": "استعلم عن الشبكة مباشرة من العقدة",
      "baseUrl": "الرابط الأساسي",
      "tags": {
        "cors": "CORS مفعّل",
        "units": "القيم بوحدة e7",
        "noAuth": "بدون مصادقة"
      },
      "groups": {
        "read": "قراءة",
        "write": "كتابة"
      },
      "endpoints": {
        "status": "حالة الشبكة: الارتفاع، المدققون، تجمع المعاملات، مكافأة الكتلة",
        "blocks": "آخر N كتلة",
        "blockByHeight": "كتلة واحدة حسب الارتفاع أو التجزئة",
        "txs": "المعاملات الأخيرة، مقسّمة على صفحات",
        "tx": "معاملة واحدة حسب المعرف",
        "address": "الرصيد، الحصة، nonce، الدور، الرموز والطاقة",
        "tokens": "قائمة رموز EAV20 (أو /tokens/:id للتفاصيل)",
        "validators": "مجموعة DPoS النشطة + منتج الفتحة",
        "sendTx": "يرسل معاملة أصلية موقّعة (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "يرسل معاملة عبر طبقة EAVM (متوافقة مع JSON-RPC)"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "شبكة مخصصة"
      },
      "title": "استخدم EAV7 في محفظتك",
      "description": "تتحدث EAV7 لهجة JSON-RPC التي تفهمها المحافظ الشاملة — أضف الشبكة بنقرة واحدة.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "أي محفظة EVM"
      },
      "params": {
        "networkName": "اسم الشبكة",
        "rpcUrl": "رابط RPC",
        "chainId": "معرّف السلسلة",
        "symbol": "الرمز",
        "explorer": "المستكشف",
        "decimals": "الخانات العشرية"
      },
      "button": {
        "adding": "جارٍ الإضافة…",
        "addToMetamask": "إضافة إلى MetaMask"
      },
      "status": {
        "added": "تمت إضافة الشبكة!",
        "noWallet": "لم يتم اكتشاف MetaMask — انسخ البيانات المجاورة."
      },
      "error": {
        "addFailed": "تعذّرت إضافة الشبكة"
      },
      "mapping": {
        "badge": "نفس الحساب",
        "title": "هويتان، حساب واحد",
        "labelEavm": "EAVM",
        "labelNative": "أصلي",
        "desc1": "تعرض MetaMask العنوان",
        "desc2": "؛ وعلى السلسلة يعيش الرصيد في العنوان المقابل",
        "desc3": "إنه نفس الحساب."
      },
      "steps": {
        "step1": "انقر لإضافة شبكة EAV7",
        "step2": "يظهر حسابك بصيغة 0x… في المحفظة",
        "step3": "على السلسلة يعيش الرصيد في العنوان E7 المقابل"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "زمن الكتلة",
        "stat_validators_value": "حتى 27",
        "stat_validators_label": "مدققو DPoS",
        "stat_supply_value": "100 مليار",
        "stat_supply_label": "المعروض من EAV7",
        "stat_reward_label": "EAV7 لكل كتلة",
        "stat_quantum_value": "هجينة",
        "stat_quantum_label": "ما بعد الكم",
        "pillars_title": "ركائز البروتوكول",
        "pillar_consensus": "إجماع DPoS",
        "pillar_token_standard": "معيار EAV20",
        "pillar_bridge": "الجسر عبر السلاسل",
        "pillar_security": "الأمان والذكاء الاصطناعي",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "معيار EAV20",
        "title": "رموز أصلية بلا آلة افتراضية",
        "description": "مكافئ لـ TRC20: تعيش الرموز مباشرة في حالة السلسلة وتنتقل عبر معاملات موقّعة — سريعة ورخيصة وقابلة للتحقق.",
        "cta": "عرض رموز الشبكة"
      },
      "consenso": {
        "badge": "إجماع DPoS",
        "title": "كتلة جديدة كل ثانية",
        "description": "يتناوب المدققون بالتناوب: في كل فترة مدتها ثانية واحدة، يوقّع منتج متوقع الكتلة التالية. بلا استنزاف حسابي وبلا انتظار.",
        "slot_now": "الفترة الحالية",
        "slot_offset": "الفترة +{n}",
        "fact_election_label": "الانتخاب",
        "fact_election_value": "أكبر 27 حسب الحصة (≥ 1000 EAV7)",
        "fact_production_label": "الإنتاج",
        "fact_production_value": "validators[slot % N] · بالتناوب",
        "fact_fork_choice_label": "اختيار الفرع",
        "fact_fork_choice_value": "أطول سلسلة صالحة",
        "cta": "عرض المدققين مباشرة"
      },
      "ponte": {
        "title": "كيف ينقل الجسر القيمة بين الشبكات",
        "arrow_pays": "يدفع",
        "node_external": "شبكة خارجية",
        "step_bridge_out": "يقفل EAV7/الرمز ويسجل الوجهة الخارجية",
        "step_relayer": "يراقب الخروج ويدفع على السلسلة الخارجية",
        "step_bridge_settle": "يضع علامة على الخروج كمدفوع على السلسلة (متكرر بأمان)",
        "step_bridge_in": "يحرر الأموال القادمة من الخارج، مع إزالة التكرار حسب sourceTxHash"
      },
      "seguranca": {
        "badge_hybrid": "توقيع هجين",
        "title_hybrid": "مقاوم للكم بالتصميم",
        "verify_both": "يتطلب التحقق كليهما",
        "hybrid_description": "تحمل كل محفظة ومعاملة وكتلة التوقيعين معًا — ECDSA (النضج) و ML-DSA-44 (FIPS 204، مقاوم للكم). سيتطلب التزوير كسر كلا الأساسين في آن واحد.",
        "badge_ai": "طبقة الذكاء الاصطناعي",
        "title_ai": "أوراكل مع ضمان على السلسلة",
        "sentinel_title": "حارس الأمان · 24 ساعة",
        "sentinel_description": "تراقب عملية الشبكة باستمرار — إعادة التنظيم، والتحويلات الضخمة، وطفرات المعاملات، وتركّز المنتجين — وتسجل النتائج في موجز الأمان.",
        "sentinel_cta": "عرض في التعدين"
      },
      "staking": {
        "tier_fee_title": "رسوم صفرية",
        "tier_fee_desc": "اقفل 100+ EAV7 وستصبح معاملاتك بلا رسوم — تُولَّد الطاقة (bandwidth) بالتجميد وتتجدد مع الوقت.",
        "tier_mine_title": "عدّن الكتل",
        "tier_mine_desc": "اقفل 1000+ EAV7 وادخل انتخاب DPoS. عند إنتاج كتلة تحصل على 16 EAV7 بالإضافة إلى رسوم الكتلة كاملة.",
        "reward_title": "المكافأة وإلغاء التقييد",
        "reward_desc": "تذهب المكافأة بالكامل إلى منتج الكتلة. يحرر إلغاء التقييد القيمة إلى رصيدك — لا يُسمح بتفريغ آخر مدقق في الشبكة.",
        "cta_lock": "اقفل EAV7",
        "cta_mining": "عرض التعدين"
      }
    },
    "energyGauge": {
      "ariaLabel": "الطاقة {available} من {max}",
      "title": "الطاقة",
      "description": "مورد يغطي تكلفة المعاملات. يتجدد بمرور الوقت وينمو مع EAV7 المقفل في التخزين."
    },
    "home_activityBars": {
      "ariaLabel": "المعاملات لكل كتلة",
      "txsCount": "{n} معاملة"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "نظرة عامة",
        "blocks": "الكتل",
        "transactions": "المعاملات",
        "validators": "المدققون",
        "tokens": "الرموز"
      },
      "cols": {
        "block": "الكتلة",
        "age": "العمر",
        "txs": "المعاملات",
        "producer": "المنتج",
        "reward": "المكافأة",
        "hash": "الهاش"
      },
      "sidebar": {
        "explore": "استكشاف",
        "network": "الشبكة"
      },
      "toolbar": {
        "filter": "تصفية",
        "sort": "ترتيب",
        "live": "مباشر"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "استكشف",
      "title": "كل شيء على السلسلة، في الوقت الفعلي",
      "description": "الكتل والمعاملات تتدفق الآن. انقر على أي عنصر للتحقيق فيه.",
      "viewBlocks": "عرض الكتل",
      "viewTxs": "عرض المعاملات"
    },
    "home_heartbeat": {
      "label": "النبض",
      "blockAgoPrefix": "الكتلة منذ",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} معاملة",
      "viewAll": "عرض الكل"
    },
    "home_hero": {
      "coin_alt": "عملة EAV7",
      "title": "العصر الجديد لمستكشف السلسلة",
      "subtitle": "كتل كل ثانية واحدة، وأمان ما بعد الكم، وطبقة ذكاء اصطناعي أصلية. استكشف الكتل والمعاملات والمدققين والعناوين في الوقت الفعلي.",
      "search_placeholder": "ابحث عن كتلة أو معاملة أو عنوان…",
      "search_button": "استكشف",
      "stat_height": "الارتفاع",
      "stat_block": "الكتلة",
      "stat_validators": "المدققون",
      "stat_mempool": "الميمبول"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "عملة EAV7",
        "titleBefore": "بلوكتشين EAV7، وما",
        "titleHighlight": "بعده",
        "subtitle": "إجماع DPoS بزمن ثانية واحدة، وأمان مقاوم للحوسبة الكمية، وطبقة ذكاء اصطناعي أصلية. استكشف الكتل والمعاملات والمدققين في الوقت الفعلي.",
        "exploreNetwork": "استكشاف الشبكة",
        "openWallet": "فتح المحفظة",
        "scrollAriaLabel": "التمرير إلى اللوحة"
      },
      "vitals": {
        "height": "الارتفاع",
        "blockTime": "الكتلة",
        "validators": "المدققون"
      }
    },
    "home_inkBand": {
      "eyebrow": "تفاعلي",
      "title": "مرّر الفأرة للكشف",
      "subtitle": "شبكة EAV7، إلى ما وراء الكتلة",
      "mobileHint": "على الجوال يظهر التصميم مباشرة"
    },
    "home_latestTxs": {
      "title": "أحدث المعاملات",
      "viewAll": "عرض الكل",
      "table": {
        "hash": "التجزئة",
        "type": "النوع",
        "fromTo": "من ← إلى",
        "value": "القيمة"
      },
      "empty": "لا توجد معاملات بعد"
    },
    "home_moments": {
      "sectionEyebrow": "داخل البروتوكول",
      "sectionTitle": "طبقة أولى مبنية لتدوم",
      "items": {
        "security": {
          "eyebrow": "الأمان",
          "titlePrefix": "جاهزة لعصر ما",
          "titleHighlight": "بعد الكم",
          "desc": "كل محفظة ومعاملة وكتلة تحمل توقيعين — والتحقق يتطلب كليهما. تزوير ذلك يتطلب كسر كلا الأساسين في آن واحد.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "عنوان E7 مشتق عبر SHA3-256"
        },
        "consensus": {
          "eyebrow": "الإجماع",
          "titlePrefix": "كتلة كل",
          "titleHighlight": "1 ثانية",
          "desc": "إجماع DPoS بما يصل إلى 27 مدققًا منتخبًا بالحصة، بتناوب حتمي — أسرع 3 مرات من Tron، مع حيوية محمية.",
          "bullet1": "27 مدققًا · تناوب دائري لكل فتحة",
          "bullet2": "16 EAV7 مكافأة لكل كتلة"
        },
        "intelligence": {
          "eyebrow": "الذكاء",
          "titlePrefix": "طبقة",
          "titleHighlight": "ذكاء اصطناعي أصلية",
          "desc": "أوراكل على السلسلة مع ضمان: يتم نشر مهام الذكاء الاصطناعي، وحلها بواسطة الأوراكل المحدد، وتسويتها بشكل يمكن التحقق منه — كل ذلك داخل البروتوكول.",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "تجزئة النتيجة مسجلة على السلسلة"
        },
        "assets": {
          "eyebrow": "الأصول",
          "titlePrefix": "رموز",
          "titleHighlight": "EAV20",
          "titleSuffix": "وجسر عبر السلاسل",
          "desc": "أنشئ وانقل رموزًا أصلية (تعادل TRC20) واربط EAV7 بشبكات أخرى عبر نموذج قفل وتحرير آمن ومتماثل القوة.",
          "bullet1": "معيار EAV20 · create / transfer / approve",
          "bullet2": "جسر TRON · ETH · BTC (قفل وتحرير)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "الوقت الفعلي",
      "title": "نبض الشبكة",
      "subtitle": "كتلة جديدة كل ثانية. تابع نبض شبكة EAV7 في الوقت الفعلي.",
      "stats": {
        "blockHeight": "ارتفاع الكتلة",
        "txLast30": "المعاملات · آخر 30 كتلة",
        "mempool": "الذاكرة المؤقتة (Mempool)",
        "rewardPerBlock": "EAV7 / كتلة"
      },
      "activity": {
        "title": "نشاط الشبكة",
        "txInLastBlocks": "معاملات في آخر {n} كتلة"
      },
      "slots": {
        "title": "فتحات DPoS",
        "activeValidators": "المدققون النشطون",
        "supply": "المعروض {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "إجمالي الحسابات"
        },
        "transactions": {
          "label": "إجمالي المعاملات"
        },
        "volume": {
          "label": "حجم التحويلات"
        },
        "staked": {
          "label": "إجمالي الحصص المرهونة"
        }
      },
      "ring": {
        "supplyLine1": "من إجمالي العرض",
        "supplyLine2": "مقفل في الحصص المرهونة"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} من {max}"
    },
    "home_walletCta": {
      "eyebrow": "ابدأ الآن",
      "title": "استكشف شبكة EAV7 الآن",
      "description": "يتم إنشاء محفظتك وتوقيعها في المتصفح بحماية ما بعد الكم — ولا تغادر جهازك أبدًا. أرسل، وقم بالمشاركة (Staking)، وقم بالتعدين مباشرة عبر الويب.",
      "createWallet": "إنشاء محفظة",
      "exploreNetwork": "استكشاف الشبكة"
    },
    "mining_live": {
      "badge_consensus": "DPoS · تكديس",
      "title": "التعدين",
      "live_badge": "مباشر",
      "subtitle": "في EAV7 تقوم بالتعدين عن طريق قفل EAV7 (تكديس) — بدون أجهزة، وبدون استهلاك طاقة",
      "stat_reward_block": "المكافأة / الكتلة",
      "stat_blocks_day": "الكتل / اليوم",
      "stat_daily_emission": "الإصدار اليومي",
      "stat_already_mined": "تم تعدينه بالفعل",
      "network_production": "إنتاج الشبكة",
      "reward_per_block_caption": "مكافأة كل كتلة (1 ثانية)",
      "annual_emission_caption": "الإصدار السنوي المقدر",
      "next_block": "الكتلة التالية",
      "miners_label": "المعدّنون",
      "staked_label": "EAV7 مقفلة",
      "block_time_label": "زمن الكتلة",
      "ai_sentinel_badge": "حارس الذكاء الاصطناعي · 24 ساعة",
      "network_protected": "الشبكة محمية",
      "ai_monitoring_desc": "مراقبة مستمرة بواسطة ذكاء اصطناعي أصلي",
      "alerts_analyzed": "التنبيهات التي تم تحليلها",
      "active_oracles": "الأوراكل النشطة",
      "pending_ai_tasks": "مهام الذكاء الاصطناعي المعلقة",
      "cta_title": "ابدأ تعدين EAV7",
      "cta_description": "اقفل EAV7 في محفظتك لتصبح معدّنًا في إجماع DPoS وتحصل على مكافآت عن كل كتلة يتم إنتاجها. كل ذلك بحفظ ذاتي، مع توقيع ما بعد الكم في المتصفح.",
      "cta_lock_button": "قفل EAV7",
      "cta_view_validators": "عرض المدققين"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "بحث",
      "dica": "كتلة (رقم) · معاملة (E7…) · عنوان (E7… أو 0x…)"
    },
    "netStatus": {
      "onlineTitle": "شبكة EAV7 متصلة · الارتفاع {height}",
      "offlineTitle": "العقدة غير متصلة",
      "connecting": "جارٍ الاتصال…"
    },
    "page_address": {
      "metaTitle": "العنوان {addr}… · EAV7 Scan",
      "eyebrow": "العنوان",
      "title": "العنوان",
      "roleValidator": "مُدقّق",
      "roleOracle": "أوراكل",
      "roleAccount": "حساب",
      "balance": "الرصيد",
      "staked": "محجوز في الستيك",
      "nonce": "nonce",
      "feeExempt": "بدون رسوم",
      "available": "متاح",
      "max": "الحد الأقصى {n}",
      "tokensTitle": "رموز EAV20",
      "colToken": "الرمز",
      "colSymbol": "الرمز المختصر",
      "colBalance": "الرصيد",
      "txsTitle": "المعاملات",
      "colHash": "التجزئة",
      "colBlock": "الكتلة",
      "colType": "النوع",
      "colCounterparty": "الطرف المقابل",
      "colValue": "القيمة",
      "colDate": "التاريخ",
      "out": "صادر",
      "in": "وارد",
      "noTxs": "لا توجد معاملات لهذا العنوان",
      "totalBalance": "الرصيد الإجمالي: {n}",
      "tabOverview": "نظرة عامة",
      "tabTransfers": "التحويلات",
      "tabInternal": "التحويلات الداخلية",
      "tabStaking": "التخزين والموارد",
      "tabContract": "العقد",
      "tabPermissions": "الأذونات",
      "tabAnalysis": "التحليل",
      "internalNote": "قيمة نقلها تنفيذ العقد. ليست معاملة موقَّعة، ولذلك ليس لها تجزئة خاصة بها.",
      "internalEmpty": "لا توجد تحويلات داخلية",
      "colFrom": "من",
      "colTo": "إلى",
      "colTx": "المعاملة",
      "stakingTitle": "التخزين والموارد",
      "bandwidth": "عرض النطاق",
      "energy": "الطاقة",
      "delegatedOut": "مفوَّض للآخرين",
      "delegatedIn": "مستلَم بالتفويض",
      "unbondingTitle": "قيد الإلغاء",
      "matureIn": "يُفتح بعد {n} كتلة",
      "votesCastTitle": "الأصوات المُدلى بها",
      "votesReceived": "الأصوات المستلمة",
      "vestingTitle": "الاستحقاق",
      "permsNone": "حساب بمفتاح واحد — بدون توقيع متعدد",
      "permsThreshold": "الحد",
      "colWeight": "الوزن",
      "colKey": "المفتاح",
      "contractNone": "هذا العنوان ليس عقدًا",
      "contractCodeSize": "حجم الشيفرة",
      "contractVerified": "موثَّق",
      "contractUnverified": "غير موثَّق",
      "sent": "مُرسَل",
      "received": "مُستلَم",
      "feesPaid": "الرسوم المدفوعة",
      "txCount": "المعاملات",
      "firstSeen": "أول نشاط",
      "lastSeen": "آخر نشاط",
      "byType": "حسب النوع",
      "topCounterparties": "أبرز الأطراف المقابلة",
      "truncatedNote": "عيّنة مقتصرة على أحدث المعاملات",
      "noData": "لا توجد بيانات",
      "nftsTitle": "رموز NFT (EAV721)",
      "colNftCollection": "المجموعة",
      "colNftId": "الرمز",
      "namesTitle": "أسماء EAV-NS",
      "colNsName": "الاسم",
      "colNsTarget": "يشير إلى",
      "votesLabel": "الأصوات المستلمة",
      "commissionLabel": "العمولة",
      "accountInfo": "معلومات الحساب",
      "accountType": "نوع الحساب",
      "createdAt": "أُنشئ في",
      "totalTxs": "إجمالي المعاملات",
      "tabTokenTx": "تحويلات الرموز",
      "tokenTxEmpty": "لا توجد تحويلات رموز",
      "roleContract": "عقد",
      "roleMultisig": "توقيع متعدد",
      "holdings": "الحيازات",
      "colAsset": "الأصل",
      "assets": "الأصول",
      "transfersRow": "التحويلات",
      "votesRow": "الأصوات",
      "claimable": "مكافآت قابلة للمطالبة",
      "tabApprovals": "الموافقات",
      "searchHoldings": "ابحث بالاسم أو الرمز أو العنوان…",
      "noHoldings": "لا يوجد شيء هنا",
      "colSpender": "المُخوَّل",
      "colLimit": "الحد",
      "more": "عرض المزيد",
      "tabTokens": "الرموز",
      "tabTransactions": "المعاملات",
      "colAge": "العمر",
      "colResult": "النتيجة",
      "resultOk": "نجاح",
      "resultRevert": "تراجع",
      "summaryTx": "إجمالي {n} معاملة",
      "summaryTransfers": "إجمالي {n} تحويل",
      "summaryInternal": "إجمالي {n} تحويل داخلي",
      "filterAll": "الكل",
      "filterIn": "وارد",
      "filterOut": "صادر",
      "summaryTokenTx": "إجمالي {n} تحويل رموز",
      "colParentHash": "التجزئة الأصل",
      "colResourceAmount": "كمية المورد",
      "colStakedAmount": "EAV7 المخزّن",
      "colUpdatedAt": "آخر تحديث",
      "stakeNote": "في EAV7 يمنح التخزين الواحد الطاقة وعرض النطاق معًا — بخلاف TRON، لا يتم اختيار مورد.",
      "permsOperations": "العمليات",
      "thisAccount": "هذا الحساب",
      "summaryContracts": "إجمالي {n} عقد",
      "permsNote": "في EAV7 تنطبق مجموعة العمليات على أي حساب متعدد التواقيع — لا يوجد نطاق لكل إذن كما في TRON.",
      "permsDefault": "افتراضي",
      "permsDefaultNote": "لم يتم إعداد توقيع متعدد. هذا هو التفويض الفعلي للحساب: مفتاح واحد وتوقيع واحد."
    },
    "page_block": {
      "metaTitle": "الكتلة #{height} · EAV7 Scan",
      "eyebrow": "كتلة",
      "title": "الكتلة #{height}",
      "sub": "منذ {ago}",
      "kv": {
        "height": "الارتفاع",
        "date": "التاريخ",
        "producer": "المنتِج",
        "previousHash": "التجزئة السابقة",
        "merkleRoot": "جذر ميركل (المعاملات)",
        "txCount": "المعاملات",
        "protocol": "البروتوكول",
        "scheme": "المخطط"
      },
      "txSectionTitle": "معاملات الكتلة",
      "table": {
        "hash": "التجزئة",
        "type": "النوع",
        "from": "من",
        "to": "إلى",
        "value": "القيمة",
        "fee": "الرسوم"
      },
      "emptyBlock": "كتلة فارغة"
    },
    "page_docs": {
      "metaTitleFallback": "التوثيق · EAV7 Scan",
      "breadcrumb": "التوثيق",
      "terminal": "الطرفية",
      "onThisPage": "في هذه الصفحة"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "التعدين · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "هذه الصفحة غير موجودة في سلسلة EAV7.",
      "backLink": "← العودة إلى الصفحة الرئيسية"
    },
    "page_search": {
      "metaTitle": "بحث · EAV7 Scan",
      "title": "لم يتم العثور على شيء",
      "notRecognizedPrefix": "لم نتعرف على",
      "notRecognizedSuffix": "ككتلة أو معاملة أو عنوان EAV7.",
      "retryPlaceholder": "حاول مرة أخرى…",
      "whatCanSearch": "ما الذي يمكنك البحث عنه",
      "blockLabel": "كتلة",
      "blockDesc": "رقم الارتفاع، مثال",
      "txLabel": "معاملة",
      "txDesc": "التجزئة",
      "txChars": "(64 حرفًا)",
      "addressLabel": "عنوان",
      "addressLen34": "(34) أو",
      "or": "أو",
      "evmLabel": "(EAVM)",
      "backHome": "← العودة إلى الصفحة الرئيسية"
    },
    "page_token": {
      "eyebrow": "رمز EAV20",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "رمز · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "المعيار",
      "mintable": "إصدار مفتوح",
      "fixedSupply": "عرض ثابت",
      "paused": "متوقف",
      "tabTransfers": "التحويلات",
      "tabHolders": "الحائزون",
      "tabAnalysis": "التحليل",
      "totalSupply": "إجمالي العرض",
      "holders": "الحائزون",
      "decimals": "المنازل العشرية",
      "status": "الحالة",
      "statusActive": "نشط",
      "statusPaused": "متوقف",
      "createdAt": "تاريخ الإنشاء",
      "contract": "العقد",
      "creator": "المُنشئ",
      "owner": "المسؤول",
      "mintableLabel": "يمكن إصدار المزيد",
      "yes": "نعم",
      "no": "لا",
      "summaryTransfers": "إجمالي {n} تحويل",
      "summaryHolders": "{n} حائز إجمالاً — عرض أكبر {shown}",
      "colHash": "التجزئة",
      "colBlock": "الكتلة",
      "colAge": "العمر",
      "colFrom": "من",
      "colTo": "إلى",
      "colAmount": "المبلغ ({symbol})",
      "colRank": "#",
      "colAddress": "العنوان",
      "colBalance": "الرصيد ({symbol})",
      "colShare": "الحصة",
      "blacklisted": "محظور",
      "noTransfers": "لم يتم العثور على تحويلات.",
      "noHolders": "لم يتم العثور على حائزين.",
      "top1": "أكبر حائز",
      "top10": "أكبر 10",
      "top50": "أكبر 50",
      "concentrationTitle": "تركّز العرض",
      "concentrationNote": "مقدار العرض الموجود في أكبر المحافظ. العرض الكبير في أيدٍ قليلة يحمل مخاطر سوقية مختلفة عن العرض الموزّع على نطاق واسع — لذا فإن التوزيع أهم من الرقم الإجمالي.",
      "largestHolder": "أكبر حائز:",
      "overviewTitle": "نظرة عامة",
      "basicInfoTitle": "معلومات العقد",
      "activityTitle": "التوزيع",
      "largestHolderShort": "أكبر حائز",
      "tabContract": "العقد",
      "nativeTitle": "رمز أصلي في البروتوكول",
      "nativeBadge": "بلا شيفرة اعتباطية",
      "nativeNote": "هذا الرمز ليس عقداً ذكياً: البروتوكول نفسه هو من ينفّذه. لا يوجد Solidity ولا مُصرِّف ولا بايت كود للتحقق منه — ولا توجد كذلك منطق خفي كتبه أحد. السلوك متطابق لكل رموز EAV20 ولا يتغيّر إلا عبر انقسام صلب للشبكة.",
      "implementation": "التنفيذ",
      "implementationValue": "أصلي في التوافق (معيار EAV20)",
      "sourceOfTruth": "مصدر البروتوكول",
      "powersTitle": "ما يستطيع المسؤول فعله",
      "powersNote": "في مستكشف EVM كنت ستقرأ الشيفرة المصدرية لمعرفة ذلك. هنا هي حقول حالة، لذا نسردها مباشرة. هذا ما يهم فعلاً قبل الوثوق برمز.",
      "powerMint": "إصدار وحدات إضافية",
      "powerMintNote": "يزيد إجمالي العرض ويُخفّف حصص الحائزين الحاليين.",
      "powerPause": "إيقاف التحويلات",
      "powerPauseNote": "يجمّد كل حركة الرمز دفعة واحدة.",
      "powerBlacklist": "حظر العناوين",
      "powerBlacklistNote": "يمنع عنواناً محدداً من الإرسال أو الاستقبال.",
      "powerFreeze": "تجميد الرصيد",
      "powerFreezeNote": "يقفل جزءاً من رصيد عنوان حتى تاريخ محدد.",
      "powerYes": "يستطيع",
      "powerNo": "لا يستطيع",
      "powerActiveNow": "نشط الآن",
      "adminIs": "المسؤول:",
      "restrictionsTitle": "القيود السارية",
      "frozenUntil": "حتى {when}"
    },
    "page_tx": {
      "metaTitle": "المعاملة {id}… · EAV7 Scan",
      "eyebrow": "معاملة",
      "title": "المعاملة",
      "status": "الحالة",
      "type": "النوع",
      "block": "الكتلة",
      "from": "من",
      "to": "إلى",
      "value": "القيمة",
      "fee": "الرسوم",
      "nonce": "Nonce",
      "date": "التاريخ",
      "scheme": "المخطط",
      "eavmLayer": "طبقة EAVM (MetaMask)",
      "energy": "الطاقة",
      "energyUnit": "طاقة"
    },
    "page_txs": {
      "metaTitle": "المعاملات · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "معيار EAV20",
        "title": "الرموز",
        "subtitle": "أصول أصلية لبروتوكول eav20 — تعادل TRC20 في شبكة Tron"
      },
      "empty": {
        "title": "لم يتم إنشاء أي رموز بعد",
        "description": "تظهر الرموز هنا بمجرد إنشائها على الشبكة عبر"
      },
      "stats": {
        "tokens": "رموز EAV20",
        "holders": "الحائزون (الإجمالي)",
        "supply": "الإجمالي المجمّع للعرض",
        "standard": "المعيار"
      },
      "card": {
        "supply": "العرض",
        "holders": "الحائزون",
        "share": "الحصة",
        "creator": "المُنشئ"
      }
    },
    "txs_live": {
      "chainLabel": "سلسلة eav20",
      "title": "المعاملات",
      "live": "مباشر",
      "subtitleLive": "الأحدث أولاً · القيم بـ EAV7",
      "subtitleOlder": "معاملات أقدم · القيم بـ EAV7",
      "searchPlaceholder": "ابحث عن معاملة أو كتلة أو عنوان…",
      "cols": {
        "hash": "التجزئة",
        "block": "الكتلة",
        "type": "النوع",
        "from": "من",
        "to": "إلى",
        "value": "القيمة",
        "age": "العمر"
      },
      "stats": {
        "totalTx": "إجمالي المعاملات",
        "mempool": "في المجمع",
        "volume": "الحجم (EAV7)",
        "avgFee": "متوسط الرسوم"
      },
      "table": {
        "latest": "أحدث المعاملات",
        "older": "المعاملات السابقة",
        "updating": "جارٍ التحديث",
        "empty": "لم يتم العثور على معاملات",
        "count": "{n} معاملة",
        "loadMore": "تحميل الأقدم →",
        "genesis": "بداية السلسلة"
      }
    },
    "ui_copy": {
      "default_value": "القيمة",
      "aria_label": "نسخ {label}",
      "copied": "تم النسخ ✓",
      "copy_label": "نسخ {label}",
      "copy": "نسخ"
    },
    "ui_explorerSearch": {
      "placeholder": "ابحث عن كتلة أو معاملة أو عنوان…",
      "searchButton": "بحث"
    },
    "validators_live": {
      "unavailable": "العقدة غير متاحة",
      "header": {
        "eyebrow": "إجماع DPoS",
        "title": "المدققون",
        "live": "مباشر",
        "subtitle": "{active} نشط من أصل {max} فتحة · الحد الأدنى للحصة {min} EAV7 · تناوب في كل كتلة"
      },
      "producer": {
        "label": "منتج الفتحة الحالية",
        "producingBlock": "يقوم بإنتاج الكتلة"
      },
      "slot": {
        "label": "الفتحة · {n} ثانية",
        "staked": "{n} EAV7 محجوزة كحصة"
      },
      "rotation": {
        "label": "تناوب الإنتاج"
      },
      "stats": {
        "activeValidators": "المدققون النشطون",
        "rewardPerBlock": "المكافأة / الكتلة",
        "totalStaked": "إجمالي الحصة",
        "peers": "أقران الشبكة"
      },
      "ranking": {
        "title": "المجموعة النشطة",
        "sortedBy": "مرتب حسب الحصة",
        "producing": "قيد الإنتاج",
        "active": "نشط",
        "stakedCaption": "EAV7 محجوزة كحصة"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "آمنة"
      },
      "role": {
        "validator": "مُصادِق",
        "oracle": "أوراكل",
        "account": "حساب EAV7"
      },
      "lock": {
        "button": "قفل"
      },
      "balance": {
        "label": "الرصيد المتاح"
      },
      "tier": {
        "validator": "مُصادِق",
        "fee_zero": "رسوم صفرية",
        "standard": "قياسي"
      },
      "actions": {
        "send": "إرسال",
        "receive": "استلام",
        "stake": "تكديس"
      },
      "stats": {
        "staked": "المُكدَّس",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "الرسوم",
        "fee_zero": "صفر",
        "fee_standard": "قياسي"
      },
      "tier_progress": {
        "label": "تقدم المستوى",
        "remaining_prefix": "متبقٍ",
        "remaining_suffix": "للوصول إلى مستوى {tier}"
      },
      "receive": {
        "title": "استلام EAV7",
        "description_before": "شارك عنوانك",
        "description_after": "— تقوم الشبكة تلقائيًا بربطه بعملة E7 الأصلية الخاصة بك.",
        "close": "إغلاق"
      },
      "activity": {
        "title": "النشاط الأخير",
        "sent": "مُرسَل",
        "received": "مُستلَم"
      },
      "addresses": {
        "hint": "استخدم هذا العنوان 0x للاستلام (معيار EAVM/MetaMask)"
      },
      "tokens": {
        "title": "عملات EAV20"
      },
      "footer": {
        "quantum": "ما بعد الكم · secp256k1 + ML-DSA-44",
        "logout": "تسجيل الخروج / تبديل"
      },
      "wipe": {
        "title": "حذف هذه المحفظة؟",
        "description_before": "ستتم إزالة المحفظة المشفرة",
        "description_bold": "من هذا المتصفح",
        "description_after": ". يمكنك استعادتها فقط باستخدام نسخة احتياطية للمفتاح الخاص — لا يوجد استرداد لكلمة المرور.",
        "warning_before": "تأكد من أن لديك",
        "warning_bold": "نسخة احتياطية للمفتاح",
        "warning_after": "قبل الحذف.",
        "download_backup": "تنزيل النسخة الاحتياطية (.json)",
        "cancel": "إلغاء",
        "confirm": "حذف المحفظة"
      }
    },
    "wallet_addNet": {
      "title": "الاستخدام في MetaMask / Trust",
      "description": "أضف شبكة EAV7 (السلسلة 72020) إلى محفظة EVM الخاصة بك.",
      "adding": "جارٍ الإضافة…",
      "added": "✓ تمت الإضافة",
      "addButton": "إضافة الشبكة",
      "noWallet": "لم يتم اكتشاف MetaMask في هذا المتصفح.",
      "error": "تعذّرت إضافة الشبكة."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "أنت وحدك من يتحكم",
        "on_device_title": "على الجهاز",
        "on_device_desc": "المفتاح لا يغادر أبدًا",
        "quantum_title": "مقاوم للحوسبة الكمية",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "نسخة احتياطية",
        "password": "كلمة المرور",
        "ready": "جاهز"
      },
      "unlock": {
        "title": "مرحبًا بعودتك",
        "subtitle": "توجد محفظة مشفّرة في هذا المتصفح. أدخل كلمة المرور لإلغاء القفل.",
        "password_placeholder": "كلمة المرور",
        "error_wrong_password": "كلمة المرور غير صحيحة",
        "unlocking": "جارٍ إلغاء القفل…",
        "unlock_button": "إلغاء قفل المحفظة",
        "wipe_confirm": "هل تريد حذف المحفظة من هذا المتصفح؟ تأكد من أن لديك نسخة احتياطية من المفتاح!",
        "wipe_button": "حذف والبدء من جديد"
      },
      "choose": {
        "title": "محفظتك في EAV7",
        "subtitle": "محفظة ذاتية الحفظ: أنت المالك الوحيد لمفاتيحك. ابدأ خلال ثوانٍ.",
        "create_title": "إنشاء محفظة جديدة",
        "create_desc": "يُنشئ مفتاحًا جديدًا على هذا الجهاز.",
        "import_title": "استيراد مفتاح",
        "import_desc": "لديك بالفعل مفتاح خاص؟ استعده هنا."
      },
      "import": {
        "title": "استيراد المحفظة",
        "subtitle": "الصق المفتاح الخاص واختر كلمة مرور لتشفيره في هذا المتصفح.",
        "label": "المفتاح الخاص (0x + 64 hex)",
        "importing": "جارٍ الاستيراد…",
        "button": "استيراد",
        "back": "رجوع",
        "error_invalid_key": "مفتاح خاص غير صالح (المتوقع 0x + 64 hex)"
      },
      "create": {
        "title": "قم بعمل نسخة احتياطية من مفتاحك",
        "subtitle": "لا يوجد استرجاع لكلمة المرور. من يملك المفتاح الخاص يتحكم بالأموال — احفظه قبل المتابعة.",
        "warning_prefix": "هذا المفتاح ",
        "warning_bold": "هو الطريقة الوحيدة",
        "warning_suffix": " للوصول إلى أموالك. احفظه دون اتصال بالإنترنت — لا تشاركه مع أي شخص أبدًا.",
        "address_label": "عنوان E7",
        "private_key_label": "المفتاح الخاص",
        "reveal": "إظهار",
        "hide": "إخفاء",
        "download_backup": "⭳ تنزيل النسخة الاحتياطية (.json)",
        "confirm_saved": "لقد حفظت مفتاحي في مكان آمن",
        "creating": "جارٍ الإنشاء…",
        "create_button": "إنشاء محفظة",
        "confirm_hint": "أكّد أنك حفظت المفتاح",
        "back": "رجوع"
      },
      "errors": {
        "password_min": "يجب أن تحتوي كلمة المرور على 6 أحرف على الأقل",
        "password_mismatch": "كلمتا المرور غير متطابقتين",
        "save_error": "حدث خطأ أثناء الحفظ"
      },
      "password": {
        "label": "كلمة المرور للتشفير (6 أحرف على الأقل)",
        "placeholder": "كلمة المرور",
        "confirm_placeholder": "تأكيد كلمة المرور",
        "mismatch": "كلمتا المرور غير متطابقتين",
        "strength": {
          "very_weak": "ضعيفة جدًا",
          "weak": "ضعيفة",
          "fair": "معقولة",
          "good": "جيدة",
          "strong": "قوية"
        }
      }
    },
    "wallet_send": {
      "title": "إرسال EAV7",
      "steps": {
        "destination": "الوجهة",
        "value": "المبلغ",
        "review": "مراجعة"
      },
      "recipient": {
        "label": "الوجهة (0x… EAVM/MetaMask)",
        "paste": "لصق",
        "valid": "✓ عنوان صالح",
        "invalid": "عنوان 0x غير صالح"
      },
      "errors": {
        "needEvmAddress": "أدخل عنوان 0x للوجهة (المحفظة على الويب توقّع وفق نموذج EAVM)",
        "invalidAddress": "يجب أن تكون الوجهة عنوان 0x (EAVM/MetaMask)",
        "needPositiveAmount": "أدخل مبلغًا موجبًا",
        "insufficientBalance": "الرصيد غير كافٍ (ضع الرسوم في الاعتبار)",
        "invalidAmount": "مبلغ غير صالح",
        "sendFailed": "فشل الإرسال"
      },
      "continue": "متابعة",
      "cancel": "إلغاء",
      "available": "المتاح: {amount} EAV7",
      "percent": {
        "max": "الحد الأقصى"
      },
      "back": "رجوع",
      "sendingLabel": "جارٍ الإرسال",
      "sendingTo": "إلى {addr}",
      "networkFee": "رسوم الشبكة",
      "balanceAfter": "الرصيد بعد العملية",
      "quantumNote": "تم التوقيع على هذا الجهاز · حماية ما بعد الكم لهذه الشبكة",
      "confirmAndSign": "تأكيد وتوقيع",
      "signing": "جارٍ التوقيع…",
      "transactionSent": {
        "title": "تم إرسال المعاملة",
        "subtitle": "سيتم التأكيد في الكتلة التالية (~1 ثانية)."
      },
      "close": "إغلاق"
    },
    "wallet_stake": {
      "title": "الستاكينغ",
      "subtitle": "‎≥ 100 EAV7 يلغي الرسوم · ‎≥ 1000 يجعلك عامل تعدين (16 EAV7/كتلة منتجة).",
      "tierZeroFee": {
        "label": "بدون رسوم",
        "sub": "‎≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "مُصادق",
        "sub": "‎≥ 1000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "المبلغ المُودع حالياً:",
      "warnValidator": "هذا سيخفض رصيدك المُودع إلى أقل من 1000 — وستفقد صفة المُصادق.",
      "warnFeeReset": "هذا سيخفض رصيدك المُودع إلى أقل من 100 — وستعود معاملاتك لدفع الرسوم.",
      "warnConfirm": "فهمت، أزل على أي حال ←",
      "errInvalidAmount": "أدخل مبلغاً موجباً",
      "errInvalidValue": "مبلغ غير صالح",
      "errFailedOp": "فشلت العملية",
      "sentTitle": "تم إرسال العملية",
      "close": "إغلاق",
      "stakeBtn": "إيداع في الستاكينغ",
      "removeBtn": "إزالة"
    }
  },
  "hi": {
    "blocks_live": {
      "networkLabel": "eav20 श्रृंखला",
      "title": "ब्लॉक",
      "live": "लाइव",
      "blockTimeInfo": "हर {n} सेकंड में एक नया ब्लॉक · DPoS सर्वसम्मति",
      "searchPlaceholder": "ऊँचाई या हैश से ब्लॉक खोजें…",
      "stats": {
        "height": "वर्तमान ऊँचाई",
        "blockTime": "ब्लॉक समय",
        "avgTx": "टीएक्स / ब्लॉक (औसत)",
        "activeProducers": "सक्रिय उत्पादक"
      },
      "latestBlocks": "नवीनतम ब्लॉक",
      "updating": "अपडेट हो रहा है",
      "columns": {
        "block": "ब्लॉक",
        "age": "आयु",
        "txs": "टीएक्स",
        "producer": "उत्पादक",
        "reward": "इनाम",
        "hash": "हैश"
      }
    },
    "comingSoon": {
      "badge": "निर्माणाधीन · स्प्रिंट 4",
      "backToExplorer": "← एक्सप्लोरर पर वापस जाएं"
    },
    "docs_api": {
      "badge": "सार्वजनिक API",
      "title": "नोड से सीधे नेटवर्क क्वेरी करें",
      "baseUrl": "बेस URL",
      "tags": {
        "cors": "CORS सक्षम",
        "units": "मान e7 में",
        "noAuth": "बिना प्रमाणीकरण"
      },
      "groups": {
        "read": "पढ़ना",
        "write": "लिखना"
      },
      "endpoints": {
        "status": "नेटवर्क स्थिति: ऊँचाई, वैलिडेटर, मेमपूल, ब्लॉक रिवॉर्ड",
        "blocks": "अंतिम N ब्लॉक",
        "blockByHeight": "ऊँचाई या हैश द्वारा एक ब्लॉक",
        "txs": "हाल के लेनदेन, पेजिनेटेड",
        "tx": "id द्वारा एक लेनदेन",
        "address": "बैलेंस, स्टेक, nonce, भूमिका, टोकन और ऊर्जा",
        "tokens": "EAV20 टोकन की सूची (विवरण के लिए /tokens/:id)",
        "validators": "सक्रिय DPoS सेट + स्लॉट प्रोड्यूसर",
        "sendTx": "एक हस्ताक्षरित नेटिव लेनदेन भेजता है (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "EAVM लेयर के माध्यम से लेनदेन भेजता है (JSON-RPC संगत)"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "कस्टम नेटवर्क"
      },
      "title": "अपने वॉलेट में EAV7 का उपयोग करें",
      "description": "EAV7 वही JSON-RPC भाषा बोलती है जिसे यूनिवर्सल वॉलेट समझते हैं — एक क्लिक में नेटवर्क जोड़ें।",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "कोई भी EVM वॉलेट"
      },
      "params": {
        "networkName": "नेटवर्क का नाम",
        "rpcUrl": "RPC URL",
        "chainId": "चेन आईडी",
        "symbol": "प्रतीक",
        "explorer": "एक्सप्लोरर",
        "decimals": "दशमलव अंक"
      },
      "button": {
        "adding": "जोड़ा जा रहा है…",
        "addToMetamask": "MetaMask में जोड़ें"
      },
      "status": {
        "added": "नेटवर्क जोड़ा गया!",
        "noWallet": "MetaMask नहीं मिली — बगल का डेटा कॉपी करें।"
      },
      "error": {
        "addFailed": "नेटवर्क जोड़ा नहीं जा सका"
      },
      "mapping": {
        "badge": "वही खाता",
        "title": "दो पहचान, एक खाता",
        "labelEavm": "EAVM",
        "labelNative": "नेटिव",
        "desc1": "MetaMask दिखाता है",
        "desc2": "; चेन पर बैलेंस संबंधित",
        "desc3": "पते में रहता है। यह वही खाता है।"
      },
      "steps": {
        "step1": "EAV7 नेटवर्क जोड़ने के लिए क्लिक करें",
        "step2": "आपका खाता वॉलेट में 0x… के रूप में दिखता है",
        "step3": "चेन पर बैलेंस संबंधित E7 में रहता है"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "ब्लॉक समय",
        "stat_validators_value": "27 तक",
        "stat_validators_label": "DPoS वैलिडेटर",
        "stat_supply_value": "100 अरब",
        "stat_supply_label": "EAV7 आपूर्ति",
        "stat_reward_label": "प्रति ब्लॉक EAV7",
        "stat_quantum_value": "हाइब्रिड",
        "stat_quantum_label": "पोस्ट-क्वांटम",
        "pillars_title": "प्रोटोकॉल के स्तंभ",
        "pillar_consensus": "DPoS सर्वसम्मति",
        "pillar_token_standard": "EAV20 मानक",
        "pillar_bridge": "क्रॉस-चेन ब्रिज",
        "pillar_security": "सुरक्षा और AI",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "EAV20 मानक",
        "title": "बिना वर्चुअल मशीन के नेटिव टोकन",
        "description": "TRC20 के समकक्ष: टोकन सीधे चेन की स्थिति में रहते हैं और हस्ताक्षरित लेनदेन के माध्यम से चलते हैं — तेज़, सस्ता और सत्यापन योग्य।",
        "cta": "नेटवर्क टोकन देखें"
      },
      "consenso": {
        "badge": "DPoS सर्वसम्मति",
        "title": "हर सेकंड एक नया ब्लॉक",
        "description": "वैलिडेटर बारी-बारी से बदलते हैं: हर 1 सेकंड के स्लॉट में, एक अपेक्षित प्रोड्यूसर अगले ब्लॉक पर हस्ताक्षर करता है। कोई ग्राइंडिंग नहीं, कोई इंतज़ार नहीं।",
        "slot_now": "अभी का स्लॉट",
        "slot_offset": "स्लॉट +{n}",
        "fact_election_label": "चुनाव",
        "fact_election_value": "स्टेक के अनुसार शीर्ष 27 (≥ 1,000 EAV7)",
        "fact_production_label": "उत्पादन",
        "fact_production_value": "validators[slot % N] · राउंड-रॉबिन",
        "fact_fork_choice_label": "फोर्क चॉइस",
        "fact_fork_choice_value": "सबसे लंबी वैध चेन",
        "cta": "लाइव वैलिडेटर देखें"
      },
      "ponte": {
        "title": "ब्रिज नेटवर्कों के बीच मूल्य कैसे स्थानांतरित करता है",
        "arrow_pays": "भुगतान करता है",
        "node_external": "बाहरी नेटवर्क",
        "step_bridge_out": "EAV7/टोकन को लॉक करता है और बाहरी गंतव्य दर्ज करता है",
        "step_relayer": "आउटगोइंग को देखता है और बाहरी चेन पर भुगतान करता है",
        "step_bridge_settle": "आउटफ्लो को ऑन-चेन भुगतान किया गया चिह्नित करता है (इडेम्पोटेंट)",
        "step_bridge_in": "बाहर से धन जारी करता है, sourceTxHash द्वारा डुप्लिकेट हटाकर"
      },
      "seguranca": {
        "badge_hybrid": "हाइब्रिड हस्ताक्षर",
        "title_hybrid": "डिज़ाइन से ही पोस्ट-क्वांटम",
        "verify_both": "सत्यापन के लिए दोनों आवश्यक",
        "hybrid_description": "हर वॉलेट, लेनदेन और ब्लॉक दोनों हस्ताक्षर रखता है — ECDSA (परिपक्वता) और ML-DSA-44 (FIPS 204, क्वांटम-प्रतिरोधी)। जालसाजी के लिए दोनों प्रिमिटिव को एक साथ तोड़ना पड़ेगा।",
        "badge_ai": "AI परत",
        "title_ai": "ऑन-चेन एस्क्रो के साथ ऑरेकल",
        "sentinel_title": "सुरक्षा सेंटिनल · 24घंटे",
        "sentinel_description": "एक प्रक्रिया नेटवर्क की लगातार निगरानी करती है — पुनर्गठन, विशाल ट्रांसफर, लेनदेन की बाढ़ और प्रोड्यूसर संकेंद्रण — और निष्कर्षों को सुरक्षा फ़ीड में दर्ज करती है।",
        "sentinel_cta": "माइनिंग में देखें"
      },
      "staking": {
        "tier_fee_title": "शून्य शुल्क",
        "tier_fee_desc": "100+ EAV7 लॉक करें और आपके लेनदेन पर शुल्क शून्य हो जाएगा — ऊर्जा (बैंडविड्थ) फ्रीज़ से उत्पन्न होती है और समय के साथ पुनर्जीवित होती है।",
        "tier_mine_title": "ब्लॉक माइन करें",
        "tier_mine_desc": "1,000+ EAV7 लॉक करें और DPoS चुनाव में प्रवेश करें। ब्लॉक बनाने पर आपको 16 EAV7 और ब्लॉक शुल्क पूरी तरह मिलते हैं।",
        "reward_title": "पुरस्कार और अनस्टेक",
        "reward_desc": "पुरस्कार पूरी तरह ब्लॉक प्रोड्यूसर को जाता है। अनस्टेक राशि को आपके बैलेंस में वापस करता है — नेटवर्क के अंतिम वैलिडेटर को खाली करने की अनुमति नहीं है।",
        "cta_lock": "EAV7 लॉक करें",
        "cta_mining": "माइनिंग देखें"
      }
    },
    "energyGauge": {
      "ariaLabel": "ऊर्जा {available} में से {max}",
      "title": "ऊर्जा",
      "description": "वह संसाधन जो लेनदेन की लागत को कवर करता है। समय के साथ पुनर्जीवित होता है और स्टेक में लॉक किए गए EAV7 के साथ बढ़ता है।"
    },
    "home_activityBars": {
      "ariaLabel": "प्रति ब्लॉक लेनदेन",
      "txsCount": "{n} लेनदेन"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "अवलोकन",
        "blocks": "ब्लॉक्स",
        "transactions": "लेन-देन",
        "validators": "वैलिडेटर्स",
        "tokens": "टोकन"
      },
      "cols": {
        "block": "ब्लॉक",
        "age": "आयु",
        "txs": "लेन-देन",
        "producer": "निर्माता",
        "reward": "इनाम",
        "hash": "हैश"
      },
      "sidebar": {
        "explore": "एक्सप्लोर करें",
        "network": "नेटवर्क"
      },
      "toolbar": {
        "filter": "फ़िल्टर करें",
        "sort": "क्रमबद्ध करें",
        "live": "लाइव"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "एक्सप्लोर करें",
      "title": "सब कुछ ऑन-चेन, वास्तविक समय में",
      "description": "ब्लॉक्स और लेनदेन अभी प्रवाहित हो रहे हैं। जांच के लिए किसी भी आइटम पर क्लिक करें।",
      "viewBlocks": "ब्लॉक्स देखें",
      "viewTxs": "लेनदेन देखें"
    },
    "home_heartbeat": {
      "label": "हार्टबीट",
      "blockAgoPrefix": "ब्लॉक",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} लेनदेन",
      "viewAll": "सभी देखें"
    },
    "home_hero": {
      "coin_alt": "EAV7 सिक्का",
      "title": "ऑन-चेन एक्सप्लोरर का नया युग",
      "subtitle": "हर 1 सेकंड में ब्लॉक, पोस्ट-क्वांटम सुरक्षा और एक नेटिव AI परत। ब्लॉक, लेनदेन, वैलिडेटर और पते वास्तविक समय में जांचें।",
      "search_placeholder": "ब्लॉक, लेनदेन या पता खोजें…",
      "search_button": "एक्सप्लोर करें",
      "stat_height": "ऊंचाई",
      "stat_block": "ब्लॉक",
      "stat_validators": "वैलिडेटर",
      "stat_mempool": "मेमपूल"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "EAV7 सिक्का",
        "titleBefore": "EAV7 ब्लॉकचेन, और",
        "titleHighlight": "उससे भी आगे",
        "subtitle": "1-सेकंड DPoS सर्वसम्मति, पोस्ट-क्वांटम सुरक्षा और एक नेटिव AI परत। ब्लॉक, लेनदेन और वैलिडेटर को रीयल-टाइम में एक्सप्लोर करें।",
        "exploreNetwork": "नेटवर्क एक्सप्लोर करें",
        "openWallet": "वॉलेट खोलें",
        "scrollAriaLabel": "पैनल पर स्क्रॉल करें"
      },
      "vitals": {
        "height": "ऊंचाई",
        "blockTime": "ब्लॉक",
        "validators": "वैलिडेटर"
      }
    },
    "home_inkBand": {
      "eyebrow": "इंटरैक्टिव",
      "title": "माउस घुमाकर देखें",
      "subtitle": "EAV7 नेटवर्क, ब्लॉक से परे",
      "mobileHint": "मोबाइल पर कलाकृति सीधे दिखाई देती है"
    },
    "home_latestTxs": {
      "title": "नवीनतम लेन-देन",
      "viewAll": "सभी देखें",
      "table": {
        "hash": "हैश",
        "type": "प्रकार",
        "fromTo": "से → तक",
        "value": "मूल्य"
      },
      "empty": "अभी तक कोई लेन-देन नहीं"
    },
    "home_moments": {
      "sectionEyebrow": "प्रोटोकॉल के भीतर",
      "sectionTitle": "एक L1 जो टिकाऊ बनाई गई है",
      "items": {
        "security": {
          "eyebrow": "सुरक्षा",
          "titlePrefix": "पोस्ट-क्वांटम युग के लिए",
          "titleHighlight": "तैयार",
          "desc": "हर वॉलेट, लेनदेन और ब्लॉक दो हस्ताक्षर रखता है — और सत्यापन दोनों की मांग करता है। जालसाजी करने के लिए दोनों प्रिमिटिव्स को एक साथ तोड़ना पड़ेगा।",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "SHA3-256 द्वारा व्युत्पन्न E7 पता"
        },
        "consensus": {
          "eyebrow": "सर्वसम्मति",
          "titlePrefix": "हर",
          "titleHighlight": "1 सेकंड में एक ब्लॉक",
          "desc": "स्टेक द्वारा चुने गए 27 तक वैलिडेटर्स के साथ निश्चयात्मक रोटेशन में DPoS सर्वसम्मति — Tron से 3 गुना तेज़, संरक्षित लाइवनेस के साथ।",
          "bullet1": "27 वैलिडेटर्स · स्लॉट के अनुसार राउंड-रॉबिन",
          "bullet2": "प्रति ब्लॉक 16 EAV7 इनाम"
        },
        "intelligence": {
          "eyebrow": "बुद्धिमत्ता",
          "titlePrefix": "एक",
          "titleHighlight": "नेटिव AI परत",
          "desc": "एस्क्रो के साथ ऑन-चेन ऑरेकल: AI कार्यों को प्रकाशित किया जाता है, नामित ऑरेकल द्वारा हल किया जाता है और सत्यापन योग्य तरीके से निपटाया जाता है — सब कुछ प्रोटोकॉल के भीतर।",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "परिणाम हैश ऑन-चेन दर्ज"
        },
        "assets": {
          "eyebrow": "संपत्ति",
          "titlePrefix": "टोकन",
          "titleHighlight": "EAV20",
          "titleSuffix": "और क्रॉस-चेन ब्रिज",
          "desc": "नेटिव टोकन (TRC20 के समकक्ष) बनाएं और स्थानांतरित करें, और एक सुरक्षित, आइडेम्पोटेंट लॉक-एंड-रिलीज़ मॉडल के माध्यम से EAV7 को अन्य नेटवर्क से जोड़ें।",
          "bullet1": "EAV20 मानक · create / transfer / approve",
          "bullet2": "TRON · ETH · BTC ब्रिज (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "रीयल टाइम",
      "title": "नेटवर्क की धड़कन",
      "subtitle": "हर सेकंड एक नया ब्लॉक। EAV7 नेटवर्क की धड़कन को रीयल टाइम में देखें।",
      "stats": {
        "blockHeight": "ब्लॉक ऊंचाई",
        "txLast30": "लेनदेन · पिछले 30 ब्लॉक",
        "mempool": "मेमपूल",
        "rewardPerBlock": "EAV7 / ब्लॉक"
      },
      "activity": {
        "title": "नेटवर्क गतिविधि",
        "txInLastBlocks": "पिछले {n} ब्लॉकों में लेनदेन"
      },
      "slots": {
        "title": "DPoS स्लॉट्स",
        "activeValidators": "सक्रिय वैलिडेटर",
        "supply": "आपूर्ति {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "कुल खाते"
        },
        "transactions": {
          "label": "कुल लेनदेन"
        },
        "volume": {
          "label": "स्थानांतरित वॉल्यूम"
        },
        "staked": {
          "label": "कुल स्टेक्ड"
        }
      },
      "ring": {
        "supplyLine1": "कुल आपूर्ति का",
        "supplyLine2": "स्टेक में लॉक्ड"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{max} में से {value}"
    },
    "home_walletCta": {
      "eyebrow": "अभी शुरू करें",
      "title": "अभी EAV7 नेटवर्क एक्सप्लोर करें",
      "description": "आपका वॉलेट ब्राउज़र में पोस्ट-क्वांटम सुरक्षा के साथ जनरेट और साइन किया जाता है — यह कभी भी आपकी डिवाइस से बाहर नहीं जाता। सीधे वेब से भेजें, स्टेक करें और माइन करें।",
      "createWallet": "वॉलेट बनाएं",
      "exploreNetwork": "नेटवर्क एक्सप्लोर करें"
    },
    "mining_live": {
      "badge_consensus": "DPoS · स्टेकिंग",
      "title": "माइनिंग",
      "live_badge": "लाइव",
      "subtitle": "EAV7 पर आप EAV7 को लॉक करके (स्टेक) माइन करते हैं — बिना हार्डवेयर, बिना ऊर्जा खर्च के",
      "stat_reward_block": "इनाम / ब्लॉक",
      "stat_blocks_day": "ब्लॉक / दिन",
      "stat_daily_emission": "दैनिक उत्सर्जन",
      "stat_already_mined": "पहले से माइन किया गया",
      "network_production": "नेटवर्क उत्पादन",
      "reward_per_block_caption": "प्रत्येक ब्लॉक (1s) पर इनाम",
      "annual_emission_caption": "अनुमानित वार्षिक उत्सर्जन",
      "next_block": "अगला ब्लॉक",
      "miners_label": "माइनर्स",
      "staked_label": "EAV7 लॉक किया गया",
      "block_time_label": "ब्लॉक समय",
      "ai_sentinel_badge": "AI सेंटिनल · 24 घंटे",
      "network_protected": "नेटवर्क सुरक्षित",
      "ai_monitoring_desc": "नेटिव AI द्वारा निरंतर निगरानी",
      "alerts_analyzed": "विश्लेषित अलर्ट",
      "active_oracles": "सक्रिय ऑरेकल",
      "pending_ai_tasks": "लंबित AI कार्य",
      "cta_title": "EAV7 माइन करना शुरू करें",
      "cta_description": "DPoS सर्वसम्मति का माइनर बनने और उत्पादित प्रत्येक ब्लॉक के लिए इनाम प्राप्त करने के लिए अपने वॉलेट में EAV7 लॉक करें। सब कुछ सेल्फ-कस्टोडियल, ब्राउज़र में पोस्ट-क्वांटम हस्ताक्षर के साथ।",
      "cta_lock_button": "EAV7 लॉक करें",
      "cta_view_validators": "वैलिडेटर देखें"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "खोजें",
      "dica": "ब्लॉक (संख्या) · लेन-देन (E7…) · पता (E7… या 0x…)"
    },
    "netStatus": {
      "onlineTitle": "EAV7 नेटवर्क ऑनलाइन · ऊँचाई {height}",
      "offlineTitle": "नोड ऑफ़लाइन",
      "connecting": "कनेक्ट हो रहा है…"
    },
    "page_address": {
      "metaTitle": "पता {addr}… · EAV7 Scan",
      "eyebrow": "पता",
      "title": "पता",
      "roleValidator": "वैलिडेटर",
      "roleOracle": "ऑरेकल",
      "roleAccount": "खाता",
      "balance": "बैलेंस",
      "staked": "स्टेक में",
      "nonce": "nonce",
      "feeExempt": "शून्य शुल्क",
      "available": "उपलब्ध",
      "max": "अधिकतम {n}",
      "tokensTitle": "EAV20 टोकन",
      "colToken": "टोकन",
      "colSymbol": "प्रतीक",
      "colBalance": "बैलेंस",
      "txsTitle": "लेनदेन",
      "colHash": "हैश",
      "colBlock": "ब्लॉक",
      "colType": "प्रकार",
      "colCounterparty": "प्रतिपक्ष",
      "colValue": "मूल्य",
      "colDate": "तारीख",
      "out": "आउटगोइंग",
      "in": "इनकमिंग",
      "noTxs": "इस पते के लिए कोई लेनदेन नहीं",
      "totalBalance": "कुल बैलेंस: {n}",
      "tabOverview": "अवलोकन",
      "tabTransfers": "हस्तांतरण",
      "tabInternal": "आंतरिक हस्तांतरण",
      "tabStaking": "स्टेकिंग और संसाधन",
      "tabContract": "अनुबंध",
      "tabPermissions": "अनुमतियाँ",
      "tabAnalysis": "विश्लेषण",
      "internalNote": "अनुबंध निष्पादन द्वारा स्थानांतरित मूल्य। यह हस्ताक्षरित लेनदेन नहीं है, इसलिए इसका अपना हैश नहीं होता।",
      "internalEmpty": "कोई आंतरिक हस्तांतरण नहीं",
      "colFrom": "से",
      "colTo": "को",
      "colTx": "लेनदेन",
      "stakingTitle": "स्टेक और संसाधन",
      "bandwidth": "बैंडविड्थ",
      "energy": "ऊर्जा",
      "delegatedOut": "दूसरों को सौंपा",
      "delegatedIn": "प्रत्यायोजन में प्राप्त",
      "unbondingTitle": "अनबॉन्डिंग",
      "matureIn": "{n} ब्लॉक बाद अनलॉक",
      "votesCastTitle": "डाले गए वोट",
      "votesReceived": "प्राप्त वोट",
      "vestingTitle": "वेस्टिंग",
      "permsNone": "एकल-कुंजी खाता — बिना बहु-हस्ताक्षर",
      "permsThreshold": "सीमा",
      "colWeight": "भार",
      "colKey": "कुंजी",
      "contractNone": "यह पता अनुबंध नहीं है",
      "contractCodeSize": "कोड आकार",
      "contractVerified": "सत्यापित",
      "contractUnverified": "असत्यापित",
      "sent": "भेजा",
      "received": "प्राप्त",
      "feesPaid": "भुगतान शुल्क",
      "txCount": "लेनदेन",
      "firstSeen": "पहली गतिविधि",
      "lastSeen": "अंतिम गतिविधि",
      "byType": "प्रकार अनुसार",
      "topCounterparties": "प्रमुख प्रतिपक्ष",
      "truncatedNote": "नमूना हाल के लेनदेन तक सीमित",
      "noData": "कोई डेटा नहीं",
      "nftsTitle": "NFT (EAV721)",
      "colNftCollection": "संग्रह",
      "colNftId": "टोकन",
      "namesTitle": "EAV-NS नाम",
      "colNsName": "नाम",
      "colNsTarget": "हल होता है",
      "votesLabel": "प्राप्त वोट",
      "commissionLabel": "कमीशन",
      "accountInfo": "खाता जानकारी",
      "accountType": "खाता प्रकार",
      "createdAt": "बनाया गया",
      "totalTxs": "कुल लेनदेन",
      "tabTokenTx": "टोकन हस्तांतरण",
      "tokenTxEmpty": "कोई टोकन हस्तांतरण नहीं",
      "roleContract": "अनुबंध",
      "roleMultisig": "बहु-हस्ताक्षर",
      "holdings": "धारिता",
      "colAsset": "संपत्ति",
      "assets": "संपत्तियाँ",
      "transfersRow": "हस्तांतरण",
      "votesRow": "वोट",
      "claimable": "दावा योग्य पुरस्कार",
      "tabApprovals": "अनुमोदन",
      "searchHoldings": "नाम, प्रतीक या पते से खोजें…",
      "noHoldings": "यहाँ कुछ नहीं",
      "colSpender": "अधिकृत",
      "colLimit": "सीमा",
      "more": "और देखें",
      "tabTokens": "टोकन",
      "tabTransactions": "लेनदेन",
      "colAge": "आयु",
      "colResult": "परिणाम",
      "resultOk": "सफल",
      "resultRevert": "वापस लिया",
      "summaryTx": "कुल {n} लेनदेन",
      "summaryTransfers": "कुल {n} हस्तांतरण",
      "summaryInternal": "कुल {n} आंतरिक हस्तांतरण",
      "filterAll": "सभी",
      "filterIn": "आवक",
      "filterOut": "जावक",
      "summaryTokenTx": "कुल {n} टोकन हस्तांतरण",
      "colParentHash": "मूल हैश",
      "colResourceAmount": "संसाधन मात्रा",
      "colStakedAmount": "स्टेक किया EAV7",
      "colUpdatedAt": "अद्यतन",
      "stakeNote": "EAV7 में एक ही स्टेक ऊर्जा और बैंडविड्थ दोनों देता है — TRON की तरह संसाधन चुनना नहीं होता।",
      "permsOperations": "संचालन",
      "thisAccount": "यह खाता",
      "summaryContracts": "कुल {n} अनुबंध",
      "permsNote": "EAV7 में संचालन समूह किसी भी बहु-हस्ताक्षर खाते पर लागू होता है — TRON की तरह प्रति-अनुमति दायरा नहीं है।",
      "permsDefault": "डिफ़ॉल्ट",
      "permsDefaultNote": "कोई बहु-हस्ताक्षर कॉन्फ़िगर नहीं। यह खाते का प्रभावी प्राधिकरण है: एक कुंजी, एक हस्ताक्षर।"
    },
    "page_block": {
      "metaTitle": "ब्लॉक #{height} · EAV7 Scan",
      "eyebrow": "ब्लॉक",
      "title": "ब्लॉक #{height}",
      "sub": "{ago} पहले",
      "kv": {
        "height": "ऊँचाई",
        "date": "तारीख़",
        "producer": "निर्माता",
        "previousHash": "पिछला हैश",
        "merkleRoot": "मर्कल रूट (लेनदेन)",
        "txCount": "लेनदेन",
        "protocol": "प्रोटोकॉल",
        "scheme": "योजना"
      },
      "txSectionTitle": "ब्लॉक के लेनदेन",
      "table": {
        "hash": "हैश",
        "type": "प्रकार",
        "from": "से",
        "to": "प्रति",
        "value": "राशि",
        "fee": "शुल्क"
      },
      "emptyBlock": "खाली ब्लॉक"
    },
    "page_docs": {
      "metaTitleFallback": "दस्तावेज़ीकरण · EAV7 Scan",
      "breadcrumb": "दस्तावेज़ीकरण",
      "terminal": "टर्मिनल",
      "onThisPage": "इस पेज पर"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "माइनिंग · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "यह पेज EAV7 चेन पर मौजूद नहीं है।",
      "backLink": "← होम पर वापस जाएं"
    },
    "page_search": {
      "metaTitle": "खोज · EAV7 Scan",
      "title": "कुछ नहीं मिला",
      "notRecognizedPrefix": "हमने",
      "notRecognizedSuffix": "को ब्लॉक, लेन-देन या EAV7 पते के रूप में पहचान नहीं पाया।",
      "retryPlaceholder": "फिर से कोशिश करें…",
      "whatCanSearch": "आप क्या खोज सकते हैं",
      "blockLabel": "ब्लॉक",
      "blockDesc": "ऊंचाई संख्या, उदा.",
      "txLabel": "लेन-देन",
      "txDesc": "हैश",
      "txChars": "(64 अक्षर)",
      "addressLabel": "पता",
      "addressLen34": "(34) या",
      "or": "या",
      "evmLabel": "(EAVM)",
      "backHome": "← होम पर वापस जाएं"
    },
    "page_token": {
      "eyebrow": "EAV20 टोकन",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "टोकन · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "मानक",
      "mintable": "अतिरिक्त जारी संभव",
      "fixedSupply": "निश्चित आपूर्ति",
      "paused": "रोका गया",
      "tabTransfers": "स्थानांतरण",
      "tabHolders": "धारक",
      "tabAnalysis": "विश्लेषण",
      "totalSupply": "कुल आपूर्ति",
      "holders": "धारक",
      "decimals": "दशमलव स्थान",
      "status": "स्थिति",
      "statusActive": "सक्रिय",
      "statusPaused": "रोका गया",
      "createdAt": "निर्मित",
      "contract": "अनुबंध",
      "creator": "निर्माता",
      "owner": "प्रशासक",
      "mintableLabel": "और जारी कर सकता है",
      "yes": "हाँ",
      "no": "नहीं",
      "summaryTransfers": "कुल {n} स्थानांतरण",
      "summaryHolders": "कुल {n} धारक — शीर्ष {shown} दिखाए जा रहे हैं",
      "colHash": "हैश",
      "colBlock": "ब्लॉक",
      "colAge": "आयु",
      "colFrom": "से",
      "colTo": "को",
      "colAmount": "राशि ({symbol})",
      "colRank": "#",
      "colAddress": "पता",
      "colBalance": "शेष ({symbol})",
      "colShare": "हिस्सा",
      "blacklisted": "अवरुद्ध",
      "noTransfers": "कोई स्थानांतरण नहीं मिला।",
      "noHolders": "कोई धारक नहीं मिला।",
      "top1": "सबसे बड़ा धारक",
      "top10": "शीर्ष 10",
      "top50": "शीर्ष 50",
      "concentrationTitle": "आपूर्ति संकेंद्रण",
      "concentrationNote": "कुल आपूर्ति का कितना हिस्सा सबसे बड़े वॉलेट में है। कुछ ही हाथों में बड़ी आपूर्ति का बाज़ार जोखिम व्यापक रूप से वितरित आपूर्ति से अलग होता है — इसीलिए वितरण कुल संख्या से अधिक मायने रखता है।",
      "largestHolder": "सबसे बड़ा धारक:",
      "overviewTitle": "अवलोकन",
      "basicInfoTitle": "अनुबंध जानकारी",
      "activityTitle": "वितरण",
      "largestHolderShort": "सबसे बड़ा धारक",
      "tabContract": "अनुबंध",
      "nativeTitle": "प्रोटोकॉल-मूल टोकन",
      "nativeBadge": "कोई मनमाना कोड नहीं",
      "nativeNote": "यह टोकन स्मार्ट अनुबंध नहीं है: इसे प्रोटोकॉल स्वयं लागू करता है। सत्यापित करने के लिए न Solidity है, न कंपाइलर, न बाइटकोड — और न ही कोई छिपा हुआ तर्क जिसे किसी ने लिखा हो। हर EAV20 टोकन का व्यवहार एक समान है और केवल नेटवर्क हार्ड फ़ोर्क से बदलता है।",
      "implementation": "कार्यान्वयन",
      "implementationValue": "सर्वसम्मति-मूल (EAV20 मानक)",
      "sourceOfTruth": "प्रोटोकॉल स्रोत",
      "powersTitle": "प्रशासक क्या कर सकता है",
      "powersNote": "किसी EVM एक्सप्लोरर में यह जानने के लिए आप स्रोत कोड पढ़ते। यहाँ ये स्थिति फ़ील्ड हैं, इसलिए हम सीधे सूचीबद्ध करते हैं। किसी टोकन पर भरोसा करने से पहले यही वास्तव में मायने रखता है।",
      "powerMint": "और इकाइयाँ जारी करना",
      "powerMintNote": "कुल आपूर्ति बढ़ाता है और मौजूदा धारकों को कमज़ोर करता है।",
      "powerPause": "स्थानांतरण रोकना",
      "powerPauseNote": "टोकन की सारी आवाजाही एक साथ रोक देता है।",
      "powerBlacklist": "पते अवरुद्ध करना",
      "powerBlacklistNote": "किसी विशेष पते को भेजने या पाने से रोकता है।",
      "powerFreeze": "शेष जमा करना",
      "powerFreezeNote": "किसी पते के शेष का हिस्सा एक तिथि तक बंद कर देता है।",
      "powerYes": "कर सकता है",
      "powerNo": "नहीं कर सकता",
      "powerActiveNow": "अभी सक्रिय",
      "adminIs": "प्रशासक:",
      "restrictionsTitle": "लागू प्रतिबंध",
      "frozenUntil": "{when} तक"
    },
    "page_tx": {
      "metaTitle": "लेनदेन {id}… · EAV7 Scan",
      "eyebrow": "लेनदेन",
      "title": "लेनदेन",
      "status": "स्थिति",
      "type": "प्रकार",
      "block": "ब्लॉक",
      "from": "से",
      "to": "प्रति",
      "value": "मूल्य",
      "fee": "शुल्क",
      "nonce": "Nonce",
      "date": "तारीख़",
      "scheme": "योजना",
      "eavmLayer": "EAVM परत (MetaMask)",
      "energy": "ऊर्जा",
      "energyUnit": "ऊर्जा"
    },
    "page_txs": {
      "metaTitle": "लेनदेन · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "EAV20 मानक",
        "title": "टोकन",
        "subtitle": "eav20 प्रोटोकॉल की मूल संपत्तियाँ — Tron के TRC20 के समकक्ष"
      },
      "empty": {
        "title": "अभी तक कोई टोकन नहीं बनाया गया",
        "description": "टोकन नेटवर्क पर बनाए जाते ही यहाँ दिखाई देते हैं, इसके माध्यम से"
      },
      "stats": {
        "tokens": "EAV20 टोकन",
        "holders": "धारक (कुल)",
        "supply": "संयुक्त आपूर्ति",
        "standard": "मानक"
      },
      "card": {
        "supply": "आपूर्ति",
        "holders": "धारक",
        "share": "हिस्सेदारी",
        "creator": "निर्माता"
      }
    },
    "txs_live": {
      "chainLabel": "eav20 चेन",
      "title": "लेन-देन",
      "live": "लाइव",
      "subtitleLive": "नवीनतम पहले · मूल्य EAV7 में",
      "subtitleOlder": "पुराने लेन-देन · मूल्य EAV7 में",
      "searchPlaceholder": "tx, ब्लॉक या पता खोजें…",
      "cols": {
        "hash": "हैश",
        "block": "ब्लॉक",
        "type": "प्रकार",
        "from": "से",
        "to": "प्रति",
        "value": "मूल्य",
        "age": "आयु"
      },
      "stats": {
        "totalTx": "कुल लेन-देन",
        "mempool": "मेमपूल में",
        "volume": "वॉल्यूम (EAV7)",
        "avgFee": "औसत शुल्क"
      },
      "table": {
        "latest": "नवीनतम लेन-देन",
        "older": "पिछले लेन-देन",
        "updating": "अपडेट हो रहा है",
        "empty": "कोई लेन-देन नहीं मिला",
        "count": "{n} लेन-देन",
        "loadMore": "पुराने लोड करें →",
        "genesis": "चेन की शुरुआत"
      }
    },
    "ui_copy": {
      "default_value": "मान",
      "aria_label": "{label} कॉपी करें",
      "copied": "कॉपी हो गया ✓",
      "copy_label": "{label} कॉपी करें",
      "copy": "कॉपी करें"
    },
    "ui_explorerSearch": {
      "placeholder": "ब्लॉक, टीएक्स या पता खोजें…",
      "searchButton": "खोजें"
    },
    "validators_live": {
      "unavailable": "नोड उपलब्ध नहीं है",
      "header": {
        "eyebrow": "DPoS सर्वसम्मति",
        "title": "वैलिडेटर्स",
        "live": "लाइव",
        "subtitle": "{max} स्लॉट में से {active} सक्रिय · न्यूनतम स्टेक {min} EAV7 · हर ब्लॉक पर रोटेशन"
      },
      "producer": {
        "label": "वर्तमान स्लॉट का निर्माता",
        "producingBlock": "ब्लॉक बना रहा है"
      },
      "slot": {
        "label": "स्लॉट · {n}s",
        "staked": "{n} EAV7 स्टेक किया गया"
      },
      "rotation": {
        "label": "उत्पादन रोटेशन"
      },
      "stats": {
        "activeValidators": "सक्रिय वैलिडेटर्स",
        "rewardPerBlock": "इनाम / ब्लॉक",
        "totalStaked": "कुल स्टेक",
        "peers": "नेटवर्क पीयर्स"
      },
      "ranking": {
        "title": "सक्रिय समूह",
        "sortedBy": "स्टेक के अनुसार क्रमबद्ध",
        "producing": "उत्पादन जारी",
        "active": "सक्रिय",
        "stakedCaption": "EAV7 स्टेक किया गया"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "सुरक्षित"
      },
      "role": {
        "validator": "वैलिडेटर",
        "oracle": "ओरेकल",
        "account": "EAV7 खाता"
      },
      "lock": {
        "button": "लॉक करें"
      },
      "balance": {
        "label": "उपलब्ध शेष"
      },
      "tier": {
        "validator": "वैलिडेटर",
        "fee_zero": "शून्य शुल्क",
        "standard": "मानक"
      },
      "actions": {
        "send": "भेजें",
        "receive": "प्राप्त करें",
        "stake": "स्टेक"
      },
      "stats": {
        "staked": "स्टेक में",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "शुल्क",
        "fee_zero": "शून्य",
        "fee_standard": "मानक"
      },
      "tier_progress": {
        "label": "स्तर की प्रगति",
        "remaining_prefix": "शेष",
        "remaining_suffix": "{tier} स्तर तक पहुँचने के लिए"
      },
      "receive": {
        "title": "EAV7 प्राप्त करें",
        "description_before": "अपना पता साझा करें",
        "description_after": "— नेटवर्क इसे स्वचालित रूप से आपके नेटिव E7 से मैप कर देता है।",
        "close": "बंद करें"
      },
      "activity": {
        "title": "हाल की गतिविधि",
        "sent": "भेजा गया",
        "received": "प्राप्त हुआ"
      },
      "addresses": {
        "hint": "प्राप्त करने के लिए इस 0x का उपयोग करें (EAVM/MetaMask मानक)"
      },
      "tokens": {
        "title": "EAV20 टोकन"
      },
      "footer": {
        "quantum": "पोस्ट-क्वांटम · secp256k1 + ML-DSA-44",
        "logout": "साइन आउट / बदलें"
      },
      "wipe": {
        "title": "क्या यह वॉलेट हटाएँ?",
        "description_before": "एन्क्रिप्टेड वॉलेट को",
        "description_bold": "इस ब्राउज़र से",
        "description_after": "हटा दिया जाएगा। आप इसे केवल प्राइवेट की बैकअप से पुनर्स्थापित कर सकते हैं — पासवर्ड रिकवरी संभव नहीं है।",
        "warning_before": "हटाने से पहले पुष्टि करें कि आपके पास",
        "warning_bold": "की बैकअप",
        "warning_after": "है।",
        "download_backup": "बैकअप डाउनलोड करें (.json)",
        "cancel": "रद्द करें",
        "confirm": "वॉलेट हटाएँ"
      }
    },
    "wallet_addNet": {
      "title": "MetaMask / Trust में उपयोग करें",
      "description": "अपने EVM वॉलेट में EAV7 नेटवर्क (चेन 72020) जोड़ें।",
      "adding": "जोड़ा जा रहा है…",
      "added": "✓ जोड़ी गई",
      "addButton": "नेटवर्क जोड़ें",
      "noWallet": "इस ब्राउज़र में MetaMask नहीं मिला।",
      "error": "नेटवर्क जोड़ा नहीं जा सका।"
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "केवल आपका नियंत्रण",
        "on_device_title": "डिवाइस पर",
        "on_device_desc": "कुंजी कभी बाहर नहीं जाती",
        "quantum_title": "क्वांटम-सुरक्षित",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "बैकअप",
        "password": "पासवर्ड",
        "ready": "तैयार"
      },
      "unlock": {
        "title": "वापसी पर स्वागत है",
        "subtitle": "इस ब्राउज़र में एक एन्क्रिप्टेड वॉलेट मौजूद है। अनलॉक करने के लिए पासवर्ड डालें।",
        "password_placeholder": "पासवर्ड",
        "error_wrong_password": "गलत पासवर्ड",
        "unlocking": "अनलॉक हो रहा है…",
        "unlock_button": "वॉलेट अनलॉक करें",
        "wipe_confirm": "इस ब्राउज़र से वॉलेट मिटाएं? सुनिश्चित करें कि आपके पास कुंजी का बैकअप है!",
        "wipe_button": "मिटाएं और फिर से शुरू करें"
      },
      "choose": {
        "title": "आपका EAV7 वॉलेट",
        "subtitle": "एक self-custodial वॉलेट: आप अपनी कुंजियों के एकमात्र मालिक हैं। सेकंडों में शुरू करें।",
        "create_title": "नया वॉलेट बनाएं",
        "create_desc": "इस डिवाइस पर एक नई कुंजी बनाता है।",
        "import_title": "कुंजी आयात करें",
        "import_desc": "पहले से निजी कुंजी है? यहां पुनर्स्थापित करें।"
      },
      "import": {
        "title": "वॉलेट आयात करें",
        "subtitle": "निजी कुंजी पेस्ट करें और इसे इस ब्राउज़र में एन्क्रिप्ट करने के लिए एक पासवर्ड चुनें।",
        "label": "निजी कुंजी (0x + 64 hex)",
        "importing": "आयात हो रहा है…",
        "button": "आयात करें",
        "back": "वापस",
        "error_invalid_key": "अमान्य निजी कुंजी (अपेक्षित 0x + 64 hex)"
      },
      "create": {
        "title": "अपनी कुंजी का बैकअप लें",
        "subtitle": "पासवर्ड रिकवरी संभव नहीं है। जिसके पास निजी कुंजी है वही धन को नियंत्रित करता है — जारी रखने से पहले इसे सहेजें।",
        "warning_prefix": "यह कुंजी ",
        "warning_bold": "ही आपके धन तक पहुंचने का एकमात्र तरीका है",
        "warning_suffix": "। इसे ऑफ़लाइन सहेजें — इसे कभी किसी के साथ साझा न करें।",
        "address_label": "E7 पता",
        "private_key_label": "निजी कुंजी",
        "reveal": "दिखाएं",
        "hide": "छिपाएं",
        "download_backup": "⭳ बैकअप डाउनलोड करें (.json)",
        "confirm_saved": "मैंने अपनी कुंजी सुरक्षित स्थान पर सहेज ली है",
        "creating": "बनाया जा रहा है…",
        "create_button": "वॉलेट बनाएं",
        "confirm_hint": "पुष्टि करें कि आपने कुंजी सहेज ली है",
        "back": "वापस"
      },
      "errors": {
        "password_min": "पासवर्ड में कम से कम 6 अक्षर होने चाहिए",
        "password_mismatch": "पासवर्ड मेल नहीं खाते",
        "save_error": "सहेजने में त्रुटि"
      },
      "password": {
        "label": "एन्क्रिप्ट करने के लिए पासवर्ड (न्यूनतम 6 अक्षर)",
        "placeholder": "पासवर्ड",
        "confirm_placeholder": "पासवर्ड की पुष्टि करें",
        "mismatch": "पासवर्ड मेल नहीं खाते",
        "strength": {
          "very_weak": "बहुत कमज़ोर",
          "weak": "कमज़ोर",
          "fair": "ठीक-ठाक",
          "good": "अच्छा",
          "strong": "मज़बूत"
        }
      }
    },
    "wallet_send": {
      "title": "EAV7 भेजें",
      "steps": {
        "destination": "गंतव्य",
        "value": "राशि",
        "review": "समीक्षा"
      },
      "recipient": {
        "label": "गंतव्य (0x… EAVM/MetaMask)",
        "paste": "पेस्ट करें",
        "valid": "✓ पता मान्य है",
        "invalid": "अमान्य 0x पता"
      },
      "errors": {
        "needEvmAddress": "गंतव्य का 0x पता दर्ज करें (वेब वॉलेट EAVM मॉडल में हस्ताक्षर करता है)",
        "invalidAddress": "गंतव्य एक 0x पता होना चाहिए (EAVM/MetaMask)",
        "needPositiveAmount": "एक धनात्मक राशि दर्ज करें",
        "insufficientBalance": "अपर्याप्त शेष (शुल्क का ध्यान रखें)",
        "invalidAmount": "अमान्य राशि",
        "sendFailed": "भेजने में विफल"
      },
      "continue": "जारी रखें",
      "cancel": "रद्द करें",
      "available": "उपलब्ध: {amount} EAV7",
      "percent": {
        "max": "अधिकतम"
      },
      "back": "वापस",
      "sendingLabel": "भेजा जा रहा है",
      "sendingTo": "{addr} को",
      "networkFee": "नेटवर्क शुल्क",
      "balanceAfter": "बाद का शेष",
      "quantumNote": "इस डिवाइस पर हस्ताक्षरित · नेटवर्क की पोस्ट-क्वांटम सुरक्षा",
      "confirmAndSign": "पुष्टि करें और हस्ताक्षर करें",
      "signing": "हस्ताक्षर हो रहा है…",
      "transactionSent": {
        "title": "लेनदेन भेजा गया",
        "subtitle": "अगले ब्लॉक में पुष्टि होगी (~1 सेकंड)।"
      },
      "close": "बंद करें"
    },
    "wallet_stake": {
      "title": "स्टेक",
      "subtitle": "≥ 100 EAV7 पर शुल्क माफ · ≥ 1,000 पर आप माइनर बन जाते हैं (16 EAV7/उत्पन्न ब्लॉक)。",
      "tierZeroFee": {
        "label": "शून्य शुल्क",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "वैलिडेटर",
        "sub": "≥ 1,000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "वर्तमान में स्टेक में:",
      "warnValidator": "इससे आपका स्टेक 1,000 से नीचे चला जाएगा — आप वैलिडेटर का दर्जा खो देंगे।",
      "warnFeeReset": "इससे आपका स्टेक 100 से नीचे चला जाएगा — आपके लेन-देन पर फिर से शुल्क लगेगा।",
      "warnConfirm": "समझ गया, फिर भी हटाएं →",
      "errInvalidAmount": "एक सकारात्मक राशि दर्ज करें",
      "errInvalidValue": "अमान्य राशि",
      "errFailedOp": "प्रक्रिया विफल रही",
      "sentTitle": "प्रक्रिया भेज दी गई",
      "close": "बंद करें",
      "stakeBtn": "स्टेक करें",
      "removeBtn": "हटाएं"
    }
  },
  "ko": {
    "blocks_live": {
      "networkLabel": "eav20 체인",
      "title": "블록",
      "live": "실시간",
      "blockTimeInfo": "{n}초마다 새 블록 · DPoS 합의",
      "searchPlaceholder": "높이 또는 해시로 블록 검색…",
      "stats": {
        "height": "현재 높이",
        "blockTime": "블록 시간",
        "avgTx": "블록당 Txs (평균)",
        "activeProducers": "활성 생산자"
      },
      "latestBlocks": "최신 블록",
      "updating": "업데이트 중",
      "columns": {
        "block": "블록",
        "age": "경과 시간",
        "txs": "Txs",
        "producer": "생산자",
        "reward": "보상",
        "hash": "해시"
      }
    },
    "comingSoon": {
      "badge": "공사 중 · 스프린트 4",
      "backToExplorer": "← 익스플로러로 돌아가기"
    },
    "docs_api": {
      "badge": "공개 API",
      "title": "노드에서 직접 네트워크 조회",
      "baseUrl": "기본 URL",
      "tags": {
        "cors": "CORS 활성화됨",
        "units": "e7 단위 값",
        "noAuth": "인증 없음"
      },
      "groups": {
        "read": "읽기",
        "write": "쓰기"
      },
      "endpoints": {
        "status": "네트워크 상태: 높이, 검증자, 멤풀, 블록 보상",
        "blocks": "최근 N개 블록",
        "blockByHeight": "높이 또는 해시로 블록 조회",
        "txs": "최근 거래, 페이지네이션 적용",
        "tx": "id로 거래 조회",
        "address": "잔액, 스테이크, nonce, 역할, 토큰 및 에너지",
        "tokens": "EAV20 토큰 목록 (상세는 /tokens/:id)",
        "validators": "활성 DPoS 세트 + 슬롯 생산자",
        "sendTx": "서명된 네이티브 거래 전송 (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "EAVM 계층을 통해 거래 전송 (JSON-RPC 호환)"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "사용자 지정 네트워크"
      },
      "title": "지갑에서 EAV7 사용하기",
      "description": "EAV7는 범용 지갑이 이해하는 JSON-RPC 방언을 사용합니다 — 클릭 한 번으로 네트워크를 추가하세요.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "모든 EVM 지갑"
      },
      "params": {
        "networkName": "네트워크 이름",
        "rpcUrl": "RPC URL",
        "chainId": "체인 ID",
        "symbol": "심볼",
        "explorer": "탐색기",
        "decimals": "소수 자릿수"
      },
      "button": {
        "adding": "추가 중…",
        "addToMetamask": "MetaMask에 추가"
      },
      "status": {
        "added": "네트워크가 추가되었습니다!",
        "noWallet": "MetaMask가 감지되지 않았습니다 — 옆의 데이터를 복사하세요."
      },
      "error": {
        "addFailed": "네트워크를 추가할 수 없습니다"
      },
      "mapping": {
        "badge": "동일 계정",
        "title": "두 개의 정체성, 하나의 계정",
        "labelEavm": "EAVM",
        "labelNative": "네이티브",
        "desc1": "MetaMask는",
        "desc2": "를 표시합니다. 온체인에서는 잔액이 해당",
        "desc3": "에 존재합니다. 동일한 계정입니다."
      },
      "steps": {
        "step1": "EAV7 네트워크를 추가하려면 클릭하세요",
        "step2": "지갑에 계정이 0x… 형태로 표시됩니다",
        "step3": "온체인 잔액은 해당 E7에 존재합니다"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "블록 시간",
        "stat_validators_value": "최대 27개",
        "stat_validators_label": "DPoS 검증자",
        "stat_supply_value": "1,000억",
        "stat_supply_label": "EAV7 공급량",
        "stat_reward_label": "블록당 EAV7",
        "stat_quantum_value": "하이브리드",
        "stat_quantum_label": "포스트 퀀텀",
        "pillars_title": "프로토콜의 기둥",
        "pillar_consensus": "DPoS 합의",
        "pillar_token_standard": "EAV20 표준",
        "pillar_bridge": "크로스체인 브리지",
        "pillar_security": "보안 & AI",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "EAV20 표준",
        "title": "가상 머신 없는 네이티브 토큰",
        "description": "TRC20과 동등: 토큰은 체인 상태에 직접 존재하며 서명된 트랜잭션으로 이동합니다 — 빠르고, 저렴하며, 검증 가능합니다.",
        "cta": "네트워크 토큰 보기"
      },
      "consenso": {
        "badge": "DPoS 합의",
        "title": "매초 새로운 블록",
        "description": "검증자는 순환 방식으로 교대합니다: 1초 슬롯마다 예정된 생산자가 다음 블록에 서명합니다. 그라인딩도, 대기도 없습니다.",
        "slot_now": "현재 슬롯",
        "slot_offset": "슬롯 +{n}",
        "fact_election_label": "선출",
        "fact_election_value": "스테이크 기준 상위 27명(≥ 1,000 EAV7)",
        "fact_production_label": "생성",
        "fact_production_value": "validators[slot % N] · 라운드로빈",
        "fact_fork_choice_label": "포크 선택",
        "fact_fork_choice_value": "가장 긴 유효 체인",
        "cta": "실시간 검증자 보기"
      },
      "ponte": {
        "title": "브리지가 네트워크 간 가치를 이동시키는 방법",
        "arrow_pays": "지급",
        "node_external": "외부 네트워크",
        "step_bridge_out": "EAV7/토큰을 잠그고 외부 목적지를 기록",
        "step_relayer": "출금을 감시하고 외부 체인에서 지급",
        "step_bridge_settle": "출금을 온체인에서 지급 완료로 표시(멱등)",
        "step_bridge_in": "외부에서 온 자금을 해제, sourceTxHash로 중복 제거"
      },
      "seguranca": {
        "badge_hybrid": "하이브리드 서명",
        "title_hybrid": "설계부터 포스트 퀀텀",
        "verify_both": "검증에는 둘 다 필요",
        "hybrid_description": "모든 지갑, 트랜잭션, 블록은 두 서명을 모두 포함합니다 — ECDSA(성숙도)와 ML-DSA-44(FIPS 204, 양자 저항). 위조하려면 두 프리미티브를 동시에 깨야 합니다.",
        "badge_ai": "AI 레이어",
        "title_ai": "온체인 에스크로가 있는 오라클",
        "sentinel_title": "보안 센티널 · 24시간",
        "sentinel_description": "프로세스가 네트워크를 지속적으로 모니터링합니다 — 재구성, 대규모 전송, 트랜잭션 급증, 생산자 집중 — 그리고 결과를 보안 피드에 기록합니다.",
        "sentinel_cta": "마이닝에서 보기"
      },
      "staking": {
        "tier_fee_title": "수수료 제로",
        "tier_fee_desc": "100+ EAV7을 잠그면 거래 수수료가 제로가 됩니다 — 에너지(대역폭)는 프리즈로 생성되며 시간이 지나면 재생됩니다.",
        "tier_mine_title": "블록 채굴",
        "tier_mine_desc": "1,000+ EAV7을 잠그고 DPoS 선출에 참여하세요. 블록을 생성하면 16 EAV7과 블록 수수료를 전액 받습니다.",
        "reward_title": "보상 및 언스테이크",
        "reward_desc": "보상은 전액 블록 생산자에게 돌아갑니다. 언스테이크는 금액을 잔액으로 되돌립니다 — 네트워크의 마지막 검증자를 비우는 것은 허용되지 않습니다.",
        "cta_lock": "EAV7 잠그기",
        "cta_mining": "마이닝 보기"
      }
    },
    "energyGauge": {
      "ariaLabel": "에너지 {available} / {max}",
      "title": "에너지",
      "description": "거래 비용을 충당하는 자원입니다. 시간이 지나면 재생되며 스테이킹된 EAV7에 따라 증가합니다."
    },
    "home_activityBars": {
      "ariaLabel": "블록당 거래 수",
      "txsCount": "{n}건의 거래"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "개요",
        "blocks": "블록",
        "transactions": "트랜잭션",
        "validators": "검증자",
        "tokens": "토큰"
      },
      "cols": {
        "block": "블록",
        "age": "경과 시간",
        "txs": "Txs",
        "producer": "생성자",
        "reward": "보상",
        "hash": "해시"
      },
      "sidebar": {
        "explore": "탐색",
        "network": "네트워크"
      },
      "toolbar": {
        "filter": "필터",
        "sort": "정렬",
        "live": "실시간"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "탐색",
      "title": "온체인의 모든 것, 실시간으로",
      "description": "블록과 트랜잭션이 지금 이 순간에도 흐르고 있습니다. 항목을 클릭해 자세히 살펴보세요.",
      "viewBlocks": "블록 보기",
      "viewTxs": "트랜잭션 보기"
    },
    "home_heartbeat": {
      "label": "하트비트",
      "blockAgoPrefix": "블록",
      "noData": "—",
      "blockTitle": "#{height} · {txCount}건 거래",
      "viewAll": "전체 보기"
    },
    "home_hero": {
      "coin_alt": "EAV7 코인",
      "title": "온체인 익스플로러의 새로운 시대",
      "subtitle": "1초마다 생성되는 블록, 양자 내성 보안, 네이티브 AI 레이어. 블록, 트랜잭션, 검증인, 주소를 실시간으로 조사하세요.",
      "search_placeholder": "블록, 트랜잭션 또는 주소 검색…",
      "search_button": "탐색하기",
      "stat_height": "높이",
      "stat_block": "블록",
      "stat_validators": "검증인",
      "stat_mempool": "멤풀"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "EAV7 코인",
        "titleBefore": "EAV7 블록체인, 그리고",
        "titleHighlight": "그 너머",
        "subtitle": "1초 DPoS 합의, 양자 내성 보안, 네이티브 AI 레이어. 블록, 트랜잭션, 검증자를 실시간으로 탐색하세요.",
        "exploreNetwork": "네트워크 탐색",
        "openWallet": "지갑 열기",
        "scrollAriaLabel": "패널로 스크롤"
      },
      "vitals": {
        "height": "높이",
        "blockTime": "블록",
        "validators": "검증자"
      }
    },
    "home_inkBand": {
      "eyebrow": "인터랙티브",
      "title": "마우스를 올려 확인하세요",
      "subtitle": "EAV7 네트워크, 블록 그 너머",
      "mobileHint": "모바일에서는 아트가 바로 나타납니다"
    },
    "home_latestTxs": {
      "title": "최신 거래",
      "viewAll": "전체 보기",
      "table": {
        "hash": "해시",
        "type": "유형",
        "fromTo": "보낸 주소 → 받는 주소",
        "value": "금액"
      },
      "empty": "아직 거래가 없습니다"
    },
    "home_moments": {
      "sectionEyebrow": "프로토콜 내부",
      "sectionTitle": "오래 지속되도록 만들어진 L1",
      "items": {
        "security": {
          "eyebrow": "보안",
          "titlePrefix": "준비된",
          "titleHighlight": "포스트 퀀텀 시대",
          "desc": "모든 지갑, 트랜잭션, 블록은 두 개의 서명을 가지며 — 검증은 둘 다를 요구합니다. 위조하려면 두 프리미티브를 동시에 깨야 합니다.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "SHA3-256으로 파생된 E7 주소"
        },
        "consensus": {
          "eyebrow": "합의",
          "titlePrefix": "매",
          "titleHighlight": "1초마다 블록 생성",
          "desc": "지분에 따라 선출된 최대 27명의 검증자가 결정론적으로 순환하는 DPoS 합의 — Tron보다 3배 빠르며 라이브니스가 보호됩니다.",
          "bullet1": "27명의 검증자 · 슬롯별 라운드 로빈",
          "bullet2": "블록당 16 EAV7 보상"
        },
        "intelligence": {
          "eyebrow": "인텔리전스",
          "titlePrefix": "네이티브",
          "titleHighlight": "AI 레이어",
          "desc": "에스크로가 있는 온체인 오라클: AI 작업이 게시되고, 지정된 오라클에 의해 해결되며, 검증 가능한 방식으로 정산됩니다 — 모두 프로토콜 내에서.",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "결과 해시가 온체인에 기록됨"
        },
        "assets": {
          "eyebrow": "자산",
          "titlePrefix": "토큰",
          "titleHighlight": "EAV20",
          "titleSuffix": "및 크로스체인 브리지",
          "desc": "네이티브 토큰(TRC20 동등)을 생성하고 이동하며, 안전하고 멱등적인 lock-and-release 모델을 통해 EAV7을 다른 네트워크에 연결합니다.",
          "bullet1": "EAV20 표준 · create / transfer / approve",
          "bullet2": "TRON · ETH · BTC 브리지 (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "실시간",
      "title": "네트워크의 맥박",
      "subtitle": "매초 새로운 블록이 생성됩니다. EAV7 네트워크의 실시간 맥박을 확인하세요.",
      "stats": {
        "blockHeight": "블록 높이",
        "txLast30": "거래 수 · 최근 30개 블록",
        "mempool": "멤풀",
        "rewardPerBlock": "EAV7 / 블록"
      },
      "activity": {
        "title": "네트워크 활동",
        "txInLastBlocks": "최근 {n}개 블록의 거래 수"
      },
      "slots": {
        "title": "DPoS 슬롯",
        "activeValidators": "활성 검증인",
        "supply": "공급량 {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "총 계정 수"
        },
        "transactions": {
          "label": "총 거래 수"
        },
        "volume": {
          "label": "전송된 거래량"
        },
        "staked": {
          "label": "총 스테이킹량"
        }
      },
      "ring": {
        "supplyLine1": "총 공급량 중",
        "supplyLine2": "스테이킹에 잠김"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{max}중 {value}"
    },
    "home_walletCta": {
      "eyebrow": "지금 시작하기",
      "title": "지금 EAV7 네트워크를 살펴보세요",
      "description": "지갑은 브라우저에서 포스트 퀀텀 보호 기능으로 생성되고 서명되며, 기기를 절대 벗어나지 않습니다. 웹에서 바로 전송, 스테이킹, 채굴을 할 수 있습니다.",
      "createWallet": "지갑 생성",
      "exploreNetwork": "네트워크 탐색"
    },
    "mining_live": {
      "badge_consensus": "DPoS · 스테이킹",
      "title": "채굴",
      "live_badge": "실시간",
      "subtitle": "EAV7에서는 EAV7을 잠금(스테이크)하여 채굴합니다 — 하드웨어 불필요, 에너지 소비 없음",
      "stat_reward_block": "블록당 보상",
      "stat_blocks_day": "일일 블록 수",
      "stat_daily_emission": "일일 발행량",
      "stat_already_mined": "채굴 완료",
      "network_production": "네트워크 생산량",
      "reward_per_block_caption": "블록마다(1초) 보상",
      "annual_emission_caption": "예상 연간 발행량",
      "next_block": "다음 블록",
      "miners_label": "채굴자",
      "staked_label": "잠긴 EAV7",
      "block_time_label": "블록 시간",
      "ai_sentinel_badge": "AI 센티넬 · 24시간",
      "network_protected": "네트워크 보호됨",
      "ai_monitoring_desc": "네이티브 AI의 지속적인 모니터링",
      "alerts_analyzed": "분석된 경고",
      "active_oracles": "활성 오라클",
      "pending_ai_tasks": "대기 중인 AI 작업",
      "cta_title": "EAV7 채굴 시작하기",
      "cta_description": "지갑에서 EAV7을 잠가 DPoS 합의의 채굴자가 되고 생성되는 모든 블록에 대해 보상을 받으세요. 모든 것이 자기보관형이며 브라우저에서 포스트 퀀텀 서명이 이루어집니다.",
      "cta_lock_button": "EAV7 잠그기",
      "cta_view_validators": "검증자 보기"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "검색",
      "dica": "블록(번호) · 트랜잭션(E7…) · 주소(E7… 또는 0x…)"
    },
    "netStatus": {
      "onlineTitle": "EAV7 네트워크 온라인 · 높이 {height}",
      "offlineTitle": "노드 오프라인",
      "connecting": "연결 중…"
    },
    "page_address": {
      "metaTitle": "주소 {addr}… · EAV7 Scan",
      "eyebrow": "주소",
      "title": "주소",
      "roleValidator": "검증자",
      "roleOracle": "오라클",
      "roleAccount": "계정",
      "balance": "잔액",
      "staked": "스테이킹 중",
      "nonce": "nonce",
      "feeExempt": "수수료 없음",
      "available": "사용 가능",
      "max": "최대 {n}",
      "tokensTitle": "EAV20 토큰",
      "colToken": "토큰",
      "colSymbol": "심볼",
      "colBalance": "잔액",
      "txsTitle": "트랜잭션",
      "colHash": "해시",
      "colBlock": "블록",
      "colType": "유형",
      "colCounterparty": "상대방",
      "colValue": "금액",
      "colDate": "날짜",
      "out": "출금",
      "in": "입금",
      "noTxs": "이 주소에 대한 트랜잭션이 없습니다",
      "totalBalance": "총 잔액: {n}",
      "tabOverview": "개요",
      "tabTransfers": "전송",
      "tabInternal": "내부 전송",
      "tabStaking": "스테이킹 및 자원",
      "tabContract": "컨트랙트",
      "tabPermissions": "권한",
      "tabAnalysis": "분석",
      "internalNote": "컨트랙트 실행으로 이동한 가치입니다. 서명된 트랜잭션이 아니므로 고유 해시가 없습니다.",
      "internalEmpty": "내부 전송 없음",
      "colFrom": "보낸 곳",
      "colTo": "받는 곳",
      "colTx": "트랜잭션",
      "stakingTitle": "스테이크 및 자원",
      "bandwidth": "대역폭",
      "energy": "에너지",
      "delegatedOut": "위임한 양",
      "delegatedIn": "위임받은 양",
      "unbondingTitle": "언본딩 중",
      "matureIn": "{n} 블록 후 해제",
      "votesCastTitle": "행사한 투표",
      "votesReceived": "받은 투표",
      "vestingTitle": "베스팅",
      "permsNone": "단일 키 계정 — 다중 서명 없음",
      "permsThreshold": "임계값",
      "colWeight": "가중치",
      "colKey": "키",
      "contractNone": "이 주소는 컨트랙트가 아닙니다",
      "contractCodeSize": "코드 크기",
      "contractVerified": "검증됨",
      "contractUnverified": "미검증",
      "sent": "보냄",
      "received": "받음",
      "feesPaid": "지불 수수료",
      "txCount": "트랜잭션",
      "firstSeen": "최초 활동",
      "lastSeen": "최근 활동",
      "byType": "유형별",
      "topCounterparties": "주요 거래 상대",
      "truncatedNote": "최근 트랜잭션으로 제한된 표본",
      "noData": "데이터 없음",
      "nftsTitle": "NFT (EAV721)",
      "colNftCollection": "컬렉션",
      "colNftId": "토큰",
      "namesTitle": "EAV-NS 이름",
      "colNsName": "이름",
      "colNsTarget": "연결 대상",
      "votesLabel": "받은 투표",
      "commissionLabel": "수수료",
      "accountInfo": "계정 정보",
      "accountType": "계정 유형",
      "createdAt": "생성일",
      "totalTxs": "총 트랜잭션",
      "tabTokenTx": "토큰 전송",
      "tokenTxEmpty": "토큰 전송 없음",
      "roleContract": "컨트랙트",
      "roleMultisig": "다중 서명",
      "holdings": "보유 자산",
      "colAsset": "자산",
      "assets": "자산",
      "transfersRow": "전송",
      "votesRow": "투표",
      "claimable": "수령 가능 보상",
      "tabApprovals": "승인",
      "searchHoldings": "이름, 심볼 또는 주소로 검색…",
      "noHoldings": "항목 없음",
      "colSpender": "승인 대상",
      "colLimit": "한도",
      "more": "더 보기",
      "tabTokens": "토큰",
      "tabTransactions": "트랜잭션",
      "colAge": "경과",
      "colResult": "결과",
      "resultOk": "성공",
      "resultRevert": "되돌림",
      "summaryTx": "총 {n}건의 트랜잭션",
      "summaryTransfers": "총 {n}건의 전송",
      "summaryInternal": "총 {n}건의 내부 전송",
      "filterAll": "전체",
      "filterIn": "입금",
      "filterOut": "출금",
      "summaryTokenTx": "총 {n}건의 토큰 전송",
      "colParentHash": "상위 해시",
      "colResourceAmount": "자원 수량",
      "colStakedAmount": "스테이킹된 EAV7",
      "colUpdatedAt": "갱신 시각",
      "stakeNote": "EAV7에서는 한 번의 스테이킹이 에너지와 대역폭을 동시에 부여합니다 — TRON과 달리 자원을 선택하지 않습니다.",
      "permsOperations": "작업",
      "thisAccount": "현재 계정",
      "summaryContracts": "총 {n}개의 컨트랙트",
      "permsNote": "EAV7에서는 작업 집합이 모든 다중 서명 계정에 적용됩니다 — TRON과 달리 권한별 범위가 없습니다.",
      "permsDefault": "기본값",
      "permsDefaultNote": "다중 서명이 설정되지 않았습니다. 이것이 계정의 실효 권한입니다: 키 하나, 서명 하나."
    },
    "page_block": {
      "metaTitle": "블록 #{height} · EAV7 Scan",
      "eyebrow": "블록",
      "title": "블록 #{height}",
      "sub": "{ago} 전",
      "kv": {
        "height": "높이",
        "date": "날짜",
        "producer": "생성자",
        "previousHash": "이전 해시",
        "merkleRoot": "머클 루트 (거래)",
        "txCount": "거래 수",
        "protocol": "프로토콜",
        "scheme": "스킴"
      },
      "txSectionTitle": "블록 거래 내역",
      "table": {
        "hash": "해시",
        "type": "유형",
        "from": "보낸 주소",
        "to": "받는 주소",
        "value": "금액",
        "fee": "수수료"
      },
      "emptyBlock": "빈 블록"
    },
    "page_docs": {
      "metaTitleFallback": "문서 · EAV7 Scan",
      "breadcrumb": "문서",
      "terminal": "터미널",
      "onThisPage": "이 페이지의 내용"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "마이닝 · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "이 페이지는 EAV7 체인에 존재하지 않습니다.",
      "backLink": "← 홈으로 돌아가기"
    },
    "page_search": {
      "metaTitle": "검색 · EAV7 Scan",
      "title": "결과 없음",
      "notRecognizedPrefix": "",
      "notRecognizedSuffix": "을(를) 블록, 트랜잭션 또는 EAV7 주소로 인식하지 못했습니다.",
      "retryPlaceholder": "다시 시도하세요…",
      "whatCanSearch": "검색할 수 있는 항목",
      "blockLabel": "블록",
      "blockDesc": "블록 높이 번호, 예:",
      "txLabel": "트랜잭션",
      "txDesc": "해시",
      "txChars": "(64자)",
      "addressLabel": "주소",
      "addressLen34": "(34) 또는",
      "or": "또는",
      "evmLabel": "(EAVM)",
      "backHome": "← 홈으로 돌아가기"
    },
    "page_token": {
      "eyebrow": "EAV20 토큰",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "토큰 · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "표준",
      "mintable": "추가 발행 가능",
      "fixedSupply": "고정 공급",
      "paused": "일시중지",
      "tabTransfers": "전송",
      "tabHolders": "보유자",
      "tabAnalysis": "분석",
      "totalSupply": "총 공급량",
      "holders": "보유자",
      "decimals": "소수 자릿수",
      "status": "상태",
      "statusActive": "활성",
      "statusPaused": "일시중지",
      "createdAt": "생성일",
      "contract": "컨트랙트",
      "creator": "생성자",
      "owner": "관리자",
      "mintableLabel": "추가 발행 가능",
      "yes": "예",
      "no": "아니오",
      "summaryTransfers": "총 {n}건의 전송",
      "summaryHolders": "총 {n}명의 보유자 — 상위 {shown}명 표시",
      "colHash": "해시",
      "colBlock": "블록",
      "colAge": "경과",
      "colFrom": "보낸 주소",
      "colTo": "받는 주소",
      "colAmount": "수량 ({symbol})",
      "colRank": "#",
      "colAddress": "주소",
      "colBalance": "잔액 ({symbol})",
      "colShare": "비중",
      "blacklisted": "차단됨",
      "noTransfers": "전송 내역이 없습니다.",
      "noHolders": "보유자가 없습니다.",
      "top1": "최대 보유자",
      "top10": "상위 10",
      "top50": "상위 50",
      "concentrationTitle": "공급 집중도",
      "concentrationNote": "전체 공급량 중 대형 지갑이 보유한 비율입니다. 소수에 집중된 대량 공급은 널리 분산된 공급과 시장 위험이 다릅니다 — 그래서 총량보다 분포가 더 중요합니다.",
      "largestHolder": "최대 보유자:",
      "overviewTitle": "개요",
      "basicInfoTitle": "컨트랙트 정보",
      "activityTitle": "분포",
      "largestHolderShort": "최대 보유자",
      "tabContract": "컨트랙트",
      "nativeTitle": "프로토콜 네이티브 토큰",
      "nativeBadge": "임의 코드 없음",
      "nativeNote": "이 토큰은 스마트 컨트랙트가 아니라 프로토콜 자체가 구현합니다. 검증할 Solidity·컴파일러·바이트코드가 없으며, 누군가 작성했을 숨은 로직도 없습니다. 모든 EAV20 토큰의 동작은 동일하며 네트워크 하드포크로만 바뀝니다.",
      "implementation": "구현",
      "implementationValue": "합의 네이티브 (EAV20 표준)",
      "sourceOfTruth": "프로토콜 소스",
      "powersTitle": "관리자가 할 수 있는 일",
      "powersNote": "EVM 익스플로러라면 소스 코드를 읽어 알아내야 할 내용입니다. 여기서는 상태 필드이므로 직접 나열합니다. 토큰을 신뢰하기 전에 정말 중요한 것은 이 부분입니다.",
      "powerMint": "추가 발행",
      "powerMintNote": "총 공급량이 늘어나 기존 보유자의 지분이 희석됩니다.",
      "powerPause": "전송 중지",
      "powerPauseNote": "토큰의 모든 이동을 한 번에 동결합니다.",
      "powerBlacklist": "주소 차단",
      "powerBlacklistNote": "특정 주소의 송수신을 막습니다.",
      "powerFreeze": "잔액 동결",
      "powerFreezeNote": "특정 주소 잔액의 일부를 지정일까지 잠급니다.",
      "powerYes": "가능",
      "powerNo": "불가",
      "powerActiveNow": "현재 적용 중",
      "adminIs": "관리자:",
      "restrictionsTitle": "적용 중인 제한",
      "frozenUntil": "{when}까지"
    },
    "page_tx": {
      "metaTitle": "트랜잭션 {id}… · EAV7 Scan",
      "eyebrow": "트랜잭션",
      "title": "트랜잭션",
      "status": "상태",
      "type": "유형",
      "block": "블록",
      "from": "보낸 주소",
      "to": "받는 주소",
      "value": "금액",
      "fee": "수수료",
      "nonce": "Nonce",
      "date": "날짜",
      "scheme": "스킴",
      "eavmLayer": "EAVM 레이어 (MetaMask)",
      "energy": "에너지",
      "energyUnit": "에너지"
    },
    "page_txs": {
      "metaTitle": "거래 내역 · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "EAV20 표준",
        "title": "토큰",
        "subtitle": "eav20 프로토콜의 네이티브 자산 — Tron의 TRC20에 해당"
      },
      "empty": {
        "title": "아직 생성된 토큰이 없습니다",
        "description": "토큰은 네트워크에 생성되는 즉시 여기에 표시됩니다. 생성 방법은"
      },
      "stats": {
        "tokens": "EAV20 토큰",
        "holders": "보유자 (전체)",
        "supply": "합산 공급량",
        "standard": "표준"
      },
      "card": {
        "supply": "공급량",
        "holders": "보유자",
        "share": "비중",
        "creator": "생성자"
      }
    },
    "txs_live": {
      "chainLabel": "eav20 체인",
      "title": "거래",
      "live": "실시간",
      "subtitleLive": "최신순 · 단위 EAV7",
      "subtitleOlder": "이전 거래 · 단위 EAV7",
      "searchPlaceholder": "tx, 블록 또는 주소 검색…",
      "cols": {
        "hash": "해시",
        "block": "블록",
        "type": "유형",
        "from": "보낸 주소",
        "to": "받는 주소",
        "value": "금액",
        "age": "경과 시간"
      },
      "stats": {
        "totalTx": "총 거래 수",
        "mempool": "멤풀 내",
        "volume": "거래량 (EAV7)",
        "avgFee": "평균 수수료"
      },
      "table": {
        "latest": "최신 거래",
        "older": "이전 거래",
        "updating": "업데이트 중",
        "empty": "거래를 찾을 수 없습니다",
        "count": "{n}건의 거래",
        "loadMore": "이전 항목 더 보기 →",
        "genesis": "체인의 시작"
      }
    },
    "ui_copy": {
      "default_value": "값",
      "aria_label": "{label} 복사",
      "copied": "복사됨 ✓",
      "copy_label": "{label} 복사",
      "copy": "복사"
    },
    "ui_explorerSearch": {
      "placeholder": "블록, 트랜잭션 또는 주소 검색…",
      "searchButton": "검색"
    },
    "validators_live": {
      "unavailable": "노드를 사용할 수 없습니다",
      "header": {
        "eyebrow": "DPoS 합의",
        "title": "검증자",
        "live": "실시간",
        "subtitle": "{max}개 슬롯 중 {active}개 활성 · 최소 스테이크 {min} EAV7 · 블록마다 순환"
      },
      "producer": {
        "label": "현재 슬롯 생산자",
        "producingBlock": "블록 생성 중"
      },
      "slot": {
        "label": "슬롯 · {n}초",
        "staked": "{n} EAV7 스테이킹됨"
      },
      "rotation": {
        "label": "생산 순환"
      },
      "stats": {
        "activeValidators": "활성 검증자",
        "rewardPerBlock": "블록당 보상",
        "totalStaked": "총 스테이킹량",
        "peers": "네트워크 피어"
      },
      "ranking": {
        "title": "활성 집합",
        "sortedBy": "스테이크 순 정렬",
        "producing": "생성 중",
        "active": "활성",
        "stakedCaption": "EAV7 스테이킹됨"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "안전함"
      },
      "role": {
        "validator": "검증인",
        "oracle": "오라클",
        "account": "EAV7 계정"
      },
      "lock": {
        "button": "잠금"
      },
      "balance": {
        "label": "사용 가능 잔액"
      },
      "tier": {
        "validator": "검증인",
        "fee_zero": "수수료 없음",
        "standard": "표준"
      },
      "actions": {
        "send": "보내기",
        "receive": "받기",
        "stake": "스테이크"
      },
      "stats": {
        "staked": "스테이킹됨",
        "staked_suffix": "EAV7",
        "nonce": "논스",
        "fee": "수수료",
        "fee_zero": "없음",
        "fee_standard": "표준"
      },
      "tier_progress": {
        "label": "등급 진행률",
        "remaining_prefix": "남음",
        "remaining_suffix": "{tier} 등급까지"
      },
      "receive": {
        "title": "EAV7 받기",
        "description_before": "주소를 공유하세요",
        "description_after": "— 네트워크가 자동으로 네이티브 E7로 매핑합니다.",
        "close": "닫기"
      },
      "activity": {
        "title": "최근 활동",
        "sent": "보냄",
        "received": "받음"
      },
      "addresses": {
        "hint": "받으려면 이 0x를 사용하세요 (EAVM/MetaMask 표준)"
      },
      "tokens": {
        "title": "EAV20 토큰"
      },
      "footer": {
        "quantum": "포스트 퀀텀 · secp256k1 + ML-DSA-44",
        "logout": "로그아웃 / 전환"
      },
      "wipe": {
        "title": "이 지갑을 삭제하시겠습니까?",
        "description_before": "암호화된 지갑이",
        "description_bold": "이 브라우저에서",
        "description_after": "제거됩니다. 개인 키 백업으로만 복원할 수 있으며 — 비밀번호 복구는 불가능합니다.",
        "warning_before": "삭제하기 전에",
        "warning_bold": "키 백업",
        "warning_after": "을 가지고 있는지 확인하세요.",
        "download_backup": "백업 다운로드 (.json)",
        "cancel": "취소",
        "confirm": "지갑 삭제"
      }
    },
    "wallet_addNet": {
      "title": "MetaMask / Trust에서 사용",
      "description": "EAV7 네트워크(체인 72020)를 EVM 지갑에 추가하세요.",
      "adding": "추가하는 중…",
      "added": "✓ 추가됨",
      "addButton": "네트워크 추가",
      "noWallet": "이 브라우저에서 MetaMask가 감지되지 않았습니다.",
      "error": "네트워크를 추가할 수 없습니다."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "오직 당신만 통제합니다",
        "on_device_title": "기기 내 보관",
        "on_device_desc": "키가 외부로 유출되지 않습니다",
        "quantum_title": "양자 내성",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "백업",
        "password": "비밀번호",
        "ready": "완료"
      },
      "unlock": {
        "title": "다시 오신 것을 환영합니다",
        "subtitle": "이 브라우저에 암호화된 지갑이 있습니다. 잠금을 해제하려면 비밀번호를 입력하세요.",
        "password_placeholder": "비밀번호",
        "error_wrong_password": "비밀번호가 올바르지 않습니다",
        "unlocking": "잠금 해제 중…",
        "unlock_button": "지갑 잠금 해제",
        "wipe_confirm": "이 브라우저의 지갑을 삭제하시겠습니까? 키 백업을 반드시 확인하세요!",
        "wipe_button": "삭제하고 처음부터 시작"
      },
      "choose": {
        "title": "당신의 EAV7 지갑",
        "subtitle": "self-custodial 지갑: 당신만이 자신의 키를 소유합니다. 몇 초 만에 시작하세요.",
        "create_title": "새 지갑 생성",
        "create_desc": "이 기기에서 새 키를 생성합니다.",
        "import_title": "키 가져오기",
        "import_desc": "이미 개인 키가 있으신가요? 여기서 복원하세요."
      },
      "import": {
        "title": "지갑 가져오기",
        "subtitle": "개인 키를 붙여넣고 이 브라우저에서 암호화할 비밀번호를 선택하세요.",
        "label": "개인 키 (0x + 64 hex)",
        "importing": "가져오는 중…",
        "button": "가져오기",
        "back": "뒤로",
        "error_invalid_key": "유효하지 않은 개인 키입니다 (0x + 64 hex 필요)"
      },
      "create": {
        "title": "키를 백업하세요",
        "subtitle": "비밀번호는 복구할 수 없습니다. 개인 키를 가진 사람이 자금을 관리합니다 — 계속하기 전에 저장하세요.",
        "warning_prefix": "이 키는 ",
        "warning_bold": "자금에 접근할 수 있는 유일한 방법",
        "warning_suffix": "입니다. 오프라인에 저장하고 절대 누구와도 공유하지 마세요.",
        "address_label": "E7 주소",
        "private_key_label": "개인 키",
        "reveal": "표시",
        "hide": "숨기기",
        "download_backup": "⭳ 백업 다운로드 (.json)",
        "confirm_saved": "키를 안전한 곳에 저장했습니다",
        "creating": "생성 중…",
        "create_button": "지갑 생성",
        "confirm_hint": "키를 저장했는지 확인하세요",
        "back": "뒤로"
      },
      "errors": {
        "password_min": "비밀번호는 최소 6자 이상이어야 합니다",
        "password_mismatch": "비밀번호가 일치하지 않습니다",
        "save_error": "저장 중 오류가 발생했습니다"
      },
      "password": {
        "label": "암호화용 비밀번호 (최소 6자)",
        "placeholder": "비밀번호",
        "confirm_placeholder": "비밀번호 확인",
        "mismatch": "비밀번호가 일치하지 않습니다",
        "strength": {
          "very_weak": "매우 약함",
          "weak": "약함",
          "fair": "보통",
          "good": "좋음",
          "strong": "강함"
        }
      }
    },
    "wallet_send": {
      "title": "EAV7 보내기",
      "steps": {
        "destination": "받는 주소",
        "value": "금액",
        "review": "검토"
      },
      "recipient": {
        "label": "받는 주소 (0x… EAVM/MetaMask)",
        "paste": "붙여넣기",
        "valid": "✓ 유효한 주소입니다",
        "invalid": "잘못된 0x 주소입니다"
      },
      "errors": {
        "needEvmAddress": "받는 주소의 0x 주소를 입력하세요 (웹 지갑은 EAVM 모델로 서명합니다)",
        "invalidAddress": "받는 주소는 0x 주소여야 합니다 (EAVM/MetaMask)",
        "needPositiveAmount": "양수 금액을 입력하세요",
        "insufficientBalance": "잔액이 부족합니다 (수수료를 고려하세요)",
        "invalidAmount": "잘못된 금액입니다",
        "sendFailed": "전송에 실패했습니다"
      },
      "continue": "계속",
      "cancel": "취소",
      "available": "사용 가능: {amount} EAV7",
      "percent": {
        "max": "최대"
      },
      "back": "뒤로",
      "sendingLabel": "전송 중",
      "sendingTo": "{addr} 로",
      "networkFee": "네트워크 수수료",
      "balanceAfter": "전송 후 잔액",
      "quantumNote": "이 기기에서 서명됨 · 네트워크의 양자 내성 보호",
      "confirmAndSign": "확인 및 서명",
      "signing": "서명 중…",
      "transactionSent": {
        "title": "거래가 전송되었습니다",
        "subtitle": "다음 블록에서 확정됩니다 (~1초)."
      },
      "close": "닫기"
    },
    "wallet_stake": {
      "title": "스테이킹",
      "subtitle": "≥ 100 EAV7 시 수수료 면제 · ≥ 1,000 시 채굴자 등록 (블록 생성당 16 EAV7).",
      "tierZeroFee": {
        "label": "수수료 없음",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "검증인",
        "sub": "≥ 1,000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "현재 스테이킹:",
      "warnValidator": "이렇게 하면 스테이킹이 1,000 미만으로 떨어져 검증인 자격을 잃게 됩니다.",
      "warnFeeReset": "이렇게 하면 스테이킹이 100 미만으로 떨어져 거래에 다시 수수료가 부과됩니다.",
      "warnConfirm": "알겠습니다, 그래도 제거 →",
      "errInvalidAmount": "양수 값을 입력하세요",
      "errInvalidValue": "잘못된 금액입니다",
      "errFailedOp": "작업에 실패했습니다",
      "sentTitle": "작업이 전송되었습니다",
      "close": "닫기",
      "stakeBtn": "스테이킹하기",
      "removeBtn": "제거"
    }
  },
  "it": {
    "blocks_live": {
      "networkLabel": "catena eav20",
      "title": "Blocchi",
      "live": "in diretta",
      "blockTimeInfo": "un nuovo blocco ogni {n}s · consenso DPoS",
      "searchPlaceholder": "Cerca blocco per altezza o hash…",
      "stats": {
        "height": "Altezza attuale",
        "blockTime": "Tempo di blocco",
        "avgTx": "Txs / blocco (media)",
        "activeProducers": "Produttori attivi"
      },
      "latestBlocks": "Ultimi blocchi",
      "updating": "aggiornamento",
      "columns": {
        "block": "Blocco",
        "age": "Età",
        "txs": "Txs",
        "producer": "Produttore",
        "reward": "Ricompensa",
        "hash": "Hash"
      }
    },
    "comingSoon": {
      "badge": "in costruzione · sprint 4",
      "backToExplorer": "← torna all'explorer"
    },
    "docs_api": {
      "badge": "API pubblica",
      "title": "Interroga la rete direttamente dal nodo",
      "baseUrl": "URL base",
      "tags": {
        "cors": "CORS abilitato",
        "units": "valori in e7",
        "noAuth": "senza autenticazione"
      },
      "groups": {
        "read": "lettura",
        "write": "scrittura"
      },
      "endpoints": {
        "status": "stato della rete: altezza, validatori, mempool, ricompensa/blocco",
        "blocks": "ultimi N blocchi",
        "blockByHeight": "un blocco per altezza o hash",
        "txs": "transazioni recenti, paginate",
        "tx": "una transazione per id",
        "address": "saldo, stake, nonce, ruolo, token ed energia",
        "tokens": "elenco dei token EAV20 (o /tokens/:id per il dettaglio)",
        "validators": "set DPoS attivo + produttore dello slot",
        "sendTx": "invia una transazione nativa firmata (secp256k1 + ML-DSA-44)",
        "sendEavmTx": "invia una transazione tramite il layer EAVM (compatibile JSON-RPC)"
      }
    },
    "docs_eavm": {
      "badge": {
        "customNetwork": "rete personalizzata"
      },
      "title": "Usa EAV7 nel tuo wallet",
      "description": "EAV7 parla il dialetto JSON-RPC che i wallet universali comprendono — aggiungi la rete in un clic.",
      "wallets": {
        "metamask": "MetaMask",
        "trustWallet": "Trust Wallet",
        "anyEvm": "qualsiasi wallet EVM"
      },
      "params": {
        "networkName": "Nome della rete",
        "rpcUrl": "URL RPC",
        "chainId": "Chain ID",
        "symbol": "Simbolo",
        "explorer": "Explorer",
        "decimals": "Decimali"
      },
      "button": {
        "adding": "Aggiunta in corso…",
        "addToMetamask": "Aggiungi a MetaMask"
      },
      "status": {
        "added": "rete aggiunta!",
        "noWallet": "MetaMask non rilevata — copia i dati a fianco."
      },
      "error": {
        "addFailed": "impossibile aggiungere la rete"
      },
      "mapping": {
        "badge": "stesso account",
        "title": "Due identità, un solo account",
        "labelEavm": "EAVM",
        "labelNative": "nativo",
        "desc1": "MetaMask mostra lo",
        "desc2": "; on-chain il saldo risiede nel corrispondente",
        "desc3": "indirizzo. Sono lo stesso account."
      },
      "steps": {
        "step1": "Clicca per aggiungere la rete EAV7",
        "step2": "Il tuo account appare come 0x… nel wallet",
        "step3": "On-chain il saldo risiede nel corrispondente E7"
      }
    },
    "docs_hero": {
      "sobre": {
        "stat_block_time": "tempo di blocco",
        "stat_validators_value": "fino a 27",
        "stat_validators_label": "validatori DPoS",
        "stat_supply_value": "100 mld",
        "stat_supply_label": "offerta EAV7",
        "stat_reward_label": "EAV7 per blocco",
        "stat_quantum_value": "ibrida",
        "stat_quantum_label": "post-quantistica",
        "pillars_title": "pilastri del protocollo",
        "pillar_consensus": "Consenso DPoS",
        "pillar_token_standard": "Standard EAV20",
        "pillar_bridge": "Bridge cross-chain",
        "pillar_security": "Sicurezza & IA",
        "pillar_eavm": "EAVM · MetaMask"
      },
      "token": {
        "badge": "standard EAV20",
        "title": "Token nativi, senza macchina virtuale",
        "description": "Equivalente a TRC20: i token vivono direttamente nello stato della catena e si spostano tramite transazioni firmate — veloce, economico e verificabile.",
        "cta": "Vedi i token della rete"
      },
      "consenso": {
        "badge": "consenso DPoS",
        "title": "Un nuovo blocco ogni secondo",
        "description": "I validatori si alternano a rotazione: in ogni slot di 1s, un produttore atteso firma il blocco successivo. Senza grinding, senza attesa.",
        "slot_now": "slot attuale",
        "slot_offset": "slot +{n}",
        "fact_election_label": "Elezione",
        "fact_election_value": "i 27 maggiori per stake (≥ 1.000 EAV7)",
        "fact_production_label": "Produzione",
        "fact_production_value": "validators[slot % N] · round-robin",
        "fact_fork_choice_label": "Fork choice",
        "fact_fork_choice_value": "catena valida più lunga",
        "cta": "Vedi i validatori in diretta"
      },
      "ponte": {
        "title": "Come il bridge sposta valore tra le reti",
        "arrow_pays": "paga",
        "node_external": "Rete esterna",
        "step_bridge_out": "blocca EAV7/token e registra la destinazione esterna",
        "step_relayer": "osserva l'uscita e paga sulla catena esterna",
        "step_bridge_settle": "segna l'uscita come pagata on-chain (idempotente)",
        "step_bridge_in": "rilascia i fondi dall'esterno, deduplicato per sourceTxHash"
      },
      "seguranca": {
        "badge_hybrid": "firma ibrida",
        "title_hybrid": "Post-quantistica per progettazione",
        "verify_both": "la verifica richiede entrambe",
        "hybrid_description": "Ogni wallet, transazione e blocco porta entrambe le firme — ECDSA (maturità) e ML-DSA-44 (FIPS 204, resistente al quantico). Falsificare richiederebbe di violare entrambe le primitive contemporaneamente.",
        "badge_ai": "livello IA",
        "title_ai": "Oracoli con escrow on-chain",
        "sentinel_title": "Sentinella di sicurezza · 24h",
        "sentinel_description": "Un processo monitora la rete continuamente — riorganizzazioni, trasferimenti enormi, ondate di transazioni e concentrazione di produttori — registrando i risultati nel feed di sicurezza.",
        "sentinel_cta": "Vedi nel mining"
      },
      "staking": {
        "tier_fee_title": "Zero commissioni",
        "tier_fee_desc": "Blocca 100+ EAV7 e le tue transazioni avranno commissioni zero — l'energia (bandwidth) è generata dal freeze e si rigenera nel tempo.",
        "tier_mine_title": "Estrai blocchi",
        "tier_mine_desc": "Blocca 1.000+ EAV7 ed entra nell'elezione DPoS. Producendo un blocco ricevi 16 EAV7 più le commissioni del blocco, per intero.",
        "reward_title": "Ricompensa e unstake",
        "reward_desc": "La ricompensa va interamente al produttore del blocco. L'unstake libera il valore di nuovo sul tuo saldo — non è consentito svuotare l'ultimo validatore della rete.",
        "cta_lock": "Blocca EAV7",
        "cta_mining": "Vedi il mining"
      }
    },
    "energyGauge": {
      "ariaLabel": "Energia {available} di {max}",
      "title": "Energia",
      "description": "Risorsa che copre il costo delle transazioni. Si rigenera nel tempo e cresce con l'EAV7 bloccato in staking."
    },
    "home_activityBars": {
      "ariaLabel": "Transazioni per blocco",
      "txsCount": "{n} tx"
    },
    "home_appShowcase": {
      "nav": {
        "overview": "Panoramica",
        "blocks": "Blocchi",
        "transactions": "Transazioni",
        "validators": "Validatori",
        "tokens": "Token"
      },
      "cols": {
        "block": "Blocco",
        "age": "Età",
        "txs": "Txs",
        "producer": "Produttore",
        "reward": "Ricompensa",
        "hash": "Hash"
      },
      "sidebar": {
        "explore": "Esplora",
        "network": "Rete"
      },
      "toolbar": {
        "filter": "Filtra",
        "sort": "Ordina",
        "live": "in diretta"
      }
    },
    "home_explorerPreview": {
      "eyebrow": "esplora",
      "title": "Tutto on-chain, in tempo reale",
      "description": "Blocchi e transazioni che scorrono proprio ora. Clicca su un elemento per approfondire.",
      "viewBlocks": "Vedi blocchi",
      "viewTxs": "Vedi transazioni"
    },
    "home_heartbeat": {
      "label": "battito",
      "blockAgoPrefix": "blocco",
      "noData": "—",
      "blockTitle": "#{height} · {txCount} tx",
      "viewAll": "vedi tutti"
    },
    "home_hero": {
      "coin_alt": "Moneta EAV7",
      "title": "La nuova era dell'esploratore on-chain",
      "subtitle": "Blocchi ogni 1 secondo, sicurezza post-quantistica e un livello nativo di IA. Esplora blocchi, transazioni, validatori e indirizzi in tempo reale.",
      "search_placeholder": "Cerca blocco, transazione o indirizzo…",
      "search_button": "Esplora",
      "stat_height": "Altezza",
      "stat_block": "Blocco",
      "stat_validators": "Validatori",
      "stat_mempool": "Mempool"
    },
    "home_heroExp": {
      "hero": {
        "coinAlt": "Moneta EAV7",
        "titleBefore": "La blockchain EAV7, e",
        "titleHighlight": "oltre",
        "subtitle": "Consenso DPoS di 1 secondo, sicurezza post-quantistica e un livello IA nativo. Esplora blocchi, transazioni e validatori in tempo reale.",
        "exploreNetwork": "Esplora la rete",
        "openWallet": "Apri il wallet",
        "scrollAriaLabel": "Scorri al pannello"
      },
      "vitals": {
        "height": "Altezza",
        "blockTime": "Blocco",
        "validators": "Validatori"
      }
    },
    "home_inkBand": {
      "eyebrow": "interattivo",
      "title": "Passa il mouse per rivelare",
      "subtitle": "la rete EAV7, oltre il blocco",
      "mobileHint": "su mobile l'immagine appare direttamente"
    },
    "home_latestTxs": {
      "title": "Ultime transazioni",
      "viewAll": "vedi tutte",
      "table": {
        "hash": "Hash",
        "type": "Tipo",
        "fromTo": "Da → A",
        "value": "Valore"
      },
      "empty": "ancora nessuna transazione"
    },
    "home_moments": {
      "sectionEyebrow": "dentro il protocollo",
      "sectionTitle": "Una L1 costruita per durare",
      "items": {
        "security": {
          "eyebrow": "sicurezza",
          "titlePrefix": "Pronta per l'era",
          "titleHighlight": "post-quantistica",
          "desc": "Ogni wallet, transazione e blocco porta due firme — e la verifica le richiede entrambe. Falsificarla richiederebbe di rompere entrambe le primitive contemporaneamente.",
          "bullet1": "ECDSA secp256k1 + ML-DSA-44 (FIPS 204)",
          "bullet2": "Indirizzo E7 derivato tramite SHA3-256"
        },
        "consensus": {
          "eyebrow": "consenso",
          "titlePrefix": "Un blocco ogni",
          "titleHighlight": "1 secondo",
          "desc": "Consenso DPoS con fino a 27 validatori eletti per stake, in rotazione deterministica — 3 volte più veloce di Tron, con liveness protetta.",
          "bullet1": "27 validatori · round-robin per slot",
          "bullet2": "16 EAV7 di ricompensa per blocco"
        },
        "intelligence": {
          "eyebrow": "intelligenza",
          "titlePrefix": "Un livello",
          "titleHighlight": "nativo di IA",
          "desc": "Oracoli on-chain con escrow: le attività di IA vengono pubblicate, risolte dall'oracolo designato e liquidate in modo verificabile — tutto all'interno del protocollo.",
          "bullet1": "AI_TASK · AI_RESULT · AI_REFUND",
          "bullet2": "Hash del risultato registrato on-chain"
        },
        "assets": {
          "eyebrow": "asset",
          "titlePrefix": "Token",
          "titleHighlight": "EAV20",
          "titleSuffix": "e ponte cross-chain",
          "desc": "Crea e sposta token nativi (equivalenti a TRC20) e collega EAV7 ad altre reti tramite un modello lock-and-release sicuro e idempotente.",
          "bullet1": "Standard EAV20 · create / transfer / approve",
          "bullet2": "Ponte TRON · ETH · BTC (lock-and-release)"
        }
      }
    },
    "home_netPulse": {
      "eyebrow": "tempo reale",
      "title": "Il battito della rete",
      "subtitle": "Un nuovo blocco ogni secondo. Segui la rete EAV7 pulsare in tempo reale.",
      "stats": {
        "blockHeight": "Altezza del blocco",
        "txLast30": "Tx · ultimi 30 blocchi",
        "mempool": "Mempool",
        "rewardPerBlock": "EAV7 / blocco"
      },
      "activity": {
        "title": "Attività della rete",
        "txInLastBlocks": "transazioni negli ultimi {n} blocchi"
      },
      "slots": {
        "title": "Slot DPoS",
        "activeValidators": "validatori attivi",
        "supply": "offerta {n} EAV7"
      }
    },
    "home_netStats": {
      "cards": {
        "accounts": {
          "label": "Totale account"
        },
        "transactions": {
          "label": "Totale transazioni"
        },
        "volume": {
          "label": "Volume trasferito"
        },
        "staked": {
          "label": "Totale in staking"
        }
      },
      "ring": {
        "supplyLine1": "dell'offerta",
        "supplyLine2": "bloccato in staking"
      }
    },
    "home_slotsGauge": {
      "ariaValueOf": "{value} su {max}"
    },
    "home_walletCta": {
      "eyebrow": "inizia ora",
      "title": "Esplora subito la rete EAV7",
      "description": "Il tuo wallet viene generato e firmato nel browser con protezione post-quantistica — non lascia mai il tuo dispositivo. Invia, fai staking e mina direttamente dal web.",
      "createWallet": "Crea wallet",
      "exploreNetwork": "Esplora la rete"
    },
    "mining_live": {
      "badge_consensus": "DPoS · staking",
      "title": "Mining",
      "live_badge": "in diretta",
      "subtitle": "su EAV7 esegui il mining bloccando EAV7 (stake) — senza hardware, senza consumo energetico",
      "stat_reward_block": "Ricompensa / blocco",
      "stat_blocks_day": "Blocchi / giorno",
      "stat_daily_emission": "Emissione giornaliera",
      "stat_already_mined": "Già minato",
      "network_production": "produzione della rete",
      "reward_per_block_caption": "ricompensa per ogni blocco (1s)",
      "annual_emission_caption": "emissione annuale stimata",
      "next_block": "prossimo blocco",
      "miners_label": "minatori",
      "staked_label": "EAV7 bloccati",
      "block_time_label": "tempo di blocco",
      "ai_sentinel_badge": "sentinella IA · 24h",
      "network_protected": "Rete protetta",
      "ai_monitoring_desc": "monitoraggio continuo tramite IA nativa",
      "alerts_analyzed": "avvisi analizzati",
      "active_oracles": "oracoli attivi",
      "pending_ai_tasks": "attività IA in sospeso",
      "cta_title": "Inizia a minare EAV7",
      "cta_description": "Blocca EAV7 nel tuo wallet per diventare un minatore del consenso DPoS e ricevere ricompense per ogni blocco prodotto. Tutto self-custodial, con firma post-quantistica nel browser.",
      "cta_lock_button": "Blocca EAV7",
      "cta_view_validators": "Vedi i validatori"
    },
    "nav_extra": {
      "nfts": "NFTs EAV721",
      "nftsDesc": "Coleções de NFT na rede",
      "names": "Nomes EAV-NS",
      "namesDesc": "Nomes legíveis → endereço",
      "governance": "Governança",
      "governanceDesc": "Propostas, parâmetros e tesouraria"
    },
    "nav_headerSearch": {
      "buscar": "Cerca",
      "dica": "blocco (numero) · transazione (E7…) · indirizzo (E7… o 0x…)"
    },
    "netStatus": {
      "onlineTitle": "Rete EAV7 online · altezza {height}",
      "offlineTitle": "Nodo offline",
      "connecting": "connessione in corso…"
    },
    "page_address": {
      "metaTitle": "Indirizzo {addr}… · EAV7 Scan",
      "eyebrow": "indirizzo",
      "title": "Indirizzo",
      "roleValidator": "Validatore",
      "roleOracle": "Oracolo",
      "roleAccount": "Conto",
      "balance": "Saldo",
      "staked": "in staking",
      "nonce": "nonce",
      "feeExempt": "zero commissioni",
      "available": "Disponibile",
      "max": "max {n}",
      "tokensTitle": "Token EAV20",
      "colToken": "Token",
      "colSymbol": "Simbolo",
      "colBalance": "Saldo",
      "txsTitle": "Transazioni",
      "colHash": "Hash",
      "colBlock": "Blocco",
      "colType": "Tipo",
      "colCounterparty": "Controparte",
      "colValue": "Valore",
      "colDate": "Data",
      "out": "uscita",
      "in": "entrata",
      "noTxs": "nessuna transazione per questo indirizzo",
      "totalBalance": "saldo totale: {n}",
      "tabOverview": "Panoramica",
      "tabTransfers": "Trasferimenti",
      "tabInternal": "Trasferimenti interni",
      "tabStaking": "Staking e risorse",
      "tabContract": "Contratto",
      "tabPermissions": "Permessi",
      "tabAnalysis": "Analisi",
      "internalNote": "Valore mosso dall'esecuzione di un contratto. Non è una transazione firmata, quindi non ha un hash proprio.",
      "internalEmpty": "nessun trasferimento interno",
      "colFrom": "Da",
      "colTo": "A",
      "colTx": "Transazione",
      "stakingTitle": "Stake e risorse",
      "bandwidth": "Larghezza di banda",
      "energy": "Energia",
      "delegatedOut": "Delegato a terzi",
      "delegatedIn": "Ricevuto in delega",
      "unbondingTitle": "In sblocco",
      "matureIn": "si sblocca tra {n} blocchi",
      "votesCastTitle": "Voti espressi",
      "votesReceived": "Voti ricevuti",
      "vestingTitle": "Vesting",
      "permsNone": "account a chiave singola — senza multifirma",
      "permsThreshold": "Soglia",
      "colWeight": "Peso",
      "colKey": "Chiave",
      "contractNone": "questo indirizzo non è un contratto",
      "contractCodeSize": "Dimensione del codice",
      "contractVerified": "Verificato",
      "contractUnverified": "Non verificato",
      "sent": "Inviato",
      "received": "Ricevuto",
      "feesPaid": "Commissioni pagate",
      "txCount": "Transazioni",
      "firstSeen": "Prima attività",
      "lastSeen": "Ultima attività",
      "byType": "Per tipo",
      "topCounterparties": "Principali controparti",
      "truncatedNote": "campione limitato alle transazioni più recenti",
      "noData": "nessun dato",
      "nftsTitle": "NFT (EAV721)",
      "colNftCollection": "Collezione",
      "colNftId": "Token",
      "namesTitle": "Nomi EAV-NS",
      "colNsName": "Nome",
      "colNsTarget": "Risolve a",
      "votesLabel": "Voti ricevuti",
      "commissionLabel": "Commissione",
      "accountInfo": "Informazioni account",
      "accountType": "Tipo di account",
      "createdAt": "Creato",
      "totalTxs": "Transazioni totali",
      "tabTokenTx": "Trasferimenti di token",
      "tokenTxEmpty": "nessun trasferimento di token",
      "roleContract": "Contratto",
      "roleMultisig": "Multifirma",
      "holdings": "Partecipazioni",
      "colAsset": "Asset",
      "assets": "Attività",
      "transfersRow": "Trasferimenti",
      "votesRow": "Voti",
      "claimable": "Ricompense riscuotibili",
      "tabApprovals": "Approvazioni",
      "searchHoldings": "Cerca per nome, simbolo o indirizzo…",
      "noHoldings": "niente qui",
      "colSpender": "Autorizzato",
      "colLimit": "Limite",
      "more": "Vedi altro",
      "tabTokens": "Token",
      "tabTransactions": "Transazioni",
      "colAge": "Età",
      "colResult": "Risultato",
      "resultOk": "Successo",
      "resultRevert": "Annullata",
      "summaryTx": "Totale di {n} transazioni",
      "summaryTransfers": "Totale di {n} trasferimenti",
      "summaryInternal": "Totale di {n} trasferimenti interni",
      "filterAll": "Tutti",
      "filterIn": "Entrata",
      "filterOut": "Uscita",
      "summaryTokenTx": "Totale di {n} trasferimenti di token",
      "colParentHash": "Hash padre",
      "colResourceAmount": "Quantità di risorsa",
      "colStakedAmount": "EAV7 in stake",
      "colUpdatedAt": "Aggiornato",
      "stakeNote": "In EAV7 un solo stake concede energia E larghezza di banda insieme — non si sceglie una risorsa, a differenza di TRON.",
      "permsOperations": "Operazioni",
      "thisAccount": "questo account",
      "summaryContracts": "Totale di {n} contratti",
      "permsNote": "In EAV7 l'insieme di operazioni vale per qualsiasi account multifirma — non esiste un ambito per permesso come in TRON.",
      "permsDefault": "predefinito",
      "permsDefaultNote": "Nessuna multifirma configurata. Questa è l’autorizzazione effettiva dell’account: una chiave, una firma."
    },
    "page_block": {
      "metaTitle": "Blocco #{height} · EAV7 Scan",
      "eyebrow": "blocco",
      "title": "Blocco #{height}",
      "sub": "{ago} fa",
      "kv": {
        "height": "Altezza",
        "date": "Data",
        "producer": "Produttore",
        "previousHash": "Hash precedente",
        "merkleRoot": "Merkle root (tx)",
        "txCount": "Transazioni",
        "protocol": "Protocollo",
        "scheme": "schema"
      },
      "txSectionTitle": "Transazioni del blocco",
      "table": {
        "hash": "Hash",
        "type": "Tipo",
        "from": "Da",
        "to": "A",
        "value": "Valore",
        "fee": "Commissione"
      },
      "emptyBlock": "blocco vuoto"
    },
    "page_docs": {
      "metaTitleFallback": "Documentazione · EAV7 Scan",
      "breadcrumb": "documentazione",
      "terminal": "terminale",
      "onThisPage": "in questa pagina"
    },
    "page_governance": {
      "metaTitle": "Governança on-chain · EAV7 Scan",
      "eyebrow": "governança on-chain",
      "title": "Governança & Tesouraria",
      "subtitle": "Validadores propõem e votam mudanças de parâmetro (2/3+1); um cofre governável recebe parte da recompensa",
      "treasuryTitle": "Tesouraria",
      "treasuryBalance": "Saldo do cofre",
      "treasuryPct": "% da recompensa de bloco",
      "validators": "validadores ativos",
      "paramsTitle": "Parâmetros vigentes (governados)",
      "noParams": "Nenhum parâmetro sobrescrito por governança — todos no padrão do protocolo",
      "colParam": "Parâmetro",
      "colValue": "Valor",
      "proposalsTitle": "Propostas",
      "colProposer": "Proponente",
      "colStatus": "Status",
      "colVotes": "Votos",
      "colDeadline": "Prazo (bloco)",
      "noProposals": "Nenhuma proposta ativa ou encerrada"
    },
    "page_mining": {
      "metaTitle": "Mining · EAV7 Scan"
    },
    "page_names": {
      "metaTitle": "EAV-NS · Nomes · EAV7 Scan",
      "eyebrow": "serviço de nomes",
      "title": "EAV-NS",
      "subtitle": "Nomes legíveis que resolvem para um endereço E7 (register, update, transfer, release)",
      "colName": "Nome",
      "colTarget": "Resolve para",
      "colOwner": "Dono",
      "empty": "Nenhum nome registrado ainda"
    },
    "page_nfts": {
      "metaTitle": "NFTs EAV721 · EAV7 Scan",
      "eyebrow": "padrão EAV721",
      "title": "NFTs",
      "subtitle": "Coleções EAV721 (equivalente ao TRC721) emitidas na rede EAV7",
      "colCollection": "Coleção",
      "colSymbol": "Símbolo",
      "colSupply": "Emitidos",
      "colOwner": "Criador",
      "empty": "Nenhuma coleção EAV721 emitida ainda",
      "tokensTitle": "Tokens",
      "colTokenId": "Token",
      "colTokenOwner": "Dono",
      "colUri": "URI",
      "supplyLabel": "emitidos",
      "back": "todas as coleções"
    },
    "page_notFound": {
      "description": "Questa pagina non esiste sulla chain EAV7.",
      "backLink": "← torna alla home"
    },
    "page_search": {
      "metaTitle": "Ricerca · EAV7 Scan",
      "title": "Nessun risultato",
      "notRecognizedPrefix": "Non abbiamo riconosciuto",
      "notRecognizedSuffix": "come blocco, transazione o indirizzo EAV7.",
      "retryPlaceholder": "Riprova…",
      "whatCanSearch": "cosa puoi cercare",
      "blockLabel": "blocco",
      "blockDesc": "numero di altezza, es.",
      "txLabel": "transazione",
      "txDesc": "hash",
      "txChars": "(64 caratteri)",
      "addressLabel": "indirizzo",
      "addressLen34": "(34) o",
      "or": "o",
      "evmLabel": "(EAVM)",
      "backHome": "← torna alla home"
    },
    "page_token": {
      "eyebrow": "Token EAV20",
      "metaTitle": "{symbol} · {name} · EAV7 Scan",
      "metaTitleFallback": "Token · EAV7 Scan",
      "standard": "EAV20",
      "standardLabel": "Standard",
      "mintable": "emissione aperta",
      "fixedSupply": "offerta fissa",
      "paused": "in pausa",
      "tabTransfers": "Trasferimenti",
      "tabHolders": "Detentori",
      "tabAnalysis": "Analisi",
      "totalSupply": "Offerta totale",
      "holders": "Detentori",
      "decimals": "Decimali",
      "status": "Stato",
      "statusActive": "Attivo",
      "statusPaused": "In pausa",
      "createdAt": "Creato il",
      "contract": "Contratto",
      "creator": "Creatore",
      "owner": "Amministratore",
      "mintableLabel": "Può emetterne altri",
      "yes": "sì",
      "no": "no",
      "summaryTransfers": "Totale di {n} trasferimenti",
      "summaryHolders": "{n} detentori in totale — mostrati i {shown} maggiori",
      "colHash": "Hash",
      "colBlock": "Blocco",
      "colAge": "Età",
      "colFrom": "Da",
      "colTo": "A",
      "colAmount": "Importo ({symbol})",
      "colRank": "#",
      "colAddress": "Indirizzo",
      "colBalance": "Saldo ({symbol})",
      "colShare": "Quota",
      "blacklisted": "bloccato",
      "noTransfers": "Nessun trasferimento trovato.",
      "noHolders": "Nessun detentore trovato.",
      "top1": "Maggiore detentore",
      "top10": "Top 10",
      "top50": "Top 50",
      "concentrationTitle": "Concentrazione dell'offerta",
      "concentrationNote": "Quanta parte dell'offerta si trova nei portafogli maggiori. Un'offerta ampia in poche mani comporta un rischio di mercato diverso da una distribuita — per questo la distribuzione conta più del numero totale.",
      "largestHolder": "Maggiore detentore:",
      "overviewTitle": "Panoramica",
      "basicInfoTitle": "Informazioni contratto",
      "activityTitle": "Distribuzione",
      "largestHolderShort": "Maggiore detentore",
      "tabContract": "Contratto",
      "nativeTitle": "Token nativo del protocollo",
      "nativeBadge": "nessun codice arbitrario",
      "nativeNote": "Questo token non è uno smart contract: è implementato dal protocollo stesso. Non esiste Solidity, compilatore o bytecode da verificare — e nemmeno logica nascosta che qualcuno possa aver scritto. Il comportamento è identico per ogni token EAV20 e cambia solo con un hard fork della rete.",
      "implementation": "Implementazione",
      "implementationValue": "Nativa al consenso (standard EAV20)",
      "sourceOfTruth": "Sorgente del protocollo",
      "powersTitle": "Cosa può fare l'amministratore",
      "powersNote": "Su un explorer EVM leggeresti il codice sorgente per scoprirlo. Qui sono campi di stato, quindi li elenchiamo direttamente. È ciò che conta davvero prima di fidarsi di un token.",
      "powerMint": "Emettere altre unità",
      "powerMintNote": "Aumenta l'offerta totale e diluisce i detentori esistenti.",
      "powerPause": "Sospendere i trasferimenti",
      "powerPauseNote": "Congela tutti i movimenti del token in una volta.",
      "powerBlacklist": "Bloccare indirizzi",
      "powerBlacklistNote": "Impedisce a un indirizzo specifico di inviare o ricevere.",
      "powerFreeze": "Congelare il saldo",
      "powerFreezeNote": "Blocca parte del saldo di un indirizzo fino a una data.",
      "powerYes": "può",
      "powerNo": "non può",
      "powerActiveNow": "attivo ora",
      "adminIs": "Amministratore:",
      "restrictionsTitle": "Restrizioni in vigore",
      "frozenUntil": "fino al {when}"
    },
    "page_tx": {
      "metaTitle": "Transazione {id}… · EAV7 Scan",
      "eyebrow": "transazione",
      "title": "Transazione",
      "status": "Stato",
      "type": "Tipo",
      "block": "Blocco",
      "from": "Da",
      "to": "A",
      "value": "Valore",
      "fee": "Commissione",
      "nonce": "Nonce",
      "date": "Data",
      "scheme": "Schema",
      "eavmLayer": "Livello EAVM (MetaMask)",
      "energy": "Energia",
      "energyUnit": "energia"
    },
    "page_txs": {
      "metaTitle": "Transazioni · EAV7 Scan"
    },
    "secSentinel": {
      "title": "Reports da sentinela de IA",
      "sub": "A sentinela de segurança 24h monitora a rede e publica pareceres em tempo real: reorganizações e rollbacks de cadeia, transferências gigantes, rajadas de transações e enchentes de mempool, concentração de produtores, saúde de validadores (degradado/recuperado) e recomendações de governança.",
      "live": "ao vivo",
      "reports": "Reports recentes",
      "loading": "Carregando reports…",
      "empty": "Nenhum report ainda — a sentinela publica pareceres continuamente.",
      "stat_reports": "reports",
      "stat_oracles": "oráculos",
      "stat_tasks": "tarefas de IA",
      "sev": {
        "critical": "crítico",
        "warning": "alerta",
        "info": "info"
      }
    },
    "tokens_view": {
      "header": {
        "badge": "standard EAV20",
        "title": "Token",
        "subtitle": "asset nativi del protocollo eav20 — equivalente al TRC20 di Tron"
      },
      "empty": {
        "title": "Nessun token creato ancora",
        "description": "I token appaiono qui non appena vengono creati sulla rete tramite"
      },
      "stats": {
        "tokens": "Token EAV20",
        "holders": "Holder (totale)",
        "supply": "Offerta combinata",
        "standard": "Standard"
      },
      "card": {
        "supply": "Offerta",
        "holders": "Holder",
        "share": "quota",
        "creator": "creatore"
      }
    },
    "txs_live": {
      "chainLabel": "catena eav20",
      "title": "Transazioni",
      "live": "in diretta",
      "subtitleLive": "più recenti prima · valori in EAV7",
      "subtitleOlder": "transazioni più vecchie · valori in EAV7",
      "searchPlaceholder": "Cerca tx, blocco o indirizzo…",
      "cols": {
        "hash": "Hash",
        "block": "Blocco",
        "type": "Tipo",
        "from": "Da",
        "to": "A",
        "value": "Valore",
        "age": "Età"
      },
      "stats": {
        "totalTx": "Totale transazioni",
        "mempool": "Nella mempool",
        "volume": "Volume (EAV7)",
        "avgFee": "Commissione media"
      },
      "table": {
        "latest": "Ultime transazioni",
        "older": "Transazioni precedenti",
        "updating": "aggiornamento",
        "empty": "nessuna transazione trovata",
        "count": "{n} transazioni",
        "loadMore": "Carica più vecchie →",
        "genesis": "inizio della catena"
      }
    },
    "ui_copy": {
      "default_value": "valore",
      "aria_label": "Copia {label}",
      "copied": "copiato ✓",
      "copy_label": "copia {label}",
      "copy": "copia"
    },
    "ui_explorerSearch": {
      "placeholder": "Cerca blocco, tx o indirizzo…",
      "searchButton": "Cerca"
    },
    "validators_live": {
      "unavailable": "nodo non disponibile",
      "header": {
        "eyebrow": "consenso DPoS",
        "title": "Validatori",
        "live": "in diretta",
        "subtitle": "{active} attivi su {max} slot · stake minimo {min} EAV7 · rotazione ad ogni blocco"
      },
      "producer": {
        "label": "produttore dello slot attuale",
        "producingBlock": "produzione del blocco"
      },
      "slot": {
        "label": "slot · {n}s",
        "staked": "{n} EAV7 in stake"
      },
      "rotation": {
        "label": "rotazione di produzione"
      },
      "stats": {
        "activeValidators": "Validatori attivi",
        "rewardPerBlock": "Ricompensa / blocco",
        "totalStaked": "Totale in stake",
        "peers": "Peer di rete"
      },
      "ranking": {
        "title": "Insieme attivo",
        "sortedBy": "ordinato per stake",
        "producing": "in produzione",
        "active": "attivo",
        "stakedCaption": "EAV7 in stake"
      }
    },
    "wallet_account": {
      "badge": {
        "secure": "sicura"
      },
      "role": {
        "validator": "Validatore",
        "oracle": "Oracolo",
        "account": "Conto EAV7"
      },
      "lock": {
        "button": "blocca"
      },
      "balance": {
        "label": "saldo disponibile"
      },
      "tier": {
        "validator": "Validatore",
        "fee_zero": "Commissione zero",
        "standard": "Standard"
      },
      "actions": {
        "send": "Invia",
        "receive": "Ricevi",
        "stake": "Stake"
      },
      "stats": {
        "staked": "In stake",
        "staked_suffix": "EAV7",
        "nonce": "Nonce",
        "fee": "Commissione",
        "fee_zero": "zero",
        "fee_standard": "standard"
      },
      "tier_progress": {
        "label": "avanzamento livello",
        "remaining_prefix": "mancano",
        "remaining_suffix": "per il livello {tier}"
      },
      "receive": {
        "title": "Ricevi EAV7",
        "description_before": "Condividi il tuo indirizzo",
        "description_after": "— la rete lo mappa automaticamente al tuo E7 nativo.",
        "close": "chiudi"
      },
      "activity": {
        "title": "Attività recente",
        "sent": "Inviato",
        "received": "Ricevuto"
      },
      "addresses": {
        "hint": "usa questo 0x per ricevere (standard EAVM/MetaMask)"
      },
      "tokens": {
        "title": "Token EAV20"
      },
      "footer": {
        "quantum": "post-quantistica · secp256k1 + ML-DSA-44",
        "logout": "esci / cambia"
      },
      "wipe": {
        "title": "Eliminare questo wallet?",
        "description_before": "Il wallet cifrato verrà rimosso",
        "description_bold": "da questo browser",
        "description_after": ". Puoi ripristinarlo solo con il backup della chiave privata — non esiste il recupero della password.",
        "warning_before": "Conferma di avere il",
        "warning_bold": "backup della chiave",
        "warning_after": "prima di eliminare.",
        "download_backup": "Scarica backup (.json)",
        "cancel": "Annulla",
        "confirm": "Elimina wallet"
      }
    },
    "wallet_addNet": {
      "title": "Usa con MetaMask / Trust",
      "description": "Aggiungi la rete EAV7 (chain 72020) al tuo wallet EVM.",
      "adding": "aggiunta in corso…",
      "added": "✓ aggiunta",
      "addButton": "Aggiungi rete",
      "noWallet": "MetaMask non rilevata in questo browser.",
      "error": "impossibile aggiungere la rete."
    },
    "wallet_app": {
      "trust": {
        "self_custody_title": "self-custody",
        "self_custody_desc": "solo tu hai il controllo",
        "on_device_title": "sul dispositivo",
        "on_device_desc": "la chiave non esce mai",
        "quantum_title": "post-quantistica",
        "quantum_desc": "secp256k1 + ML-DSA-44"
      },
      "stepper": {
        "backup": "Backup",
        "password": "Password",
        "ready": "Pronto"
      },
      "unlock": {
        "title": "Bentornato",
        "subtitle": "C'è un portafoglio cifrato in questo browser. Inserisci la password per sbloccarlo.",
        "password_placeholder": "password",
        "error_wrong_password": "password errata",
        "unlocking": "sblocco in corso…",
        "unlock_button": "Sblocca portafoglio",
        "wipe_confirm": "Eliminare il portafoglio da questo browser? Assicurati di avere il backup della chiave!",
        "wipe_button": "elimina e ricomincia"
      },
      "choose": {
        "title": "Il tuo portafoglio EAV7",
        "subtitle": "Un portafoglio self-custodial: sei l'unico proprietario delle tue chiavi. Inizia in pochi secondi.",
        "create_title": "Crea nuovo portafoglio",
        "create_desc": "Genera una nuova chiave su questo dispositivo.",
        "import_title": "Importa chiave",
        "import_desc": "Hai già una chiave privata? Ripristinala qui."
      },
      "import": {
        "title": "Importa portafoglio",
        "subtitle": "Incolla la chiave privata e scegli una password per cifrarla in questo browser.",
        "label": "Chiave privata (0x + 64 hex)",
        "importing": "importazione…",
        "button": "Importa",
        "back": "Indietro",
        "error_invalid_key": "chiave privata non valida (atteso 0x + 64 hex)"
      },
      "create": {
        "title": "Esegui il backup della tua chiave",
        "subtitle": "Non esiste il recupero della password. Chi possiede la chiave privata controlla i fondi — salvala prima di continuare.",
        "warning_prefix": "Questa chiave ",
        "warning_bold": "è l'unico modo",
        "warning_suffix": " per accedere ai tuoi fondi. Salvala offline — non condividerla mai con nessuno.",
        "address_label": "indirizzo E7",
        "private_key_label": "chiave privata",
        "reveal": "rivela",
        "hide": "nascondi",
        "download_backup": "⭳ Scarica backup (.json)",
        "confirm_saved": "Ho salvato la mia chiave in un luogo sicuro",
        "creating": "creazione…",
        "create_button": "Crea portafoglio",
        "confirm_hint": "conferma di aver salvato la chiave",
        "back": "Indietro"
      },
      "errors": {
        "password_min": "la password deve avere almeno 6 caratteri",
        "password_mismatch": "le password non coincidono",
        "save_error": "errore durante il salvataggio"
      },
      "password": {
        "label": "Password per cifrare (min. 6 caratteri)",
        "placeholder": "password",
        "confirm_placeholder": "conferma password",
        "mismatch": "le password non coincidono",
        "strength": {
          "very_weak": "molto debole",
          "weak": "debole",
          "fair": "discreta",
          "good": "buona",
          "strong": "forte"
        }
      }
    },
    "wallet_send": {
      "title": "Invia EAV7",
      "steps": {
        "destination": "Destinazione",
        "value": "Importo",
        "review": "Rivedi"
      },
      "recipient": {
        "label": "Destinazione (0x… EAVM/MetaMask)",
        "paste": "incolla",
        "valid": "✓ indirizzo valido",
        "invalid": "indirizzo 0x non valido"
      },
      "errors": {
        "needEvmAddress": "inserisci lo 0x della destinazione (il wallet web firma nel modello EAVM)",
        "invalidAddress": "la destinazione deve essere un indirizzo 0x (EAVM/MetaMask)",
        "needPositiveAmount": "inserisci un importo positivo",
        "insufficientBalance": "saldo insufficiente (considera la commissione)",
        "invalidAmount": "importo non valido",
        "sendFailed": "invio non riuscito"
      },
      "continue": "Continua",
      "cancel": "Annulla",
      "available": "disponibile: {amount} EAV7",
      "percent": {
        "max": "MAX"
      },
      "back": "Indietro",
      "sendingLabel": "invio in corso",
      "sendingTo": "a {addr}",
      "networkFee": "Commissione di rete",
      "balanceAfter": "Saldo dopo",
      "quantumNote": "firmato su questo dispositivo · protezione post-quantistica della rete",
      "confirmAndSign": "Conferma e firma",
      "signing": "firma in corso…",
      "transactionSent": {
        "title": "Transazione inviata",
        "subtitle": "Confermata nel prossimo blocco (~1s)."
      },
      "close": "chiudi"
    },
    "wallet_stake": {
      "title": "Stake",
      "subtitle": "≥ 100 EAV7 azzera le commissioni · ≥ 1.000 diventi un minatore (16 EAV7/blocco prodotto).",
      "tierZeroFee": {
        "label": "Commissione zero",
        "sub": "≥ 100 EAV7"
      },
      "tierValidator": {
        "label": "Validatore",
        "sub": "≥ 1.000 EAV7"
      },
      "amountPlaceholder": "0",
      "currentStake": "in stake ora:",
      "warnValidator": "Questo farà scendere il tuo stake sotto 1.000 — perderai lo status di validatore.",
      "warnFeeReset": "Questo farà scendere il tuo stake sotto 100 — le tue transazioni torneranno a pagare commissioni.",
      "warnConfirm": "capito, rimuovi comunque →",
      "errInvalidAmount": "inserisci un valore positivo",
      "errInvalidValue": "valore non valido",
      "errFailedOp": "operazione fallita",
      "sentTitle": "Operazione inviata",
      "close": "chiudi",
      "stakeBtn": "Fai stake",
      "removeBtn": "Rimuovi"
    }
  }
};
