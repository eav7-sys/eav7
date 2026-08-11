import { getGovernance, getTreasury } from "@/lib/api";
import { ScanGovView } from "@/components/scan/gov-view";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("page_governance.metaTitle") };
}

export default async function GovernancePage() {
  const [gov, treasury] = await Promise.all([
    getGovernance().catch(() => ({
      params: {},
      governable: [],
      proposals: [],
      validators: 0,
      governanceActive: false,
    })),
    getTreasury().catch(() => null),
  ]);

  return <ScanGovView gov={gov} treasury={treasury} />;
}
