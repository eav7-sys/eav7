// Dicionário do "chrome" global (nav, header, mega-menu, footer) nos 12 idiomas.
// pt define a forma (Messages); os demais devem espelhar as mesmas chaves.
// Textos das telas internas serão adicionados em novos namespaces, incrementalmente.

const pt = {
  terms: {
    home: "Início",
    blocks: "Blocos",
    txs: "Transações",
    tokens: "Tokens",
    tokensEav20: "Tokens EAV20",
    validators: "Validadores",
    mining: "Mineração",
    wallet: "Carteira",
    walletWeb: "Carteira web",
    staking: "Staking & recompensas",
    consensusDpos: "Consenso DPoS",
    tokenStandard: "Padrão EAV20",
    tokenStandardFull: "Padrão de token EAV20",
    bridge: "Ponte cross-chain",
    eavm: "EAVM · MetaMask",
    apiRest: "API REST",
    aboutProtocol: "Sobre o protocolo",
    aboutEav20: "Sobre o eav20",
    security24: "Segurança & IA 24h",
    privacyPolicy: "Política de Privacidade",
    livePanel: "Painel ao vivo",
  },
  actions: {
    openWallet: "Abrir carteira",
    menu: "Menu",
    changeLanguage: "Mudar idioma",
    viewLivePanel: "Ver painel ao vivo",
    runNode: "Como rodar um nó",
    startOverview: "Começar pela visão geral",
  },
  menu: {
    explore: "Explorar",
    network: "Rede",
    protocol: "Protocolo",
    h: {
      chain: "cadeia",
      assets: "ativos & contas",
      consensus: "consenso",
      learn: "aprender",
      fundamentals: "fundamentos",
      security: "segurança & rede",
    },
    d: {
      blocks: "Últimos blocos, a cada 1s",
      txs: "Fluxo de transações da rede",
      tokens: "Tokens nativos do protocolo",
      livePanel: "Métricas da rede em tempo real",
      validators: "Conjunto DPoS ativo e produção",
      mining: "Stake, recompensas e nós",
      consensus: "Como os blocos são produzidos",
      staking: "Trave EAV7 para minerar",
      about: "Visão geral do eav20",
      standard: "Tokens nativos (tipo TRC20)",
      bridge: "Lock-and-release entre redes",
      security: "Pós-quântica + vigilância",
      eavm: "Usar a rede em carteiras EVM",
      api: "Endpoints públicos do nó",
    },
  },
  live: { network: "rede ao vivo", blockHeight: "altura do bloco", valShort: "val." },
  footer: {
    securityDev: "Segurança & Dev",
    tagline:
      "O explorador oficial da blockchain EAV7. Protocolo eav20, consenso DPoS, segurança pós-quântica e camada nativa de IA — em tempo real.",
    networkActive: "rede ativa",
  },
};

export type Messages = typeof pt;

const en: Messages = {
  terms: {
    home: "Home", blocks: "Blocks", txs: "Transactions", tokens: "Tokens", tokensEav20: "EAV20 Tokens",
    validators: "Validators", mining: "Mining", wallet: "Wallet", walletWeb: "Web wallet",
    staking: "Staking & rewards", consensusDpos: "DPoS consensus", tokenStandard: "EAV20 standard",
    tokenStandardFull: "EAV20 token standard", bridge: "Cross-chain bridge", eavm: "EAVM · MetaMask",
    apiRest: "REST API", aboutProtocol: "About the protocol", aboutEav20: "About eav20",
    security24: "24/7 Security & AI", livePanel: "Live panel",
    privacyPolicy: "Privacy Policy",
  },
  actions: {
    openWallet: "Open wallet", menu: "Menu", changeLanguage: "Change language",
    viewLivePanel: "View live panel", runNode: "How to run a node", startOverview: "Start with the overview",
  },
  menu: {
    explore: "Explore", network: "Network", protocol: "Protocol",
    h: { chain: "chain", assets: "assets & accounts", consensus: "consensus", learn: "learn", fundamentals: "fundamentals", security: "security & network" },
    d: {
      blocks: "Latest blocks, every 1s", txs: "Network transaction flow", tokens: "Native protocol tokens",
      livePanel: "Real-time network metrics", validators: "Active DPoS set and production", mining: "Stake, rewards and nodes",
      consensus: "How blocks are produced", staking: "Lock EAV7 to mine", about: "eav20 overview",
      standard: "Native tokens (TRC20-like)", bridge: "Lock-and-release across chains", security: "Post-quantum + surveillance",
      eavm: "Use the network in EVM wallets", api: "Public node endpoints",
    },
  },
  live: { network: "live network", blockHeight: "block height", valShort: "val." },
  footer: {
    securityDev: "Security & Dev",
    tagline: "The official explorer of the EAV7 blockchain. eav20 protocol, DPoS consensus, post-quantum security and a native AI layer — in real time.",
    networkActive: "network active",
  },
};

const es: Messages = {
  terms: {
    home: "Inicio", blocks: "Bloques", txs: "Transacciones", tokens: "Tokens", tokensEav20: "Tokens EAV20",
    validators: "Validadores", mining: "Minería", wallet: "Billetera", walletWeb: "Billetera web",
    staking: "Staking y recompensas", consensusDpos: "Consenso DPoS", tokenStandard: "Estándar EAV20",
    tokenStandardFull: "Estándar de token EAV20", bridge: "Puente cross-chain", eavm: "EAVM · MetaMask",
    apiRest: "API REST", aboutProtocol: "Sobre el protocolo", aboutEav20: "Sobre eav20",
    security24: "Seguridad e IA 24h", livePanel: "Panel en vivo",
    privacyPolicy: "Política de Privacidad",
  },
  actions: {
    openWallet: "Abrir billetera", menu: "Menú", changeLanguage: "Cambiar idioma",
    viewLivePanel: "Ver panel en vivo", runNode: "Cómo ejecutar un nodo", startOverview: "Empezar por la visión general",
  },
  menu: {
    explore: "Explorar", network: "Red", protocol: "Protocolo",
    h: { chain: "cadena", assets: "activos y cuentas", consensus: "consenso", learn: "aprender", fundamentals: "fundamentos", security: "seguridad y red" },
    d: {
      blocks: "Últimos bloques, cada 1s", txs: "Flujo de transacciones de la red", tokens: "Tokens nativos del protocolo",
      livePanel: "Métricas de red en tiempo real", validators: "Conjunto DPoS activo y producción", mining: "Stake, recompensas y nodos",
      consensus: "Cómo se producen los bloques", staking: "Bloquea EAV7 para minar", about: "Visión general de eav20",
      standard: "Tokens nativos (tipo TRC20)", bridge: "Lock-and-release entre redes", security: "Poscuántica + vigilancia",
      eavm: "Usa la red en billeteras EVM", api: "Endpoints públicos del nodo",
    },
  },
  live: { network: "red en vivo", blockHeight: "altura del bloque", valShort: "val." },
  footer: {
    securityDev: "Seguridad y Dev",
    tagline: "El explorador oficial de la blockchain EAV7. Protocolo eav20, consenso DPoS, seguridad poscuántica y capa nativa de IA — en tiempo real.",
    networkActive: "red activa",
  },
};

const zh: Messages = {
  terms: {
    home: "首页", blocks: "区块", txs: "交易", tokens: "代币", tokensEav20: "EAV20 代币",
    validators: "验证者", mining: "挖矿", wallet: "钱包", walletWeb: "网页钱包",
    staking: "质押与奖励", consensusDpos: "DPoS 共识", tokenStandard: "EAV20 标准",
    tokenStandardFull: "EAV20 代币标准", bridge: "跨链桥", eavm: "EAVM · MetaMask",
    apiRest: "REST API", aboutProtocol: "关于协议", aboutEav20: "关于 eav20",
    security24: "7×24 安全与 AI", livePanel: "实时面板",
    privacyPolicy: "隐私政策",
  },
  actions: {
    openWallet: "打开钱包", menu: "菜单", changeLanguage: "切换语言",
    viewLivePanel: "查看实时面板", runNode: "如何运行节点", startOverview: "从概览开始",
  },
  menu: {
    explore: "浏览", network: "网络", protocol: "协议",
    h: { chain: "链", assets: "资产与账户", consensus: "共识", learn: "学习", fundamentals: "基础", security: "安全与网络" },
    d: {
      blocks: "最新区块，每 1 秒", txs: "网络交易流", tokens: "协议原生代币",
      livePanel: "实时网络指标", validators: "活跃 DPoS 集合与出块", mining: "质押、奖励与节点",
      consensus: "区块如何产生", staking: "锁定 EAV7 进行挖矿", about: "eav20 概览",
      standard: "原生代币（类似 TRC20）", bridge: "跨链锁定与释放", security: "抗量子 + 监控",
      eavm: "在 EVM 钱包中使用网络", api: "节点公共接口",
    },
  },
  live: { network: "实时网络", blockHeight: "区块高度", valShort: "验证者" },
  footer: {
    securityDev: "安全与开发",
    tagline: "EAV7 区块链的官方浏览器。eav20 协议、DPoS 共识、抗量子安全和原生 AI 层——实时呈现。",
    networkActive: "网络活跃",
  },
};

const fr: Messages = {
  terms: {
    home: "Accueil", blocks: "Blocs", txs: "Transactions", tokens: "Jetons", tokensEav20: "Jetons EAV20",
    validators: "Validateurs", mining: "Minage", wallet: "Portefeuille", walletWeb: "Portefeuille web",
    staking: "Staking et récompenses", consensusDpos: "Consensus DPoS", tokenStandard: "Standard EAV20",
    tokenStandardFull: "Standard de jeton EAV20", bridge: "Pont cross-chain", eavm: "EAVM · MetaMask",
    apiRest: "API REST", aboutProtocol: "À propos du protocole", aboutEav20: "À propos d'eav20",
    security24: "Sécurité et IA 24h/24", livePanel: "Panneau en direct",
    privacyPolicy: "Politique de confidentialité",
  },
  actions: {
    openWallet: "Ouvrir le portefeuille", menu: "Menu", changeLanguage: "Changer de langue",
    viewLivePanel: "Voir le panneau en direct", runNode: "Comment exécuter un nœud", startOverview: "Commencer par la vue d'ensemble",
  },
  menu: {
    explore: "Explorer", network: "Réseau", protocol: "Protocole",
    h: { chain: "chaîne", assets: "actifs et comptes", consensus: "consensus", learn: "apprendre", fundamentals: "fondamentaux", security: "sécurité et réseau" },
    d: {
      blocks: "Derniers blocs, toutes les 1s", txs: "Flux de transactions du réseau", tokens: "Jetons natifs du protocole",
      livePanel: "Métriques réseau en temps réel", validators: "Ensemble DPoS actif et production", mining: "Stake, récompenses et nœuds",
      consensus: "Comment les blocs sont produits", staking: "Bloquez EAV7 pour miner", about: "Vue d'ensemble d'eav20",
      standard: "Jetons natifs (type TRC20)", bridge: "Lock-and-release entre réseaux", security: "Post-quantique + surveillance",
      eavm: "Utiliser le réseau dans les portefeuilles EVM", api: "Points de terminaison publics du nœud",
    },
  },
  live: { network: "réseau en direct", blockHeight: "hauteur du bloc", valShort: "val." },
  footer: {
    securityDev: "Sécurité et Dev",
    tagline: "L'explorateur officiel de la blockchain EAV7. Protocole eav20, consensus DPoS, sécurité post-quantique et couche d'IA native — en temps réel.",
    networkActive: "réseau actif",
  },
};

const de: Messages = {
  terms: {
    home: "Start", blocks: "Blöcke", txs: "Transaktionen", tokens: "Token", tokensEav20: "EAV20-Token",
    validators: "Validatoren", mining: "Mining", wallet: "Wallet", walletWeb: "Web-Wallet",
    staking: "Staking & Belohnungen", consensusDpos: "DPoS-Konsens", tokenStandard: "EAV20-Standard",
    tokenStandardFull: "EAV20-Token-Standard", bridge: "Cross-Chain-Bridge", eavm: "EAVM · MetaMask",
    apiRest: "REST-API", aboutProtocol: "Über das Protokoll", aboutEav20: "Über eav20",
    security24: "Sicherheit & KI rund um die Uhr", livePanel: "Live-Panel",
    privacyPolicy: "Datenschutzerklärung",
  },
  actions: {
    openWallet: "Wallet öffnen", menu: "Menü", changeLanguage: "Sprache ändern",
    viewLivePanel: "Live-Panel ansehen", runNode: "Node betreiben", startOverview: "Mit der Übersicht beginnen",
  },
  menu: {
    explore: "Entdecken", network: "Netzwerk", protocol: "Protokoll",
    h: { chain: "Kette", assets: "Assets & Konten", consensus: "Konsens", learn: "Lernen", fundamentals: "Grundlagen", security: "Sicherheit & Netzwerk" },
    d: {
      blocks: "Neueste Blöcke, jede Sekunde", txs: "Transaktionsfluss des Netzwerks", tokens: "Native Protokoll-Token",
      livePanel: "Netzwerkmetriken in Echtzeit", validators: "Aktives DPoS-Set und Produktion", mining: "Stake, Belohnungen und Nodes",
      consensus: "Wie Blöcke erzeugt werden", staking: "EAV7 sperren, um zu minen", about: "eav20-Überblick",
      standard: "Native Token (TRC20-ähnlich)", bridge: "Lock-and-Release zwischen Netzwerken", security: "Post-Quanten + Überwachung",
      eavm: "Netzwerk in EVM-Wallets nutzen", api: "Öffentliche Node-Endpunkte",
    },
  },
  live: { network: "Live-Netzwerk", blockHeight: "Blockhöhe", valShort: "Val." },
  footer: {
    securityDev: "Sicherheit & Dev",
    tagline: "Der offizielle Explorer der EAV7-Blockchain. eav20-Protokoll, DPoS-Konsens, Post-Quanten-Sicherheit und native KI-Schicht — in Echtzeit.",
    networkActive: "Netzwerk aktiv",
  },
};

const ja: Messages = {
  terms: {
    home: "ホーム", blocks: "ブロック", txs: "トランザクション", tokens: "トークン", tokensEav20: "EAV20 トークン",
    validators: "バリデータ", mining: "マイニング", wallet: "ウォレット", walletWeb: "ウェブウォレット",
    staking: "ステーキングと報酬", consensusDpos: "DPoS コンセンサス", tokenStandard: "EAV20 規格",
    tokenStandardFull: "EAV20 トークン規格", bridge: "クロスチェーンブリッジ", eavm: "EAVM · MetaMask",
    apiRest: "REST API", aboutProtocol: "プロトコルについて", aboutEav20: "eav20 について",
    security24: "24時間 セキュリティ & AI", livePanel: "ライブパネル",
    privacyPolicy: "プライバシーポリシー",
  },
  actions: {
    openWallet: "ウォレットを開く", menu: "メニュー", changeLanguage: "言語を変更",
    viewLivePanel: "ライブパネルを見る", runNode: "ノードの実行方法", startOverview: "概要から始める",
  },
  menu: {
    explore: "探索", network: "ネットワーク", protocol: "プロトコル",
    h: { chain: "チェーン", assets: "資産とアカウント", consensus: "コンセンサス", learn: "学ぶ", fundamentals: "基礎", security: "セキュリティとネットワーク" },
    d: {
      blocks: "最新ブロック、毎秒", txs: "ネットワークのトランザクションフロー", tokens: "プロトコルのネイティブトークン",
      livePanel: "リアルタイムのネットワーク指標", validators: "アクティブな DPoS セットと生成", mining: "ステーク・報酬・ノード",
      consensus: "ブロックの生成方法", staking: "EAV7 をロックしてマイニング", about: "eav20 の概要",
      standard: "ネイティブトークン（TRC20 相当）", bridge: "ネットワーク間のロック＆リリース", security: "耐量子 + 監視",
      eavm: "EVM ウォレットでネットワークを利用", api: "ノードの公開エンドポイント",
    },
  },
  live: { network: "ライブネットワーク", blockHeight: "ブロック高", valShort: "バリ" },
  footer: {
    securityDev: "セキュリティ & 開発",
    tagline: "EAV7 ブロックチェーンの公式エクスプローラー。eav20 プロトコル、DPoS コンセンサス、耐量子セキュリティ、ネイティブ AI レイヤー — リアルタイムで。",
    networkActive: "ネットワーク稼働中",
  },
};

const ru: Messages = {
  terms: {
    home: "Главная", blocks: "Блоки", txs: "Транзакции", tokens: "Токены", tokensEav20: "Токены EAV20",
    validators: "Валидаторы", mining: "Майнинг", wallet: "Кошелёк", walletWeb: "Веб-кошелёк",
    staking: "Стейкинг и награды", consensusDpos: "Консенсус DPoS", tokenStandard: "Стандарт EAV20",
    tokenStandardFull: "Стандарт токена EAV20", bridge: "Кросс-чейн мост", eavm: "EAVM · MetaMask",
    apiRest: "REST API", aboutProtocol: "О протоколе", aboutEav20: "Об eav20",
    security24: "Безопасность и ИИ 24/7", livePanel: "Живая панель",
    privacyPolicy: "Политика конфиденциальности",
  },
  actions: {
    openWallet: "Открыть кошелёк", menu: "Меню", changeLanguage: "Сменить язык",
    viewLivePanel: "Смотреть живую панель", runNode: "Как запустить узел", startOverview: "Начать с обзора",
  },
  menu: {
    explore: "Обзор", network: "Сеть", protocol: "Протокол",
    h: { chain: "цепочка", assets: "активы и счета", consensus: "консенсус", learn: "обучение", fundamentals: "основы", security: "безопасность и сеть" },
    d: {
      blocks: "Последние блоки, каждую 1с", txs: "Поток транзакций сети", tokens: "Нативные токены протокола",
      livePanel: "Метрики сети в реальном времени", validators: "Активный набор DPoS и производство", mining: "Стейк, награды и узлы",
      consensus: "Как создаются блоки", staking: "Заблокируйте EAV7 для майнинга", about: "Обзор eav20",
      standard: "Нативные токены (как TRC20)", bridge: "Lock-and-release между сетями", security: "Постквантовая + наблюдение",
      eavm: "Использовать сеть в EVM-кошельках", api: "Публичные эндпоинты узла",
    },
  },
  live: { network: "живая сеть", blockHeight: "высота блока", valShort: "вал." },
  footer: {
    securityDev: "Безопасность и Dev",
    tagline: "Официальный обозреватель блокчейна EAV7. Протокол eav20, консенсус DPoS, постквантовая безопасность и нативный слой ИИ — в реальном времени.",
    networkActive: "сеть активна",
  },
};

const ar: Messages = {
  terms: {
    home: "الرئيسية", blocks: "الكتل", txs: "المعاملات", tokens: "الرموز", tokensEav20: "رموز EAV20",
    validators: "المدققون", mining: "التعدين", wallet: "المحفظة", walletWeb: "محفظة الويب",
    staking: "الرهن والمكافآت", consensusDpos: "إجماع DPoS", tokenStandard: "معيار EAV20",
    tokenStandardFull: "معيار رمز EAV20", bridge: "جسر عبر السلاسل", eavm: "EAVM · MetaMask",
    apiRest: "واجهة REST", aboutProtocol: "حول البروتوكول", aboutEav20: "حول eav20",
    security24: "الأمن والذكاء الاصطناعي 24 ساعة", livePanel: "اللوحة المباشرة",
    privacyPolicy: "سياسة الخصوصية",
  },
  actions: {
    openWallet: "فتح المحفظة", menu: "القائمة", changeLanguage: "تغيير اللغة",
    viewLivePanel: "عرض اللوحة المباشرة", runNode: "كيفية تشغيل عقدة", startOverview: "ابدأ بنظرة عامة",
  },
  menu: {
    explore: "استكشاف", network: "الشبكة", protocol: "البروتوكول",
    h: { chain: "السلسلة", assets: "الأصول والحسابات", consensus: "الإجماع", learn: "تعلّم", fundamentals: "الأساسيات", security: "الأمن والشبكة" },
    d: {
      blocks: "أحدث الكتل، كل ثانية", txs: "تدفق معاملات الشبكة", tokens: "الرموز الأصلية للبروتوكول",
      livePanel: "مقاييس الشبكة في الوقت الفعلي", validators: "مجموعة DPoS النشطة والإنتاج", mining: "الرهن والمكافآت والعقد",
      consensus: "كيف تُنتَج الكتل", staking: "اقفل EAV7 للتعدين", about: "نظرة عامة على eav20",
      standard: "رموز أصلية (مثل TRC20)", bridge: "القفل والإطلاق بين الشبكات", security: "ما بعد الكم + المراقبة",
      eavm: "استخدم الشبكة في محافظ EVM", api: "نقاط النهاية العامة للعقدة",
    },
  },
  live: { network: "شبكة مباشرة", blockHeight: "ارتفاع الكتلة", valShort: "مدقق" },
  footer: {
    securityDev: "الأمن والتطوير",
    tagline: "المستكشف الرسمي لبلوكتشين EAV7. بروتوكول eav20، إجماع DPoS، أمن ما بعد الكم وطبقة ذكاء اصطناعي أصلية — في الوقت الفعلي.",
    networkActive: "الشبكة نشطة",
  },
};

const hi: Messages = {
  terms: {
    home: "होम", blocks: "ब्लॉक", txs: "लेनदेन", tokens: "टोकन", tokensEav20: "EAV20 टोकन",
    validators: "वैलिडेटर", mining: "माइनिंग", wallet: "वॉलेट", walletWeb: "वेब वॉलेट",
    staking: "स्टेकिंग और रिवॉर्ड", consensusDpos: "DPoS सर्वसम्मति", tokenStandard: "EAV20 मानक",
    tokenStandardFull: "EAV20 टोकन मानक", bridge: "क्रॉस-चेन ब्रिज", eavm: "EAVM · MetaMask",
    apiRest: "REST API", aboutProtocol: "प्रोटोकॉल के बारे में", aboutEav20: "eav20 के बारे में",
    security24: "24 घंटे सुरक्षा और AI", livePanel: "लाइव पैनल",
    privacyPolicy: "गोपनीयता नीति",
  },
  actions: {
    openWallet: "वॉलेट खोलें", menu: "मेन्यू", changeLanguage: "भाषा बदलें",
    viewLivePanel: "लाइव पैनल देखें", runNode: "नोड कैसे चलाएँ", startOverview: "अवलोकन से शुरू करें",
  },
  menu: {
    explore: "एक्सप्लोर", network: "नेटवर्क", protocol: "प्रोटोकॉल",
    h: { chain: "चेन", assets: "एसेट और खाते", consensus: "सर्वसम्मति", learn: "सीखें", fundamentals: "मूल बातें", security: "सुरक्षा और नेटवर्क" },
    d: {
      blocks: "नवीनतम ब्लॉक, हर 1 सेकंड", txs: "नेटवर्क लेनदेन प्रवाह", tokens: "प्रोटोकॉल के मूल टोकन",
      livePanel: "रियल-टाइम नेटवर्क मेट्रिक्स", validators: "सक्रिय DPoS सेट और उत्पादन", mining: "स्टेक, रिवॉर्ड और नोड",
      consensus: "ब्लॉक कैसे बनते हैं", staking: "माइन करने के लिए EAV7 लॉक करें", about: "eav20 अवलोकन",
      standard: "मूल टोकन (TRC20 जैसे)", bridge: "नेटवर्कों के बीच लॉक-एंड-रिलीज़", security: "पोस्ट-क्वांटम + निगरानी",
      eavm: "EVM वॉलेट में नेटवर्क उपयोग करें", api: "नोड के सार्वजनिक एंडपॉइंट",
    },
  },
  live: { network: "लाइव नेटवर्क", blockHeight: "ब्लॉक ऊँचाई", valShort: "वैल." },
  footer: {
    securityDev: "सुरक्षा और Dev",
    tagline: "EAV7 ब्लॉकचेन का आधिकारिक एक्सप्लोरर। eav20 प्रोटोकॉल, DPoS सर्वसम्मति, पोस्ट-क्वांटम सुरक्षा और नेटिव AI परत — रियल-टाइम में।",
    networkActive: "नेटवर्क सक्रिय",
  },
};

const ko: Messages = {
  terms: {
    home: "홈", blocks: "블록", txs: "트랜잭션", tokens: "토큰", tokensEav20: "EAV20 토큰",
    validators: "검증자", mining: "채굴", wallet: "지갑", walletWeb: "웹 지갑",
    staking: "스테이킹 및 보상", consensusDpos: "DPoS 합의", tokenStandard: "EAV20 표준",
    tokenStandardFull: "EAV20 토큰 표준", bridge: "크로스체인 브리지", eavm: "EAVM · MetaMask",
    apiRest: "REST API", aboutProtocol: "프로토콜 소개", aboutEav20: "eav20 소개",
    security24: "24시간 보안 & AI", livePanel: "라이브 패널",
    privacyPolicy: "개인정보 처리방침",
  },
  actions: {
    openWallet: "지갑 열기", menu: "메뉴", changeLanguage: "언어 변경",
    viewLivePanel: "라이브 패널 보기", runNode: "노드 실행 방법", startOverview: "개요부터 시작",
  },
  menu: {
    explore: "탐색", network: "네트워크", protocol: "프로토콜",
    h: { chain: "체인", assets: "자산 및 계정", consensus: "합의", learn: "학습", fundamentals: "기초", security: "보안 및 네트워크" },
    d: {
      blocks: "최신 블록, 1초마다", txs: "네트워크 트랜잭션 흐름", tokens: "프로토콜 네이티브 토큰",
      livePanel: "실시간 네트워크 지표", validators: "활성 DPoS 세트 및 생성", mining: "스테이크, 보상 및 노드",
      consensus: "블록 생성 방식", staking: "채굴을 위해 EAV7 잠금", about: "eav20 개요",
      standard: "네이티브 토큰(TRC20 유형)", bridge: "네트워크 간 락앤릴리스", security: "포스트 양자 + 감시",
      eavm: "EVM 지갑에서 네트워크 사용", api: "노드 공개 엔드포인트",
    },
  },
  live: { network: "라이브 네트워크", blockHeight: "블록 높이", valShort: "검증" },
  footer: {
    securityDev: "보안 & 개발",
    tagline: "EAV7 블록체인의 공식 익스플로러. eav20 프로토콜, DPoS 합의, 포스트 양자 보안 및 네이티브 AI 레이어 — 실시간으로.",
    networkActive: "네트워크 활성",
  },
};

const it: Messages = {
  terms: {
    home: "Home", blocks: "Blocchi", txs: "Transazioni", tokens: "Token", tokensEav20: "Token EAV20",
    validators: "Validatori", mining: "Mining", wallet: "Wallet", walletWeb: "Wallet web",
    staking: "Staking e ricompense", consensusDpos: "Consenso DPoS", tokenStandard: "Standard EAV20",
    tokenStandardFull: "Standard del token EAV20", bridge: "Bridge cross-chain", eavm: "EAVM · MetaMask",
    apiRest: "API REST", aboutProtocol: "Informazioni sul protocollo", aboutEav20: "Informazioni su eav20",
    security24: "Sicurezza e IA 24 ore", livePanel: "Pannello live",
    privacyPolicy: "Informativa sulla privacy",
  },
  actions: {
    openWallet: "Apri wallet", menu: "Menu", changeLanguage: "Cambia lingua",
    viewLivePanel: "Vedi pannello live", runNode: "Come eseguire un nodo", startOverview: "Inizia dalla panoramica",
  },
  menu: {
    explore: "Esplora", network: "Rete", protocol: "Protocollo",
    h: { chain: "catena", assets: "asset e account", consensus: "consenso", learn: "impara", fundamentals: "fondamenti", security: "sicurezza e rete" },
    d: {
      blocks: "Ultimi blocchi, ogni 1s", txs: "Flusso di transazioni della rete", tokens: "Token nativi del protocollo",
      livePanel: "Metriche di rete in tempo reale", validators: "Set DPoS attivo e produzione", mining: "Stake, ricompense e nodi",
      consensus: "Come vengono prodotti i blocchi", staking: "Blocca EAV7 per minare", about: "Panoramica di eav20",
      standard: "Token nativi (tipo TRC20)", bridge: "Lock-and-release tra reti", security: "Post-quantistica + sorveglianza",
      eavm: "Usa la rete in wallet EVM", api: "Endpoint pubblici del nodo",
    },
  },
  live: { network: "rete live", blockHeight: "altezza del blocco", valShort: "val." },
  footer: {
    securityDev: "Sicurezza e Dev",
    tagline: "L'explorer ufficiale della blockchain EAV7. Protocollo eav20, consenso DPoS, sicurezza post-quantistica e livello IA nativo — in tempo reale.",
    networkActive: "rete attiva",
  },
};

import type { LocaleCode } from "./locales";
import { generated } from "./messages/generated";

const base: Record<LocaleCode, Record<string, unknown>> = { pt, en, es, zh, fr, de, ja, ru, ar, hi, ko, it };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Merge profundo imutável: chrome (base) + telas internas (generated).
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [key, bv] of Object.entries(b)) {
    const av = out[key];
    out[key] = isObj(av) && isObj(bv) ? deepMerge(av, bv) : bv;
  }
  return out;
}

export const dictionaries = Object.fromEntries(
  (Object.keys(base) as LocaleCode[]).map((code) => [code, deepMerge(base[code], generated[code] ?? {})]),
) as Record<LocaleCode, Record<string, unknown>>;
