import type {
  AggregateDataQuality,
  CoreTimeframe,
  FeedProvenance,
  SourceAttribution,
} from "@/lib/types/market";

export function emptyProvenance(listing: SourceAttribution[] = []): FeedProvenance {
  return {
    listing,
    ticker: null,
    ohlcv: null,
    oi: null,
    funding: null,
  };
}

export function assessAggregateDataQuality(input: {
  validTimeframes: CoreTimeframe[];
  hasTicker: boolean;
  hasOi: boolean;
  hasFunding: boolean;
  ohlcvIsBtcc?: boolean;
}): AggregateDataQuality {
  const uniqueTimeframes = [...new Set(input.validTimeframes)];
  const tfCount = uniqueTimeframes.length;
  let score = 0;

  if (input.ohlcvIsBtcc) {
    score += tfCount >= 3 ? 70 : tfCount === 2 ? 55 : tfCount === 1 ? 30 : 0;
    if (input.hasTicker) score += 5;
    if (input.hasOi) score += 15;
    if (input.hasFunding) score += 10;
  } else {
    // Complement data must never look equivalent to BTCC-native data.
    score += tfCount >= 3 ? 45 : tfCount === 2 ? 30 : tfCount === 1 ? 18 : 0;
    if (input.hasTicker) score += 5;
    if (input.hasOi) score += 10;
    if (input.hasFunding) score += 9;
    score = Math.min(score, 69);
  }

  const reasons: string[] = [];
  if (!input.ohlcvIsBtcc && tfCount > 0) {
    reasons.push("OHLCVはBTCC公式ではなく、同一シンボルの他取引所補完です");
  }
  if (tfCount < 3) reasons.push(`有効な時間足 ${tfCount}/3`);
  if (!input.hasTicker) reasons.push("Ticker unavailable");
  if (!input.hasOi) reasons.push("OI unavailable");
  if (!input.hasFunding) reasons.push("Funding unavailable");
  if (score === 0) reasons.push("Market data unavailable");

  return {
    score,
    band: score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : score > 0 ? "LOW" : "NONE",
    validTimeframes: uniqueTimeframes,
    reasons,
  };
}

export function confidenceFromDataQuality(
  quality: AggregateDataQuality,
): "HIGH" | "MEDIUM" | "LOW" {
  if (quality.score >= 80 && quality.validTimeframes.length === 3) return "HIGH";
  if (quality.score >= 60) return "MEDIUM";
  return "LOW";
}
