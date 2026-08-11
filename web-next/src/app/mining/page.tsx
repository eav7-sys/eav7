import { getStatus, getValidators } from "@/lib/api";
import { MiningLive } from "@/components/mining/mining-live";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("page_mining.metaTitle") };
}

export default async function MiningPage() {
  const [status, validators] = await Promise.all([
    getStatus().catch(() => null),
    getValidators().catch(() => null),
  ]);

  return <MiningLive initial={{ status, validators }} />;
}
