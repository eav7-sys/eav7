#!/usr/bin/env node
/**
 * Faucet HTTP da testnet pública EAV7 (chain 72021).
 *
 * Opt-in: FAUCET_ENABLE=1. Sem isto o processo recusa arrancar.
 *
 * POST /faucet  { "address": "E7…" }  → { ok, amount, id }
 * GET  /status                        → { ok, amount, intervalMs, waiting }
 *
 * Usa eav7-cli + carteira do produtor (saldo de gênese). Fila serializa
 * envios para não colidir nonce sob carga.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.FAUCET_ENABLE !== "1") {
  console.error("recusado: defina FAUCET_ENABLE=1 (opt-in explícito)");
  process.exit(2);
}

const PORT = Number(process.env.FAUCET_PORT || 8790);
const HOST = process.env.FAUCET_HOST || "127.0.0.1";
const NODE = process.env.EAV7_NODE || "http://127.0.0.1:6170";
const WALLET = process.env.FAUCET_WALLET || "/var/lib/eav7-testnet/validator-wallet.json";
const CLI = process.env.EAV7_CLI || "/usr/local/bin/eav7-cli";
const AMOUNT = process.env.FAUCET_AMOUNT || "100";
const INTERVAL_MS = Number(process.env.FAUCET_INTERVAL_MS || 3_600_000);
const CORS = (process.env.FAUCET_CORS || "https://testnet.eavscan.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** @type {Map<string, number>} */
const ultimo = new Map();
let fila = Promise.resolve();
let emEspera = 0;

function agora() {
  return Date.now();
}

function normalizaEndereco(raw) {
  const a = String(raw || "").trim().toUpperCase();
  if (!/^E7[0-9A-F]{32}$/.test(a)) return null;
  return a;
}

function esperaRestante(addr) {
  const prev = ultimo.get(addr);
  if (prev == null) return 0;
  return Math.max(0, INTERVAL_MS - (agora() - prev));
}

function podar() {
  const now = agora();
  for (const [k, when] of ultimo) {
    if (now - when >= INTERVAL_MS) ultimo.delete(k);
  }
}

function enfileira(fn) {
  const run = fila.then(fn, fn);
  fila = run.catch(() => {});
  return run;
}

function runCli(args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, {
      env: { ...process.env, EAV7_NODE: NODE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timeout no eav7-cli"));
    }, timeoutMs);
    child.stdout.on("data", (b) => {
      out += b.toString();
    });
    child.stderr.on("data", (b) => {
      err += b.toString();
    });
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) {
        reject(new Error((err || out || `exit ${code}`).trim().slice(0, 400)));
        return;
      }
      resolve(out);
    });
  });
}

function parseTxId(stdout) {
  try {
    const j = JSON.parse(stdout);
    return j.id || j.txId || j.hash || null;
  } catch {
    const m = stdout.match(/"id"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  }
}

async function enviar(address) {
  const out = await runCli([
    "send",
    "--node",
    NODE,
    "--wallet",
    WALLET,
    "--to",
    address,
    "--amount",
    AMOUNT,
  ]);
  return parseTxId(out);
}

function corsHeaders(origin) {
  const allow = origin && CORS.includes(origin) ? origin : CORS[0] || "*";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

function sendJson(res, status, body, origin) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(origin),
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/status") {
      podar();
      sendJson(
        res,
        200,
        {
          ok: true,
          network: "testnet",
          amount: AMOUNT,
          symbol: "EAV7",
          intervalMs: INTERVAL_MS,
          waiting: ultimo.size,
          queue: emEspera,
        },
        origin,
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/faucet") {
      const body = await readBody(req);
      const address = normalizaEndereco(body.address);
      if (!address) {
        sendJson(res, 400, { error: "endereço EAV7 inválido" }, origin);
        return;
      }

      podar();
      const falta = esperaRestante(address);
      if (falta > 0) {
        const mins = Math.ceil(falta / 60_000);
        sendJson(
          res,
          429,
          {
            error: `aguarde ${mins} min antes de pedir de novo`,
            retryAfterMs: falta,
          },
          origin,
        );
        return;
      }

      // Reserva o slot ANTES do envio (mesma regra do SDK).
      ultimo.set(address, agora());
      emEspera += 1;
      try {
        const id = await enfileira(async () => {
          // Pequena folga se o bloco anterior ainda estiver a confirmar nonce.
          await sleep(50);
          return enviar(address);
        });
        sendJson(
          res,
          200,
          { ok: true, amount: String(Number(AMOUNT) * 1_000_000), id: id || undefined },
          origin,
        );
      } catch (e) {
        ultimo.delete(address);
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }, origin);
      } finally {
        emEspera = Math.max(0, emEspera - 1);
      }
      return;
    }

    sendJson(res, 404, { error: "not found" }, origin);
  } catch (e) {
    sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `[faucet] http://${HOST}:${PORT} · ${AMOUNT} EAV7 / ${INTERVAL_MS}ms · node ${NODE}`,
  );
});
