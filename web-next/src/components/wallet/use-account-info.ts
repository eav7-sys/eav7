import { useQuery } from "@tanstack/react-query";
import { getAddress, getStatus } from "@/lib/api";

export function useAccountInfo(evm: string | null) {
  return useQuery({
    queryKey: ["address", evm],
    queryFn: () => getAddress(evm as string),
    enabled: !!evm,
    refetchInterval: 4000,
  });
}

export function useChainId(): number {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    staleTime: 30000,
  });
  return data?.eavm.chainId ?? 72020;
}
