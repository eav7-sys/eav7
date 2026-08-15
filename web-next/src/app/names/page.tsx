import type { Metadata } from "next";
import { getNames } from "@/lib/api";
import { Cartao, ListaShell } from "@/components/scan/lists/table";
import { AddrLink } from "@/components/hash-link";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("page_names.metaTitle") };
}

export default async function NamesPage() {
  const t = await getT();
  const names = await getNames().catch(() => []);

  return (
    <ListaShell titulo={t("page_names.title")} eyebrow={t("page_names.eyebrow")} subtitle={t("page_names.subtitle")}>
      <Cartao>
        <div className="p-5">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left">
                {[t("page_names.colName"), t("page_names.colTarget"), t("page_names.colOwner")].map((h) => (
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
              {names.map((n) => (
                <tr key={n.name} className="border-b border-line/40 hover:bg-line/30">
                  <td className="py-3">
                    <span className="flex items-center gap-2">
                      <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-teal/15 text-[13px] text-teal">@</span>
                      <span className="font-mono font-semibold text-ink">{n.name}</span>
                    </span>
                  </td>
                  <td>
                    <AddrLink addr={n.target} len={14} />
                  </td>
                  <td>
                    <AddrLink addr={n.owner} len={10} />
                  </td>
                </tr>
              ))}
              {names.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-muted">
                    {t("page_names.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Cartao>
    </ListaShell>
  );
}
