import type {
  Bucket,
  EquityPoint,
  PortfolioResult,
  RegimeBreakdown,
  ScoreCard,
  SimTrade,
  SimulationSettings,
} from "@/lib/types/simulation";

const DAY_MS = 86_400_000;

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export const EMPTY_SCORECARD: ScoreCard = {
  tradeCount: 0,
  winRate: 0,
  averageWinPct: 0,
  averageLossPct: 0,
  expectedValuePct: 0,
  expectancyR: 0,
  profitFactor: 0,
  maxConsecutiveLosses: 0,
  maxConsecutiveWins: 0,
  sharpe: 0,
  sortino: 0,
  averageHoldingMinutes: 0,
  liquidationCount: 0,
  totalFeePct: 0,
  bestTradePct: 0,
  worstTradePct: 0,
};

/**
 * Per-trade statistics. `sharpe` and `sortino` are per-trade ratios of mean to
 * dispersion, not annualized, so they are only comparable between strategies
 * measured on the same trade population.
 */
export function buildScoreCard(trades: SimTrade[]): ScoreCard {
  if (trades.length === 0) return EMPTY_SCORECARD;
  const ordered = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const returns = ordered.map((trade) => trade.netNotionalReturnPct);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value <= 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const downside = returns.filter((value) => value < 0).map((value) => Math.abs(value));

  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  let consecutiveWins = 0;
  let maxConsecutiveWins = 0;
  for (const value of returns) {
    if (value > 0) {
      consecutiveWins += 1;
      consecutiveLosses = 0;
    } else {
      consecutiveLosses += 1;
      consecutiveWins = 0;
    }
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
  }

  const dispersion = stdDev(returns);
  const downsideDispersion = stdDev(downside.length > 1 ? downside : [0, 0]);
  return {
    tradeCount: ordered.length,
    winRate: (wins.length / ordered.length) * 100,
    averageWinPct: mean(wins),
    averageLossPct: mean(losses),
    expectedValuePct: mean(returns),
    expectancyR: mean(ordered.map((trade) => trade.rMultiple)),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxConsecutiveLosses,
    maxConsecutiveWins,
    sharpe: dispersion > 0 ? mean(returns) / dispersion : 0,
    sortino: downsideDispersion > 0 ? mean(returns) / downsideDispersion : 0,
    averageHoldingMinutes: mean(ordered.map((trade) => trade.holdingMinutes)),
    liquidationCount: ordered.filter((trade) => trade.liquidated).length,
    totalFeePct: ordered.reduce((sum, trade) => sum + trade.costPct, 0),
    bestTradePct: Math.max(...returns),
    worstTradePct: Math.min(...returns),
  };
}

type OpenPosition = {
  trade: SimTrade;
  notional: number;
  exitTime: number;
};

/**
 * Sequential portfolio replay. Trades enter in chronological order and only up
 * to `positionCount` may be open at once, so a strategy that fires constantly
 * cannot silently assume unlimited capital.
 */
export function simulatePortfolio(
  trades: SimTrade[],
  settings: SimulationSettings,
): PortfolioResult {
  const ordered = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const curve: EquityPoint[] = [];
  let capital = settings.initialCapital;
  let peak = capital;
  let maxDrawdownPct = 0;
  let feesPaid = 0;
  let fundingPaid = 0;
  let liquidations = 0;
  let executed = 0;
  let skipped = 0;
  let sizeCapped = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  let peakGross = 0;
  let peakLong = 0;
  let peakShort = 0;
  let open: OpenPosition[] = [];

  const settle = (position: OpenPosition) => {
    const { trade, notional } = position;
    const fee = (notional * trade.feePct) / 100;
    const funding = (notional * trade.fundingPct) / 100;
    feesPaid += fee;
    fundingPaid += funding;
    if (trade.liquidated) liquidations += 1;
    const pnl = (notional * trade.netNotionalReturnPct) / 100;
    capital = Math.max(0, capital + pnl);
    if (pnl <= 0) {
      consecutiveLosses += 1;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    } else {
      consecutiveLosses = 0;
    }
    peak = Math.max(peak, capital);
    const drawdown = peak > 0 ? ((peak - capital) / peak) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);
    curve.push({
      time: trade.exitTime,
      capital,
      drawdownPct: drawdown,
      openPositions: open.length,
    });
  };

  const releaseUntil = (time: number) => {
    const due = open.filter((position) => position.exitTime <= time);
    if (due.length === 0) return;
    open = open.filter((position) => position.exitTime > time);
    for (const position of due.sort((a, b) => a.exitTime - b.exitTime)) settle(position);
  };

  for (const trade of ordered) {
    releaseUntil(trade.entryTime);
    if (capital <= 0) break;
    if (open.length >= settings.positionCount) {
      skipped += 1;
      continue;
    }

    const riskBase = settings.compounding ? capital : settings.initialCapital;
    const riskAmount = (riskBase * settings.riskPerTradePct) / 100;
    const wanted = riskAmount / (trade.stopDistancePct / 100);
    const committedMargin = open.reduce(
      (sum, position) => sum + position.notional / settings.leverage,
      0,
    );
    const freeMargin = Math.max(0, capital - committedMargin);
    const slotMargin = Math.min(freeMargin, capital / settings.positionCount);
    const affordable = slotMargin * settings.leverage;
    if (!(affordable > 0)) {
      skipped += 1;
      continue;
    }
    const notional = Math.min(wanted, affordable);
    if (notional < wanted * 0.999) sizeCapped += 1;

    open.push({ trade, notional, exitTime: trade.exitTime });
    executed += 1;
    const gross = open.reduce((sum, position) => sum + position.notional, 0);
    peakGross = Math.max(peakGross, gross);
    peakLong = Math.max(
      peakLong,
      open
        .filter((position) => position.trade.direction === "LONG")
        .reduce((sum, position) => sum + position.notional, 0),
    );
    peakShort = Math.max(
      peakShort,
      open
        .filter((position) => position.trade.direction === "SHORT")
        .reduce((sum, position) => sum + position.notional, 0),
    );
  }

  releaseUntil(Number.POSITIVE_INFINITY);

  const start = ordered[0]?.entryTime ?? 0;
  const end = ordered[ordered.length - 1]?.exitTime ?? 0;
  const spanDays = start && end > start ? (end - start) / DAY_MS : 0;
  const totalReturnPct =
    settings.initialCapital > 0
      ? ((capital - settings.initialCapital) / settings.initialCapital) * 100
      : 0;
  const cagrPct =
    spanDays >= 1 && settings.initialCapital > 0 && capital > 0
      ? ((capital / settings.initialCapital) ** (365 / spanDays) - 1) * 100
      : null;

  return {
    initialCapital: settings.initialCapital,
    finalCapital: capital,
    totalReturnPct,
    cagrPct,
    maxDrawdownPct,
    maxConsecutiveLosses,
    curve,
    executedTrades: executed,
    skippedByPositionLimit: skipped,
    sizeCappedTrades: sizeCapped,
    feesPaid,
    fundingPaid,
    liquidations,
    peakGrossExposure: peakGross,
    peakLongExposure: peakLong,
    peakShortExposure: peakShort,
    spanDays,
  };
}

export function groupBreakdown(
  trades: SimTrade[],
  key: (trade: SimTrade) => string,
): RegimeBreakdown[] {
  const groups = new Map<string, SimTrade[]>();
  for (const trade of trades) {
    const id = key(trade);
    const bucket = groups.get(id);
    if (bucket) bucket.push(trade);
    else groups.set(id, [trade]);
  }
  return [...groups.entries()]
    .map(([id, rows]) => {
      const card = buildScoreCard(rows);
      return {
        key: id,
        tradeCount: card.tradeCount,
        winRate: card.winRate,
        expectancyR: card.expectancyR,
        expectedValuePct: card.expectedValuePct,
        profitFactor: card.profitFactor,
      };
    })
    .sort((a, b) => b.tradeCount - a.tradeCount);
}

export function histogram(values: number[], edges: number[], unit: string): Bucket[] {
  const buckets: Bucket[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const low = edges[i];
    const high = edges[i + 1];
    buckets.push({
      label:
        high == null ? `>= ${low}${unit}` : i === 0 ? `< ${high}${unit}` : `${low}〜${high}${unit}`,
      count: values.filter((value) =>
        high == null ? value >= low : i === 0 ? value < high : value >= low && value < high,
      ).length,
    });
  }
  return buckets;
}

export const RETURN_HISTOGRAM_EDGES = [-100, -3, -2, -1, 0, 1, 2, 3, 5];
export const HOLDING_HISTOGRAM_EDGES = [0, 15, 30, 60, 120, 240, 720, 1440];
