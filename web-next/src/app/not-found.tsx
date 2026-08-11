"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useT } from "@/i18n/provider";

export default function NotFound() {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-5 py-24 text-center">
      <Logo size={54} />
      <div className="font-display mt-5 text-[64px] font-extrabold leading-none tracking-tight text-violet">
        404
      </div>
      <p className="mt-2 text-[15px] text-muted">{t("page_notFound.description")}</p>
      <Link href="/" className="btn-primary mt-6">
        {t("page_notFound.backLink")}
      </Link>
    </div>
  );
}
