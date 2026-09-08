import type { MarketEnvSnapshot, SymbolAnalysis } from "@/lib/types/scoring";
import type { MarketDecision } from "@/lib/types/trade-decision";

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function isBullish(trend: string | undefined): boolean {
  return trend === "Bullish" || trend === "Strong Bullish";
}

function isBearish(trend: string | undefined): boolean {
  return trend === "Bearish" || trend === "Strong Bearish";
}

export function assessMarketDecision(
  rows: SymbolAnalysis[],
  market: MarketEnvSnapshot | null,
): MarketDecision {
  const eligible = rows.filter(
    (row) => row.rankingEligible && row.availability === "SCORING_AVAILABLE",
  );
  const btc4h = market?.btc4h?.trend;
  const btc1h = market?.btc?.indicators["1h"]?.trend;
  const btcDirection = isBullish(btc4h) ? "LONG" : isBearish(btc4h) ? "SHORT" : null;
  const aligned = eligible.filter((row) => {
    if (!btcDirection) return false;
    const long = row.entryExpectancy.long?.total ?? 0;
    const short = row.entryExpectancy.short?.total ?? 0;
    return btcDirection === (long >= short ? "LONG" : "SHORT");
  }).length;
  const marketBreadthPct =
    eligible.length && btcDirection ? (aligned / eligible.length) * 100 : null;
  const opportunities = eligible.flatMap((row) =>
    [row.entryExpectancy.long, row.entryExpectancy.short].filter(
      (item): item is NonNullable<typeof item> =>
        item != null &&
        item.total >= 80 &&
        item.rewardRisk >= 2 &&
        item.reversalRisk <= 45,
    ),
  );
  const allSetups = eligible.flatMap((row) =>
    [row.entryExpectancy.long, row.entryExpectancy.short].filter(
      (item): item is NonNullable<typeof item> => item != null,
    ),
  );
  const averageExpectedMove = average(allSetups.map((item) => item.expectedMoveScore));
  const averageCorrelation = average(
    eligible
      .map((row) => row.btcCorrelation)
      .filter((value): value is number => value != null)
      .map(Math.abs),
  );
  const reversalRatio =
    allSetups.length
      ? allSetups.filter((item) => item.reversalRisk >= 65).length / allSetups.length
      : 0;
  const poorRrRatio =
    allSetups.length
      ? allSetups.filter((item) => item.rewardRisk < 1.25).length / allSetups.length
      : 1;
  const crowdedRatio =
    eligible.length
      ? eligible.filter((row) => {
          const funding = row.futures?.fundingPercentile ?? 50;
          return funding >= 90 || funding <= 10 || Math.abs(row.futures?.oiChange1hPct ?? 0) >= 5;
        }).length / eligible.length
      : 0;
  const trending = isBullish(btc4h) || isBearish(btc4h);
  const persistence =
    (isBullish(btc4h) && isBullish(btc1h)) || (isBearish(btc4h) && isBearish(btc1h));
  const btcMove1h = market?.btc?.futures?.priceChange1hPct ?? 0;
  const btcVolume = market?.btc?.indicators["1h"]?.volumeRatio ?? 0;
  const btcLiquidation = market?.btc?.futures?.liquidation ?? 0;
  const shockScore = Math.round(Math.min(
    100,
    Math.abs(btcMove1h) * 18 + Math.max(0, btcVolume - 1) * 25 + btcLiquidation * 0.35,
  ));
  const shock =
    (Math.abs(btcMove1h) >= 2 && (btcVolume >= 1.8 || btcLiquidation >= 60)) ||
    Math.abs(btcMove1h) >= 4;

  let score = 35;
  if (trending) score += 12;
  if (persistence) score += 13;
  if ((marketBreadthPct ?? 0) >= 60) score += 15;
  if (opportunities.length >= 3) score += 15;
  else if (opportunities.length >= 1) score += 7;
  if ((averageCorrelation ?? 1) <= 0.65) score += 8;
  if (crowdedRatio < 0.25) score += 7;
  if ((averageExpectedMove ?? 0) < 45) score -= 12;
  if (reversalRatio >= 0.4) score -= 15;
  if (poorRrRatio >= 0.5) score -= 12;
  if (market?.btc?.regime?.regime === "RANGING") score -= 20;
  if (shock) score -= 40;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const attackLevel =
    shock || score <= 35 ? "DEFEND" : score >= 65 ? "ATTACK" : "NORMAL";
  const capitalPreservation =
    attackLevel === "DEFEND" ||
    reversalRatio >= 0.4 ||
    poorRrRatio >= 0.5 ||
    (averageCorrelation ?? 0) >= 0.8;
  const reasons = [
    trending ? `BTC 4H ${btc4h}` : "BTC trend不明瞭",
    marketBreadthPct == null ? "Market breadth N/A" : `方向一致Breadth ${marketBreadthPct.toFixed(0)}%`,
    `High EV setup ${opportunities.length}`,
    averageCorrelation == null ? "Correlation N/A" : `平均|BTC相関| ${averageCorrelation.toFixed(2)}`,
    crowdedRatio >= 0.25 ? "OI / Funding crowding増加" : "OI / Funding crowdingは限定的",
    ...(shock ? [`MARKET SHOCK score ${shockScore}`] : []),
  ];
  const recommendedSet =
    attackLevel === "ATTACK"
      ? "BALANCED SET"
      : attackLevel === "DEFEND"
        ? "DEFENSIVE SET"
        : "BALANCED SET";
  const optionalSet =
    attackLevel === "ATTACK"
      ? "ATTACK SET"
      : attackLevel === "NORMAL"
        ? "DEFENSIVE SET"
        : null;
  const advice =
    attackLevel === "ATTACK"
      ? "市場と高期待値Setupの整合が比較的良好です。Entry ZoneとR/Rを満たす個別Setupに限定してリスクを検討できます。"
      : attackLevel === "DEFEND"
        ? "市場の不確実性または急変リスクが高いため、新規Entryを減らし、相関したExposureを増やさない検討が必要です。"
        : "市場は中立です。方向を決め打ちせず、Entry Zone・R/R・Data Qualityが揃う銘柄を選別します。";

  return {
    attackLevel,
    score,
    shock,
    shockScore,
    marketBreadthPct,
    highOpportunityCount: opportunities.length,
    averageExpectedMove,
    averageCorrelation,
    capitalPreservation,
    reasons,
    recommendedSet,
    optionalSet,
    avoid:
      attackLevel === "ATTACK"
        ? "Entry Zone外の追いかけEntry"
        : attackLevel === "DEFEND"
          ? "高相関・同方向Positionの追加"
          : "低R/R Setupへの無理なEntry",
    advice,
  };
}
