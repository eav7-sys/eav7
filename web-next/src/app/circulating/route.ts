import { NextResponse } from "next/server";
import { getCirculatingSnapshot } from "@/lib/circulating";

export const dynamic = "force-dynamic";

/** GET /circulating — free float + custódias (JSON para trackers / front). */
export async function GET() {
  try {
    const data = await getCirculatingSnapshot();
    return NextResponse.json(
      { data },
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "circulating unavailable" },
      { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
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
