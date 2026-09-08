export type SimTimeframe = "5m" | "15m" | "1h" | "4h";

export const BAR_MINUTES: Record<SimTimeframe, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
};

export type HoldingOption = "15m" | "30m" | "1h" | "2h" | "4h" | "12h" | "24h";

export const HOLDING_MINUTES: Record<HoldingOption, number> = {
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "12h": 720,
  "24h": 1440,
};

export type StrategyId =
  | "TREND_FOLLOWING"
  | "MA_CROSS"
  | "EMA_PULLBACK"
  | "BREAKOUT"
  | "BREAKOUT_RETEST"
  | "RSI_MEAN_REVERSION"
  | "BOLLINGER_REVERSION"
  | "VWAP_REVERSION"
  | "VOLATILITY_EXPANSION";

export type TradeDirection = "LONG" | "SHORT";

/** Structural label assigned from data available at the entry bar only. */
export type MarketRegime =
  | "BULL"
  | "BEAR"
  | "TRENDING"
  | "RANGING"
  | "CRASH"
  | "RECOVERY";

export type VolatilityBand = "HIGH_VOLATILITY" | "NORMAL_VOLATILITY" | "LOW_VOLATILITY";

export type StrategyParams = {
  rsiOversold: number;
  rsiOverbought: number;
  emaFast: number;
  emaSlow: number;
  atrStopMultiplier: number;
  target1R: number;
  target2R: number;
  /** Fraction of the position closed at TP1; the remainder trails to TP2. */
  target1Fraction: number;
  breakoutLookback: number;
  minVolumeRatio: number;
};

export type CostModel = {
  feesEnabled: boolean;
  slippageEnabled: boolean;
  fundingEnabled: boolean;
  /** Taker fee per side, percent of notional. */
  takerFeePct: number;
  /** Applied to entry and exit fills, percent of price. */
  slippagePct: number;
  /** Modeled constant funding per 8h, percent of notional. Not historical funding. */
  fundingRatePct8h: number;
  maintenanceMarginRate: number;
};

export type SimulationSettings = {
  symbols: string[];
  timeframes: SimTimeframe[];
  strategies: StrategyId[];
  direction: "LONG" | "SHORT" | "BOTH";
  initialCapital: number;
  leverage: number;
  holding: HoldingOption;
  stopMode: "DYNAMIC" | "FIXED";
  fixedStopPct: number;
  takeProfitMode: "DYNAMIC" | "FIXED";
  fixedTarget1Pct: number;
  fixedTarget2Pct: number;
  riskPerTradePct: number;
  positionCount: number;
  compounding: boolean;
  params: StrategyParams;
  costs: CostModel;
};

export type SimTrade = {
  symbol: string;
  timeframe: SimTimeframe;
  strategy: StrategyId;
  direction: TradeDirection;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  target1: number;
  target2: number;
  liquidationPrice: number;
  exitReason: "TP1" | "TP2" | "STOP" | "BREAKEVEN" | "TIME" | "LIQUIDATION";
  holdingBars: number;
  holdingMinutes: number;
  stopDistancePct: number;
  /** Weighted price move actually realized, percent of entry price. */
  priceReturnPct: number;
  feePct: number;
  fundingPct: number;
  costPct: number;
  /** priceReturnPct minus costs, still expressed against notional. */
  netNotionalReturnPct: number;
  /** Net result in units of the risked amount. The unit used by Monte Carlo. */
  rMultiple: number;
  leverage: number;
  liquidated: boolean;
  regime: MarketRegime;
  volatility: VolatilityBand;
  entryRsi: number | null;
  entryAtrPct: number | null;
};

export type ScoreCard = {
  tradeCount: number;
  winRate: number;
  averageWinPct: number;
  averageLossPct: number;
  expectedValuePct: number;
  expectancyR: number;
  profitFactor: number;
  maxConsecutiveLosses: number;
  maxConsecutiveWins: number;
  sharpe: number;
  sortino: number;
  averageHoldingMinutes: number;
  liquidationCount: number;
  totalFeePct: number;
  bestTradePct: number;
  worstTradePct: number;
};

export type EquityPoint = {
  time: number;
  capital: number;
  drawdownPct: number;
  openPositions: number;
};

export type PortfolioResult = {
  initialCapital: number;
  finalCapital: number;
  totalReturnPct: number;
  cagrPct: number | null;
  maxDrawdownPct: number;
  maxConsecutiveLosses: number;
  curve: EquityPoint[];
  executedTrades: number;
  skippedByPositionLimit: number;
  sizeCappedTrades: number;
  feesPaid: number;
  fundingPaid: number;
  liquidations: number;
  peakGrossExposure: number;
  peakLongExposure: number;
  peakShortExposure: number;
  spanDays: number;
};

export type Bucket = {
  label: string;
  count: number;
};

export type RegimeBreakdown = {
  key: string;
  tradeCount: number;
  winRate: number;
  expectancyR: number;
  expectedValuePct: number;
  profitFactor: number;
};

export type StrategyReport = {
  strategy: StrategyId;
  scorecard: ScoreCard;
  regimes: RegimeBreakdown[];
};

export type BacktestWarning = {
  scope: string;
  message: string;
};

/** Compact resampling input for Monte Carlo, kept separate from the trade list. */
export type TradePopulation = {
  rMultiples: number[];
  tradesPerDay: number | null;
};

export type BacktestResult = {
  settings: SimulationSettings;
  dataStart: number | null;
  dataEnd: number | null;
  candlesLoaded: number;
  requests: number;
  /** Truncated for transport. Aggregates and `population` cover every trade. */
  trades: SimTrade[];
  totalTrades: number;
  population: TradePopulation;
  scorecard: ScoreCard;
  portfolio: PortfolioResult;
  byStrategy: StrategyReport[];
  bySymbol: RegimeBreakdown[];
  byTimeframe: RegimeBreakdown[];
  byRegime: RegimeBreakdown[];
  byVolatility: RegimeBreakdown[];
  byHoldingBucket: RegimeBreakdown[];
  returnHistogram: Bucket[];
  holdingHistogram: Bucket[];
  warnings: BacktestWarning[];
  generatedAt: string;
};

export type MonteCarloSettings = {
  paths: number;
  tradesPerPath: number;
  initialCapital: number;
  riskPerTradePct: number;
  /** Contiguous trade blocks preserve streaks; 1 means plain iid bootstrap. */
  blockSize: number;
  ruinThresholdPct: number;
  drawdownThresholdPct: number;
  targetCapital: number;
  compounding: boolean;
  seed: number;
};

export type MonteCarloResult = {
  settings: MonteCarloSettings;
  sampleSize: number;
  medianFinalCapital: number;
  meanFinalCapital: number;
  bestCase: number;
  worstCase: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  probabilityOfLoss: number;
  probabilityOfDrawdownBeyondThreshold: number;
  probabilityOfRuin: number;
  medianMaxDrawdownPct: number;
  worstMaxDrawdownPct: number;
  targetReachProbability: number;
  medianTradesToTarget: number | null;
  medianDaysToTarget: number | null;
  medianPathCurve: number[];
  finalCapitalHistogram: Bucket[];
};
