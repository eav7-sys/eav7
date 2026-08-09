"use client";

import Link from "next/link";
import { ago, fmt, num, shortHash } from "@/lib/format";
import { useT } from "@/i18n/provider";
import type { Block, Tx } from "@/lib/api";

/** Cabeçalho comum aos dois painéis, com o ponto de "ao vivo". */
function Head({ title, right }: { title: string; right: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--scan-border-soft)] px-5 py-4">
      <div className="flex items-center gap-[9px] text-sm font-bold text-ink">
        <span className="scan-live" aria-hidden />
        {title}
      </div>
      <div className="text-[11px] text-faint">{right}</div>
    </div>
  );
}

function VerTudo({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block border-t border-[var(--scan-border-soft)] px-3 py-3 text-center text-[12.5px] font-semibold text-violet hover:bg-[var(--scan-hover)]"
    >
      {label} →
    </Link>
  );
}

function Vazio({ msg }: { msg: string }) {
  return <div className="px-5 py-8 text-center text-[13px] text-muted">{msg}</div>;
}

/**
 * Selo de status da execução.
 *
 * Só transação EAVM tem recibo. A AUSÊNCIA de recibo significa "aplicou-se com
 * sucesso" — é como o próprio explorador de referência lê —, então uma
 * transferência comum não pode aparecer como falha só por não ter recibo. O selo
 * de erro sai exclusivamente de `success === false`, que é a chamada que reverteu.
 */
function Status({ tx }: { tx: Tx }) {
  const t = useT();
  const falhou = tx.receipt?.success === false;
  return (
    <span
      className="rounded px-[7px] py-[2px] text-[10px] font-semibold"
      style={{
        background: falhou ? "color-mix(in srgb, var(--red) 18%, transparent)" : "color-mix(in srgb, var(--ok) 16%, transparent)",
        color: falhou ? "var(--red)" : "var(--ok)",
      }}
    >
      {falhou ? t("scan.stFailed") : t("scan.stOk")}
    </span>
  );
}

/** Cor estável derivada do endereço — o mesmo produtor tem sempre o mesmo tom. */
function avatarBg(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 58%)`;
}

export function LatestBlocks({
  blocks,
  blockTimeMs,
  blockReward,
  nomes,
}: {
  blocks: Block[];
  blockTimeMs?: number;
  blockReward?: string;
  /** endereço → nome EAV-NS, quando registrado. */
  nomes?: Record<string, string>;
}) {
  const t = useT();
  const cadencia = blockTimeMs ? `~${Math.round(blockTimeMs / 1000)}s` : "";
  // A recompensa é a MESMA para todo bloco (parâmetro do protocolo, vem do
  // /status). O desenho a mostra por linha; mostrar só quando existe evita a
  // alternativa ruim, que seria fixar o número no código do frontend.
  const recompensa = blockReward ? `+${fmt(blockReward)} EAV7` : null;

  return (
    <div className="scan-glass flex flex-col overflow-hidden">
      <Head title={t("scan.latestBlocks")} right={cadencia} />
      <div className="flex-1">
        {blocks.length === 0 ? <Vazio msg={t("scan.empty")} /> : null}
        {blocks.map((b) => (
          <div key={b.height} className="scan-row scan-in flex items-center gap-3.5 px-5 py-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--scan-chip)] text-violet">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" />
                <path d="M3.3 7.5 12 12.5l8.7-5" />
                <path d="M12 22V12.5" />
              </svg>
            </div>
            <div className="min-w-[112px]">
              <Link href={`/block/${b.height}`} className="text-sm font-bold text-violet hover:underline">
                #{num(b.height)}
              </Link>
              <div className="mt-[3px] text-[11.5px] text-faint">{ago(b.timestamp)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-[7px]">
                <span
                  className="inline-block size-4 shrink-0 rounded-full"
                  style={{ background: avatarBg(b.producer) }}
                  aria-hidden
                />
                {/* Nome EAV-NS quando o produtor tem um REGISTRADO na cadeia; senão
                    o endereço encurtado. O desenho mostrava sempre um nome, mas
                    aqueles vinham do gerador de dados fictícios — inventar um
                    apelido para um validador seria atribuir identidade a quem não
                    a declarou. */}
                <Link
                  href={`/address/${b.producer}`}
                  className="truncate text-[12.5px] font-semibold text-ink hover:text-violet"
                  title={b.producer}
                >
                  {nomes?.[b.producer] ?? shortHash(b.producer, 10, 6)}
                </Link>
              </div>
              <div className="mt-[3px] truncate font-mono text-[11px] text-faint">
                {shortHash(b.hash, 12, 6)}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Link
                href={`/block/${b.height}`}
                className="rounded-md bg-[var(--scan-chip)] px-2.5 py-[3px] text-[11px] font-semibold text-violet"
              >
                {b.txCount} {t("scan.txs")}
              </Link>
              {recompensa ? (
                <span className="text-[11.5px] font-semibold text-[var(--ok)]">{recompensa}</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <VerTudo href="/blocks" label={t("scan.viewAll")} />
    </div>
  );
}

export function LatestTxs({ txs }: { txs: Tx[] }) {
  const t = useT();

  return (
    <div className="scan-glass flex flex-col overflow-hidden">
      <Head title={t("scan.latestTxs")} right="EAV20 · EAV7" />
      <div className="flex-1">
        {txs.length === 0 ? <Vazio msg={t("scan.empty")} /> : null}
        {txs.map((x) => (
          <div key={x.id} className="scan-row scan-in flex items-center gap-3.5 px-5 py-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--scan-chip)] text-violet">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                <path d="M7 10h11l-3-3" />
                <path d="M17 14H6l3 3" />
              </svg>
            </div>
            <div className="min-w-[128px]">
              <Link href={`/tx/${x.id}`} className="font-mono text-[12.5px] font-semibold text-violet hover:underline">
                {shortHash(x.id, 10, 6)}
              </Link>
              <div className="mt-[3px] flex items-center gap-1.5">
                <span className="rounded bg-[var(--scan-chip)] px-[7px] py-[2px] text-[10px] font-semibold text-violet">
                  {x.type.toLowerCase()}
                </span>
                {x.timestamp ? <span className="text-[11px] text-faint">{ago(x.timestamp)}</span> : null}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-[7px] font-mono text-xs">
              <Link href={`/address/${x.from}`} className="truncate text-violet hover:underline">
                {shortHash(x.from, 6, 4)}
              </Link>
              <svg className="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M5 12h14" />
                <path d="m14 7 5 5-5 5" />
              </svg>
              {x.to ? (
                <Link href={`/address/${x.to}`} className="truncate text-violet hover:underline">
                  {shortHash(x.to, 6, 4)}
                </Link>
              ) : (
                <span className="text-faint">—</span>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[12.5px] font-bold text-ink">
                {x.amount && x.amount !== "0" ? `${fmt(x.amount)} EAV7` : "—"}
              </span>
              <Status tx={x} />
            </div>
          </div>
        ))}
      </div>
      <VerTudo href="/txs" label={t("scan.viewAll")} />
    </div>
  );
}
