import {
  openSync, readSync, closeSync, appendFileSync, writeFileSync, readFileSync,
  renameSync, ftruncateSync, existsSync, unlinkSync, mkdirSync, statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const CHUNK_BYTES = 64 * 1024 * 1024;
const IDX_REC = 16; // u64 offset ‖ u64 len (LE)
const HASH_REC = 32; // digest SHA3-256 cru

// Armazém de blocos em disco sobre o blocks.jsonl (uma linha JSON por bloco),
// com índice de byte-offsets. G7: sidecars `blocks.idx` + `hashes.bin` persistem
// offsets e digests entre boots (sem fork — só layout local do nó).
export class BlockStore {
  #fd = null;

  constructor(file) {
    this.file = file;
    this.idxFile = join(dirname(file), 'blocks.idx');
    this.hashesFile = join(dirname(file), 'hashes.bin');
    this.offsets = []; // altura -> [byteOffset, byteLen] (len sem o \n)
  }

  get count() {
    return this.offsets.length;
  }

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

  /** Digest hex (64) da altura, via hashes.bin — O(1) sem array em RAM. */
  hashAt(height) {
    if (height < 0 || height >= this.offsets.length) return null;
    if (!existsSync(this.hashesFile)) return null;
    const buf = Buffer.allocUnsafe(HASH_REC);
    const fd = openSync(this.hashesFile, 'r');
    try {
      const n = readSync(fd, buf, 0, HASH_REC, height * HASH_REC);
      if (n !== HASH_REC) return null;
    } finally {
      closeSync(fd);
    }
    return buf.toString('hex');
  }

  static #digestFromHash(hash) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash)) return null;
    return Buffer.from(hash, 'hex');
  }

  // Tenta carregar sidecars. true = offsets prontos (caller ainda pode validar).
  tryLoadSidecars() {
    if (!existsSync(this.file) || !existsSync(this.idxFile) || !existsSync(this.hashesFile)) {
      return false;
    }
    const idx = Buffer.from(readFileSync(this.idxFile));
    const hashes = Buffer.from(readFileSync(this.hashesFile));
    if (idx.length % IDX_REC !== 0 || hashes.length % HASH_REC !== 0) return false;
    const n = idx.length / IDX_REC;
    if (n !== hashes.length / HASH_REC) return false;
    if (n === 0) {
      this.offsets = [];
      return true;
    }
    const offsets = [];
    for (let i = 0; i < n; i++) {
      const o = Number(idx.readBigUInt64LE(i * IDX_REC));
      const len = Number(idx.readBigUInt64LE(i * IDX_REC + 8));
      offsets.push([o, len]);
    }
    const [lo, ll] = offsets[n - 1];
    const expectedEnd = lo + ll + 1;
    const size = statSync(this.file).size;
    if (size < expectedEnd) return false;
    // Confere gênese: hash do bloco 0 bate com hashes.bin[0]
    try {
      this.offsets = offsets;
      const b0 = this.get(0);
      const h0 = hashes.subarray(0, HASH_REC).toString('hex');
      if (!b0 || b0.hash !== h0) {
        this.offsets = [];
        return false;
      }
    } catch {
      this.offsets = [];
      return false;
    }
    return true;
  }

  persistSidecars(hashList) {
    // hashList[i] = hex do bloco i (opcional se já temos hashes.bin coerente)
    const n = this.offsets.length;
    const idx = Buffer.allocUnsafe(n * IDX_REC);
    const hashes = Buffer.allocUnsafe(n * HASH_REC);
    for (let i = 0; i < n; i++) {
      const [o, len] = this.offsets[i];
      idx.writeBigUInt64LE(BigInt(o), i * IDX_REC);
      idx.writeBigUInt64LE(BigInt(len), i * IDX_REC + 8);
      let dig = null;
      if (hashList && hashList[i]) dig = BlockStore.#digestFromHash(hashList[i]);
      if (!dig) {
        const b = this.get(i);
        dig = BlockStore.#digestFromHash(b?.hash);
      }
      if (!dig) throw new Error(`blockstore: hash inválido na altura ${i}`);
      dig.copy(hashes, i * HASH_REC);
    }
    const dir = dirname(this.file);
    mkdirSync(dir, { recursive: true });
    const tmpIdx = this.idxFile + '.tmp';
    const tmpH = this.hashesFile + '.tmp';
    writeFileSync(tmpIdx, idx);
    writeFileSync(tmpH, hashes);
    renameSync(tmpIdx, this.idxFile);
    renameSync(tmpH, this.hashesFile);
  }

  #appendSidecar(off, len, hashHex) {
    const dig = BlockStore.#digestFromHash(hashHex);
    if (!dig) return; // sem sidecar até rebuild
    const idxRec = Buffer.allocUnsafe(IDX_REC);
    idxRec.writeBigUInt64LE(BigInt(off), 0);
    idxRec.writeBigUInt64LE(BigInt(len), 8);
    try {
      appendFileSync(this.idxFile, idxRec);
      appendFileSync(this.hashesFile, dig);
    } catch {
      // sidecars ficam sujos → próximo boot reconstrói
      try { unlinkSync(this.idxFile); } catch { /* */ }
      try { unlinkSync(this.hashesFile); } catch { /* */ }
    }
  }

  #truncateSidecars(height) {
    try {
      if (existsSync(this.idxFile)) {
        const fd = openSync(this.idxFile, 'r+');
        try { ftruncateSync(fd, height * IDX_REC); } finally { closeSync(fd); }
      }
      if (existsSync(this.hashesFile)) {
        const fd = openSync(this.hashesFile, 'r+');
        try { ftruncateSync(fd, height * HASH_REC); } finally { closeSync(fd); }
      }
    } catch {
      try { unlinkSync(this.idxFile); } catch { /* */ }
      try { unlinkSync(this.hashesFile); } catch { /* */ }
    }
  }

  scan(onBlock, byteStart = 0) {
    if (!existsSync(this.file)) return { count: 0, truncated: false };
    if (byteStart === 0) this.offsets = [];
    const fd = openSync(this.file, 'r');
    let count = 0;
    let truncateAt = -1;
    try {
      const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
      let carry = null;
      let lineStart = byteStart;
      let pos = byteStart;
      let n;
      while ((n = readSync(fd, chunk, 0, chunk.length, pos)) > 0) {
        const view = chunk.subarray(0, n);
        let start = 0;
        let nl;
        while ((nl = view.indexOf(10, start)) !== -1) {
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
          const rest = view.subarray(start);
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
            truncateAt = lineStart;
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
      try {
        const fd = openSync(this.file, 'r+');
        try { ftruncateSync(fd, off); } finally { closeSync(fd); }
      } catch { /* melhor esforço */ }
      throw err;
    }
    const len = Buffer.byteLength(line);
    this.offsets.push([off, len]);
    this.#appendSidecar(off, len, block.hash);
  }

  truncateToIndexedEnd() {
    const fd = openSync(this.file, 'r+');
    try { ftruncateSync(fd, this.fileBytes); } finally { closeSync(fd); }
    this.#truncateSidecars(this.offsets.length);
  }

  truncateFrom(height) {
    const at = this.offsets[height];
    if (!at) return;
    const fd = openSync(this.file, 'r+');
    try { ftruncateSync(fd, at[0]); } finally { closeSync(fd); }
    this.offsets.length = height;
    this.#truncateSidecars(height);
  }

  reset(blocks) {
    const tmp = this.file + '.tmp';
    this.offsets = [];
    let off = 0;
    const lines = [];
    const hashList = [];
    for (const block of blocks) {
      const line = JSON.stringify(block);
      const len = Buffer.byteLength(line);
      this.offsets.push([off, len]);
      off += len + 1;
      lines.push(line);
      hashList.push(block.hash);
    }
    writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '');
    renameSync(tmp, this.file);
    this.#dropFd();
    if (blocks.length === 0) {
      try { unlinkSync(this.idxFile); } catch { /* */ }
      try { unlinkSync(this.hashesFile); } catch { /* */ }
    } else {
      this.persistSidecars(hashList);
    }
  }

  close() {
    this.#dropFd();
  }
}
