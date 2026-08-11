import type { Metadata } from "next";
import { DevShell } from "@/components/developers/dev-shell";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: t("dev.meta.hubTitle"), template: "%s · EAV7 Developers" },
    description: t("dev.meta.hubDesc"),
  };
}

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return <DevShell>{children}</DevShell>;
}
