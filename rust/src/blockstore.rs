//! Armazém de blocos em disco — o `blocks.jsonl`.
//!
//! Uma linha JSON por bloco, e um índice de `(offset, comprimento)` por altura em
//! RAM. É o que quebra a proporcionalidade entre memória e IDADE da cadeia: o
//! consumo passa a ser o do ESTADO mais o da janela recente de blocos, e qualquer
//! bloco antigo é lido do disco em O(1) pelo offset. Nada aqui materializa o
//! arquivo inteiro — ele passa dos 2 GiB, que é o teto do `readFileSync` E do
//! comprimento de string do Node (foi assim que o problema apareceu em produção).
//!
//! # Este módulo não sabe o que é um bloco
//!
//! Ele lida com LINHAS. A serialização e o parse ficam com quem chama (`block.rs`),
//! e isso é deliberado, não preguiça: o critério de "esta linha é um bloco válido"
//! é do formato de bloco, não do armazém, e o armazém precisa continuar correto
//! quando o formato do bloco mudar. `scan` recebe o parser como callback, que é
//! exatamente o papel do `onBlock` + `JSON.parse` na referência.
//!
//! # Escrita interrompida não pode corromper
//!
//! São dois modos de falha distintos, e a referência (`src/core/blockstore.js`) os
//! trata diferente de propósito:
//!
//! - **Rasgo no FIM** (crash no meio do append: a última linha não tem `\n` e não
//!   parseia). É recuperável e esperado — o arquivo é truncado no início dessa
//!   linha e o nó sobe com um bloco a menos.
//! - **Corrupção no MEIO** (uma linha completa que não parseia). NÃO é truncada em
//!   silêncio: descartar o rabo aqui poderia jogar fora milhares de blocos
//!   válidos por causa de um byte estragado. Vira erro, e a decisão sobe.
//!
//! O `append` fecha o terceiro caso: se a escrita falhar no meio (disco cheio),
//! ela pode ter gravado bytes parciais. O reparo trunca no fim da última linha
//! INDEXADA, para que índice e arquivo nunca divirjam.

use crate::transaction::{parse_json, JsonValue};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------- constantes
//
// As duas abaixo NÃO vêm de `crate::config` (gerado de `src/config.js`) porque
// não estão lá: nenhuma é parâmetro de protocolo. São detalhes de layout em
// disco deste nó — um nó pode varrer em pedaços de outro tamanho, ou nomear o
// arquivo de outro jeito, sem sair da rede. Declaradas aqui com a origem anotada.

/// Tamanho do bloco de leitura da varredura, em bytes. Origem:
/// `src/core/blockstore.js:3` (`CHUNK_BYTES = 64 * 1024 * 1024`).
///
/// A varredura lê em pedaços porque o arquivo não cabe em memória. O buffer real
/// é o MENOR entre esta constante e o tamanho do arquivo: reservar 64 MiB para
/// varrer um arquivo de gênese de 2 KiB seria desperdício puro.
pub const CHUNK_BYTES: usize = 64 * 1024 * 1024;

/// Nome do arquivo dentro do diretório de dados. Origem:
/// `src/core/blockchain.js:80` (`join(dataDir, 'blocks.jsonl')`).
pub const BLOCKS_FILE: &str = "blocks.jsonl";

/// Sidecar de offsets — `src/core/blockstore.js` (`blocks.idx`).
pub const IDX_FILE: &str = "blocks.idx";
/// Sidecar de digests — `src/core/blockstore.js` (`hashes.bin`).
pub const HASHES_FILE: &str = "hashes.bin";

/// Registro do índice: offset u64 LE ‖ len u64 LE (sem o `\n`).
const IDX_REC: usize = 16;
/// Digest SHA3-256 cru (32 B) por altura — `hashAt` devolve hex.
const HASH_REC: usize = 32;

const NL: u8 = b'\n';

// --------------------------------------------------------------------- erros

#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    /// Linha COMPLETA que o parser recusou, na altura indicada. Distinta do rasgo
    /// final: esta não é truncada — ver a nota do módulo.
    LinhaCorrompida(usize),
    /// Leitura devolveu menos bytes que o índice prometia — índice e arquivo
    /// divergiram (arquivo encolheu por fora).
    LeituraCurta(usize),
    /// A linha a gravar contém `\n`. O formato é uma linha por bloco; aceitar a
    /// quebra faria UM bloco virar dois no índice e desalinharia todas as alturas
    /// seguintes — corrupção silenciosa, só visível no próximo boot.
    QuebraDeLinhaNoConteudo,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Io(e) => write!(f, "blockstore: {e}"),
            Error::LinhaCorrompida(h) => write!(f, "blockstore: linha corrompida na altura {h}"),
            Error::LeituraCurta(h) => write!(f, "blockstore: leitura curta na altura {h}"),
            Error::QuebraDeLinhaNoConteudo => {
                write!(f, "blockstore: a linha do bloco não pode conter quebra de linha")
            }
        }
    }
}
impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

type R<T> = Result<T, Error>;

/// Resultado da varredura.
#[derive(Debug, PartialEq, Eq)]
pub struct ScanReport {
    /// Linhas indexadas nesta varredura.
    pub count: usize,
    /// A última linha estava rasgada e foi removida do arquivo.
    pub truncated: bool,
}

// ---------------------------------------------------------------- o armazém

/// Armazém append-only de linhas, com índice de offsets por altura.
pub struct BlockStore {
    file: PathBuf,
    idx_file: PathBuf,
    hashes_file: PathBuf,
    /// altura → `(offset em bytes, comprimento SEM o `\n`)`.
    offsets: Vec<(u64, u64)>,
    /// Descritor de leitura, aberto sob demanda e reaproveitado. Ler um bloco
    /// antigo é operação quente (sincronização de par, consulta de API) e reabrir
    /// o arquivo a cada leitura seria uma syscall por bloco.
    ///
    /// `OnceLock` e não `Option<File>`: a leitura usa `read_at` (pread), que lê por
    /// OFFSET sem mover cursor nenhum — então `get` pode ser `&self` e várias
    /// leituras da API podem correr em paralelo sob lock compartilhado. O estado
    /// mutável que existia aqui era só o `seek`, e o `seek` era desnecessário.
    leitura: std::sync::OnceLock<File>,
    /// Sidecars alinhados a `offsets` (G7). `false` → próximo boot reconstrói.
    sidecars_ok: bool,
}

impl std::fmt::Debug for BlockStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BlockStore")
            .field("file", &self.file)
            .field("count", &self.offsets.len())
            .finish()
    }
}

impl BlockStore {
    pub fn new(file: impl AsRef<Path>) -> Self {
        let file = file.as_ref().to_path_buf();
        let dir = file.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
        BlockStore {
            file,
            idx_file: dir.join(IDX_FILE),
            hashes_file: dir.join(HASHES_FILE),
            offsets: Vec::new(),
            leitura: std::sync::OnceLock::new(),
            sidecars_ok: false,
        }
    }

    pub fn path(&self) -> &Path {
        &self.file
    }

    pub fn sidecars_ok(&self) -> bool {
        self.sidecars_ok
    }

    /// Digest hex (64) da altura via `hashes.bin` — O(1), sem array em RAM.
    pub fn hash_at(&self, height: usize) -> Option<String> {
        if height >= self.offsets.len() || !self.hashes_file.exists() {
            return None;
        }
        let mut fd = File::open(&self.hashes_file).ok()?;
        fd.seek(SeekFrom::Start((height * HASH_REC) as u64)).ok()?;
        let mut dig = [0u8; HASH_REC];
        fd.read_exact(&mut dig).ok()?;
        Some(hex::encode(dig))
    }

    /// Carrega `blocks.idx` + `hashes.bin` se alinhados ao `blocks.jsonl`.
    /// Espelha `tryLoadSidecars` do JS. `true` = `offsets` prontos.
    pub fn try_load_sidecars(&mut self) -> bool {
        if !self.file.exists() || !self.idx_file.exists() || !self.hashes_file.exists() {
            return false;
        }
        let idx = match std::fs::read(&self.idx_file) {
            Ok(b) => b,
            Err(_) => return false,
        };
        let hashes = match std::fs::read(&self.hashes_file) {
            Ok(b) => b,
            Err(_) => return false,
        };
        if idx.len() % IDX_REC != 0 || hashes.len() % HASH_REC != 0 {
            return false;
        }
        let n = idx.len() / IDX_REC;
        if n != hashes.len() / HASH_REC {
            return false;
        }
        if n == 0 {
            self.offsets.clear();
            self.sidecars_ok = true;
            return true;
        }
        let mut offsets = Vec::with_capacity(n);
        for i in 0..n {
            let base = i * IDX_REC;
            let off = u64::from_le_bytes(idx[base..base + 8].try_into().unwrap());
            let len = u64::from_le_bytes(idx[base + 8..base + 16].try_into().unwrap());
            offsets.push((off, len));
        }
        let (lo, ll) = offsets[n - 1];
        let expected_end = lo + ll + 1;
        let size = match std::fs::metadata(&self.file) {
            Ok(m) => m.len(),
            Err(_) => return false,
        };
        if size < expected_end {
            return false;
        }
        self.offsets = offsets;
        self.solta_fd();
        // Confere gênese: hash do bloco 0 bate com hashes.bin[0]
        let h0 = hex::encode(&hashes[..HASH_REC]);
        match self.get_json(0) {
            Ok(Some(v)) => {
                let ok = match &v {
                    JsonValue::Map(m) => matches!(
                        m.get("hash"),
                        Some(JsonValue::Str(s)) if s == &h0
                    ),
                    _ => false,
                };
                if !ok {
                    self.offsets.clear();
                    return false;
                }
            }
            _ => {
                self.offsets.clear();
                return false;
            }
        }
        self.sidecars_ok = true;
        true
    }

    /// Reconstrói sidecars a partir dos offsets atuais + hashes hex (ou do disco).
    pub fn persist_sidecars(&mut self, hash_list: &[Option<&str>]) -> R<()> {
        let n = self.offsets.len();
        let mut idx = vec![0u8; n * IDX_REC];
        let mut hashes = vec![0u8; n * HASH_REC];
        for i in 0..n {
            let (o, len) = self.offsets[i];
            idx[i * IDX_REC..i * IDX_REC + 8].copy_from_slice(&o.to_le_bytes());
            idx[i * IDX_REC + 8..i * IDX_REC + 16].copy_from_slice(&len.to_le_bytes());
            let dig = hash_list
                .get(i)
                .and_then(|h| h.and_then(digest_from_hash))
                .or_else(|| {
                    self.get_json(i).ok().flatten().and_then(|v| match v {
                        JsonValue::Map(m) => match m.get("hash") {
                            Some(JsonValue::Str(s)) => digest_from_hash(s),
                            _ => None,
                        },
                        _ => None,
                    })
                })
                .ok_or_else(|| {
                    Error::Io(std::io::Error::other(format!(
                        "blockstore: hash inválido na altura {i}"
                    )))
                })?;
            hashes[i * HASH_REC..(i + 1) * HASH_REC].copy_from_slice(&dig);
        }
        if let Some(parent) = self.idx_file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp_idx = self.idx_file.with_extension("idx.tmp");
        let tmp_h = self.hashes_file.with_extension("bin.tmp");
        std::fs::write(&tmp_idx, &idx)?;
        std::fs::write(&tmp_h, &hashes)?;
        std::fs::rename(&tmp_idx, &self.idx_file)?;
        std::fs::rename(&tmp_h, &self.hashes_file)?;
        self.sidecars_ok = true;
        Ok(())
    }

    fn append_sidecar(&mut self, off: u64, len: u64, hash_hex: &str) {
        let Some(dig) = digest_from_hash(hash_hex) else {
            return;
        };
        let mut idx_rec = [0u8; IDX_REC];
        idx_rec[0..8].copy_from_slice(&off.to_le_bytes());
        idx_rec[8..16].copy_from_slice(&len.to_le_bytes());
        if let Err(_) = (|| -> std::io::Result<()> {
            let mut f = OpenOptions::new().create(true).append(true).open(&self.idx_file)?;
            f.write_all(&idx_rec)?;
            let mut f = OpenOptions::new().create(true).append(true).open(&self.hashes_file)?;
            f.write_all(&dig)?;
            Ok(())
        })() {
            let _ = std::fs::remove_file(&self.idx_file);
            let _ = std::fs::remove_file(&self.hashes_file);
            self.sidecars_ok = false;
            return;
        }
        self.sidecars_ok = true;
    }

    fn truncate_sidecars(&mut self, height: usize) {
        let trunc = || -> std::io::Result<()> {
            if self.idx_file.exists() {
                let f = OpenOptions::new().write(true).open(&self.idx_file)?;
                f.set_len((height * IDX_REC) as u64)?;
            }
            if self.hashes_file.exists() {
                let f = OpenOptions::new().write(true).open(&self.hashes_file)?;
                f.set_len((height * HASH_REC) as u64)?;
            }
            Ok(())
        };
        if trunc().is_err() {
            let _ = std::fs::remove_file(&self.idx_file);
            let _ = std::fs::remove_file(&self.hashes_file);
            self.sidecars_ok = false;
        }
    }

    fn drop_sidecars(&mut self) {
        let _ = std::fs::remove_file(&self.idx_file);
        let _ = std::fs::remove_file(&self.hashes_file);
        self.sidecars_ok = false;
    }

    /// Quantidade de linhas indexadas.
    pub fn count(&self) -> usize {
        self.offsets.len()
    }

    /// Fim LÓGICO do arquivo segundo o índice — igual ao tamanho real, exceto
    /// enquanto houver lixo além do índice (rasgo, reorg torto). É esse valor, e
    /// não o tamanho real, que manda no `append` e no truncamento: o índice é a
    /// autoridade sobre onde a cadeia válida termina.
    pub fn file_bytes(&self) -> u64 {
        match self.offsets.last() {
            None => 0,
            Some((off, len)) => off + len + 1, // +1 do `\n`
        }
    }

    fn fd_leitura(&self) -> R<&File> {
        if let Some(fd) = self.leitura.get() {
            return Ok(fd);
        }
        // Corrida benigna: dois leitores podem abrir ao mesmo tempo e um `set`
        // perde — o `File` perdedor é fechado pelo `Drop`. O vencedor fica em
        // cache para todas as leituras seguintes.
        let _ = self.leitura.set(File::open(&self.file)?);
        self.leitura.get().ok_or_else(|| {
            Error::Io(std::io::Error::other("descritor de leitura indisponível"))
        })
    }

    fn solta_fd(&mut self) {
        self.leitura = std::sync::OnceLock::new(); // o `Drop` do `File` fecha
    }

    /// Lê `len` bytes na posição `off` SEM mover cursor (pread). É o que permite
    /// `get` ser `&self`: não há estado de posição compartilhado entre leitores.
    fn le_em(fd: &File, off: u64, buf: &mut [u8]) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileExt;
            fd.read_exact_at(buf, off)
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileExt;
            let mut lido = 0usize;
            while lido < buf.len() {
                let n = fd.seek_read(&mut buf[lido..], off + lido as u64)?;
                if n == 0 {
                    return Err(std::io::ErrorKind::UnexpectedEof.into());
                }
                lido += n;
            }
            Ok(())
        }
    }

    /// Linha da altura, lida do disco pelo offset. `None` se a altura não existe.
    ///
    /// `&self` DE PROPÓSITO: a leitura usa `pread` (offset explícito, sem `seek`),
    /// então não muta nada — e a API pode servir blocos antigos em paralelo sob
    /// lock COMPARTILHADO, em vez de serializar toda leitura atrás de um `&mut`.
    pub fn get(&self, height: usize) -> R<Option<String>> {
        let Some(&(off, len)) = self.offsets.get(height) else {
            return Ok(None);
        };
        let len_usize = usize::try_from(len).map_err(|_| Error::LeituraCurta(height))?;
        let mut buf = vec![0u8; len_usize];
        let fd = self.fd_leitura()?;
        // Leitura exata e não parcial: uma leitura curta aqui significa que o
        // arquivo encolheu por fora do índice, e devolver a linha pela metade
        // entregaria um bloco truncado como se fosse legítimo.
        Self::le_em(fd, off, &mut buf).map_err(|_| Error::LeituraCurta(height))?;
        // Nunca `from_utf8_lossy`: bytes inválidos viram U+FFFD e mudariam a hash
        // do bloco em silêncio. Bytes inválidos são corrupção, e corrupção é erro.
        String::from_utf8(buf).map(Some).map_err(|_| Error::LinhaCorrompida(height))
    }

    /// Varre o arquivo a partir de `byte_start`, indexando cada linha e entregando-a
    /// a `on_line`. `byte_start` permite retomar de onde uma varredura anterior
    /// parou (boot por snapshot: o prefixo já validado não é relido).
    ///
    /// `on_line(altura, linha) -> bool`: `false` significa "não parseia". Uma linha
    /// COMPLETA recusada vira `Err(LinhaCorrompida)`; a última linha SEM `\n`
    /// recusada é um append rasgado por crash e é truncada do arquivo.
    ///
    /// Arquivo inexistente é varredura vazia, não erro: é o primeiro boot.
    pub fn scan<F>(&mut self, byte_start: u64, mut on_line: F) -> R<ScanReport>
    where
        F: FnMut(usize, &str) -> bool,
    {
        // Varredura DO INÍCIO reconstrói o índice inteiro — então zera o que havia.
        //
        // Sem isto, `scan(0, …)` chamado duas vezes EMPILHA os offsets: a contagem
        // dobra, `get(altura)` passa a devolver a linha errada e o chamador conclui
        // que o arquivo tem o dobro de blocos. Aconteceu de verdade — o boot tenta o
        // snapshot, cai no replay, e o replay via um arquivo com o dobro do tamanho,
        // truncando blocos válidos como se fossem rabo inválido.
        if byte_start == 0 {
            self.offsets.clear();
        }
        if !self.file.exists() {
            return Ok(ScanReport { count: 0, truncated: false });
        }
        let mut fd = File::open(&self.file)?;
        let tamanho = fd.metadata()?.len();
        let mut count = 0usize;
        let mut truncar_em: Option<u64> = None;

        // Buffer limitado pelo tamanho do arquivo: ver a nota em `CHUNK_BYTES`.
        let cap = tamanho.saturating_sub(byte_start).min(CHUNK_BYTES as u64).max(1);
        let cap = usize::try_from(cap).unwrap_or(CHUNK_BYTES);
        let mut chunk = vec![0u8; cap];

        // Sobra de uma linha partida entre dois pedaços. Guardada como BYTES, não
        // como texto: um caractere UTF-8 multibyte pode cair exatamente na fronteira
        // do pedaço, e decodificar antes de juntar quebraria a linha.
        let mut carry: Vec<u8> = Vec::new();
        let mut linha_inicio = byte_start;
        let mut pos = byte_start;
        fd.seek(SeekFrom::Start(byte_start))?;

        'externo: loop {
            let n = fd.read(&mut chunk)?;
            if n == 0 {
                break;
            }
            let vista = &chunk[..n];
            let mut inicio = 0usize;
            while let Some(rel) = vista[inicio..].iter().position(|&b| b == NL) {
                let nl = inicio + rel;
                let bruto: Vec<u8> = if carry.is_empty() {
                    vista[inicio..nl].to_vec()
                } else {
                    let mut v = std::mem::take(&mut carry);
                    v.extend_from_slice(&vista[inicio..nl]);
                    v
                };
                carry.clear();
                let linha_fim = pos + nl as u64;
                match std::str::from_utf8(&bruto) {
                    // Linha em branco é ignorada (e não indexada), como o
                    // `if (text.trim())` da referência: um `\n` extra no fim do
                    // arquivo não pode virar um bloco fantasma na altura seguinte.
                    Ok(texto) if texto.trim().is_empty() => {}
                    Ok(texto) => {
                        if !on_line(self.offsets.len(), texto) {
                            return Err(Error::LinhaCorrompida(self.offsets.len()));
                        }
                        self.offsets.push((linha_inicio, linha_fim - linha_inicio));
                        count += 1;
                    }
                    // UTF-8 inválido numa linha COMPLETA é corrupção no meio.
                    Err(_) => return Err(Error::LinhaCorrompida(self.offsets.len())),
                }
                linha_inicio = linha_fim + 1;
                inicio = nl + 1;
                if inicio >= n {
                    break;
                }
            }
            if inicio < n {
                carry.extend_from_slice(&vista[inicio..]);
            }
            pos += n as u64;
            if pos >= tamanho {
                break 'externo;
            }
        }

        // Sobrou conteúdo sem `\n` no fim: ou é uma linha íntegra que o processo
        // gravou sem terminador, ou é o append rasgado pelo crash.
        if !carry.is_empty() {
            let texto = std::str::from_utf8(&carry).ok();
            match texto {
                Some(t) if t.trim().is_empty() => {}
                Some(t) if on_line(self.offsets.len(), t) => {
                    self.offsets.push((linha_inicio, pos - linha_inicio));
                    count += 1;
                }
                // Não parseia (ou nem é UTF-8): rasgo. Trunca no início da linha.
                _ => truncar_em = Some(linha_inicio),
            }
        }
        drop(fd);

        if let Some(em) = truncar_em {
            let wfd = OpenOptions::new().write(true).open(&self.file)?;
            wfd.set_len(em)?;
        }
        Ok(ScanReport { count, truncated: truncar_em.is_some() })
    }

    /// A linha da altura já lida para [`JsonValue`] — `None` se a altura não existe.
    ///
    /// Atalho de `get` + [`parse_json`]. Linha ilegível vira [`Error::LinhaCorrompida`]
    /// e não pânico: quem chama é a API servindo um bloco antigo pedido pela rede.
    pub fn get_json(&self, height: usize) -> R<Option<JsonValue>> {
        match self.get(height)? {
            None => Ok(None),
            Some(linha) => parse_json(&linha)
                .map(Some)
                .map_err(|_| Error::LinhaCorrompida(height)),
        }
    }

    /// Varredura que entrega VALOR, não texto: cada linha já lida para [`JsonValue`].
    ///
    /// É o que fecha o caminho de boot — `scan` sozinho entrega `&str`, e nada mais
    /// no crate convertia a linha de volta. O contrato de recuperação de `scan` é
    /// preservado inteiro: `on_value` devolve `false` para recusar o valor, uma
    /// linha COMPLETA recusada (ou ilegível) vira `Err(LinhaCorrompida)`, e a última
    /// linha sem `\n` que não passa é o append rasgado por crash e é truncada.
    ///
    /// Continua valendo que este módulo NÃO sabe o que é um bloco: `JsonValue` é
    /// valor JSON genérico, e o critério de "isto é um bloco válido" segue com quem
    /// chama — `block_from_json` roda dentro de `on_value`.
    pub fn scan_json<F>(&mut self, byte_start: u64, mut on_value: F) -> R<ScanReport>
    where
        F: FnMut(usize, JsonValue) -> bool,
    {
        self.scan(byte_start, |altura, linha| match parse_json(linha) {
            Ok(v) => on_value(altura, v),
            // JSON inválido é indistinguível, aqui, de linha rasgada: a decisão
            // entre "corrupção no meio" e "rasgo no fim" é do `scan`, pela POSIÇÃO
            // da linha, não pelo motivo da recusa. Por isso só devolvemos `false`.
            Err(_) => false,
        })
    }

    /// Acrescenta uma linha ao fim e indexa-a.
    pub fn append(&mut self, line: &str) -> R<()> {
        if line.contains('\n') {
            return Err(Error::QuebraDeLinhaNoConteudo);
        }
        let off = self.file_bytes();
        let escrita = || -> std::io::Result<()> {
            let mut fd = OpenOptions::new().create(true).append(true).open(&self.file)?;
            fd.write_all(line.as_bytes())?;
            fd.write_all(b"\n")?;
            // Sem `sync_data`: a referência usa `appendFileSync`, que também não
            // sincroniza. Um corte de energia pode perder o último bloco — e é
            // justamente para isso que existe a recuperação de rasgo em `scan`.
            // Sincronizar por bloco custaria um flush de disco a cada segundo.
            Ok(())
        };
        if let Err(e) = escrita() {
            // A escrita pode ter gravado bytes PARCIAIS antes de falhar (disco
            // cheio é o caso comum). Repara truncando no fim da última linha
            // indexada — melhor esforço: se o reparo também falhar, o erro
            // original é o que importa, e o `scan` do próximo boot ainda cobre o
            // rasgo. Por isso o `let _ =`: engolir o erro do reparo é deliberado.
            let _ = OpenOptions::new().write(true).open(&self.file).map(|f| f.set_len(off));
            return Err(Error::Io(e));
        }
        let len = line.len() as u64;
        self.offsets.push((off, len));
        // G7: sidecar incremental (hash do JSON se presente).
        if let Some(h) = hash_hex_from_line(line) {
            self.append_sidecar(off, len, &h);
        } else {
            self.sidecars_ok = false;
        }
        Ok(())
    }

    /// Trunca exatamente no fim da última linha INDEXADA, descartando o que houver
    /// além. Usado quando o replay conclui que o rabo do arquivo é inválido.
    pub fn truncate_to_indexed_end(&mut self) -> R<()> {
        let fd = OpenOptions::new().write(true).open(&self.file)?;
        fd.set_len(self.file_bytes())?;
        let n = self.offsets.len();
        self.truncate_sidecars(n);
        Ok(())
    }

    /// Descarta as alturas `>= height` (reorg: trunca no ponto do fork e o chamador
    /// re-appenda o novo rabo). O prefixo comum NUNCA é reescrito — é o que torna o
    /// reorg O(tamanho do rabo) em vez de O(tamanho da cadeia).
    pub fn truncate_from(&mut self, height: usize) -> R<()> {
        let Some(&(off, _)) = self.offsets.get(height) else {
            return Ok(()); // altura além do índice: nada a fazer
        };
        let fd = OpenOptions::new().write(true).open(&self.file)?;
        fd.set_len(off)?;
        self.offsets.truncate(height);
        self.truncate_sidecars(height);
        Ok(())
    }

    /// Reescreve o arquivo INTEIRO. Só para gênese e migração — o custo é O(cadeia)
    /// e materializa tudo, o que é o oposto do que este módulo existe para fazer.
    ///
    /// Grava num temporário e renomeia: o `rename` é atômico no mesmo sistema de
    /// arquivos, então um crash no meio deixa o arquivo ANTIGO intacto, nunca um
    /// meio-arquivo novo.
    pub fn reset<'a, I>(&mut self, lines: I) -> R<()>
    where
        I: IntoIterator<Item = &'a str>,
    {
        let tmp = self.file.with_extension("jsonl.tmp");
        let mut offsets = Vec::new();
        let mut off = 0u64;
        let mut conteudo = String::new();
        for line in lines {
            if line.contains('\n') {
                return Err(Error::QuebraDeLinhaNoConteudo);
            }
            let len = line.len() as u64;
            offsets.push((off, len));
            off += len + 1;
            conteudo.push_str(line);
            conteudo.push('\n');
        }
        // O índice só é adotado depois que o arquivo está no lugar: se a escrita
        // falhar, o armazém continua descrevendo o arquivo que de fato existe.
        std::fs::write(&tmp, conteudo.as_bytes())?;
        std::fs::rename(&tmp, &self.file)?;
        self.offsets = offsets;
        // O `rename` troca o inode: o descritor em cache ainda aponta para o
        // arquivo VELHO (que continua vivo enquanto houver fd aberto). Mantê-lo
        // faria toda leitura seguinte devolver o conteúdo anterior — silenciosamente.
        self.solta_fd();
        if self.offsets.is_empty() {
            self.drop_sidecars();
        } else {
            // Melhor esforço: rebuild a partir das linhas em disco.
            let _ = self.persist_sidecars(&[]);
        }
        Ok(())
    }

    pub fn close(&mut self) {
        self.solta_fd();
    }
}

fn digest_from_hash(hash: &str) -> Option<[u8; HASH_REC]> {
    if hash.len() != 64 {
        return None;
    }
    let mut out = [0u8; HASH_REC];
    hex::decode_to_slice(hash, &mut out).ok()?;
    Some(out)
}

fn hash_hex_from_line(line: &str) -> Option<String> {
    match parse_json(line).ok()? {
        JsonValue::Map(m) => match m.get("hash") {
            Some(JsonValue::Str(s)) if s.len() == 64 => Some(s.clone()),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Diretório temporário próprio, sem dependência externa.
    fn tmpdir(nome: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let carimbo = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        p.push(format!("eav7-blockstore-{nome}-{carimbo}"));
        let _ = std::fs::create_dir_all(&p);
        p
    }

    fn store(nome: &str) -> BlockStore {
        BlockStore::new(tmpdir(nome).join(BLOCKS_FILE))
    }

    /// Validador mínimo de teste: aceita o que começa com `{` e fecha as chaves
    /// fora de string. Faz o papel que o `JSON.parse` faz na referência e que, em
    /// produção, é do parser de bloco passado pelo chamador.
    fn parseia(_altura: usize, linha: &str) -> bool {
        let mut prof = 0i32;
        let mut em_str = false;
        let mut escape = false;
        for c in linha.chars() {
            if em_str {
                if escape {
                    escape = false;
                } else if c == '\\' {
                    escape = true;
                } else if c == '"' {
                    em_str = false;
                }
                continue;
            }
            match c {
                '"' => em_str = true,
                '{' | '[' => prof += 1,
                '}' | ']' => prof -= 1,
                _ => {}
            }
        }
        linha.starts_with('{') && prof == 0 && !em_str
    }

    fn linha(h: usize) -> String {
        format!("{{\"height\":{h},\"hash\":\"h{h}\"}}")
    }

    #[test]
    fn ida_e_volta_ao_disco() {
        let mut s = store("roundtrip");
        for h in 0..5 {
            s.append(&linha(h)).expect("append");
        }
        assert_eq!(s.count(), 5);

        // Lê pelo índice em memória.
        for h in 0..5 {
            assert_eq!(s.get(h).expect("get"), Some(linha(h)));
        }
        assert_eq!(s.get(5).expect("get"), None, "altura inexistente não é erro");

        // Reabre do zero: o índice é reconstruído do arquivo e devolve o mesmo.
        let mut s2 = BlockStore::new(s.path());
        let r = s2.scan(0, parseia).expect("scan");
        assert_eq!(r, ScanReport { count: 5, truncated: false });
        assert_eq!(s2.file_bytes(), s.file_bytes());
        for h in 0..5 {
            assert_eq!(s2.get(h).expect("get"), Some(linha(h)));
        }
    }

    #[test]
    fn utf8_multibyte_sobrevive_a_fronteira_de_pedaco() {
        // Acento e emoji na linha: se a varredura decodificasse antes de juntar o
        // carry, o caractere partido viraria erro de UTF-8.
        let mut s = store("utf8");
        let l = "{\"nota\":\"café 😀 ação\"}";
        s.append(l).expect("append");
        s.append(&linha(1)).expect("append");

        let mut s2 = BlockStore::new(s.path());
        assert_eq!(s2.scan(0, parseia).expect("scan").count, 2);
        assert_eq!(s2.get(0).expect("get").as_deref(), Some(l));
    }

    #[test]
    fn append_rasgado_no_fim_e_truncado_sem_panico() {
        let mut s = store("rasgo");
        for h in 0..3 {
            s.append(&linha(h)).expect("append");
        }
        let bytes_antes = s.file_bytes();

        // Crash no meio do append: bytes parciais, sem `\n`.
        let mut fd = OpenOptions::new().append(true).open(s.path()).expect("abrir");
        fd.write_all(b"{\"height\":3,\"hash\":\"E7QUEBR").expect("escrever");
        drop(fd);

        let mut s2 = BlockStore::new(s.path());
        let r = s2.scan(0, parseia).expect("rasgo no fim é recuperável, não erro");
        assert_eq!(r, ScanReport { count: 3, truncated: true });
        assert_eq!(s2.file_bytes(), bytes_antes, "o lixo saiu do arquivo");
        assert_eq!(
            std::fs::metadata(s2.path()).expect("stat").len(),
            bytes_antes,
            "o disco reflete o truncamento"
        );

        // Idempotente: o boot seguinte não encontra mais nada para truncar, e o
        // append cai no offset certo.
        let mut s3 = BlockStore::new(s2.path());
        assert_eq!(s3.scan(0, parseia).expect("scan"), ScanReport { count: 3, truncated: false });
        s3.append(&linha(3)).expect("append");
        assert_eq!(s3.get(3).expect("get"), Some(linha(3)));
    }

    #[test]
    fn arquivo_cortado_no_meio_de_um_caractere_nao_entra_em_panico() {
        // Truncar dentro de um caractere multibyte deixa bytes UTF-8 inválidos no
        // fim. Tem de virar rasgo recuperável — nunca pânico de decodificação.
        let mut s = store("corte-utf8");
        s.append(&linha(0)).expect("append");
        let bytes_antes = s.file_bytes();
        s.append("{\"nota\":\"ação\"}").expect("append");

        let tamanho = std::fs::metadata(s.path()).expect("stat").len();
        let fd = OpenOptions::new().write(true).open(s.path()).expect("abrir");
        fd.set_len(tamanho - 4).expect("truncar"); // corta dentro do 'ç'/'ã'
        drop(fd);

        let mut s2 = BlockStore::new(s.path());
        let r = s2.scan(0, parseia).expect("não pode entrar em pânico nem falhar");
        assert_eq!(r, ScanReport { count: 1, truncated: true });
        assert_eq!(s2.file_bytes(), bytes_antes);
    }

    #[test]
    fn corrupcao_no_meio_e_erro_nao_truncamento() {
        // Diferente do rasgo final: aqui há linhas VÁLIDAS depois da estragada, e
        // truncar jogaria fora cadeia legítima. A decisão sobe para o chamador.
        let mut s = store("meio");
        let conteudo = format!("{}\n{{\"quebrado\"\n{}\n", linha(0), linha(2));
        std::fs::write(s.path(), conteudo).expect("escrever");
        let tamanho = std::fs::metadata(s.path()).expect("stat").len();

        let erro = s.scan(0, parseia).expect_err("linha completa inválida é erro");
        assert!(matches!(erro, Error::LinhaCorrompida(1)), "erro inesperado: {erro}");
        assert_eq!(
            std::fs::metadata(s.path()).expect("stat").len(),
            tamanho,
            "o arquivo não pode ser tocado nesse caso"
        );
    }

    #[test]
    fn arquivo_inexistente_e_varredura_vazia() {
        let mut s = store("vazio");
        assert_eq!(s.scan(0, parseia).expect("scan"), ScanReport { count: 0, truncated: false });
        assert_eq!(s.count(), 0);
        assert_eq!(s.file_bytes(), 0);
        assert_eq!(s.get(0).expect("get"), None);
    }

    #[test]
    fn linha_em_branco_nao_vira_bloco() {
        let mut s = store("branco");
        std::fs::write(s.path(), format!("{}\n\n{}\n", linha(0), linha(1))).expect("escrever");
        assert_eq!(s.scan(0, parseia).expect("scan").count, 2);
        assert_eq!(s.get(1).expect("get"), Some(linha(1)), "a altura 1 não pode escorregar");
    }

    #[test]
    fn truncate_from_desfaz_o_rabo_e_o_append_recomeca_dali() {
        let mut s = store("reorg");
        for h in 0..5 {
            s.append(&linha(h)).expect("append");
        }
        s.truncate_from(2).expect("truncar");
        assert_eq!(s.count(), 2);
        s.append("{\"height\":2,\"hash\":\"novo\"}").expect("append");

        let mut s2 = BlockStore::new(s.path());
        assert_eq!(s2.scan(0, parseia).expect("scan").count, 3);
        assert_eq!(s2.get(2).expect("get").as_deref(), Some("{\"height\":2,\"hash\":\"novo\"}"));

        // Altura além do índice é no-op, não erro.
        s2.truncate_from(99).expect("no-op");
        assert_eq!(s2.count(), 3);
    }

    #[test]
    fn truncate_to_indexed_end_remove_o_lixo_alem_do_indice() {
        let mut s = store("indexed-end");
        s.append(&linha(0)).expect("append");
        let esperado = s.file_bytes();
        let mut fd = OpenOptions::new().append(true).open(s.path()).expect("abrir");
        fd.write_all(b"LIXO\n").expect("escrever");
        drop(fd);

        s.truncate_to_indexed_end().expect("truncar");
        assert_eq!(std::fs::metadata(s.path()).expect("stat").len(), esperado);
    }

    #[test]
    fn reset_reescreve_e_invalida_o_descritor_antigo() {
        let mut s = store("reset");
        s.append(&linha(0)).expect("append");
        assert_eq!(s.get(0).expect("get"), Some(linha(0))); // abre o fd de leitura

        let novas: Vec<String> = (0..3).map(|h| format!("{{\"h\":{h}}}")).collect();
        s.reset(novas.iter().map(String::as_str)).expect("reset");

        assert_eq!(s.count(), 3);
        // Se o fd antigo tivesse sobrevivido ao rename, isto devolveria a linha velha.
        assert_eq!(s.get(0).expect("get").as_deref(), Some("{\"h\":0}"));
        assert_eq!(s.get(2).expect("get").as_deref(), Some("{\"h\":2}"));

        let mut s2 = BlockStore::new(s.path());
        assert_eq!(s2.scan(0, parseia).expect("scan").count, 3);

        // Reset vazio deixa arquivo vazio e índice vazio.
        s.reset(std::iter::empty()).expect("reset vazio");
        assert_eq!(s.count(), 0);
        assert_eq!(std::fs::metadata(s.path()).expect("stat").len(), 0);
    }

    #[test]
    fn linha_com_quebra_e_recusada() {
        let mut s = store("quebra");
        assert!(matches!(
            s.append("{\"a\":1}\n{\"b\":2}"),
            Err(Error::QuebraDeLinhaNoConteudo)
        ));
        assert_eq!(s.count(), 0);
        assert!(s.reset(["ok", "com\nquebra"]).is_err());
    }

    fn hash64(n: u64) -> String {
        format!("{n:064x}")
    }

    fn linha_com_hash(h: usize, hash: &str) -> String {
        format!("{{\"height\":{h},\"hash\":\"{hash}\"}}")
    }

    #[test]
    fn sidecars_sobrevivem_ao_reopen() {
        let mut s = store("sidecar");
        let h0 = hash64(0xa);
        let h1 = hash64(0xb);
        s.append(&linha_com_hash(0, &h0)).expect("append");
        s.append(&linha_com_hash(1, &h1)).expect("append");
        assert!(s.sidecars_ok());
        assert_eq!(s.hash_at(0).as_deref(), Some(h0.as_str()));
        assert_eq!(s.hash_at(1).as_deref(), Some(h1.as_str()));

        let mut s2 = BlockStore::new(s.path());
        assert!(s2.try_load_sidecars());
        assert_eq!(s2.count(), 2);
        assert_eq!(s2.hash_at(0).as_deref(), Some(h0.as_str()));
        assert_eq!(s2.get(1).expect("get").as_deref(), Some(linha_com_hash(1, &h1).as_str()));
    }

    #[test]
    fn sidecar_invalido_e_recusado() {
        let mut s = store("sidecar-bad");
        let h0 = hash64(1);
        s.append(&linha_com_hash(0, &h0)).expect("append");
        // Adulterar hashes.bin
        std::fs::write(s.path().parent().unwrap().join(HASHES_FILE), [0u8; 32]).unwrap();
        let mut s2 = BlockStore::new(s.path());
        assert!(!s2.try_load_sidecars());
        assert_eq!(s2.count(), 0);
    }

    #[test]
    fn scan_retomado_indexa_so_o_rabo() {
        // É o boot por snapshot: o prefixo já validado não é relido.
        let mut s = store("retomada");
        for h in 0..4 {
            s.append(&linha(h)).expect("append");
        }
        let corte = s.file_bytes() - (linha(3).len() as u64 + 1);

        let mut s2 = BlockStore::new(s.path());
        let r = s2.scan(corte, parseia).expect("scan");
        assert_eq!(r.count, 1);
        // O índice desta instância começa em zero; a linha lida é a última do arquivo.
        assert_eq!(s2.get(0).expect("get"), Some(linha(3)));
    }

    // ------------------------------------------------- leitura para JsonValue

    #[test]
    fn scan_json_entrega_valor_e_recusa_linha_ilegivel() {
        let mut s = store("scan-json");
        s.append(r#"{"a":1,"b":[true,null,"x"]}"#).expect("append");
        s.append(r#"{"a":2}"#).expect("append");

        let mut vistos: Vec<(usize, JsonValue)> = Vec::new();
        let mut s2 = BlockStore::new(s.path());
        let r = s2
            .scan_json(0, |h, v| {
                vistos.push((h, v));
                true
            })
            .expect("scan_json");
        assert_eq!(r, ScanReport { count: 2, truncated: false });
        assert_eq!(vistos.len(), 2);
        assert_eq!(
            crate::transaction::canonical_json(&vistos[0].1),
            r#"{"a":1,"b":[true,null,"x"]}"#
        );
        assert_eq!(s2.get_json(1).expect("get_json"), Some(vistos[1].1.clone()));
        assert_eq!(s2.get_json(9).expect("get_json"), None, "altura inexistente não é erro");

        // Uma linha completa que não é JSON é corrupção NO MEIO: erro, não
        // truncamento silencioso do rabo.
        let mut s3 = store("scan-json-corrompido");
        s3.append(r#"{"a":1}"#).expect("append");
        s3.append(r#"{"a":1,,}"#).expect("append");
        s3.append(r#"{"a":3}"#).expect("append");
        let mut s4 = BlockStore::new(s3.path());
        assert!(matches!(
            s4.scan_json(0, |_, _| true),
            Err(Error::LinhaCorrompida(1))
        ));
    }

    #[test]
    fn scan_json_trunca_o_append_rasgado_sem_panico() {
        // Metade de um JSON no fim do arquivo: o parser recusa, e `scan` classifica
        // como rasgo por ser a ÚLTIMA linha sem `\n`. Nada de pânico.
        let mut s = store("scan-json-rasgo");
        s.append(r#"{"a":1}"#).expect("append");
        let antes = s.file_bytes();
        let mut fd = OpenOptions::new().append(true).open(s.path()).expect("abrir");
        fd.write_all(br#"{"a":2,"b":["#).expect("escrever");
        drop(fd);

        let mut s2 = BlockStore::new(s.path());
        let r = s2.scan_json(0, |_, _| true).expect("rasgo é recuperável");
        assert_eq!(r, ScanReport { count: 1, truncated: true });
        assert_eq!(std::fs::metadata(s2.path()).expect("stat").len(), antes);
    }

    /// O teste que fecha o caminho de boot: blocos REAIS vão ao disco pelo
    /// `BlockStore`, voltam pelo `scan_json`, e o hash é RECOMPUTADO do bloco que
    /// voltou. Se não bater, o nó rejeita o próprio histórico no boot — que é o
    /// único sintoma que este caminho tem.
    #[test]
    fn blocos_reais_voltam_do_disco_com_o_hash_recomputado() {
        use crate::block::teste_util::Carteira;
        use crate::block::{
            block_from_json, block_payload, block_to_json_line, build_block, build_genesis_block,
            verify_block_integrity, BuildParams,
        };
        use crate::config::{PERMISSIONS_V2_HEIGHT, STATEROOT_HEIGHT};
        use crate::transaction::{tx_id, JsonValue, Tx};

        let carteira = Carteira::nova(7);
        let alice = crate::derive_address_from("VETOR:alice");

        // `data` com tudo que o parser tem de devolver intacto: escapes, UTF-8 fora
        // do BMP, inteiro negativo, aninhamento e coleções vazias. Qualquer um
        // deles voltando diferente muda o payload da tx, muda o `id`, muda o
        // `txRoot` e derruba o bloco.
        let mut tx = Tx::new("TRANSFER", &alice, 1, 1_700_000_000_000);
        tx.to = Some(crate::derive_address_from("VETOR:bob"));
        tx.amount = "1000000".into();
        tx.fee = "10000".into();
        tx.data = Some(JsonValue::map([
            ("nota".into(), JsonValue::str("café \u{1F600} \"aspas\" \\ barra\ttab\nlinha")),
            ("neg".into(), JsonValue::Int(-9_007_199_254_740_991)),
            ("max".into(), JsonValue::Int(i64::MAX)),
            ("vazios".into(), JsonValue::List(vec![JsonValue::map([]), JsonValue::List(vec![])])),
            ("fundo".into(), JsonValue::List(vec![JsonValue::List(vec![JsonValue::Null])])),
            ("\u{1F600}".into(), JsonValue::Bool(true)),
        ]));
        tx.public_key = Some("pk".into());
        tx.pq_public_key = Some("pqpk".into());
        tx.signature = Some("sig".into());
        tx.pq_signature = Some("pqsig".into());
        tx.id = Some(tx_id(&tx));

        let params = |height: u64, txs: Vec<Tx>| BuildParams {
            height,
            previous_hash: "a".repeat(64),
            timestamp: 1_700_000_000_000,
            transactions: txs,
            state_root: if height >= STATEROOT_HEIGHT { Some("b".repeat(64)) } else { None },
            producer_account: if height >= PERMISSIONS_V2_HEIGHT { Some(alice.clone()) } else { None },
            omit_public_keys: false,
        };

        let blocos = vec![
            // Gênese: campo `genesis` cru e a fórmula ANTIGA de hash.
            build_genesis_block(
                1_700_000_000_000,
                JsonValue::map([(alice.clone(), JsonValue::str("1000000000"))]),
            ),
            // Abaixo de CANONICAL_HASH_HEIGHT: o hash ainda cobre as assinaturas, e
            // o `stateRoot` é PROIBIDO — é a omissão que mantém o payload.
            build_block(&carteira, params(900_000, vec![])).expect("bloco antigo"),
            // Acima dos dois forks, com transação de `data` exótico.
            build_block(&carteira, params(1_300_000, vec![tx.clone()])).expect("bloco novo"),
            // Com `producerAccount`.
            build_block(&carteira, params(1_950_000, vec![tx])).expect("bloco delegado"),
        ];

        let mut s = store("blocos-reais");
        for b in &blocos {
            s.append(&block_to_json_line(b).expect("serializar")).expect("append");
        }

        // Boot: instância NOVA, índice reconstruído do arquivo, blocos remontados.
        let mut lidos: Vec<crate::Block> = Vec::new();
        let mut s2 = BlockStore::new(s.path());
        let r = s2
            .scan_json(0, |_, v| match block_from_json(&v) {
                Ok(b) => {
                    lidos.push(b);
                    true
                }
                Err(_) => false,
            })
            .expect("o histórico gravado tem de ser relível");
        assert_eq!(r, ScanReport { count: blocos.len(), truncated: false });
        assert_eq!(lidos.len(), blocos.len());

        for (original, lido) in blocos.iter().zip(&lidos) {
            // 1. O bloco volta idêntico campo a campo.
            assert_eq!(lido, original, "bloco {} voltou diferente", original.height);
            // 2. E — o que de fato importa — o hash RECOMPUTADO do bloco relido é o
            //    mesmo que foi gravado. `verify_block_integrity` refaz o payload
            //    canônico, o `txRoot` e o hash a partir do que voltou do disco.
            assert_eq!(
                verify_block_integrity(lido),
                Ok(()),
                "bloco {} não passa na integridade depois de voltar do disco",
                original.height
            );
            assert_eq!(lido.hash, original.hash);
            assert_eq!(block_payload(lido), block_payload(original), "a pré-imagem mudou");
        }

        // E a leitura pontual pelo índice (o caminho da API/sincronização) dá o mesmo.
        let ultimo = blocos.len() - 1;
        let v = s2.get_json(ultimo).expect("get_json").expect("existe");
        assert_eq!(&block_from_json(&v).expect("remontar"), &blocos[ultimo]);
    }

    /// Varrer do início DUAS VEZES tem de dar o mesmo índice.
    ///
    /// O boot faz exatamente isso quando o snapshot é recusado: tenta o caminho
    /// rápido, desiste, e o replay completo varre de novo. Enquanto o índice era
    /// empilhado em vez de reconstruído, a segunda varredura dobrava a contagem e
    /// o replay truncava blocos VÁLIDOS achando que eram rabo corrompido.
    #[test]
    fn varrer_do_inicio_duas_vezes_e_idempotente() {
        let mut s = store("idempotente");
        for i in 0..5 {
            s.append(&format!("{{\"n\":{i}}}")).expect("append");
        }
        let primeira = s.scan(0, |_, _| true).expect("scan").count;
        let segunda = s.scan(0, |_, _| true).expect("scan").count;
        assert_eq!(primeira, 5);
        assert_eq!(segunda, primeira, "a segunda varredura não pode somar ao índice");
        assert_eq!(s.count(), 5);
        // E a leitura por altura continua apontando para a linha certa.
        assert_eq!(s.get(4).expect("lê").as_deref(), Some("{\"n\":4}"));
    }
}
