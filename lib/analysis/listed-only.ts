import { toCompactUsdt, toDisplaySymbol } from "@/lib/market-data/provider";
import { assessAggregateDataQuality, emptyProvenance } from "@/lib/analysis/availability";
import type { BtccCandidate, TickerSnapshot } from "@/lib/types/market";
import type { SymbolAnalysis } from "@/lib/types/scoring";
import type { CandleVenue } from "@/lib/types/venue";

export const NO_PUBLIC_PERP = "btcc-listed-no-public-perp";

export const DECISION_EMPTY = {
  regime: null,
  timing: null,
  setup: null,
  confidence: null as "HIGH" | "MEDIUM" | "LOW" | null,
  nextWindow: null,
  dataSourceLabel: null as string | null,
};

export function listedWithoutPublicPerp(
  symbol: string,
  ticker: TickerSnapshot | null,
  candidate?: BtccCandidate,
): SymbolAnalysis {
  const compact = toCompactUsdt(symbol);
  return {
    symbol: compact,
    display: toDisplaySymbol(compact),
    availability: "DISCOVERED",
    listingVerification: candidate?.listingVerification ?? "DISCOVERED",
    contractClassification: candidate?.contract ?? "UNKNOWN",
    marketVenue: null,
    sources: candidate?.sources ?? emptyProvenance(),
    dataQuality:
      candidate?.dataQuality ??
      assessAggregateDataQuality({
        validTimeframes: [],
        hasTicker: Boolean(ticker),
        hasOi: false,
        hasFunding: false,
      }),
    timeframeQuality: {},
    rankingEligible: false,
    rankingExclusionReason: "市場データが不足しているためランキング対象外",
    status: "DATA_INSUFFICIENT",
    ticker,
    long: null,
    short: null,
    entryExpectancy: { long: null, short: null },
    tradePlans: { long: null, short: null },
    reach: { long: null, short: null },
    difference: null,
    bias: null,
    signal: "DATA INSUFFICIENT",
    indicators: {},
    updatedAt: new Date().toISOString(),
    notes: [
      "BTCC候補（第三者Discovery）。OKX / Bybit / Binance に完全一致するUSDT-M先物が無いため採点しません。",
      ...(candidate?.discoveryWarnings ?? []),
    ],
    dataSource: NO_PUBLIC_PERP,
    btcCorrelation: null,
    btcBeta: null,
    rankLong: null,
    rankShort: null,
    reversal: null,
    futures: null,
    ...DECISION_EMPTY,
    contract: null,
  };
}

export function failedCandidateAnalysis(input: {
  symbol: string;
  ticker: TickerSnapshot | null;
  candidate?: BtccCandidate;
  venue?: CandleVenue | null;
  error: string;
}): SymbolAnalysis {
  const row = listedWithoutPublicPerp(input.symbol, input.ticker, input.candidate);
  return {
    ...row,
    availability: input.venue ? "MARKET_DATA_AVAILABLE" : "DISCOVERED",
    marketVenue: input.venue ?? null,
    status: "DATA_ERROR",
    signal: "DATA ERROR",
    notes: [input.error],
    dataSource: input.venue ? `${input.venue}-usdt-m-public` : NO_PUBLIC_PERP,
    rankingExclusionReason: "分析処理に失敗したためランキング対象外",
  };
}
