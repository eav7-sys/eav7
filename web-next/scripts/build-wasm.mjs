#!/usr/bin/env node
/**
 * Compila rust/wasm → web-next/src/lib/eav7-wasm (mesma cripto do nó).
 * Usa .tools/wasm-pack se existir; senão wasm-pack no PATH.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const wasmPack = existsSync(join(root, ".tools/wasm-pack"))
  ? join(root, ".tools/wasm-pack")
  : "wasm-pack";
const crate = join(root, "rust/wasm");
const out = join(root, "web-next/src/lib/eav7-wasm");

const r = spawnSync(
  wasmPack,
  ["build", "--target", "bundler", "--out-dir", out, "--out-name", "eav7_wasm", "--no-opt"],
  { cwd: crate, stdio: "inherit", env: process.env },
);
if (r.status !== 0) {
  console.error("wasm-pack falhou — instale o target wasm32-unknown-unknown e wasm-pack");
  process.exit(r.status ?? 1);
}
