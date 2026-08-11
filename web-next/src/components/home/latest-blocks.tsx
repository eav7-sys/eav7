import Link from "next/link";
import type { Block } from "@/lib/api";
import { AddrLink, BlockLink } from "@/components/hash-link";
import { Ago } from "@/components/ui/ago";
import { IconLayers } from "@/components/icons";

export function LatestBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <section className="card card-glow p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-display flex items-center gap-2 text-[15px] font-bold">
          <IconLayers size={17} /> Últimos blocos
        </h2>
        <Link href="/blocks" className="font-mono text-[12px] font-semibold text-violet hover:text-teal">
          ver todos →
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left">
              {["Bloco", "Produtor", "Txs", "Idade"].map((h) => (
                <th
                  key={h}
                  className="font-mono border-b border-line pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.slice(0, 10).map((b, i) => (
              <tr
                key={b.height}
                className={`border-b border-line/40 transition-colors hover:bg-line/30 ${i === 0 ? "row-enter" : ""}`}
              >
                <td className="py-2.5">
                  <BlockLink height={b.height} />
                </td>
                <td>
                  <AddrLink addr={b.producer} />
                </td>
                <td className="tnum text-ink">{b.txCount}</td>
                <td className="tnum text-muted">
                  <Ago ts={b.timestamp} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
