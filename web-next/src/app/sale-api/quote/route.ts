import { NextResponse } from "next/server";
import { getSaleQuoteSnapshot, relayerBase, useRemoteRelayer } from "@/lib/sale-server";

export async function GET() {
  if (useRemoteRelayer()) {
    try {
      const res = await fetch(`${relayerBase()}/quote`, { cache: "no-store" });
      const json = await res.json();
      return NextResponse.json(json, { status: res.status });
    } catch {
      return NextResponse.json(
        { error: { code: "relayer_down", message: "Sale relayer offline" } },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({ data: getSaleQuoteSnapshot() });
}
