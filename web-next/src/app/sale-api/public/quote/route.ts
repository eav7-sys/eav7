import { NextResponse } from "next/server";
import { getSaleQuoteSnapshot, relayerBase, useRemoteRelayer } from "@/lib/sale-server";

export async function GET() {
  if (useRemoteRelayer("public") && process.env.SALE_RELAYER_PUBLIC_URL) {
    try {
      const res = await fetch(`${relayerBase("public")}/quote`, { cache: "no-store" });
      const json = await res.json();
      return NextResponse.json(json, { status: res.status });
    } catch {
      return NextResponse.json(
        { error: { code: "relayer_down", message: "Public relayer offline" } },
        { status: 503 },
      );
    }
  }
  return NextResponse.json({ data: getSaleQuoteSnapshot("public") });
}
