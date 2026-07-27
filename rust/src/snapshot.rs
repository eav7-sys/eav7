//! SNAPSHOT DE BOOT — o estado de consenso gravado em disco, para que subir um
//! nó não custe reexecutar a cadeia inteira.
//!
//! # O problema
//!
//! Sem snapshot, todo boot é um replay completo: cada bloco tem a assinatura
//! híbrida verificada e as transações reaplicadas. Medido nesta base, ~168 µs por
//! bloco em release — a um bloco por segundo, **1,5 hora para um ano de cadeia**,
//! crescendo sem teto. É o mesmo tipo de curva que já obrigou a pôr os blocos em
//! disco em vez de na RAM.
//!
//! # Por que a raiz do estado, e não um HMAC
//!
//! A referência sela o snapshot com HMAC-SHA256 e uma chave do operador. Isso
//! prova QUEM ESCREVEU o arquivo — não que o conteúdo seja verdade. Um operador
//! comprometido, ou um bug no próprio escritor, produz um arquivo que passa.
//!
//! Aqui o snapshot é conferido contra o `stateRoot` que o BLOCO commita: recarrega
//! o estado, recomputa a raiz, compara com o header. Se bater, aquele estado é
//! **provadamente** o que a rede acordou — garantia que vale contra qualquer
//! adversário, inclusive quem tem acesso de escrita ao disco. E dispensa a chave:
//! menos superfície operacional e mais garantia.
//!
//! Medido: recomputar a raiz de 100 mil contas custa ~44 ms. Contra 1,5 h de
//! replay.
//!
//! # O que este arquivo NÃO carrega, e por quê
//!
//! Só o estado de consenso. Os índices de consulta (`tx_index`,
//! `address_tx_index`, `blocks_with_txs`, `hashes`) ficam de fora — e não por
//! economia: `tx_index` é CONSULTADO NA VALIDAÇÃO (`blockchain.rs`, rejeição de
//! transação duplicada). Um índice vindo de arquivo não verificado, com uma
//! entrada a menos, faria o nó aceitar uma transação repetida — replay de
//! pagamento, com o estado divergindo em seguida.
//!
//! A referência os guarda no snapshot e os protege com o mesmo HMAC. Aqui eles são
//! RECONSTRUÍDOS relendo a cadeia: só parsear, sem verificar assinatura nem
//! aplicar estado, o que medimos ser ~10× mais barato que o replay (9 min por ano
//! de cadeia, contra 1,5 h). O boot fica rápido sem que nada não verificado entre.
//!
//! # Formato
//!
//! A mesma codificação canônica do `stateRoot` (`crate::canonical`). Não é
//! conveniência: o que o arquivo grava é, byte a byte, a pré-imagem que a raiz
//! cobre — então "conferir contra a raiz" confere o arquivo, não uma tradução
//! dele.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::canonical::{decode, encode, Value};
use crate::state::State;

/// Versão do formato. Um arquivo de outra versão é DESCARTADO, não migrado: o
/// caminho de recuperação (replay completo) sempre existe e é correto, então
/// tentar entender um formato antigo só acrescentaria superfície de erro.
pub const VERSAO: u32 = 1;

/// Falha ao ler ou escrever o snapshot.
///
/// Nenhuma delas é fatal para o nó: toda falha aqui significa "cai no replay
/// completo", que é o caminho-fonte-de-verdade. Um snapshot é otimização, e
/// otimização que falha tem de degradar, não derrubar.
#[derive(Debug)]
pub enum Erro {
    Io(std::io::Error),
    /// Arquivo ilegível como forma canônica (truncado, corrompido, adulterado).
    Formato(String),
    /// Versão de formato que este binário não conhece.
    VersaoDesconhecida(u32),
    /// A raiz recomputada não bate com a que o bloco commita. É o caso que o HMAC
    /// da referência não pegaria: arquivo bem-formado e FALSO.
    RaizDivergente { altura: u64, esperada: String, obtida: String },
}

impl std::fmt::Display for Erro {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Erro::Io(e) => write!(f, "erro de E/S: {e}"),
            Erro::Formato(m) => write!(f, "snapshot ilegível: {m}"),
            Erro::VersaoDesconhecida(v) => write!(f, "snapshot de versão {v}, esperada {VERSAO}"),
            Erro::RaizDivergente { altura, esperada, obtida } => write!(
                f,
                "raiz do snapshot não confere na altura {altura}: bloco commita {esperada}, \
                 estado do arquivo produz {obtida}"
            ),
        }
    }
}
impl std::error::Error for Erro {}

impl From<std::io::Error> for Erro {
    fn from(e: std::io::Error) -> Self {
        Erro::Io(e)
    }
}

/// O conteúdo do snapshot.
///
/// `state` e `base_state` viajam como [`Value`] — a forma canônica — e não como
/// [`State`] já decodificado, porque é sobre a forma canônica que a raiz é
/// calculada. Decodificar antes de conferir inverteria a ordem: passaríamos a
/// confiar no decodificador em vez de conferir o arquivo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub altura: u64,
    /// Hash do bloco da cabeça no momento do snapshot. Serve de checagem barata
    /// ANTES da recomputação da raiz: se o hash não bate, o arquivo é de outra
    /// cadeia e nem vale gastar os 44 ms.
    pub head_hash: String,
    /// Altura do primeiro bloco da janela em RAM.
    pub tail_start: u64,
    /// Quantos bytes de `blocks.jsonl` este snapshot cobre — o ponto de onde a
    /// releitura do rabo recomeça.
    pub file_bytes: u64,
    pub estado: Value,
    /// Estado APÓS o bloco `tail_start - 1` (a âncora de reorganização). Ausente
    /// quando a janela começa no gênese.
    pub base_estado: Option<Value>,
}

impl Snapshot {
    /// Monta o snapshot a partir de um estado vivo.
    pub fn montar(
        altura: u64,
        head_hash: impl Into<String>,
        tail_start: u64,
        file_bytes: u64,
        estado: &State,
        base_estado: Option<&State>,
    ) -> Result<Self, crate::canonical::Error> {
        Ok(Snapshot {
            altura,
            head_hash: head_hash.into(),
            tail_start,
            file_bytes,
            estado: estado.to_snapshot_value()?,
            base_estado: base_estado.map(State::to_snapshot_value).transpose()?,
        })
    }

    fn to_value(&self) -> Value {
        let mut m: BTreeMap<String, Value> = BTreeMap::new();
        m.insert("versao".into(), Value::uint(VERSAO));
        m.insert("altura".into(), Value::uint(self.altura));
        m.insert("headHash".into(), Value::str(&self.head_hash));
        m.insert("tailStart".into(), Value::uint(self.tail_start));
        m.insert("fileBytes".into(), Value::uint(self.file_bytes));
        m.insert("estado".into(), self.estado.clone());
        // Ausente e nulo são coisas diferentes aqui: `Null` diz "a janela começa no
        // gênese", e a ausência da chave diria "arquivo de outro formato".
        m.insert(
            "baseEstado".into(),
            self.base_estado.clone().unwrap_or(Value::Null),
        );
        Value::Map(m)
    }

    fn from_value(v: &Value) -> Result<Self, Erro> {
        let Value::Map(m) = v else {
            return Err(Erro::Formato("o topo do snapshot não é um mapa".into()));
        };
        let inteiro = |chave: &str| -> Result<u64, Erro> {
            match m.get(chave) {
                Some(Value::Int(d)) => d.parse().map_err(|_| Erro::Formato(format!("{chave} fora da faixa"))),
                _ => Err(Erro::Formato(format!("campo {chave} ausente ou não é inteiro"))),
            }
        };
        let versao = u32::try_from(inteiro("versao")?)
            .map_err(|_| Erro::Formato("versão fora da faixa".into()))?;
        // A versão é conferida ANTES de qualquer outro campo: um arquivo de outro
        // formato pode ter os mesmos nomes com outro significado, e ler adiante
        // seria interpretá-lo errado com confiança.
        if versao != VERSAO {
            return Err(Erro::VersaoDesconhecida(versao));
        }
        let Some(Value::Str(head_hash)) = m.get("headHash") else {
            return Err(Erro::Formato("headHash ausente".into()));
        };
        let Some(estado) = m.get("estado") else {
            return Err(Erro::Formato("estado ausente".into()));
        };
        let base_estado = match m.get("baseEstado") {
            Some(Value::Null) => None,
            Some(v) => Some(v.clone()),
            None => return Err(Erro::Formato("baseEstado ausente".into())),
        };
        Ok(Snapshot {
            altura: inteiro("altura")?,
            head_hash: head_hash.clone(),
            tail_start: inteiro("tailStart")?,
            file_bytes: inteiro("fileBytes")?,
            estado: estado.clone(),
            base_estado,
        })
    }

    /// Grava ATOMICAMENTE: escreve num temporário e renomeia.
    ///
    /// O `rename` dentro do mesmo diretório é atômico nos sistemas de arquivos que
    /// nos interessam. Sem isso, um crash no meio da escrita deixaria um snapshot
    /// truncado — que a leitura rejeitaria, mas só depois de o nó ter perdido o
    /// snapshot anterior, que era válido.
    pub fn gravar(&self, caminho: &Path) -> Result<(), Erro> {
        let bytes = encode(&self.to_value())
            .map_err(|e| Erro::Formato(format!("estado não codificável: {e}")))?;
        let temporario = temporario_de(caminho);
        std::fs::write(&temporario, &bytes)?;
        std::fs::rename(&temporario, caminho)?;
        Ok(())
    }

    /// Lê e valida o FORMATO. A validação de CONTEÚDO (a raiz) é
    /// [`Snapshot::estado_verificado`], e depende do bloco.
    pub fn ler(caminho: &Path) -> Result<Self, Erro> {
        let bytes = std::fs::read(caminho)?;
        let v = decode(&bytes).map_err(|e| Erro::Formato(e.to_string()))?;
        Snapshot::from_value(&v)
    }

    /// Decodifica o estado e CONFERE contra a raiz que o bloco commita.
    ///
    /// `raiz_do_header` é o `stateRoot` do bloco da altura correspondente. `None`
    /// significa que o bloco não commita raiz (abaixo do fork) — e aí não há o que
    /// conferir: o snapshot é recusado, porque aceitar sem prova é exatamente o
    /// que este desenho existe para não fazer.
    pub fn estado_verificado(
        valor: &Value,
        altura: u64,
        raiz_do_header: Option<&str>,
    ) -> Result<State, Erro> {
        let Some(esperada) = raiz_do_header else {
            return Err(Erro::Formato(format!(
                "bloco {altura} não commita stateRoot — sem raiz não há como provar o snapshot"
            )));
        };
        let estado = State::from_snapshot_value(valor)
            .ok_or_else(|| Erro::Formato(format!("estado da altura {altura} não decodificável")))?;
        let obtida = crate::stateroot::compute_state_root(
            &estado
                .state_leaves()
                .map_err(|e| Erro::Formato(format!("estado não recodificável: {e}")))?,
        );
        if obtida != esperada {
            return Err(Erro::RaizDivergente {
                altura,
                esperada: esperada.to_string(),
                obtida,
            });
        }
        Ok(estado)
    }
}

fn temporario_de(caminho: &Path) -> PathBuf {
    let mut nome = caminho.as_os_str().to_os_string();
    nome.push(".tmp");
    PathBuf::from(nome)
}

/// Remove o snapshot, ignorando ausência.
///
/// Chamado quando a cadeia muda por baixo dele (reorganização abaixo da altura do
/// snapshot): um arquivo que descreve um estado que a cadeia abandonou é pior que
/// arquivo nenhum, porque o boot seguinte o aceitaria — ele bate com a raiz de um
/// bloco que já não está na cadeia.
pub fn remover(caminho: &Path) {
    let _ = std::fs::remove_file(caminho);
    let _ = std::fs::remove_file(temporario_de(caminho));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Account;

    fn dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "eav7-snap-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&d).expect("dir temporário");
        d
    }

    fn estado_exemplo() -> State {
        let mut s = State::new();
        s.total_minted = 1_000;
        for i in 0..5u8 {
            s.accounts.insert(
                crate::address::derive_address_from(format!("snap:{i}")),
                Account { balance: 100 + u128::from(i), nonce: i.into(), ..Default::default() },
            );
        }
        s
    }

    fn raiz(s: &State) -> String {
        crate::stateroot::compute_state_root(&s.state_leaves().expect("folhas"))
    }

    /// Ida e volta pelo disco, com a raiz conferida — o caminho feliz inteiro.
    #[test]
    fn grava_le_e_verifica_contra_a_raiz_do_header() {
        let s = estado_exemplo();
        let arquivo = dir().join("ok.snap");
        let snap = Snapshot::montar(7, "ab".repeat(32), 7, 1234, &s, None).expect("monta");
        snap.gravar(&arquivo).expect("grava");

        let lido = Snapshot::ler(&arquivo).expect("lê");
        assert_eq!(lido, snap, "o arquivo tem de voltar idêntico");

        let recuperado =
            Snapshot::estado_verificado(&lido.estado, 7, Some(&raiz(&s))).expect("verifica");
        assert_eq!(raiz(&recuperado), raiz(&s));
    }

    /// O ATAQUE que o HMAC não pega: arquivo BEM-FORMADO e falso.
    ///
    /// Quem escreve no `dataDir` infla um saldo mantendo tudo canônico. Um selo por
    /// chave do operador aceitaria — ele prova quem escreveu, não o quê. A raiz
    /// commitada pelo bloco recusa.
    #[test]
    fn snapshot_bem_formado_e_falso_e_recusado_pela_raiz() {
        let s = estado_exemplo();
        let raiz_verdadeira = raiz(&s);
        let arquivo = dir().join("falso.snap");

        let mut adulterado = s.clone();
        let alvo = adulterado.accounts.keys().next().expect("uma conta").clone();
        adulterado.account_mut(&alvo).balance += 1_000_000;

        let snap = Snapshot::montar(7, "ab".repeat(32), 7, 0, &adulterado, None).expect("monta");
        snap.gravar(&arquivo).expect("grava");
        let lido = Snapshot::ler(&arquivo).expect("o arquivo é PERFEITAMENTE legível");

        match Snapshot::estado_verificado(&lido.estado, 7, Some(&raiz_verdadeira)) {
            Err(Erro::RaizDivergente { altura, .. }) => assert_eq!(altura, 7),
            outro => panic!("a raiz tinha de recusar, veio {outro:?}"),
        }
    }

    /// Sem `stateRoot` no header não há como provar — e sem prova o snapshot é
    /// recusado. É a diferença entre "otimizar" e "confiar no disco".
    #[test]
    fn sem_raiz_no_header_o_snapshot_e_recusado() {
        let s = estado_exemplo();
        let v = s.to_snapshot_value().expect("valor");
        assert!(matches!(
            Snapshot::estado_verificado(&v, 7, None),
            Err(Erro::Formato(_))
        ));
    }

    /// Arquivo TRUNCADO (crash no meio da escrita) vira erro, nunca pânico — e o
    /// nó cai no replay completo, que é sempre correto.
    #[test]
    fn arquivo_truncado_e_recusado_sem_panico() {
        let s = estado_exemplo();
        let arquivo = dir().join("truncado.snap");
        Snapshot::montar(7, "ab".repeat(32), 7, 0, &s, None)
            .expect("monta")
            .gravar(&arquivo)
            .expect("grava");

        let bytes = std::fs::read(&arquivo).expect("lê");
        for corte in [1, bytes.len() / 3, bytes.len() / 2, bytes.len() - 1] {
            std::fs::write(&arquivo, &bytes[..corte]).expect("trunca");
            assert!(Snapshot::ler(&arquivo).is_err(), "corte em {corte} tinha de falhar");
        }
    }

    /// Versão desconhecida é DESCARTADA, não migrada: o replay completo sempre
    /// existe e é correto, então interpretar um formato antigo só acrescentaria
    /// superfície de erro.
    #[test]
    fn versao_desconhecida_e_descartada() {
        let arquivo = dir().join("versao.snap");
        let mut m: BTreeMap<String, Value> = BTreeMap::new();
        m.insert("versao".into(), Value::uint(999u32));
        m.insert("altura".into(), Value::uint(1u64));
        m.insert("headHash".into(), Value::str("x"));
        m.insert("tailStart".into(), Value::uint(0u64));
        m.insert("fileBytes".into(), Value::uint(0u64));
        m.insert("estado".into(), Value::Null);
        m.insert("baseEstado".into(), Value::Null);
        std::fs::write(&arquivo, encode(&Value::Map(m)).expect("codifica")).expect("grava");

        assert!(matches!(Snapshot::ler(&arquivo), Err(Erro::VersaoDesconhecida(999))));
    }

    /// A escrita é ATÔMICA: um snapshot válido nunca é substituído por um pela
    /// metade. Sem isso, um crash durante a gravação custaria o arquivo bom.
    #[test]
    fn a_gravacao_nao_deixa_temporario_para_tras() {
        let s = estado_exemplo();
        let arquivo = dir().join("atomico.snap");
        Snapshot::montar(3, "cd".repeat(32), 3, 0, &s, None)
            .expect("monta")
            .gravar(&arquivo)
            .expect("grava");

        assert!(arquivo.exists());
        assert!(!temporario_de(&arquivo).exists(), "o temporário tem de ter sido renomeado");
        assert!(Snapshot::ler(&arquivo).is_ok());
    }

    /// `remover` limpa arquivo e temporário, e não reclama de ausência — é chamado
    /// quando a cadeia muda por baixo do snapshot, num caminho que não pode falhar.
    #[test]
    fn remover_e_idempotente() {
        let arquivo = dir().join("some.snap");
        remover(&arquivo); // não existe ainda
        std::fs::write(&arquivo, b"x").expect("cria");
        std::fs::write(temporario_de(&arquivo), b"y").expect("cria tmp");
        remover(&arquivo);
        assert!(!arquivo.exists());
        assert!(!temporario_de(&arquivo).exists());
        remover(&arquivo); // de novo, sem erro
    }
}
