//! O bloco do protocolo eav20 — estrutura, hash canônica e integridade interna.
//!
//! Porte de `src/core/block.js`. A divisão de responsabilidade com
//! [`crate::blockchain`] é a mesma da referência e vale repetir porque é o que
//! mantém este módulo testável: aqui mora tudo o que se decide olhando UM bloco
//! isolado (protocolo, faixas, `txRoot`, hash, as duas assinaturas do produtor);
//! encadeamento (altura, `previousHash`, slot DPoS, `stateRoot` contra o estado)
//! é da cadeia, porque exige estado.
//!
//! # Duas serializações canônicas — não troque uma pela outra
//!
//! O payload assinado de um bloco é `canonical(core)` de `src/crypto/hash.js`:
//! JSON com chaves ordenadas, o MESMO de [`crate::transaction::canonical_json`].
//! NÃO é o formato binário de [`crate::canonical`], que é a folha do `stateRoot`.
//! Trocar os dois invalidaria a assinatura de todo bloco já produzido.

use crate::hash::{eav_hash_one, is_valid_hash, merkle_root};
use crate::signature::{address_from_public_keys, hybrid_verify, SIGNATURE_SCHEME};
use crate::transaction::{canonical_json, JsonValue, Tx, PROTOCOL};
use std::collections::BTreeMap;

// ============================================================================
// Constantes de consenso
//
// TODAS derivam de [`crate::config`], que é gerado de `src/config.js` — nenhuma
// cópia literal mora aqui. Os apelidos abaixo existem só para ajustar o TIPO ao
// uso local (o gerador emite tudo como `u64`/`u128`, e altura de bloco é `u64`
// enquanto comprimento é `usize`). Reescrever o valor em vez de derivá-lo
// reintroduziria exatamente o problema que `config.rs` resolve: uma altura que
// diverge sem erro de compilação e sem teste vermelho, aparecendo só como cisão
// de cadeia no dia em que a rede cruzar o fork.
// ============================================================================

/// `CHAIN.PROTOCOL_VERSION`. Entra no core, logo no hash.
pub const PROTOCOL_VERSION: i64 = crate::config::PROTOCOL_VERSION as i64;

/// `CHAIN.HASH_LENGTH`.
pub const HASH_LENGTH: usize = crate::config::HASH_LENGTH as usize;

/// `CHAIN.CANONICAL_HASH_HEIGHT` — a partir daqui o hash do bloco deriva SÓ do
/// payload assinado (achado M1 da auditoria).
pub const CANONICAL_HASH_HEIGHT: u64 = crate::config::CANONICAL_HASH_HEIGHT;

/// `CHAIN.STATEROOT_HEIGHT` — a partir daqui o header commita a raiz do estado
/// APÓS o bloco.
pub const STATEROOT_HEIGHT: u64 = crate::config::STATEROOT_HEIGHT;

/// `CHAIN.PERMISSIONS_V2_HEIGHT` — a partir daqui um bloco pode carregar
/// `producerAccount` (produção delegada a uma chave `witness`).
pub const PERMISSIONS_V2_HEIGHT: u64 = crate::config::PERMISSIONS_V2_HEIGHT;

/// Pai do gênese: 64 zeros, mesmo formato de qualquer outra hash da rede.
///
/// Não é `None` nem string vazia de propósito — um campo com duas formas
/// possíveis ("ausente" e "zeros") daria duas pré-imagens para o mesmo bloco.
pub const GENESIS_PREVIOUS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Assinatura sentinela do gênese. O bloco 0 não tem produtor real; a sentinela é
/// o que `verify_block_integrity` exige no lugar das duas assinaturas híbridas.
pub const GENESIS_SIGNATURE: &str = "GENESIS";

/// Produtor sentinela do gênese.
pub const GENESIS_PRODUCER: &str = "GENESIS";

/// `Number.isSafeInteger` da referência: `height` e `timestamp` são `number` no JS.
/// Aceitar acima disso criaria blocos que o nó de referência não consegue reler sem
/// perder dígito — e um dígito perdido é outro payload, logo outro hash.
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

// ============================================================================
// A estrutura
// ============================================================================

/// Um bloco eav20.
///
/// Os campos `Option` NÃO significam todos a mesma coisa, e a diferença é
/// exatamente onde o JS era ambíguo (ver [`block_core`]):
///
/// - `public_key` / `pq_public_key`: a chave SEMPRE aparece no payload; `None`
///   vira `null` literal (é o que o gênese emite).
/// - `state_root`, `producer_account`, `genesis`: `None` significa AUSENTE — a
///   chave nem é emitida, porque `JSON.stringify` descarta `undefined`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub protocol: String,
    pub version: i64,
    pub scheme: String,
    pub height: u64,
    /// Milissegundos desde a época Unix.
    pub timestamp: i64,
    pub previous_hash: String,
    pub tx_root: String,
    pub tx_count: usize,
    /// Endereço derivado das chaves que ASSINARAM. Com `witness`, não é quem tem
    /// stake — ver [`block_validator`].
    pub producer: String,
    /// `null` no gênese.
    pub public_key: Option<String>,
    /// `null` no gênese.
    pub pq_public_key: Option<String>,
    /// Raiz do estado APÓS este bloco. Ausente abaixo de [`STATEROOT_HEIGHT`].
    pub state_root: Option<String>,
    /// Conta que DETÉM o slot, quando a produção é delegada a uma chave `witness`.
    pub producer_account: Option<String>,
    /// Alocações do gênese. Fica como [`JsonValue`] cru de propósito: a estrutura
    /// (`balances`/`stakes`/`bridgeRelayers`/`bridgeSourceCommittees`/`vesting`)
    /// entra no payload assinado e qualquer campo que a tipagem descartasse mudaria
    /// o hash do gênese — que é justamente o valor fixado (`expectedGenesisHash`)
    /// que impede um peer de impor outra rede.
    pub genesis: Option<JsonValue>,

    // --- fora do core (não entram no payload assinado) ---
    pub signature: String,
    pub pq_signature: String,
    pub hash: String,
    pub transactions: Vec<Tx>,
}

/// Erro de construção ou de validação de bloco.
///
/// Texto e não enum porque a referência devolve a mensagem crua e ela atravessa
/// a API do nó; divergir na mensagem quebraria ferramenta de operação que casa
/// por string. As mensagens abaixo são as de `block.js`, palavra por palavra.
pub type BlockError = String;

/// Validador EFETIVO de um bloco: quem recebe recompensa e quem é punido.
///
/// Com a permissão `witness`, quem ASSINA é a chave de produção e quem PRODUZ é a
/// conta — `producer_account` carrega essa conta. Usar `producer` cru creditaria a
/// recompensa a uma chave sem stake (perda silenciosa) e faria o slashing punir
/// uma chave sem fundos (equivocação impune). Espelha `blockValidator`.
pub fn block_validator(block: &Block) -> &str {
    // `??` do JS só cai para o lado direito em null/undefined: um `producerAccount`
    // vazio (`""`) seria usado como está. `Option` reproduz isso — `Some("")` é `""`.
    block.producer_account.as_deref().unwrap_or(&block.producer)
}

/// Inteiro do payload a partir de um `u64`.
///
/// `JsonValue::Int` é `i64` porque o JSON da referência é `number`. Alturas acima
/// de `MAX_SAFE_INTEGER` são rejeitadas por `verify_block_integrity` ANTES de
/// qualquer hash, então o ramo de saturação é inalcançável em bloco válido — e
/// satura em vez de entrar em pânico porque pânico em consenso é vetor de DoS.
fn int_u64(n: u64) -> JsonValue {
    JsonValue::Int(i64::try_from(n).unwrap_or(i64::MAX))
}

/// O CORE do bloco: tudo menos `signature`, `pqSignature`, `hash` e `transactions`.
///
/// É a pré-imagem da assinatura e (acima de [`CANONICAL_HASH_HEIGHT`]) do hash.
/// Espelha `blockCore` + `canonical` da referência.
///
/// # Onde a referência era ambígua
///
/// `blockCore` faz desestruturação por resto sobre um objeto JS qualquer: o core é
/// o que o objeto TIVER. Um campo extra não previsto entraria no payload em
/// silêncio e mudaria o hash. A struct fechada remove essa classe inteira; a
/// distinção ausente/nulo foi preservada nos `Option` porque o protocolo depende
/// dela (o gênese emite `publicKey: null`, um bloco abaixo do fork do `stateRoot`
/// OMITE o campo — e as duas coisas dão payloads diferentes).
///
/// Um caso permanece divergente e está registrado: `buildBlock` com
/// `height >= STATEROOT_HEIGHT` e `stateRoot` nulo emite `"stateRoot":null`. Este
/// módulo reproduz isso (o ramo abaixo emite `Null` quando a altura pede o campo
/// e ele não veio), mas um bloco RECEBIDO que simplesmente não traga a chave é
/// indistinguível aqui de um que a traga nula. Os dois são rejeitados pela regra
/// estrutural adiante, só com mensagens diferentes.
pub fn block_core(block: &Block) -> JsonValue {
    JsonValue::Map(block_core_map(block))
}

/// O mesmo core, ainda como mapa aberto.
///
/// Existe separado de [`block_core`] para que [`block_to_json`] possa ACRESCENTAR
/// os campos de fora do core sem desmontar um `JsonValue` de volta — desmontar
/// exigiria um ramo `else` impossível, que só teria como saída `unreachable!()`, ou
/// seja, um pânico no caminho que grava a cadeia em disco. Devolver o mapa remove o
/// ramo em vez de o tratar.
fn block_core_map(block: &Block) -> BTreeMap<String, JsonValue> {
    let mut m: BTreeMap<String, JsonValue> = BTreeMap::new();
    m.insert("protocol".into(), JsonValue::str(&block.protocol));
    m.insert("version".into(), JsonValue::Int(block.version));
    m.insert("scheme".into(), JsonValue::str(&block.scheme));
    m.insert("height".into(), int_u64(block.height));
    m.insert("timestamp".into(), JsonValue::Int(block.timestamp));
    m.insert("previousHash".into(), JsonValue::str(&block.previous_hash));
    m.insert("txRoot".into(), JsonValue::str(&block.tx_root));
    m.insert("txCount".into(), JsonValue::Int(block.tx_count as i64));
    m.insert("producer".into(), JsonValue::str(&block.producer));
    // SEMPRE presentes, `null` no gênese.
    m.insert(
        "publicKey".into(),
        block.public_key.as_ref().map_or(JsonValue::Null, JsonValue::str),
    );
    m.insert(
        "pqPublicKey".into(),
        block.pq_public_key.as_ref().map_or(JsonValue::Null, JsonValue::str),
    );
    // Presença condicionada à altura, exatamente como o spread de `buildBlock`
    // — MENOS no bloco gênese, que é construído por outra função.
    //
    // `buildGenesisBlock` (block.js:63) NUNCA põe `stateRoot` no core, nem quando
    // o fork está em 0 (gênese-ativo): o campo simplesmente não existe no bloco.
    // Aplicar aqui a regra de `buildBlock` fazia o payload da gênese ganhar um
    // `"stateRoot":null` que a referência não tem — outro payload, outro hash, e
    // este cliente REJEITAVA a gênese de qualquer rede de gênese-ativo. Como o
    // gênese é o bloco 0 de tudo, a cadeia inteira era recusada no boot.
    //
    // O que distingue as duas funções é justamente o campo `genesis`.
    let e_genese = block.genesis.is_some();
    match (&block.state_root, !e_genese && block.height >= STATEROOT_HEIGHT) {
        (Some(r), _) => {
            m.insert("stateRoot".into(), JsonValue::str(r));
        }
        (None, true) => {
            m.insert("stateRoot".into(), JsonValue::Null);
        }
        (None, false) => {}
    }
    if let Some(conta) = &block.producer_account {
        m.insert("producerAccount".into(), JsonValue::str(conta));
    }
    if let Some(g) = &block.genesis {
        m.insert("genesis".into(), g.clone());
    }
    m
}

/// O payload canônico do bloco — o que é assinado.
pub fn block_payload(block: &Block) -> String {
    canonical_json(&block_core(block))
}

/// A hash do bloco.
///
/// A PARTIR de [`CANONICAL_HASH_HEIGHT`] deriva SÓ do payload assinado. As
/// assinaturas (ECDSA/ML-DSA) são MALEÁVEIS — reencodar `s` para `N−s` produzia
/// outro hash para conteúdo idêntico, ou seja, dois ids válidos do MESMO bloco
/// (achado M1). Derivar do payload torna o id canônico, como já é o da transação.
///
/// Blocos ABAIXO do fork (inclusive o gênese, altura 0) mantêm a fórmula antiga:
/// o histórico já está assinado assim e o replay precisa continuar válido.
pub fn block_hash(payload: &str, signature: &str, pq_signature: &str, height: u64) -> String {
    if height >= CANONICAL_HASH_HEIGHT {
        eav_hash_one(payload)
    } else {
        // Concatenação sem separador, exatamente como `eavHash(a + b + c)` do JS.
        eav_hash_one(format!("{payload}{signature}{pq_signature}"))
    }
}

/// A raiz de Merkle das transações de um bloco.
///
/// # A ambiguidade do `id` ausente, reproduzida de propósito
///
/// A referência faz `transactions.map((tx) => tx?.id)`; uma transação sem `id`
/// vira `undefined`, e o `merkleRoot` do JS concatena isso como a STRING
/// `"undefined"`. Emitir aqui qualquer outra coisa (pular, usar vazio, hash de
/// zero) daria uma raiz diferente da que a rede calcula para o mesmo bloco.
/// Nenhum bloco válido chega nesse estado — mas um bloco FORJADO chega, e é
/// justamente onde a divergência interessaria a um atacante.
pub fn block_tx_root(transactions: &[Tx]) -> String {
    let ids: Vec<String> = transactions
        .iter()
        .map(|tx| tx.id.clone().unwrap_or_else(|| "undefined".to_string()))
        .collect();
    merkle_root(&ids)
}

// ============================================================================
// Construção
// ============================================================================

/// Quem detém o material secreto e assina o bloco.
///
/// É um trait, e não uma struct com as chaves privadas, pela mesma razão que
/// `signature.rs` só verifica: um validador nunca precisa manipular chave privada
/// dentro do código de consenso. A carteira (ou um HSM, ou um assinante remoto)
/// implementa isto e o consenso só pede a assinatura da carga.
pub trait BlockSigner {
    /// PEM da chave pública ECDSA secp256k1.
    fn public_key_pem(&self) -> &str;
    /// PEM da chave pública ML-DSA-44.
    fn pq_public_key_pem(&self) -> &str;
    /// Assina a carga, devolvendo `(assinatura, assinatura_pq)` em base64 — o
    /// mesmo par que `hybridSign` da referência produz.
    fn sign(&self, payload: &[u8]) -> Result<(String, String), BlockError>;
}

/// Parâmetros de [`build_block`]. Espelha o objeto de opções de `buildBlock`.
#[derive(Debug, Clone)]
pub struct BuildParams {
    pub height: u64,
    pub previous_hash: String,
    pub timestamp: i64,
    pub transactions: Vec<Tx>,
    /// Raiz do estado APÓS o bloco. Ignorada abaixo de [`STATEROOT_HEIGHT`].
    pub state_root: Option<String>,
    /// Conta produtora, quando a produção é delegada a uma chave `witness`.
    /// Ignorada abaixo de [`PERMISSIONS_V2_HEIGHT`].
    pub producer_account: Option<String>,
}

/// Monta e assina um bloco. Espelha `buildBlock`.
///
/// A ordem importa: o core é montado, o payload dele é assinado, e só então o hash
/// é derivado do payload (e, abaixo do fork, também das assinaturas). Hashear antes
/// de assinar daria um hash que não cobre o que foi assinado.
pub fn build_block(signer: &dyn BlockSigner, p: BuildParams) -> Result<Block, BlockError> {
    let producer = address_from_public_keys(signer.public_key_pem(), signer.pq_public_key_pem())
        .map_err(|e| format!("chave pública do produtor inválida: {e}"))?;

    let mut block = Block {
        protocol: PROTOCOL.to_string(),
        version: PROTOCOL_VERSION,
        scheme: SIGNATURE_SCHEME.to_string(),
        height: p.height,
        timestamp: p.timestamp,
        previous_hash: p.previous_hash,
        tx_root: block_tx_root(&p.transactions),
        tx_count: p.transactions.len(),
        producer,
        public_key: Some(signer.public_key_pem().to_string()),
        pq_public_key: Some(signer.pq_public_key_pem().to_string()),
        // Os dois campos só entram no core a partir do respectivo fork — abaixo
        // dele o bloco serializa exatamente como sempre serializou, que é o que
        // mantém o histórico verificável sem hard fork retroativo.
        state_root: if p.height >= STATEROOT_HEIGHT { p.state_root } else { None },
        producer_account: if p.height >= PERMISSIONS_V2_HEIGHT { p.producer_account } else { None },
        genesis: None,
        signature: String::new(),
        pq_signature: String::new(),
        hash: String::new(),
        transactions: p.transactions,
    };

    let payload = block_payload(&block);
    let (assinatura, assinatura_pq) = signer.sign(payload.as_bytes())?;
    block.hash = block_hash(&payload, &assinatura, &assinatura_pq, block.height);
    block.signature = assinatura;
    block.pq_signature = assinatura_pq;
    Ok(block)
}

/// Monta o bloco gênese. Espelha `buildGenesisBlock`.
///
/// Sem produtor real: as sentinelas `GENESIS` ocupam o lugar das assinaturas e do
/// produtor, e `verify_block_integrity` exige exatamente elas na altura 0.
pub fn build_genesis_block(timestamp: i64, alocacoes: JsonValue) -> Block {
    let mut block = Block {
        protocol: PROTOCOL.to_string(),
        version: PROTOCOL_VERSION,
        scheme: SIGNATURE_SCHEME.to_string(),
        height: 0,
        timestamp,
        previous_hash: GENESIS_PREVIOUS_HASH.to_string(),
        tx_root: merkle_root(&[]),
        tx_count: 0,
        producer: GENESIS_PRODUCER.to_string(),
        public_key: None,
        pq_public_key: None,
        state_root: None,
        producer_account: None,
        genesis: Some(alocacoes),
        signature: GENESIS_SIGNATURE.to_string(),
        pq_signature: GENESIS_SIGNATURE.to_string(),
        hash: String::new(),
        transactions: Vec::new(),
    };
    let payload = block_payload(&block);
    // MESMA função de hash do verify: com `CANONICAL_HASH_HEIGHT = 0` (gênese-ativo)
    // a altura 0 usa payload-only; com fork alto, mantém a fórmula antiga.
    block.hash = block_hash(&payload, GENESIS_SIGNATURE, GENESIS_SIGNATURE, 0);
    block
}

// ============================================================================
// Integridade
// ============================================================================

/// Integridade INTERNA do bloco: protocolo, faixas, `txRoot`, hash e a dupla
/// assinatura do produtor. Espelha `verifyBlockIntegrity`.
///
/// Regras de ENCADEAMENTO (altura em relação à cabeça, `previousHash`, slot DPoS,
/// `stateRoot` conferido contra o estado, `witness` ligado à conta) ficam na
/// cadeia, porque dependem de estado. Esta função é PURA — é o que permite usá-la
/// como juiz de evidência no `SLASH_DOUBLE_SIGN`, onde não há cadeia à mão.
///
/// `Ok(())` corresponde ao `null` da referência; `Err(msg)` traz a mesma mensagem.
pub fn verify_block_integrity(block: &Block) -> Result<(), BlockError> {
    if block.protocol != PROTOCOL {
        return Err(format!("protocolo inválido (esperado {PROTOCOL})"));
    }
    if block.scheme != SIGNATURE_SCHEME {
        return Err(format!("esquema de assinatura inválido (esperado {SIGNATURE_SCHEME})"));
    }
    // `height < 0` é impossível em `u64` — a checagem que sobra é a de faixa
    // segura, e ela NÃO é decorativa: acima de 2⁵³ o nó de referência releria
    // outro número e computaria outro hash para o mesmo bloco.
    if block.height > MAX_SAFE_INTEGER as u64 {
        return Err("altura inválida".into());
    }
    if block.timestamp <= 0 || block.timestamp > MAX_SAFE_INTEGER {
        return Err("timestamp inválido".into());
    }
    // A referência ainda checa `Array.isArray(block.transactions)`; aqui o tipo já
    // garante isso, e por isso não há mensagem 'lista de transações inválida'.
    if block.tx_count != block.transactions.len() {
        return Err("txCount não confere".into());
    }
    if block.tx_root != block_tx_root(&block.transactions) {
        return Err("txRoot não confere".into());
    }

    let payload = block_payload(block);
    if block.hash != block_hash(&payload, &block.signature, &block.pq_signature, block.height) {
        return Err("hash do bloco não confere".into());
    }

    // O gênese valida por regras próprias (sem produtor, sem stateRoot) — e é
    // checado ANTES da regra estrutural do `stateRoot`, senão com
    // `STATEROOT_HEIGHT = 0` (gênese-ativo) o próprio gênese seria rejeitado por
    // não ter o campo. A ordem aqui é regra, não estilo.
    if block.height == 0 {
        if block.signature != GENESIS_SIGNATURE || block.producer != GENESIS_PRODUCER {
            return Err("bloco gênese malformado".into());
        }
        match &block.genesis {
            Some(JsonValue::Map(_)) => return Ok(()),
            _ => return Err("alocações da gênese ausentes".into()),
        }
    }

    // Estrutural: acima do fork o `stateRoot` é obrigatório; abaixo, proibido. O
    // VALOR é conferido contra o estado no `add_block`; aqui só a forma.
    if block.height >= STATEROOT_HEIGHT {
        match &block.state_root {
            Some(r) if is_valid_hash(r) => {}
            _ => return Err("stateRoot ausente ou malformado".into()),
        }
    } else if block.state_root.is_some() {
        return Err("stateRoot presente antes do fork (STATEROOT_HEIGHT)".into());
    }

    // Forma do `producerAccount`. A ligação witness→conta depende do ESTADO e por
    // isso é conferida na cadeia — esta função permanece sem estado.
    if let Some(conta) = &block.producer_account {
        if block.height < PERMISSIONS_V2_HEIGHT {
            return Err("producerAccount antes do fork".into());
        }
        if !crate::address::is_valid_address(conta) {
            return Err("producerAccount inválido".into());
        }
        if conta == &block.producer {
            return Err("producerAccount igual ao produtor (redundante)".into());
        }
    }

    let (pk, pqpk) = match (&block.public_key, &block.pq_public_key) {
        (Some(a), Some(b)) => (a.as_str(), b.as_str()),
        // `addressFromPublicKeys(null, ...)` lança na referência e cai no mesmo
        // `catch` — logo, mesma mensagem.
        _ => return Err("chave pública do produtor inválida".into()),
    };
    let derivado = address_from_public_keys(pk, pqpk)
        .map_err(|_| "chave pública do produtor inválida".to_string())?;
    if derivado != block.producer {
        return Err("produtor não corresponde às chaves públicas".into());
    }
    if !hybrid_verify(pk, pqpk, payload.as_bytes(), &block.signature, &block.pq_signature) {
        return Err("assinatura híbrida do produtor inválida".into());
    }
    Ok(())
}

// ============================================================================
// Bloco a partir de JSON — a porta de entrada da evidência de slashing
// ============================================================================

fn campo<'a>(m: &'a BTreeMap<String, JsonValue>, chave: &str) -> Option<&'a JsonValue> {
    m.get(chave)
}

fn texto(v: Option<&JsonValue>) -> Option<&str> {
    match v {
        Some(JsonValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

fn texto_ou_nulo(v: Option<&JsonValue>) -> Result<Option<String>, BlockError> {
    match v {
        None | Some(JsonValue::Null) => Ok(None),
        Some(JsonValue::Str(s)) => Ok(Some(s.clone())),
        _ => Err("campo de texto inválido".into()),
    }
}

fn inteiro(v: Option<&JsonValue>) -> Option<i64> {
    match v {
        Some(JsonValue::Int(n)) => Some(*n),
        _ => None,
    }
}

/// Texto obrigatório com padrão para o caso AUSENTE — mas erro para o caso de TIPO
/// ERRADO. A distinção não é preciosismo: `JSON.stringify` omite `undefined`, então
/// uma chave ausente é uma forma legítima que a referência produz e o padrão a
/// reproduz. Já um `amount` que chegue como NÚMERO não é omissão, é outro formato —
/// e cair no padrão `"0"` ali transformaria uma transação estranha numa transação
/// de valor zero que parece válida, em silêncio, dentro de um bloco persistido.
fn texto_com_padrao(v: Option<&JsonValue>, padrao: &str) -> Result<String, BlockError> {
    match v {
        None => Ok(padrao.to_string()),
        Some(JsonValue::Str(s)) => Ok(s.clone()),
        _ => Err("campo de texto inválido na transação".into()),
    }
}

/// Idem para inteiro. `nonce`/`timestamp` são `number` no JS.
fn inteiro_com_padrao(v: Option<&JsonValue>, padrao: i64) -> Result<i64, BlockError> {
    match v {
        None => Ok(padrao),
        Some(JsonValue::Int(n)) => Ok(*n),
        _ => Err("campo numérico inválido na transação".into()),
    }
}

/// Serializa uma transação INTEIRA. Inverso exato de [`tx_from_json`].
///
/// A regra de presença é a de `JSON.stringify` sobre o objeto que a referência
/// mantém em memória, e não a de [`crate::transaction::tx_signing_payload`] — são
/// coisas diferentes e vale fixar a diferença:
///
/// - `to` SEMPRE aparece, `null` quando não há destino (STAKE, VOTE…). É assim no
///   payload assinado e é assim no objeto, porque a referência atribui `null`
///   explicitamente em vez de deixar o campo `undefined`.
/// - `data`, `publicKey`, `pqPublicKey` são OMITIDOS quando ausentes — `undefined`
///   não sobrevive ao `stringify`, e emitir `null` no lugar mudaria o payload
///   assinado ao reler (uma transação sem `data` e uma com `data:null` têm ids
///   diferentes), portanto mudaria o `txRoot` e o hash do bloco.
/// - `signature`, `pqSignature`, `id` ficam FORA do payload assinado, mas dentro do
///   objeto persistido: sem eles o bloco relido do disco não teria como recompor o
///   `txRoot` (que é a árvore dos `id`) nem como ser reverificado.
pub fn tx_to_json(tx: &Tx) -> JsonValue {
    let mut m: BTreeMap<String, JsonValue> = BTreeMap::new();
    m.insert("protocol".into(), JsonValue::str(&tx.protocol));
    m.insert("scheme".into(), JsonValue::str(&tx.scheme));
    // `type` é palavra reservada em Rust, mas a chave da rede continua `type`.
    m.insert("type".into(), JsonValue::str(&tx.tx_type));
    m.insert("from".into(), JsonValue::str(&tx.from));
    m.insert("to".into(), tx.to.as_ref().map_or(JsonValue::Null, JsonValue::str));
    m.insert("amount".into(), JsonValue::str(&tx.amount));
    m.insert("fee".into(), JsonValue::str(&tx.fee));
    m.insert("nonce".into(), JsonValue::Int(tx.nonce));
    m.insert("timestamp".into(), JsonValue::Int(tx.timestamp));
    // Daqui para baixo: omitir, nunca anular. Ver a nota acima.
    if let Some(d) = &tx.data {
        m.insert("data".into(), d.clone());
    }
    if let Some(k) = &tx.public_key {
        m.insert("publicKey".into(), JsonValue::str(k));
    }
    if let Some(k) = &tx.pq_public_key {
        m.insert("pqPublicKey".into(), JsonValue::str(k));
    }
    if let Some(s) = &tx.signature {
        m.insert("signature".into(), JsonValue::str(s));
    }
    if let Some(s) = &tx.pq_signature {
        m.insert("pqSignature".into(), JsonValue::str(s));
    }
    if let Some(i) = &tx.id {
        m.insert("id".into(), JsonValue::str(i));
    }
    JsonValue::Map(m)
}

/// Reconstrói uma transação a partir do JSON de um bloco. COMPLETA: todos os campos
/// de [`Tx`], não só o `id`.
///
/// Antes servia só à evidência de `SLASH_DOUBLE_SIGN`, que consome apenas `tx.id` e
/// o comprimento da lista. Isso deixou de bastar quando o bloco passou a voltar do
/// `blocks.jsonl` no boot: ali a transação relida é a transação, e um campo perdido
/// na leitura muda o payload assinado, muda o `id`, muda o `txRoot` e faz o nó
/// rejeitar o próprio histórico. Por isso agora é fiel campo a campo.
///
/// A distinção AUSENTE × NULO é preservada porque o protocolo depende dela: um
/// `data` ausente e um `data: null` dão ids diferentes. Campo com TIPO errado é
/// erro, não padrão — ver [`texto_com_padrao`].
pub fn tx_from_json(v: &JsonValue) -> Result<Tx, BlockError> {
    let JsonValue::Map(m) = v else {
        return Err("transação inválida na evidência".into());
    };
    Ok(Tx {
        protocol: texto_com_padrao(campo(m, "protocol"), "")?,
        scheme: texto_com_padrao(campo(m, "scheme"), "")?,
        tx_type: texto_com_padrao(campo(m, "type"), "")?,
        from: texto_com_padrao(campo(m, "from"), "")?,
        // `to` distingue nulo de ausente na forma, mas as duas colapsam em `None`
        // — é o que `tx_signing_payload` já faz ao emitir `null` para `None`.
        to: texto_ou_nulo(campo(m, "to"))?,
        amount: texto_com_padrao(campo(m, "amount"), "0")?,
        fee: texto_com_padrao(campo(m, "fee"), "0")?,
        nonce: inteiro_com_padrao(campo(m, "nonce"), 0)?,
        timestamp: inteiro_com_padrao(campo(m, "timestamp"), 0)?,
        // `data` fica cru: qualquer tipagem aqui descartaria campo desconhecido e
        // mudaria o `id` recalculado da transação.
        data: campo(m, "data").cloned(),
        public_key: texto_ou_nulo(campo(m, "publicKey"))?,
        pq_public_key: texto_ou_nulo(campo(m, "pqPublicKey"))?,
        signature: texto_ou_nulo(campo(m, "signature"))?,
        pq_signature: texto_ou_nulo(campo(m, "pqSignature"))?,
        id: texto_ou_nulo(campo(m, "id"))?,
    })
}

/// Reconstrói um [`Block`] a partir do JSON — o formato em que a evidência de
/// `SLASH_DOUBLE_SIGN` chega dentro de `tx.data`.
///
/// Existe para que o slashing possa chamar [`verify_block_integrity`] sobre os dois
/// blocos-evidência sem que `state/value.rs` precise conhecer a estrutura do bloco.
///
/// Falha (em vez de preencher com padrão) em tudo que muda o PAYLOAD assinado:
/// um campo que chegasse como número onde a rede grava texto produziria outro hash
/// e a evidência seria julgada contra um bloco que nunca existiu.
pub fn block_from_json(v: &JsonValue) -> Result<Block, BlockError> {
    let JsonValue::Map(m) = v else {
        return Err("bloco ausente".into());
    };
    let height = match inteiro(campo(m, "height")) {
        Some(h) if h >= 0 => h as u64,
        _ => return Err("altura inválida".into()),
    };
    let transacoes = match campo(m, "transactions") {
        Some(JsonValue::List(itens)) => {
            itens.iter().map(tx_from_json).collect::<Result<Vec<_>, _>>()?
        }
        // A referência devolve 'lista de transações inválida' quando o campo não é
        // array; aqui o erro nasce na conversão, com a mesma mensagem.
        _ => return Err("lista de transações inválida".into()),
    };
    let tx_count = match inteiro(campo(m, "txCount")) {
        Some(n) if n >= 0 => n as usize,
        _ => return Err("txCount não confere".into()),
    };
    Ok(Block {
        protocol: texto(campo(m, "protocol")).unwrap_or_default().to_string(),
        version: inteiro(campo(m, "version")).unwrap_or(0),
        scheme: texto(campo(m, "scheme")).unwrap_or_default().to_string(),
        height,
        timestamp: inteiro(campo(m, "timestamp")).unwrap_or(0),
        previous_hash: texto(campo(m, "previousHash")).unwrap_or_default().to_string(),
        tx_root: texto(campo(m, "txRoot")).unwrap_or_default().to_string(),
        tx_count,
        producer: texto(campo(m, "producer")).unwrap_or_default().to_string(),
        public_key: texto_ou_nulo(campo(m, "publicKey"))?,
        pq_public_key: texto_ou_nulo(campo(m, "pqPublicKey"))?,
        state_root: texto_ou_nulo(campo(m, "stateRoot"))?,
        producer_account: texto_ou_nulo(campo(m, "producerAccount"))?,
        genesis: campo(m, "genesis").cloned(),
        signature: texto(campo(m, "signature")).unwrap_or_default().to_string(),
        pq_signature: texto(campo(m, "pqSignature")).unwrap_or_default().to_string(),
        hash: texto(campo(m, "hash")).unwrap_or_default().to_string(),
        transactions: transacoes,
    })
}

/// Serializa o bloco INTEIRO — o inverso exato de [`block_from_json`].
///
/// `block_from_json(&block_to_json(&b)) == b` para qualquer bloco, e — o que de
/// fato importa — o hash recomputado do bloco que volta bate com o original. Não
/// bater significaria o nó rejeitar o próprio histórico no boot.
///
/// # Onde a OMISSÃO é o que mantém o hash
///
/// O corpo do core sai de [`block_core_map`], a MESMA função que monta a pré-imagem
/// da assinatura — e não de uma segunda lista de campos escrita aqui. Duas listas
/// divergiriam no dia em que um fork acrescentasse um campo, e a divergência
/// apareceria como cadeia irrelível, não como erro de compilação.
///
/// Isso importa porque três campos são OMITIDOS, não anulados, e a omissão muda o
/// payload: `stateRoot` abaixo de [`STATEROOT_HEIGHT`], `producerAccount` sem
/// witness, `genesis` fora do bloco 0. Emitir `"stateRoot":null` num bloco antigo
/// daria outra pré-imagem, logo outro hash, logo um bloco que a rede não reconhece.
/// `publicKey`/`pqPublicKey` são o caso oposto — sempre presentes, `null` no gênese.
pub fn block_to_json(block: &Block) -> JsonValue {
    let mut m = block_core_map(block);
    // Os quatro de fora do core. Nenhum é opcional no objeto persistido: sem
    // `transactions` o bloco relido nem chega a ser conferido (`block_from_json`
    // exige a lista), e sem as assinaturas o replay de um bloco ABAIXO de
    // `CANONICAL_HASH_HEIGHT` não fecha, porque lá o hash ainda as cobre.
    m.insert("signature".into(), JsonValue::str(&block.signature));
    m.insert("pqSignature".into(), JsonValue::str(&block.pq_signature));
    m.insert("hash".into(), JsonValue::str(&block.hash));
    m.insert(
        "transactions".into(),
        JsonValue::List(block.transactions.iter().map(tx_to_json).collect()),
    );
    JsonValue::Map(m)
}

/// A LINHA do bloco no `blocks.jsonl`: uma linha, um bloco.
///
/// Usa [`canonical_json`] em vez de um serializador qualquer porque é a mesma
/// escrita que já produz o payload assinado — mesma tabela de escape do
/// `JSON.stringify`, mesma ordenação por unidade de código UTF-16. Um segundo
/// serializador aqui seria um segundo lugar onde o escape pode divergir.
///
/// A recusa da quebra de linha é defesa em profundidade: `canonical_json` escapa
/// `\n` como `\\n` e todo controle abaixo de 0x20, então uma quebra crua não deveria
/// existir. Mas o custo de conferir é uma varredura, e o custo de NÃO conferir é o
/// [`crate::blockstore`] indexar UM bloco como DOIS e desalinhar todas as alturas
/// seguintes — corrupção que só aparece no boot seguinte. Erro em vez de pânico
/// porque quem chama (`add_block`) precisa poder recusar o bloco, não morrer.
pub fn block_to_json_line(block: &Block) -> Result<String, BlockError> {
    let linha = canonical_json(&block_to_json(block));
    if linha.contains('\n') {
        return Err("linha do bloco contém quebra de linha".into());
    }
    Ok(linha)
}

// ============================================================================
// Testes
// ============================================================================

#[cfg(test)]
pub(crate) mod teste_util {
    //! Carteira de teste: gera um par híbrido determinístico e assina de verdade.
    //!
    //! Assinar em teste não é conveniência — é a única forma de exercitar
    //! `verify_block_integrity` e a cadeia INTEIRA no caminho real. Um atalho que
    //! pulasse a verificação criptográfica deixaria justamente o caminho de
    //! consenso sem cobertura.
    //!
    //! As chaves saem de SEMENTE FIXA: `k256::SigningKey::from_bytes` e
    //! `ml_dsa::SigningKey::from_seed` são determinísticos, então o teste não
    //! depende de aleatoriedade nem de entropia do sistema.

    use super::{BlockError, BlockSigner};
    use k256::ecdsa::signature::Signer as _;
    use k256::pkcs8::EncodePublicKey as _;
    use ml_dsa::MlDsa44;

    /// Base64 padrão (RFC 4648) com preenchimento — o formato em que assinatura e
    /// SPKI trafegam. Dez linhas em vez de uma dependência, como já faz
    /// `signature.rs` do lado da decodificação.
    pub fn b64(dados: &[u8]) -> String {
        const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut s = String::new();
        for pedaco in dados.chunks(3) {
            let b0 = pedaco[0] as u32;
            let b1 = *pedaco.get(1).unwrap_or(&0) as u32;
            let b2 = *pedaco.get(2).unwrap_or(&0) as u32;
            let n = (b0 << 16) | (b1 << 8) | b2;
            s.push(A[(n >> 18) as usize & 63] as char);
            s.push(A[(n >> 12) as usize & 63] as char);
            s.push(if pedaco.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
            s.push(if pedaco.len() > 2 { A[n as usize & 63] as char } else { '=' });
        }
        s
    }

    fn pem(der: &[u8]) -> String {
        let corpo = b64(der);
        let mut linhas = String::from("-----BEGIN PUBLIC KEY-----\n");
        for pedaco in corpo.as_bytes().chunks(64) {
            linhas.push_str(std::str::from_utf8(pedaco).unwrap_or(""));
            linhas.push('\n');
        }
        linhas.push_str("-----END PUBLIC KEY-----\n");
        linhas
    }

    pub struct Carteira {
        ec: k256::ecdsa::SigningKey,
        pq: ml_dsa::SigningKey<MlDsa44>,
        pk_pem: String,
        pq_pem: String,
    }

    impl Carteira {
        /// Carteira determinística a partir de um byte de semente.
        pub fn nova(semente: u8) -> Self {
            // Semente 0 não é escalar válido para secp256k1; o `+1` evita o caso.
            let ec = k256::ecdsa::SigningKey::from_bytes(&[semente.wrapping_add(1); 32].into())
                .expect("semente fixa é escalar válido");
            let mut b32 = ml_dsa::B32::default();
            b32.fill(semente);
            let pq = ml_dsa::SigningKey::<MlDsa44>::from_seed(&b32);
            let pk_der = ec.verifying_key().to_public_key_der().expect("SPKI ECDSA");
            let pq_der = ml_dsa::Keypair::verifying_key(&pq)
                .to_public_key_der()
                .expect("SPKI ML-DSA");
            let pk_pem = pem(pk_der.as_bytes());
            let pq_pem = pem(pq_der.as_bytes());
            Self { ec, pq, pk_pem, pq_pem }
        }

        pub fn endereco(&self) -> String {
            crate::signature::address_from_public_keys(&self.pk_pem, &self.pq_pem)
                .expect("chaves de teste são válidas")
        }
    }

    impl BlockSigner for Carteira {
        fn public_key_pem(&self) -> &str {
            &self.pk_pem
        }
        fn pq_public_key_pem(&self) -> &str {
            &self.pq_pem
        }
        fn sign(&self, payload: &[u8]) -> Result<(String, String), BlockError> {
            let ec: k256::ecdsa::Signature = self.ec.sign(payload);
            let pq: ml_dsa::Signature<MlDsa44> = ml_dsa::signature::Signer::sign(&self.pq, payload);
            Ok((b64(ec.to_der().as_bytes()), b64(pq.encode().as_slice())))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::teste_util::Carteira;
    use super::*;

    fn params(height: u64) -> BuildParams {
        BuildParams {
            height,
            previous_hash: "a".repeat(64),
            timestamp: 1_700_000_000_000,
            transactions: Vec::new(),
            state_root: if height >= STATEROOT_HEIGHT { Some("b".repeat(64)) } else { None },
            producer_account: None,
        }
    }

    fn bloco(height: u64) -> Block {
        build_block(&Carteira::nova(1), params(height)).expect("construção")
    }

    #[test]
    fn bloco_construido_passa_na_integridade() {
        assert_eq!(verify_block_integrity(&bloco(1_300_000)), Ok(()));
        assert_eq!(verify_block_integrity(&bloco(900_000)), Ok(()));
    }

    #[test]
    fn assinatura_trocada_invalida_o_bloco_acima_do_fork_canonico() {
        // Acima de CANONICAL_HASH_HEIGHT o hash NÃO cobre a assinatura, então
        // trocá-la mantém o hash — e é a verificação híbrida que tem de pegar.
        // Este é o cenário do achado M1: se a assinatura entrasse no hash, o
        // atacante teria dois ids válidos para o mesmo bloco.
        let mut b = bloco(1_300_000);
        let hash_original = b.hash.clone();
        b.signature = "AAAA".into();
        assert_eq!(b.hash, hash_original, "o hash canônico não pode depender da assinatura");
        assert_eq!(
            verify_block_integrity(&b),
            Err("assinatura híbrida do produtor inválida".into())
        );
    }

    #[test]
    fn abaixo_do_fork_a_assinatura_entra_no_hash() {
        let b = bloco(900_000);
        let payload = block_payload(&b);
        assert_eq!(b.hash, eav_hash_one(format!("{payload}{}{}", b.signature, b.pq_signature)));
        assert_ne!(b.hash, eav_hash_one(&payload), "fórmula antiga inclui as assinaturas");
    }

    #[test]
    fn txroot_detecta_adulteracao_de_transacao() {
        let carteira = Carteira::nova(1);
        let mut tx = Tx::new("TRANSFER", carteira.endereco(), 1, 1_700_000_000_000);
        tx.id = Some(crate::transaction::tx_id(&tx));
        let mut p = params(1_300_000);
        p.transactions = vec![tx];
        let mut b = build_block(&carteira, p).expect("construção");
        assert_eq!(verify_block_integrity(&b), Ok(()));

        // Trocar o conteúdo da transação muda o `id`, logo a raiz.
        b.transactions[0].amount = "999".into();
        b.transactions[0].id = Some(crate::transaction::tx_id(&b.transactions[0]));
        assert_eq!(verify_block_integrity(&b), Err("txRoot não confere".into()));
    }

    #[test]
    fn txcount_tem_de_bater_com_a_lista() {
        let mut b = bloco(1_300_000);
        b.tx_count = 1;
        assert_eq!(verify_block_integrity(&b), Err("txCount não confere".into()));
    }

    #[test]
    fn stateroot_e_obrigatorio_acima_do_fork_e_proibido_abaixo() {
        let carteira = Carteira::nova(1);

        // Acima do fork sem raiz: `buildBlock` emite `stateRoot: null`, e a regra
        // estrutural rejeita.
        let mut p = params(1_300_000);
        p.state_root = None;
        let b = build_block(&carteira, p).expect("construção");
        assert_eq!(verify_block_integrity(&b), Err("stateRoot ausente ou malformado".into()));

        // Abaixo do fork COM raiz: o campo é proibido. Precisa ser injetado depois
        // da construção porque `build_block` o descarta — é o caso do bloco forjado.
        let mut b = bloco(900_000);
        b.state_root = Some("b".repeat(64));
        let payload = block_payload(&b);
        b.hash = block_hash(&payload, &b.signature, &b.pq_signature, b.height);
        // O hash volta a bater, mas a assinatura cobre o payload ANTIGO — a rejeição
        // vem da assinatura, e não da regra estrutural. Registrado porque a ORDEM
        // das checagens é o que decide qual mensagem sai.
        assert!(verify_block_integrity(&b).is_err());
    }

    #[test]
    fn produceraccount_so_vale_acima_do_fork_de_permissoes() {
        let carteira = Carteira::nova(1);
        let outra = Carteira::nova(2);
        let mut p = params(1_950_000);
        p.producer_account = Some(outra.endereco());
        let b = build_block(&carteira, p).expect("construção");
        assert_eq!(verify_block_integrity(&b), Ok(()));
        assert_eq!(block_validator(&b), outra.endereco(), "o validador efetivo é a CONTA");

        // Abaixo do fork o campo é descartado na construção — e o validador volta
        // a ser a chave assinante.
        let mut p = params(1_300_000);
        p.producer_account = Some(outra.endereco());
        let b = build_block(&carteira, p).expect("construção");
        assert_eq!(b.producer_account, None);
        assert_eq!(block_validator(&b), carteira.endereco());
    }

    #[test]
    fn produceraccount_igual_ao_produtor_e_redundante() {
        let carteira = Carteira::nova(1);
        let mut p = params(1_950_000);
        p.producer_account = Some(carteira.endereco());
        let b = build_block(&carteira, p).expect("construção");
        assert_eq!(
            verify_block_integrity(&b),
            Err("producerAccount igual ao produtor (redundante)".into())
        );
    }

    #[test]
    fn genesis_tem_regras_proprias() {
        let alocacoes = JsonValue::map([("balances".to_string(), JsonValue::map([]))]);
        let g = build_genesis_block(1_700_000_000_000, alocacoes);
        assert_eq!(verify_block_integrity(&g), Ok(()));
        assert_eq!(g.previous_hash, GENESIS_PREVIOUS_HASH);
        assert_eq!(g.previous_hash.len(), HASH_LENGTH);

        let mut sem_alocacoes = g.clone();
        sem_alocacoes.genesis = None;
        let payload = block_payload(&sem_alocacoes);
        sem_alocacoes.hash = block_hash(&payload, GENESIS_SIGNATURE, GENESIS_SIGNATURE, 0);
        assert_eq!(
            verify_block_integrity(&sem_alocacoes),
            Err("alocações da gênese ausentes".into())
        );

        let mut produtor_falso = g.clone();
        produtor_falso.producer = "E7AA".into();
        let payload = block_payload(&produtor_falso);
        produtor_falso.hash = block_hash(&payload, GENESIS_SIGNATURE, GENESIS_SIGNATURE, 0);
        assert_eq!(verify_block_integrity(&produtor_falso), Err("bloco gênese malformado".into()));
    }

    #[test]
    fn protocolo_e_esquema_sao_conferidos() {
        let mut b = bloco(1_300_000);
        b.protocol = "eav19".into();
        assert_eq!(verify_block_integrity(&b), Err("protocolo inválido (esperado eav20)".into()));

        let mut b = bloco(1_300_000);
        b.scheme = "outro".into();
        assert_eq!(
            verify_block_integrity(&b),
            Err("esquema de assinatura inválido (esperado eav7-hybrid-1)".into())
        );
    }

    #[test]
    fn produtor_tem_de_corresponder_as_chaves() {
        let mut b = bloco(1_300_000);
        b.producer = Carteira::nova(2).endereco();
        let payload = block_payload(&b);
        b.hash = block_hash(&payload, &b.signature, &b.pq_signature, b.height);
        // O hash foi recomputado; a divergência que sobra é produtor × chaves.
        assert_eq!(
            verify_block_integrity(&b),
            Err("produtor não corresponde às chaves públicas".into())
        );
    }

    #[test]
    fn hash_adulterado_e_rejeitado() {
        let mut b = bloco(1_300_000);
        b.hash = "c".repeat(64);
        assert_eq!(verify_block_integrity(&b), Err("hash do bloco não confere".into()));
    }

    #[test]
    fn ida_e_volta_por_json_preserva_o_payload() {
        // É o que o slashing precisa: a evidência chega como JSON e tem de produzir
        // o MESMO payload — senão a verificação julga um bloco que nunca existiu.
        let b = bloco(1_300_000);
        let json = block_to_json(&b);
        let reconstruido = block_from_json(&json).expect("conversão");
        assert_eq!(block_payload(&reconstruido), block_payload(&b));
        assert_eq!(verify_block_integrity(&reconstruido), Ok(()));
    }

    #[test]
    fn evidencia_sem_lista_de_transacoes_e_rejeitada() {
        let json = JsonValue::map([("height".to_string(), JsonValue::Int(5))]);
        assert_eq!(block_from_json(&json), Err("lista de transações inválida".into()));
    }

    // ========================================================================
    // Ida e volta pelo disco (`blocks.jsonl`)
    //
    // As alturas saem SEMPRE de `crate::config` por aritmética. Um literal aqui
    // continuaria verde no dia em que o fork fosse remarcado — que é exatamente o
    // dia em que este teste precisaria ficar vermelho.
    // ========================================================================

    /// Confere a propriedade que o armazenamento exige: struct idêntica E hash
    /// recomputado igual. A segunda é a que decide se o nó aceita o próprio
    /// histórico no boot; a primeira só explica melhor a falha quando quebra.
    fn confere_ida_e_volta(b: &Block) {
        let json = block_to_json(b);
        let voltou = block_from_json(&json).expect("bloco tem de voltar do JSON");
        assert_eq!(&voltou, b, "a struct não sobreviveu à ida e volta");

        let payload = block_payload(&voltou);
        assert_eq!(payload, block_payload(b), "o payload assinado mudou");
        assert_eq!(
            block_hash(&payload, &voltou.signature, &voltou.pq_signature, voltou.height),
            b.hash,
            "o hash recomputado não bate: o nó rejeitaria o próprio histórico"
        );

        // E pela linha de disco, que é o caminho real: canonical → parse é feito
        // aqui pelo próprio `block_to_json`, mas a linha tem de ser gravável.
        let linha = block_to_json_line(b).expect("linha");
        assert!(!linha.contains('\n'), "uma quebra dividiria o bloco em duas entradas");
        assert_eq!(linha, canonical_json(&json), "a linha é o canônico do mesmo JSON");
    }

    /// Bloco com transações ASSINADAS de verdade — o caso que importa, porque é o
    /// `id` real de cada transação que forma o `txRoot` que entra no hash.
    fn bloco_com_transacoes(height: u64) -> Block {
        let carteira = Carteira::nova(1);
        let destino = Carteira::nova(2).endereco();

        let mut t1 = Tx::new("TRANSFER", carteira.endereco(), 1, 1_700_000_000_000);
        t1.to = Some(destino.clone());
        t1.amount = "1000000".into();
        t1.fee = "10000".into();
        t1.data = Some(JsonValue::map([("memo".into(), JsonValue::str("café 😀"))]));
        t1.public_key = Some(carteira.public_key_pem().to_string());
        t1.pq_public_key = Some(carteira.pq_public_key_pem().to_string());
        let (s, ps) = carteira.sign(crate::transaction::tx_signing_payload(&t1).as_bytes())
            .expect("assinatura");
        t1.signature = Some(s);
        t1.pq_signature = Some(ps);
        t1.id = Some(crate::transaction::tx_id(&t1));

        // Segunda transação SEM `to`, SEM `data`: exercita os campos que são
        // omitidos e o `to: null`, que são formas diferentes com ids diferentes.
        let mut t2 = Tx::new("STAKE", carteira.endereco(), 2, 1_700_000_000_001);
        t2.amount = "5000".into();
        t2.public_key = Some(carteira.public_key_pem().to_string());
        t2.pq_public_key = Some(carteira.pq_public_key_pem().to_string());
        let (s, ps) = carteira.sign(crate::transaction::tx_signing_payload(&t2).as_bytes())
            .expect("assinatura");
        t2.signature = Some(s);
        t2.pq_signature = Some(ps);
        t2.id = Some(crate::transaction::tx_id(&t2));

        let mut p = params(height);
        p.transactions = vec![t1, t2];
        build_block(&carteira, p).expect("construção")
    }

    #[test]
    fn ida_e_volta_de_bloco_com_transacoes_assinadas() {
        let b = bloco_com_transacoes(STATEROOT_HEIGHT + 100_000);
        assert_eq!(verify_block_integrity(&b), Ok(()));
        confere_ida_e_volta(&b);

        // A integridade tem de continuar valendo DEPOIS da volta — inclusive a
        // verificação híbrida, que é sobre o payload reconstruído.
        let voltou = block_from_json(&block_to_json(&b)).expect("volta");
        assert_eq!(verify_block_integrity(&voltou), Ok(()));
        assert_eq!(voltou.transactions, b.transactions, "as transações são as mesmas");
    }

    #[test]
    fn ida_e_volta_do_genese() {
        // O gênese é o único bloco com `genesis` e sem `publicKey`: as duas
        // exceções na mesma ida e volta.
        let alocacoes = JsonValue::map([
            ("balances".to_string(), JsonValue::map([("E7AA".into(), JsonValue::str("100"))])),
            ("stakes".to_string(), JsonValue::map([])),
            ("bridgeRelayers".to_string(), JsonValue::List(vec![JsonValue::str("r1")])),
        ]);
        let g = build_genesis_block(1_700_000_000_000, alocacoes);
        assert_eq!(verify_block_integrity(&g), Ok(()));
        confere_ida_e_volta(&g);

        let linha = block_to_json_line(&g).expect("linha");
        assert!(linha.contains("\"publicKey\":null"), "o gênese emite a chave como null");
        assert!(linha.contains("\"genesis\":"), "as alocações entram no hash do gênese");

        let voltou = block_from_json(&block_to_json(&g)).expect("volta");
        assert_eq!(voltou.public_key, None);
        assert_eq!(verify_block_integrity(&voltou), Ok(()));
    }

    #[test]
    fn stateroot_ausente_abaixo_do_fork_e_presente_acima() {
        // ABAIXO: a chave nem pode aparecer. Emitir `"stateRoot":null` aqui daria
        // outra pré-imagem e outro hash — o bloco deixaria de ser o mesmo bloco.
        let abaixo = bloco(STATEROOT_HEIGHT - 1);
        assert_eq!(abaixo.state_root, None);
        let linha = block_to_json_line(&abaixo).expect("linha");
        assert!(!linha.contains("\"stateRoot\""), "abaixo do fork a chave é OMITIDA");
        confere_ida_e_volta(&abaixo);

        // ACIMA: a chave é obrigatória e leva a raiz.
        let acima = bloco(STATEROOT_HEIGHT);
        assert_eq!(acima.state_root, Some("b".repeat(64)));
        assert!(block_to_json_line(&acima).expect("linha").contains("\"stateRoot\":\"bbb"));
        confere_ida_e_volta(&acima);

        // As duas formas dão payloads diferentes — é o que a omissão protege.
        assert_ne!(block_payload(&abaixo), block_payload(&acima));
    }

    #[test]
    fn stateroot_nulo_acima_do_fork_sobrevive_como_nulo() {
        // `build_block` acima do fork sem raiz emite `"stateRoot":null` (ver
        // `block_core`). O bloco é inválido pela regra estrutural, mas tem de ir e
        // voltar do disco IDÊNTICO — senão o nó não conseguiria nem diagnosticar o
        // bloco ruim que ele próprio gravou.
        let mut p = params(STATEROOT_HEIGHT + 1);
        p.state_root = None;
        let b = build_block(&Carteira::nova(1), p).expect("construção");
        assert!(block_to_json_line(&b).expect("linha").contains("\"stateRoot\":null"));
        confere_ida_e_volta(&b);
    }

    #[test]
    fn produceraccount_com_e_sem() {
        let carteira = Carteira::nova(1);
        let outra = Carteira::nova(2);

        let mut p = params(PERMISSIONS_V2_HEIGHT);
        p.producer_account = Some(outra.endereco());
        let com = build_block(&carteira, p).expect("construção");
        assert_eq!(verify_block_integrity(&com), Ok(()));
        assert!(block_to_json_line(&com).expect("linha").contains("\"producerAccount\":"));
        confere_ida_e_volta(&com);
        // O validador EFETIVO tem de sobreviver: é quem recebe recompensa e quem o
        // slashing pune. Perdê-lo na leitura creditaria a conta errada no replay.
        let voltou = block_from_json(&block_to_json(&com)).expect("volta");
        assert_eq!(block_validator(&voltou), outra.endereco());

        let sem = bloco(PERMISSIONS_V2_HEIGHT);
        assert_eq!(sem.producer_account, None);
        assert!(!block_to_json_line(&sem).expect("linha").contains("\"producerAccount\""));
        confere_ida_e_volta(&sem);
    }

    #[test]
    fn a_linha_nunca_contem_quebra_de_linha() {
        // Um `\n` no conteúdo faria o `blockstore` indexar UM bloco como DOIS.
        // Aqui ele entra por onde entraria de verdade: texto controlado pelo
        // usuário dentro de `data`.
        let carteira = Carteira::nova(1);
        let mut tx = Tx::new("TRANSFER", carteira.endereco(), 1, 1_700_000_000_000);
        tx.data = Some(JsonValue::map([
            ("memo".into(), JsonValue::str("linha1\nlinha2\r\ttab\u{0}nulo")),
        ]));
        tx.id = Some(crate::transaction::tx_id(&tx));
        let mut p = params(STATEROOT_HEIGHT + 1);
        p.transactions = vec![tx];
        let b = build_block(&carteira, p).expect("construção");

        let linha = block_to_json_line(&b).expect("linha");
        assert!(!linha.contains('\n'), "o escape do canonical_json tem de neutralizar o \\n");
        assert!(linha.contains("linha1\\nlinha2"), "o \\n vira escape, não some");
        confere_ida_e_volta(&b);
    }

    #[test]
    fn ida_e_volta_de_transacao_isolada_preserva_ausente_e_nulo() {
        // `data` ausente e `data: {}` dão ids DIFERENTES; se a ida e volta
        // confundisse os dois, o `txRoot` do bloco relido mudaria.
        let mut sem = Tx::new("STAKE", "E7AA", 1, 1_700_000_000_000);
        sem.id = Some(crate::transaction::tx_id(&sem));
        let vazio = {
            let mut t = sem.clone();
            t.data = Some(JsonValue::map([]));
            t.id = Some(crate::transaction::tx_id(&t));
            t
        };
        assert_ne!(sem.id, vazio.id);

        for tx in [&sem, &vazio] {
            let voltou = tx_from_json(&tx_to_json(tx)).expect("volta");
            assert_eq!(&voltou, tx);
            assert_eq!(crate::transaction::tx_id(&voltou), crate::transaction::tx_id(tx));
        }
        assert!(!canonical_json(&tx_to_json(&sem)).contains("\"data\""));
        // `to` é o oposto de `data`: sai como `null`, não omitido.
        assert!(canonical_json(&tx_to_json(&sem)).contains("\"to\":null"));
    }

    #[test]
    fn a_linha_atravessa_o_blockstore_de_verdade() {
        // O consumidor real. Um teste que só olha a string não pegaria o caso em
        // que o `append` recusa a linha ou em que a varredura a reparte — que é
        // justamente o modo de falha que corrompe a cadeia em silêncio.
        let mut dir = std::env::temp_dir();
        let carimbo = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        dir.push(format!("eav7-block-linha-{carimbo}"));
        let Ok(()) = std::fs::create_dir_all(&dir) else { return };
        let arquivo = dir.join(crate::blockstore::BLOCKS_FILE);

        let blocos = [
            bloco_com_transacoes(STATEROOT_HEIGHT + 1),
            bloco(STATEROOT_HEIGHT - 1),
            build_genesis_block(1_700_000_000_000, JsonValue::map([(
                "balances".to_string(),
                JsonValue::map([("E7AA".into(), JsonValue::str("1\n2"))]),
            )])),
        ];

        let mut store = crate::blockstore::BlockStore::new(&arquivo);
        for b in &blocos {
            let linha = block_to_json_line(b).expect("linha");
            store.append(&linha).expect("o blockstore tem de aceitar a linha");
        }

        // Reabre do zero: é o boot. O índice é reconstruído do arquivo, e cada
        // altura tem de devolver EXATAMENTE a linha que foi gravada — se o `\n` de
        // dentro do `genesis` tivesse escapado cru, as alturas escorregariam aqui.
        let mut boot = crate::blockstore::BlockStore::new(&arquivo);
        assert_eq!(boot.scan(0, |_, l| l.starts_with('{')).expect("scan").count, blocos.len());
        for (h, b) in blocos.iter().enumerate() {
            assert_eq!(
                boot.get(h).expect("get").as_deref(),
                Some(block_to_json_line(b).expect("linha").as_str()),
                "a altura {h} não voltou idêntica do disco"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_malformado_ou_truncado_devolve_erro_sem_panico() {
        let b = bloco_com_transacoes(STATEROOT_HEIGHT + 1);
        let JsonValue::Map(completo) = block_to_json(&b) else {
            panic!("block_to_json devolve mapa")
        };

        // Não é sequer um objeto.
        for v in [JsonValue::Null, JsonValue::Int(1), JsonValue::str("x"), JsonValue::List(vec![])] {
            assert!(block_from_json(&v).is_err(), "não-objeto tem de ser erro");
        }

        // TRUNCADO: cada campo obrigatório removido, um de cada vez. Nenhum caso
        // pode entrar em pânico; os que a leitura não consegue suprir são erro.
        for chave in ["height", "transactions", "txCount", "protocol", "hash", "producer"] {
            let mut m = completo.clone();
            m.remove(chave);
            let r = block_from_json(&JsonValue::Map(m));
            match chave {
                // Sem estes três não há como reconstruir: viram erro.
                "height" | "transactions" | "txCount" => {
                    assert!(r.is_err(), "faltando {chave} tem de ser erro");
                }
                // Os demais têm padrão na leitura — mas então o hash NÃO bate, e é
                // a integridade que rejeita. Nunca um bloco aceito com campo a menos.
                _ => {
                    let parcial = r.expect("campo com padrão ainda parseia");
                    assert!(
                        verify_block_integrity(&parcial).is_err(),
                        "bloco sem {chave} não pode passar na integridade"
                    );
                }
            }
        }

        // MALFORMADO: tipo errado em cada campo. Nenhum caso pode entrar em pânico.
        let tipos_errados: [(&str, JsonValue); 7] = [
            ("height", JsonValue::str("10")),
            ("height", JsonValue::Int(-1)),
            ("txCount", JsonValue::str("2")),
            ("txCount", JsonValue::Int(-1)),
            ("transactions", JsonValue::map([])),
            ("stateRoot", JsonValue::Int(7)),
            ("producerAccount", JsonValue::List(vec![])),
        ];
        for (chave, valor) in tipos_errados {
            let mut m = completo.clone();
            m.insert(chave.to_string(), valor);
            assert!(block_from_json(&JsonValue::Map(m)).is_err(), "{chave} com tipo errado");
        }

        // Transação malformada dentro da lista: o erro sobe, o bloco não é aceito
        // com uma transação inventada no lugar.
        let mut m = completo.clone();
        m.insert("transactions".into(), JsonValue::List(vec![JsonValue::str("não é objeto")]));
        assert_eq!(
            block_from_json(&JsonValue::Map(m)),
            Err("transação inválida na evidência".into())
        );

        let mut m = completo.clone();
        m.insert(
            "transactions".into(),
            JsonValue::List(vec![JsonValue::map([("amount".into(), JsonValue::Int(5))])]),
        );
        assert_eq!(
            block_from_json(&JsonValue::Map(m)),
            Err("campo de texto inválido na transação".into()),
            "amount numérico não pode virar \"0\" em silêncio"
        );

        let mut m = completo;
        m.insert(
            "transactions".into(),
            JsonValue::List(vec![JsonValue::map([("nonce".into(), JsonValue::str("1"))])]),
        );
        assert_eq!(
            block_from_json(&JsonValue::Map(m)),
            Err("campo numérico inválido na transação".into())
        );
    }
    /// O bloco GÊNESE nunca carrega `stateRoot` no payload — nem com o fork em 0.
    ///
    /// `buildGenesisBlock` (block.js:63) monta o core SEM o campo; só
    /// `buildBlock` o inclui, e só a partir de `STATEROOT_HEIGHT`. O porte
    /// aplicava a regra de `buildBlock` aos dois, e o payload da gênese ganhava um
    /// `"stateRoot":null` que a referência não tem — outro hash, e este cliente
    /// REJEITAVA a gênese de qualquer rede de gênese-ativo (logo, a cadeia
    /// inteira, já que a gênese é o bloco 0 de tudo).
    #[test]
    fn payload_da_genese_nunca_tem_state_root() {
        use crate::transaction::JsonValue;

        let genese = build_genesis_block(
            1_000,
            JsonValue::map([("balances".to_string(), JsonValue::map([]))]),
        );
        let payload = block_payload(&genese);
        assert!(
            !payload.contains("stateRoot"),
            "o payload da gênese não pode conter `stateRoot` (nem como null): {payload}"
        );
        // E o hash do bloco confere com o payload sem o campo — ou seja, a
        // integridade fecha pelo mesmo caminho que a referência usa.
        assert_eq!(verify_block_integrity(&genese), Ok(()), "a gênese tem de se auto-verificar");
    }


    /// Custo de verificar UM bloco — o que domina o replay de boot.
    ///
    /// Não é teste de regressão de tempo (a máquina varia); é medição impressa,
    /// para que o custo do replay completo seja um número conhecido e não um
    /// palpite. Rode com `--release --nocapture`: em debug o ML-DSA é ordens de
    /// grandeza mais lento e o número não diz nada sobre produção.
    #[test]
    fn custo_de_verificacao_de_bloco() {
        let b = bloco(1_300_000);
        // 50 basta para o número estabilizar em release, e mantém o custo desta
        // medição desprezível na suíte em debug (onde o ML-DSA é lentíssimo).
        let n = 50;
        let t = std::time::Instant::now();
        for _ in 0..n {
            assert_eq!(verify_block_integrity(&b), Ok(()));
        }
        let us = t.elapsed().as_micros() as f64 / f64::from(n);
        println!("verify_block_integrity: {us:.0} µs/bloco");
        println!("  replay de 1 dia  (86 400 blocos): {:.1} s", us * 86_400.0 / 1e6);
        println!("  replay de 1 mês  (2,6M blocos):   {:.1} min", us * 2_592_000.0 / 6e7);
        println!("  replay de 1 ano  (31,5M blocos):  {:.1} h", us * 31_536_000.0 / 3.6e9);
    }

    /// Verificação de assinatura é EMBARAÇOSAMENTE PARALELA — e o replay é o
    /// único lugar onde isso importa de verdade.
    ///
    /// A aplicação ao estado tem de ser sequencial (cada bloco depende do
    /// anterior), mas VERIFICAR as assinaturas não: elas só dependem do próprio
    /// bloco. Medição impressa para dimensionar o ganho; rode com `--release`.
    #[test]
    fn custo_de_verificar_em_paralelo() {
        let blocos: Vec<Block> = (0..64u8).map(|i| {
            build_block(&Carteira::nova(i), params(1_300_000)).expect("bloco")
        }).collect();

        let sequencial = std::time::Instant::now();
        for b in &blocos {
            assert_eq!(verify_block_integrity(b), Ok(()));
        }
        let seq = sequencial.elapsed().as_secs_f64() * 1000.0;

        let nucleos = std::thread::available_parallelism().map_or(1, |n| n.get());
        let paralelo = std::time::Instant::now();
        std::thread::scope(|escopo| {
            for fatia in blocos.chunks(blocos.len().div_ceil(nucleos)) {
                escopo.spawn(move || {
                    for b in fatia {
                        assert_eq!(verify_block_integrity(b), Ok(()));
                    }
                });
            }
        });
        let par = paralelo.elapsed().as_secs_f64() * 1000.0;

        println!("64 blocos — sequencial: {seq:.0} ms · paralelo ({nucleos} núcleos): {par:.0} ms");
        println!("  ganho: {:.1}x", seq / par.max(0.001));
    }

    /// Quanto custa LER um bloco sem verificá-lo — o que decide o desenho do
    /// snapshot de boot.
    ///
    /// O índice de transações é consultado na validação (rejeição de duplicada),
    /// então não pode vir de um arquivo não verificado: um índice adulterado
    /// aceitaria uma transação repetida. Reconstruí-lo exige reler a cadeia — mas
    /// só PARSEAR, sem verificar assinatura nem aplicar estado. Este número é a
    /// diferença entre "boot rápido" e "boot rápido de mentira".
    #[test]
    fn custo_de_ler_um_bloco_sem_verificar() {
        let b = bloco(1_300_000);
        let linha = block_to_json_line(&b).expect("serializa");
        let n = 50;

        let t = std::time::Instant::now();
        for _ in 0..n {
            let v = crate::transaction::parse_json(&linha).expect("json");
            let lido = block_from_json(&v).expect("bloco");
            assert_eq!(lido.height, b.height);
        }
        let leitura = t.elapsed().as_micros() as f64 / f64::from(n);

        let t = std::time::Instant::now();
        for _ in 0..n {
            assert_eq!(verify_block_integrity(&b), Ok(()));
        }
        let verificacao = t.elapsed().as_micros() as f64 / f64::from(n);

        println!("ler e parsear: {leitura:.0} µs/bloco · verificar: {verificacao:.0} µs/bloco");
        println!("  razão: {:.0}x mais barato reconstruir índice do que revalidar", verificacao / leitura.max(0.001));
        println!("  1 ano de cadeia (31,5M blocos): leitura {:.1} min · replay {:.1} h",
            leitura * 31_536_000.0 / 6e7, verificacao * 31_536_000.0 / 3.6e9);
    }
}
