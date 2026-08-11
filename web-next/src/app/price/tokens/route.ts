import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /price/tokens — índice de preços (hoje só EAV7 nativo; EAV20 entram depois). */
export async function GET() {
  return NextResponse.json(
    {
      data: {
        updatedAt: Date.now(),
        quoteCurrency: "USD",
        tokens: [
          {
            id: "EAV7",
            symbol: "EAV7",
            name: "EAV7",
            pricePath: "/price",
            historyPath: "/price/history",
            convertPath: "/price/convert",
          },
        ],
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
