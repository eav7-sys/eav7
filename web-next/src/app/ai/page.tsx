import type { Metadata } from "next";
import { getAiOracles, getAiTasks } from "@/lib/api";
import { getT } from "@/i18n/server";
import { ScanAiView } from "@/components/scan/ai-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("page_ai.metaTitle") };
}

export default async function AiPage() {
  const [oracles, tasks] = await Promise.all([
    getAiOracles().catch(() => []),
    getAiTasks().catch(() => []),
  ]);
  return <ScanAiView oracles={oracles} tasks={tasks} />;
}
