import { HIGH_BTC_CORR } from "@/lib/correlation/pearson";
import type { MarketRisk, MarketRiskLevel, TimeframeIndicators } from "@/lib/types/scoring";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export function computeMarketRisk(input: {
  btc4h: TimeframeIndicators | null;
  dominancePct: number | null;
  correlations: Array<number | null>;
}): MarketRisk {
  let score = 0;
  const reasons: string[] = [];
  const btc4h = input.btc4h;

  if (btc4h?.trend === "Strong Bearish") {
    score += 28;
    reasons.push("BTC 4H Strong Bearish");
  } else if (btc4h?.trend === "Bearish") {
    score += 16;
    reasons.push("BTC 4H Bearish");
  } else if (btc4h?.trend === "Strong Bullish") {
    score += 10;
    reasons.push("BTC 4H Strong Bullish (extension risk)");
  }

  const rsi = btc4h?.rsi;
  if (rsi != null && (rsi >= 75 || rsi <= 25)) {
    score += 18;
    reasons.push(`BTC 4H RSI extreme (${rsi.toFixed(1)})`);
  }

  if ((btc4h?.adx ?? 0) >= 40) {
    score += 10;
    reasons.push(`BTC 4H ADX ${(btc4h?.adx ?? 0).toFixed(1)}`);
  }

  const dump =
    (btc4h?.volumeRatio ?? 0) >= 2 &&
    (btc4h?.trend === "Bearish" || btc4h?.trend === "Strong Bearish");
  if (dump) {
    score += 12;
    reasons.push("BTC 4H high-volume selloff");
  }

  if (input.dominancePct != null && input.dominancePct >= 58) {
    score += 10;
    reasons.push(`BTC dominance ${input.dominancePct.toFixed(1)}%`);
  }

  const corrs = input.correlations
    .filter((value): value is number => value != null)
    .map((value) => Math.abs(value));
  if (corrs.length >= 8) {
    const mid = median(corrs);
    const highFrac = corrs.filter((value) => value >= HIGH_BTC_CORR).length / corrs.length;
    if (mid != null && mid >= 0.8) {
      score += 20;
      reasons.push(`Median |BTC corr| ${mid.toFixed(2)}`);
    } else if (mid != null && mid >= 0.65) {
      score += 10;
      reasons.push(`Median |BTC corr| ${mid.toFixed(2)}`);
    }
    if (highFrac >= 0.5) {
      score += 8;
      reasons.push(`${Math.round(highFrac * 100)}% of names |corr|≥${HIGH_BTC_CORR}`);
    }
  }

  score = clamp(Math.round(score), 0, 100);
  const level: MarketRiskLevel =
    score >= 70 ? "HIGH" : score >= 50 ? "ELEVATED" : score >= 30 ? "MODERATE" : "LOW";

  return {
    score,
    level,
    reasons: reasons.length ? reasons : ["No elevated risk flags from available data"],
    warning: "MARKET RISK は警告のみです。自動停止・自動売買は行いません。",
  };
}
