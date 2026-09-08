import type { Candle, CoreTimeframe } from "@/lib/types/market";
import type {
  FuturesPositioning,
  ReversalAssessment,
  TimeframeIndicators,
} from "@/lib/types/scoring";
import type { TimingAssessment } from "./entry-timing";
import type { RegimeSnapshot } from "./regime";

export type EntryDirection = "LONG" | "SHORT";
export type EntryType =
  | "PULLBACK"
  | "BREAKOUT"
  | "BREAKOUT_RETEST"
  | "MOMENTUM"
  | "REVERSAL"
  | "RANGE"
  | "NO_ENTRY";
export type EntryDecision =
  | "ENTRY_NOW"
  | "ENTRY_WATCH"
  | "WAIT_FOR_PULLBACK"
  | "WAIT_FOR_BREAKOUT"
  | "NO_ENTRY";

export type EntryScoreItem = {
  key: string;
  label: string;
  normalized: number;
  weight: number;
  points: number;
  reason: string;
};

export type ExpectedEntryAssessment = {
  direction: EntryDirection;
  horizon: "4h";
  total: number;
  trendQuality: number;
  timingScore: number;
  expectedMoveScore: number;
  reversalRisk: number;
  marketContext: number;
  chasingPenalty: number;
  chasingPenaltyPoints: number;
  currentPrice: number;
  targetPrice: number;
  structuralStopPrice: number;
  userMaxStopPrice: number;
  potentialRewardPct: number;
  potentialRiskPct: number;
  rewardRisk: number;
  expectedValueProxy: number;
  atrPct: number;
  volatilityPct: number;
  supportPrice: number | null;
  resistancePrice: number | null;
  vwap: number | null;
  bollingerPosition: number | null;
  entryType: EntryType;
  decision: EntryDecision;
  lateEntryWarning: boolean;
  items: EntryScoreItem[];
  why: string[];
  warnings: string[];
};

export type DirectionalExpectedEntry = {
  long: ExpectedEntryAssessment | null;
  short: ExpectedEntryAssessment | null;
};

type Side = "long" | "short";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const ranges = candles.slice(-period).map((candle, index, tail) => {
    const sourceIndex = candles.length - period + index;
    const previous = candles[sourceIndex - 1]?.close ?? tail[index - 1]?.close ?? candle.open;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous),
      Math.abs(candle.low - previous),
    );
  });
  return mean(ranges);
}

function rollingVwap(candles: Candle[], period = 48): number | null {
  const rows = candles.slice(-period);
  const volume = rows.reduce((sum, candle) => sum + candle.volume, 0);
  if (!rows.length || volume <= 0) return null;
  return rows.reduce(
    (sum, candle) => sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume,
    0,
  ) / volume;
}

function bollinger(candles: Candle[], period = 20): {
  position: number;
  upper: number;
  lower: number;
} | null {
  const closes = candles.slice(-period).map((candle) => candle.close);
  if (closes.length < period) return null;
  const middle = mean(closes);
  const deviation = stdev(closes);
  if (deviation === 0) return { position: 0.5, upper: middle, lower: middle };
  const upper = middle + deviation * 2;
  const lower = middle - deviation * 2;
  return {
    position: (closes[closes.length - 1] - lower) / (upper - lower),
    upper,
    lower,
  };
}

function fibonacciBarrier(
  candles: Candle[],
  current: number,
  side: Side,
): number | null {
  const rows = candles.slice(-80);
  if (rows.length < 20) return null;
  const high = Math.max(...rows.map((candle) => candle.high));
  const low = Math.min(...rows.map((candle) => candle.low));
  const range = high - low;
  const levels = [0.236, 0.382, 0.5, 0.618, 0.786].map((ratio) => low + range * ratio);
  return side === "long"
    ? levels.filter((value) => value > current).sort((a, b) => a - b)[0] ?? null
    : levels.filter((value) => value < current).sort((a, b) => b - a)[0] ?? null;
}

function volumeProfileBarrier(
  candles: Candle[],
  current: number,
  side: Side,
): number | null {
  const rows = candles.slice(-96);
  if (rows.length < 20) return null;
  const low = Math.min(...rows.map((candle) => candle.low));
  const high = Math.max(...rows.map((candle) => candle.high));
  const width = (high - low) / 20;
  if (width <= 0) return null;
  const bins = Array.from({ length: 20 }, () => 0);
  for (const candle of rows) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const index = Math.min(19, Math.max(0, Math.floor((typical - low) / width)));
    bins[index] += candle.volume;
  }
  const threshold = [...bins].sort((a, b) => b - a)[4] ?? Infinity;
  const nodes = bins.flatMap((volume, index) =>
    volume >= threshold ? [low + width * (index + 0.5)] : [],
  );
  return side === "long"
    ? nodes.filter((value) => value > current).sort((a, b) => a - b)[0] ?? null
    : nodes.filter((value) => value < current).sort((a, b) => b - a)[0] ?? null;
}

function stochastic(candles: Candle[], period = 14): number | null {
  const rows = candles.slice(-period);
  if (rows.length < period) return null;
  const high = Math.max(...rows.map((candle) => candle.high));
  const low = Math.min(...rows.map((candle) => candle.low));
  if (high === low) return 50;
  return ((rows[rows.length - 1].close - low) / (high - low)) * 100;
}

function swingLevels(candles: Candle[], current: number): {
  support: number | null;
  resistance: number | null;
} {
  const rows = candles.slice(-96);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let index = 2; index < rows.length - 2; index += 1) {
    const candle = rows[index];
    if (
      candle.high > rows[index - 1].high &&
      candle.high >= rows[index - 2].high &&
      candle.high > rows[index + 1].high &&
      candle.high >= rows[index + 2].high
    ) highs.push(candle.high);
    if (
      candle.low < rows[index - 1].low &&
      candle.low <= rows[index - 2].low &&
      candle.low < rows[index + 1].low &&
      candle.low <= rows[index + 2].low
    ) lows.push(candle.low);
  }
  return {
    support: lows.filter((value) => value < current).sort((a, b) => b - a)[0] ?? null,
    resistance: highs.filter((value) => value > current).sort((a, b) => a - b)[0] ?? null,
  };
}

function trendQuality(
  side: Side,
  indicators: Partial<Record<CoreTimeframe, TimeframeIndicators>>,
  regime: RegimeSnapshot,
): number {
  const weights: Record<CoreTimeframe, number> = { "4h": 40, "1h": 35, "15m": 25 };
  let score = 0;
  let available = 0;
  for (const timeframe of ["4h", "1h", "15m"] as const) {
    const row = indicators[timeframe];
    if (!row) continue;
    available += weights[timeframe];
    const bullish = row.trend === "Bullish" || row.trend === "Strong Bullish";
    const bearish = row.trend === "Bearish" || row.trend === "Strong Bearish";
    const aligned = side === "long" ? bullish : bearish;
    const opposed = side === "long" ? bearish : bullish;
    let quality = aligned ? 70 : opposed ? 10 : 40;
    if (
      (side === "long" && row.structure === "HH_HL") ||
      (side === "short" && row.structure === "LH_LL")
    ) quality += 15;
    if ((row.adx ?? 0) >= 25) quality += aligned ? 15 : 0;
    score += clamp(quality) * weights[timeframe];
  }
  const normalized = available ? score / available : 0;
  const regimeAdjustment =
    regime.regime === "TRENDING" ? 8 : regime.regime === "RANGING" ? -20 : 0;
  return Math.round(clamp(normalized + regimeAdjustment));
}

function rrScore(rr: number): number {
  if (rr < 1) return clamp(rr * 20);
  if (rr < 1.5) return 20 + ((rr - 1) / 0.5) * 20;
  if (rr < 2) return 40 + ((rr - 1.5) / 0.5) * 20;
  if (rr < 3) return 60 + (rr - 2) * 25;
  return clamp(85 + Math.min(rr - 3, 2) * 7.5);
}

function marketContextScore(
  side: Side,
  btc4h: TimeframeIndicators | null,
  correlation: number | null,
  dominancePct: number | null,
): number {
  let score = 50;
  const bull = btc4h?.trend === "Bullish" || btc4h?.trend === "Strong Bullish";
  const bear = btc4h?.trend === "Bearish" || btc4h?.trend === "Strong Bearish";
  if ((side === "long" && bull) || (side === "short" && bear)) score += 25;
  if ((side === "long" && bear) || (side === "short" && bull)) score -= 25;
  if (Math.abs(correlation ?? 0) >= 0.75) score += score >= 50 ? 8 : -8;
  if (dominancePct != null && dominancePct >= 60 && side === "long") score -= 5;
  return Math.round(clamp(score));
}

function chasingScore(input: {
  side: Side;
  candles15m: Candle[];
  current: number;
  atrValue: number;
  ema20: number | null;
  vwap: number | null;
  rsi: number | null;
  bbPosition: number | null;
  directionalBarrier: number | null;
  futures: FuturesPositioning | null;
}): { score: number; reasons: string[] } {
  const sign = input.side === "long" ? 1 : -1;
  let score = 0;
  const reasons: string[] = [];
  const recent = input.candles15m.slice(-5);
  if (recent.length >= 5) {
    const moveAtr = sign * (recent[recent.length - 1].close - recent[0].open) / input.atrValue;
    if (moveAtr >= 1) {
      score += clamp(moveAtr * 22, 0, 35);
      reasons.push(`短期変動 ${moveAtr.toFixed(1)} ATR`);
    }
  }
  const addDistance = (label: string, value: number | null) => {
    if (value == null) return;
    const distance = sign * (input.current - value) / input.atrValue;
    if (distance >= 0.8) {
      score += clamp((distance - 0.5) * 15, 0, 20);
      reasons.push(`${label}から${distance.toFixed(1)} ATR乖離`);
    }
  };
  addDistance("EMA20", input.ema20);
  addDistance("VWAP", input.vwap);
  if (
    input.rsi != null &&
    ((input.side === "long" && input.rsi >= 72) || (input.side === "short" && input.rsi <= 28))
  ) {
    score += 18;
    reasons.push("RSI過熱");
  }
  if (
    input.bbPosition != null &&
    ((input.side === "long" && input.bbPosition >= 0.95) ||
      (input.side === "short" && input.bbPosition <= 0.05))
  ) {
    score += 15;
    reasons.push("Bollinger外縁");
  }
  if (
    input.directionalBarrier != null &&
    Math.abs(input.directionalBarrier - input.current) / input.atrValue <= 0.5
  ) {
    score += 15;
    reasons.push(input.side === "long" ? "Resistance直下" : "Support直上");
  }
  const fundingHot =
    input.side === "long"
      ? (input.futures?.fundingPercentile ?? 50) >= 85
      : (input.futures?.fundingPercentile ?? 50) <= 15;
  if (fundingHot && (input.futures?.oiChange1hPct ?? 0) >= 3) {
    score += 15;
    reasons.push("OI急増 + Funding過熱");
  }
  return { score: Math.round(clamp(score)), reasons };
}

export function scoreExpectedEntry(input: {
  direction: EntryDirection;
  candles: Partial<Record<CoreTimeframe, Candle[]>>;
  indicators: Partial<Record<CoreTimeframe, TimeframeIndicators>>;
  timing: TimingAssessment;
  reversal: ReversalAssessment;
  futures: FuturesPositioning | null;
  regime: RegimeSnapshot;
  btc4h: TimeframeIndicators | null;
  btcCorrelation: number | null;
  dominancePct: number | null;
}): ExpectedEntryAssessment | null {
  const side: Side = input.direction === "LONG" ? "long" : "short";
  const candles1h = input.candles["1h"] ?? [];
  const candles15m = input.candles["15m"] ?? candles1h;
  if (candles1h.length < 30 || candles15m.length < 20) return null;
  const current = candles15m[candles15m.length - 1]?.close;
  const atrValue = atr(candles1h);
  if (!current || !atrValue || atrValue <= 0) return null;

  const levels = swingLevels(candles1h, current);
  const vwap = rollingVwap(candles1h);
  const bands = bollinger(candles1h);
  const bbPosition = bands?.position ?? null;
  const indicator1h = input.indicators["1h"] ?? null;
  const trend = trendQuality(side, input.indicators, input.regime);
  const rawTiming = side === "long" ? input.timing.long : input.timing.short;
  const normalizedTiming = clamp((rawTiming / 88) * 100);
  const stochasticValue = stochastic(candles15m);
  const stochasticAdjustment =
    stochasticValue == null
      ? 0
      : side === "long"
        ? stochasticValue >= 25 && stochasticValue <= 65
          ? 8
          : stochasticValue >= 85
            ? -12
            : 0
        : stochasticValue >= 35 && stochasticValue <= 75
          ? 8
          : stochasticValue <= 15
            ? -12
            : 0;
  const timing = Math.round(clamp(normalizedTiming + stochasticAdjustment));
  const reversalRisk = side === "long" ? input.reversal.bearish : input.reversal.bullish;
  const marketContext = marketContextScore(
    side,
    input.btc4h,
    input.btcCorrelation,
    input.dominancePct,
  );
  const directionalCandidates = [
    side === "long" ? levels.resistance : levels.support,
    fibonacciBarrier(input.candles["4h"] ?? candles1h, current, side),
    volumeProfileBarrier(candles1h, current, side),
    side === "long" ? bands?.upper : bands?.lower,
  ].filter((value): value is number =>
    value != null && (side === "long" ? value > current : value < current),
  );
  const barrier = directionalCandidates.sort((a, b) =>
    side === "long" ? a - b : b - a,
  )[0] ?? null;
  const chasing = chasingScore({
    side,
    candles15m,
    current,
    atrValue,
    ema20: indicator1h?.ema20 ?? null,
    vwap,
    rsi: input.indicators["15m"]?.rsi ?? indicator1h?.rsi ?? null,
    bbPosition,
    directionalBarrier: barrier,
    futures: input.futures,
  });
  const atrPct = (atrValue / current) * 100;
  const returns = candles1h.slice(-25).flatMap((candle, index, rows) =>
    index === 0 ? [] : [Math.log(candle.close / rows[index - 1].close)],
  );
  const volatilityPct = stdev(returns) * Math.sqrt(4) * 100;
  const baseMovePct = Math.max(atrPct * 2, volatilityPct);
  const multiplier = clamp(
    0.35 +
      trend / 100 * 0.3 +
      timing / 100 * 0.25 +
      marketContext / 100 * 0.1 -
      chasing.score / 100 * 0.2 -
      reversalRisk / 100 * 0.2,
    0.2,
    1.25,
  );
  const modeledRewardPct = clamp(baseMovePct * multiplier, atrPct * 0.25, 10);
  const barrierRewardPct =
    barrier == null
      ? null
      : side === "long"
        ? ((barrier - current) / current) * 100
        : ((current - barrier) / current) * 100;
  const potentialRewardPct = Math.max(
    0.05,
    barrierRewardPct != null && barrierRewardPct > 0
      ? Math.min(modeledRewardPct, barrierRewardPct)
      : modeledRewardPct,
  );

  const adverseLevel = side === "long" ? levels.support : levels.resistance;
  const structuralDistance =
    adverseLevel == null
      ? atrValue * 1.2
      : Math.max(Math.abs(current - adverseLevel) + atrValue * 0.15, atrValue * 0.75);
  const potentialRiskPct = clamp((structuralDistance / current) * 100, atrPct * 0.5, 10);
  const rewardRisk = potentialRewardPct / Math.max(potentialRiskPct, 0.01);
  const moveAdequacy = clamp((potentialRewardPct / Math.max(atrPct, 0.01)) * 45);
  const expectedMove = Math.round(clamp(rrScore(rewardRisk) * 0.75 + moveAdequacy * 0.25));
  const chasingPenaltyPoints = Math.round(chasing.score * 0.3);
  const components = [
    { key: "trend", label: "Trend Quality", normalized: trend, weight: 20, reason: "4H/1H/15M・EMA・ADX・Structure" },
    { key: "timing", label: "Entry Timing", normalized: timing, weight: 25, reason: "押し目/戻り・Momentum・Volume" },
    { key: "move", label: "Expected Move", normalized: expectedMove, weight: 30, reason: `R/R ${rewardRisk.toFixed(2)}・残余値幅 ${potentialRewardPct.toFixed(2)}%` },
    { key: "reversal", label: "Reversal Safety", normalized: 100 - reversalRisk, weight: 15, reason: `逆方向Reversal Risk ${reversalRisk}` },
    { key: "market", label: "Market Context", normalized: marketContext, weight: 10, reason: "BTC trend・BTC相関・Dominance" },
  ].map((item) => ({
    ...item,
    points: Math.round(item.normalized * item.weight) / 100,
  }));
  const weighted = components.reduce((sum, item) => sum + item.points, 0);
  const rangePenalty = input.regime.regime === "RANGING" && !input.regime.breakout ? 25 : 0;
  const total = Math.round(clamp(weighted - chasingPenaltyPoints - rangePenalty));
  const nearValue =
    Math.min(
      indicator1h?.ema20 == null ? Infinity : Math.abs(current - indicator1h.ema20) / atrValue,
      vwap == null ? Infinity : Math.abs(current - vwap) / atrValue,
    ) <= 0.6;
  const breakoutConfirmed =
    input.regime.breakout &&
    (input.indicators["15m"]?.volumeRatio ?? 0) >= 1.2 &&
    ((input.futures?.oiChange15mPct ?? 0) >= 1 || !input.futures?.availableOi);
  let entryType: EntryType = "NO_ENTRY";
  if (input.regime.regime === "RANGING") entryType = "RANGE";
  else if (breakoutConfirmed && chasing.score < 55) entryType = nearValue ? "BREAKOUT_RETEST" : "BREAKOUT";
  else if (trend >= 60 && nearValue) entryType = "PULLBACK";
  else if (reversalRisk <= 30 && timing >= 60) entryType = "MOMENTUM";
  else if (reversalRisk >= 70) entryType = "REVERSAL";

  const lateEntryWarning = trend >= 75 && (chasing.score >= 55 || rewardRisk < 1.5);
  let decision: EntryDecision =
    total >= 80 && expectedMove >= 65 && timing >= 65 && reversalRisk <= 35
      ? "ENTRY_NOW"
      : total >= 65
        ? "ENTRY_WATCH"
        : "NO_ENTRY";
  if (input.regime.regime === "RANGING" && !breakoutConfirmed) decision = "NO_ENTRY";
  else if (lateEntryWarning) decision = "WAIT_FOR_PULLBACK";
  else if (
    barrierRewardPct != null &&
    barrierRewardPct <= atrPct * 0.6 &&
    !breakoutConfirmed &&
    trend >= 55
  ) decision = "WAIT_FOR_BREAKOUT";

  const sign = side === "long" ? 1 : -1;
  const targetPrice = current * (1 + sign * potentialRewardPct / 100);
  const structuralStopPrice = current * (1 - sign * potentialRiskPct / 100);
  const userMaxStopPrice = current * (1 - sign * 0.1);
  const why = [
    `${input.direction} Trend Quality ${trend}`,
    nearValue ? "価格はEMA/VWAP近辺" : "価格はValueから離れている",
    `理論Target余地 ${potentialRewardPct.toFixed(2)}%`,
    `構造Risk ${potentialRiskPct.toFixed(2)}%`,
    `Reward / Risk ${rewardRisk.toFixed(2)}`,
    input.futures?.availableOi ? `OI 1H ${input.futures.oiChange1hPct?.toFixed(2) ?? "N/A"}%` : "OI: N/A",
    input.futures?.availableFunding ? "Funding取得済み" : "Funding: N/A",
  ];
  const warnings = [
    ...chasing.reasons,
    ...(rangePenalty ? ["RANGE: 新規Entryを大幅減点"] : []),
    ...(lateEntryWarning ? ["STRONG TREND / LATE ENTRY"] : []),
  ];
  return {
    direction: input.direction,
    horizon: "4h",
    total,
    trendQuality: trend,
    timingScore: timing,
    expectedMoveScore: expectedMove,
    reversalRisk,
    marketContext,
    chasingPenalty: chasing.score,
    chasingPenaltyPoints,
    currentPrice: current,
    targetPrice,
    structuralStopPrice,
    userMaxStopPrice,
    potentialRewardPct,
    potentialRiskPct,
    rewardRisk,
    expectedValueProxy: potentialRewardPct - potentialRiskPct,
    atrPct,
    volatilityPct,
    supportPrice: levels.support,
    resistancePrice: levels.resistance,
    vwap,
    bollingerPosition: bbPosition,
    entryType,
    decision,
    lateEntryWarning,
    items: components,
    why,
    warnings,
  };
}
