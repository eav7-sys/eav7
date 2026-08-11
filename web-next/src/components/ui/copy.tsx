"use client";

import { useState } from "react";
import { useT } from "@/i18n/provider";
import { IconCheck, IconCopy } from "@/components/icons";

export function Copy({ text, label, icon = false }: { text: string; label?: string; icon?: boolean }) {
  const t = useT();
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      /* clipboard indisponível */
    }
  }

  const labelText = label ?? t("ui_copy.default_value");

  // Em tabelas densas o rótulo textual rouba a atenção da própria informação —
  // `icon` reduz o botão ao glifo, mantendo o mesmo alvo de clique e acessibilidade.
  if (icon) {
    return (
      <button
        type="button"
        onClick={copy}
        title={done ? t("ui_copy.copied") : t("ui_copy.aria_label", { label: labelText })}
        aria-label={t("ui_copy.aria_label", { label: labelText })}
        className="inline-flex shrink-0 items-center text-faint transition hover:text-ink"
      >
        {done ? <IconCheck size={13} className="text-ok" /> : <IconCopy size={13} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="font-mono inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[10.5px] font-semibold text-muted transition hover:border-line-2 hover:text-ink"
      aria-label={t("ui_copy.aria_label", { label: labelText })}
    >
      {done ? (
        <span className="text-ok">{t("ui_copy.copied")}</span>
      ) : (
        <>{label ? t("ui_copy.copy_label", { label }) : t("ui_copy.copy")}</>
      )}
    </button>
  );
}
