import { NextResponse } from "next/server";
import { getFreeFloatE7 } from "@/lib/circulating";
import { getMarketPrice } from "@/lib/price-market";

export const dynamic = "force-dynamic";

/**
 * GET /price — spot EAV7/USD.
 *
 * Query opcional: `?circulating=<e7>` para mcap.
 * Sem query: usa free float (gênese+emitido−queimado − custódias).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("circulating");
  let circulating = fromQuery;
  let basis: "free-float" | "query" | null = fromQuery ? "query" : null;
  if (!circulating) {
    try {
      circulating = await getFreeFloatE7();
      basis = "free-float";
    } catch {
      circulating = null;
      basis = null;
    }
  }
  const data = getMarketPrice({ circulatingE7: circulating, circulatingBasis: basis });
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
