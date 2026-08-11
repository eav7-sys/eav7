import Link from "next/link";
import { redirect } from "next/navigation";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { isE7Address, isE7Hash, isEvm } from "@/lib/format";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("page_search.metaTitle") };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const t = await getT();
  const { q } = await searchParams;
  const raw = (q ?? "").trim();

  // roteamento: número de bloco, hash de tx, endereço E7 ou 0x
  if (raw) {
    if (/^\d+$/.test(raw)) redirect(`/block/${raw}`);
    const up = raw.toUpperCase();
    if (isE7Hash(up)) redirect(`/tx/${up}`);
    if (isE7Address(up)) redirect(`/address/${up}`);
    if (isEvm(raw)) redirect(`/address/${raw}`);
  }

  return (
    <div className="mx-auto max-w-[640px] px-5 py-16 text-center">
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center text-faint">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
      </div>
      <h1 className="font-display text-[clamp(22px,3.4vw,30px)] font-extrabold tracking-tight">
        {t("page_search.title")}
      </h1>
      {raw && (
        <p className="mt-2 text-[14px] text-muted">
          {t("page_search.notRecognizedPrefix")} <span className="font-mono text-ink">{raw}</span>{" "}
          {t("page_search.notRecognizedSuffix")}
        </p>
      )}

      <div className="mx-auto mt-6 max-w-[460px]">
        <ExplorerSearch placeholder={t("page_search.retryPlaceholder")} />
      </div>

      <div className="card mt-6 p-6 text-left">
        <div className="font-mono mb-3 text-[10.5px] font-semibold uppercase tracking-[1.5px] text-faint">
          {t("page_search.whatCanSearch")}
        </div>
        <ul className="space-y-2.5 text-[13px] text-muted">
          <li className="flex items-center gap-2">
            <span className="font-mono w-[92px] flex-none text-violet">{t("page_search.blockLabel")}</span>{" "}
            {t("page_search.blockDesc")} <span className="font-mono text-ink">4218530</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="font-mono w-[92px] flex-none text-teal">{t("page_search.txLabel")}</span>{" "}
            {t("page_search.txDesc")} <span className="font-mono text-ink">E7…</span> {t("page_search.txChars")}
          </li>
          <li className="flex items-center gap-2">
            <span className="font-mono w-[92px] flex-none text-blue">{t("page_search.addressLabel")}</span>{" "}
            <span className="font-mono text-ink">E7…</span> {t("page_search.addressLen34")}{" "}
            {t("page_search.or")} <span className="font-mono text-ink">0x…</span> {t("page_search.evmLabel")}
          </li>
        </ul>
      </div>

      <Link href="/" className="btn-ghost mt-6">
        {t("page_search.backHome")}
      </Link>
    </div>
  );
}
