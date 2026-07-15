import { openSync, readSync, closeSync, appendFileSync, writeFileSync, renameSync, ftruncateSync, existsSync } from 'node:fs';

const CHUNK_BYTES = 64 * 1024 * 1024;

// Armazém de blocos em disco sobre o blocks.jsonl (uma linha JSON por bloco),
// com índice de byte-offsets por altura em RAM. A cadeia NÃO vive mais na RAM:
// qualquer bloco é lido do disco em O(1) pelo offset. O arquivo cresce sem
// limite — nada aqui materializa o arquivo inteiro em memória.
export class BlockStore {
  #fd = null;

  constructor(file) {
    this.file = file;
    this.offsets = []; // altura -> [byteOffset, byteLen] (len sem o \n)
  }

  get count() {
    return this.offsets.length;
  }

  // Fim lógico do arquivo segundo o índice (== tamanho real fora de reorg torto).
  get fileBytes() {
    if (this.offsets.length === 0) return 0;
    const [off, len] = this.offsets[this.offsets.length - 1];
    return off + len + 1; // +1 do \n
  }

  #readFd() {
    if (this.#fd === null) this.#fd = openSync(this.file, 'r');
    return this.#fd;
  }

  #dropFd() {
    if (this.#fd !== null) {
      try { closeSync(this.#fd); } catch { /* ok */ }
      this.#fd = null;
    }
  }

  get(height) {
    const at = this.offsets[height];
    if (!at) return null;
    const buf = Buffer.allocUnsafe(at[1]);
    const n = readSync(this.#readFd(), buf, 0, at[1], at[0]);
    if (n !== at[1]) throw new Error(`blockstore: leitura curta na altura ${height}`);
    return JSON.parse(buf.toString('utf8'));
  }

  // Varre o arquivo a partir de byteStart em chunks (o arquivo passa dos 2 GiB —
  // teto do readFileSync E do limite de string do Node), registrando o offset de
  // cada linha e entregando cada bloco parseado a onBlock. Uma linha FINAL sem \n
  // que não parseia é um append rasgado por crash: é truncada do arquivo (não é
  // corrupção no meio — essa continua lançando).
  scan(onBlock, byteStart = 0) {
    if (!existsSync(this.file)) return { count: 0, truncated: false };
    const fd = openSync(this.file, 'r');
    let count = 0;
    let truncateAt = -1;
    try {
      const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
      let carry = null; // bytes de linha partida entre chunks (Buffer: não quebra UTF-8 multi-byte)
      let lineStart = byteStart;
      let pos = byteStart;
      let n;
      while ((n = readSync(fd, chunk, 0, chunk.length, pos)) > 0) {
        const view = chunk.subarray(0, n);
        let start = 0;
        let nl;
        while ((nl = view.indexOf(10, start)) !== -1) { // 10 = '\n'
          const raw = carry ? Buffer.concat([carry, view.subarray(start, nl)]) : view.subarray(start, nl);
          carry = null;
          const lineEnd = pos + nl;
          const text = raw.toString('utf8');
          if (text.trim()) {
            onBlock(JSON.parse(text), this.offsets.length);
            this.offsets.push([lineStart, lineEnd - lineStart]);
            count += 1;
          }
          lineStart = lineEnd + 1;
          start = nl + 1;
        }
        if (start < n) {
          const rest = view.subarray(start); // aliasa `chunk`, que será sobrescrito: copiar
          carry = carry ? Buffer.concat([carry, rest]) : Buffer.from(rest);
        }
        pos += n;
      }
      if (carry) {
        const text = carry.toString('utf8');
        if (text.trim()) {
          try {
            const block = JSON.parse(text);
            onBlock(block, this.offsets.length);
            this.offsets.push([lineStart, pos - lineStart]);
            count += 1;
          } catch {
            truncateAt = lineStart; // última linha rasgada (crash no meio do append)
          }
        }
      }
    } finally {
      closeSync(fd);
    }
    if (truncateAt >= 0) {
      const wfd = openSync(this.file, 'r+');
      try { ftruncateSync(wfd, truncateAt); } finally { closeSync(wfd); }
    }
    return { count, truncated: truncateAt >= 0 };
  }

  append(block) {
    const line = JSON.stringify(block);
    const off = this.fileBytes;
    try {
      appendFileSync(this.file, line + '\n');
    } catch (err) {
      // Um append que falha pode ter gravado bytes parciais: repara truncando no
      // fim da última linha INDEXADA, para índice e arquivo nunca divergirem.
      try {
        const fd = openSync(this.file, 'r+');
        try { ftruncateSync(fd, off); } finally { closeSync(fd); }
      } catch { /* melhor esforço */ }
      throw err;
    }
    this.offsets.push([off, Buffer.byteLength(line)]);
  }

  // Trunca o arquivo exatamente no fim da última linha indexada (descarta lixo
  // além do índice — usado quando o replay encontra blocos inválidos no fim).
  truncateToIndexedEnd() {
    const fd = openSync(this.file, 'r+');
    try { ftruncateSync(fd, this.fileBytes); } finally { closeSync(fd); }
  }

  // Descarta do disco os blocos de altura >= height (reorg: trunca no fork e o
  // chamador re-appenda o novo rabo). O prefixo comum nunca é reescrito.
  truncateFrom(height) {
    const at = this.offsets[height];
    if (!at) return;
    const fd = openSync(this.file, 'r+');
    try { ftruncateSync(fd, at[0]); } finally { closeSync(fd); }
    this.offsets.length = height;
  }

  // Reescreve o arquivo inteiro (só gênese/migração — cadeias pequenas em RAM).
  reset(blocks) {
    const tmp = this.file + '.tmp';
    this.offsets = [];
    let off = 0;
    const lines = [];
    for (const block of blocks) {
      const line = JSON.stringify(block);
      const len = Buffer.byteLength(line);
      this.offsets.push([off, len]);
      off += len + 1;
      lines.push(line);
    }
    writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '');
    renameSync(tmp, this.file);
    this.#dropFd(); // o rename troca o inode — o fd antigo aponta para o arquivo velho
  }

  close() {
    this.#dropFd();
  }
}
