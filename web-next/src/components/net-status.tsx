"use client";

import { useQuery } from "@tanstack/react-query";
import { getStatus } from "@/lib/api";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { useT } from "@/i18n/provider";

export function NetStatus() {
  const t = useT();
  const { data, isError } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 2000,
  });

  const online = !!data && !isError;

  return (
    <span
      className="font-mono hidden items-center gap-2 whitespace-nowrap rounded-full border border-line bg-panel px-3 py-1.5 text-[11px] font-semibold text-muted sm:inline-flex"
      title={online ? t("netStatus.onlineTitle", { height: data?.height }) : t("netStatus.offlineTitle")}
    >
      <span
        className="livedot"
        style={online ? undefined : { background: "var(--gold)", animation: "none" }}
      />
      {online ? (
        <span className="text-ink tnum">
          <AnimatedNumber value={data!.height} />
        </span>
      ) : (
        t("netStatus.connecting")
      )}
    </span>
  );
}
