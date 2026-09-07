import { unavailableFutures } from "@/lib/scoring/futures-positioning";
import { computeFuturesPositioning } from "@/lib/scoring/futures-positioning";
import { fetchVenueFunding, fetchVenueOiHistory } from "@/lib/market-data/venue-router";
import type { CandleVenue } from "@/lib/types/venue";
import type { FuturesPositioning, TimeframeIndicators } from "@/lib/types/scoring";

export async function loadFuturesPositioning(
  symbol: string,
  tf4h: TimeframeIndicators | null,
  tf1h: TimeframeIndicators | null,
  tf15m: TimeframeIndicators | null,
  venue: CandleVenue = "okx",
): Promise<FuturesPositioning> {
  const [oiRes, fundRes] = await Promise.allSettled([
    fetchVenueOiHistory(venue, symbol, 100),
    fetchVenueFunding(venue, symbol),
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
