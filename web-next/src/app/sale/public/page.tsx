import type { Metadata } from "next";
import { SaleExperience } from "@/components/sale/sale-experience";
import { isLbpOpen, isPublicVaultDeployed, loadPublicLbpAddresses } from "@/lib/public-lbp";
import { getT } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Public distribution · EAV7",
  description:
    "Public LBP — liquid EAV7 via PublicVault. Payments auto-confirmed; window end seeds the canonical AMM.",
};

export default async function PublicSalePage() {
  const t = await getT();
  const addr = loadPublicLbpAddresses();
  const open = isLbpOpen(addr);
  const deployed = isPublicVaultDeployed(addr);
  const allocateEnabled = open;
  const gateMessage = open
    ? null
    : deployed
      ? t("sale_experience.gateDeferred")
      : t("sale_experience.gateNotDeployed");

  return (
    <SaleExperience
      channel="public"
      allocateEnabled={allocateEnabled}
      gateMessage={gateMessage}
    />
  );
}
