"use client";

import Link from "next/link";
import { Logo } from "./logo";
import { useT } from "@/i18n/provider";

export function ComingSoon({ title, note }: { title: string; note: string }) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center px-5 py-24 text-center">
      <Logo size={54} />
      <div className="badge badge-teal mt-5">{t("comingSoon.badge")}</div>
      <h1 className="font-display mt-4 text-[clamp(24px,4vw,34px)] font-extrabold tracking-tight">
        {title}
      </h1>
      <p className="mt-3 max-w-[46ch] text-[14px] text-muted">{note}</p>
      <Link href="/" className="btn-primary mt-6">
        {t("comingSoon.backToExplorer")}
      </Link>
    </div>
  );
}
