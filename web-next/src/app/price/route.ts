import { NextResponse } from "next/server";
import { getMarketPrice } from "@/lib/price-market";

export const dynamic = "force-dynamic";

/**
 * GET /price — spot EAV7/USD.
 *
 * Query opcional: `?circulating=<e7>` para incluir marketCapUsd.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const circulating = url.searchParams.get("circulating");
  const data = getMarketPrice({ circulatingE7: circulating });
  return NextResponse.json(
    { data },
    {
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
