import { fetchOkxFunding, fetchOkxOiHistory5m } from "@/lib/market-data/okx";
import {
  computeFuturesPositioning,
  unavailableFutures,
} from "@/lib/scoring/futures-positioning";
import type { FuturesPositioning, TimeframeIndicators } from "@/lib/types/scoring";

export async function loadFuturesPositioning(
  symbol: string,
  tf4h: TimeframeIndicators | null,
  tf1h: TimeframeIndicators | null,
  tf15m: TimeframeIndicators | null,
): Promise<FuturesPositioning> {
  const [oiRes, fundRes] = await Promise.allSettled([
    fetchOkxOiHistory5m(symbol, 100),
    fetchOkxFunding(symbol),
  ]);
  const oiHistory = oiRes.status === "fulfilled" ? oiRes.value : [];
  const funding =
    fundRes.status === "fulfilled"
      ? fundRes.value
      : { rate: null, nextFundingTime: null, history: [] as number[] };

  if (!oiHistory.length && funding.rate == null && funding.history.length === 0) {
    return unavailableFutures();
  }

  return computeFuturesPositioning({
    oiHistory,
    fundingRate: funding.rate,
    fundingNextTime: funding.nextFundingTime,
    fundingHistory: funding.history,
    tf1h,
    tf15m,
    tf4h,
  });
}
