import type { Metadata } from "next";
import { SaleExperience } from "@/components/sale/sale-experience";

export const metadata: Metadata = {
  title: "Private sale · EAV7",
  description:
    "Allocate EAV7 privately with USDT, USDC or BTC. Automatic confirmation and vesting delivery via SaleVault.",
};

export default function SalePage() {
  return <SaleExperience />;
}
