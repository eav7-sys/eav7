"use client";

import Link from "next/link";
import type { Tx } from "@/lib/api";
import { AddrLink, TxLink } from "@/components/hash-link";
import { TxBadge } from "@/components/tx-badge";
import { TxValue } from "@/components/tx-value";
import { IconTx } from "@/components/icons";
import { useT } from "@/i18n/provider";

export function LatestTxs({ txs }: { txs: Tx[] }) {
  const t = useT();
  const headers = [
    { key: "hash", label: t("home_latestTxs.table.hash") },
    { key: "type", label: t("home_latestTxs.table.type") },
    { key: "fromTo", label: t("home_latestTxs.table.fromTo") },
    { key: "value", label: t("home_latestTxs.table.value") },
  ];
  return (
    <section className="card card-glow p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-display flex items-center gap-2 text-[15px] font-bold">
          <IconTx size={17} /> {t("home_latestTxs.title")}
        </h2>
        <Link href="/txs" className="font-mono text-[12px] font-semibold text-violet hover:text-teal">
          {t("home_latestTxs.viewAll")} →
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left">
              {headers.map((h) => (
                <th
                  key={h.key}
                  className="font-mono border-b border-line pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted"
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txs.slice(0, 10).map((tx, i) => (
              <tr
                key={tx.id}
                className={`border-b border-line/40 transition-colors hover:bg-line/30 ${i === 0 ? "row-enter" : ""}`}
              >
                <td className="py-2.5">
                  <TxLink id={tx.id} />
                </td>
                <td>
                  <TxBadge type={tx.type} />
                </td>
                <td className="whitespace-nowrap">
                  <AddrLink addr={tx.from} len={6} />
                  <span className="mx-1.5 text-faint">→</span>
                  <AddrLink addr={tx.to} len={6} />
                </td>
                <td>
                  <TxValue tx={tx} />
                </td>
              </tr>
            ))}
            {txs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted">
                  {t("home_latestTxs.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
