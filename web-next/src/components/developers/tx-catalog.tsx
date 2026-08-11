"use client";

import { useState, type ReactNode } from "react";
import { IconSearch } from "@/components/icons";

export interface TxCatalogEntry {
  name: string;
  fee: number;
  desc: string;
}

export interface TxCatalogGroup {
  title: string;
  types: TxCatalogEntry[];
}

export interface TxCatalogLabels {
  placeholder: string;
  colType: string;
  colDesc: string;
  colFee: string;
  empty: string;
  count: string;
}

/** Grifa o trecho procurado sem perder a caixa original do identificador. */
function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-violet/25 text-ink">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

const feeFormat = new Intl.NumberFormat("en-US");

export function TxCatalog({
  groups,
  labels,
}: {
  groups: TxCatalogGroup[];
  labels: TxCatalogLabels;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const filtered = groups
    .map((group) => ({
      ...group,
      types: needle
        ? group.types.filter(
            (type) =>
              type.name.toLowerCase().includes(needle) || type.desc.toLowerCase().includes(needle),
          )
        : group.types,
    }))
    .filter((group) => group.types.length > 0);

  const total = filtered.reduce((sum, group) => sum + group.types.length, 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex min-w-[240px] flex-1 items-center gap-2.5 rounded-full border border-line bg-panel/60 px-4 py-2.5 transition-colors focus-within:border-violet/60">
          <IconSearch size={15} className="flex-none text-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.placeholder}
            className="font-mono w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </label>
        <span className="font-mono tnum text-[11.5px] uppercase tracking-[1.2px] text-faint">
          {labels.count.replace("{n}", String(total))}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="border-y border-line py-10 text-center text-[13.5px] text-muted">{labels.empty}</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[600px] border-collapse text-left">
            <thead>
              <tr>
                <th className="font-mono border-b border-line-2 pb-2.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-faint">
                  {labels.colType}
                </th>
                <th className="font-mono border-b border-line-2 pb-2.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-faint">
                  {labels.colDesc}
                </th>
                <th className="font-mono border-b border-line-2 pb-2.5 text-right text-[10px] font-semibold uppercase tracking-[1.2px] text-faint">
                  {labels.colFee}
                </th>
              </tr>
            </thead>
            {filtered.map((group) => (
              <tbody key={group.title}>
                <tr>
                  <th
                    colSpan={3}
                    className="font-mono pb-1.5 pt-6 text-left text-[10px] font-semibold uppercase tracking-[1.6px] text-violet"
                  >
                    {group.title}
                  </th>
                </tr>
                {group.types.map((type) => (
                  <tr
                    key={type.name}
                    className="border-b border-line/50 transition-colors hover:bg-violet/[0.04]"
                  >
                    <td className="py-2.5 pr-5 align-top">
                      <code className="font-mono whitespace-nowrap text-[12.5px] font-semibold text-ink">
                        {highlight(type.name, query.trim())}
                      </code>
                    </td>
                    <td className="py-2.5 pr-5 align-top text-[13px] leading-relaxed text-muted">
                      {type.desc}
                    </td>
                    <td className="font-mono tnum whitespace-nowrap py-2.5 text-right align-top text-[12px] text-faint">
                      {feeFormat.format(type.fee)}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
