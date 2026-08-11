import type { Metadata } from "next";
import { SaleExperience } from "@/components/sale/sale-experience";

export const metadata: Metadata = {
  title: "Public distribution · EAV7",
  description:
    "Public LBP — liquid EAV7 via PublicVault. Payments auto-confirmed; window end seeds the canonical AMM.",
};

export default function PublicSalePage() {
  return <SaleExperience channel="public" />;
}
