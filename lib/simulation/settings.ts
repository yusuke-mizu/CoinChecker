import { DEFAULT_STRATEGY_PARAMS, STRATEGY_BY_ID } from "./strategies";
import { MAX_BACKTEST_SYMBOLS } from "./run-backtest";
import {
  HOLDING_MINUTES,
  type HoldingOption,
  type SimTimeframe,
  type SimulationSettings,
  type StrategyId,
} from "@/lib/types/simulation";

export const SIM_TIMEFRAMES: SimTimeframe[] = ["5m", "15m", "1h", "4h"];
export const HOLDING_OPTIONS = Object.keys(HOLDING_MINUTES) as HoldingOption[];
export const MONTE_CARLO_PATH_OPTIONS = [1000, 5000, 10_000];

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"],
  timeframes: ["15m", "1h"],
  strategies: ["EMA_PULLBACK", "BREAKOUT", "RSI_MEAN_REVERSION"],
  direction: "BOTH",
  initialCapital: 10_000,
  leverage: 5,
  holding: "4h",
  stopMode: "DYNAMIC",
  fixedStopPct: 2,
  takeProfitMode: "DYNAMIC",
  fixedTarget1Pct: 2,
  fixedTarget2Pct: 4,
  riskPerTradePct: 2,
  positionCount: 5,
  compounding: true,
  params: DEFAULT_STRATEGY_PARAMS,
  costs: {
    feesEnabled: true,
    slippageEnabled: true,
    fundingEnabled: true,
    takerFeePct: 0.055,
    slippagePct: 0.02,
    fundingRatePct8h: 0.01,
    maintenanceMarginRate: 0.005,
  },
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function symbolList(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_SIMULATION_SETTINGS.symbols;
  const cleaned = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toUpperCase().replace(/[-_/]/g, ""))
        .filter((item) => /^[A-Z0-9]{4,20}USDT$/.test(item) || /^[A-Z0-9]{2,16}USDT$/.test(item)),
    ),
  ];
  return cleaned.length ? cleaned.slice(0, MAX_BACKTEST_SYMBOLS) : DEFAULT_SIMULATION_SETTINGS.symbols;
}

/**
 * Server-side validation. Every numeric knob is bounded so a crafted request
 * cannot make the Worker allocate or iterate without limit.
 */
export function normalizeSettings(raw: unknown): SimulationSettings {
  const input = (raw ?? {}) as Partial<SimulationSettings> & Record<string, unknown>;
  const defaults = DEFAULT_SIMULATION_SETTINGS;

  const timeframes = Array.isArray(input.timeframes)
    ? SIM_TIMEFRAMES.filter((timeframe) => input.timeframes?.includes(timeframe))
    : defaults.timeframes;
  const strategies = Array.isArray(input.strategies)
    ? (input.strategies.filter(
        (id): id is StrategyId => typeof id === "string" && STRATEGY_BY_ID.has(id as StrategyId),
      ) as StrategyId[])
    : defaults.strategies;
  const rawParams = (input.params ?? {}) as Partial<SimulationSettings["params"]>;
  const rawCosts = (input.costs ?? {}) as Partial<SimulationSettings["costs"]>;

  return {
    symbols: symbolList(input.symbols),
    timeframes: timeframes.length ? timeframes : defaults.timeframes,
    strategies: strategies.length ? strategies : defaults.strategies,
    direction:
      input.direction === "LONG" || input.direction === "SHORT" ? input.direction : "BOTH",
    initialCapital: clamp(input.initialCapital, defaults.initialCapital, 1_000, 1_000_000_000),
    leverage: Math.round(clamp(input.leverage, defaults.leverage, 1, 20)),
    holding: HOLDING_OPTIONS.includes(input.holding as HoldingOption)
      ? (input.holding as HoldingOption)
      : defaults.holding,
    stopMode: input.stopMode === "FIXED" ? "FIXED" : "DYNAMIC",
    fixedStopPct: clamp(input.fixedStopPct, defaults.fixedStopPct, 0.3, 15),
    takeProfitMode: input.takeProfitMode === "FIXED" ? "FIXED" : "DYNAMIC",
    fixedTarget1Pct: clamp(input.fixedTarget1Pct, defaults.fixedTarget1Pct, 0.3, 20),
    fixedTarget2Pct: clamp(input.fixedTarget2Pct, defaults.fixedTarget2Pct, 0.5, 40),
    riskPerTradePct: clamp(input.riskPerTradePct, defaults.riskPerTradePct, 0.1, 20),
    positionCount: Math.round(clamp(input.positionCount, defaults.positionCount, 1, 30)),
    compounding: boolean(input.compounding, defaults.compounding),
    params: {
      rsiOversold: Math.round(clamp(rawParams.rsiOversold, 30, 10, 45)),
      rsiOverbought: Math.round(clamp(rawParams.rsiOverbought, 70, 55, 90)),
      emaFast: Math.round(clamp(rawParams.emaFast, 20, 5, 60)),
      emaSlow: Math.round(clamp(rawParams.emaSlow, 50, 10, 200)),
      atrStopMultiplier: clamp(rawParams.atrStopMultiplier, 1.5, 0.5, 5),
      target1R: clamp(rawParams.target1R, 1.5, 0.5, 10),
      target2R: clamp(rawParams.target2R, 3, 0.5, 20),
      target1Fraction: clamp(rawParams.target1Fraction, 0.5, 0, 1),
      breakoutLookback: Math.round(clamp(rawParams.breakoutLookback, 20, 5, 100)),
      minVolumeRatio: clamp(rawParams.minVolumeRatio, 1.2, 0.5, 5),
    },
    costs: {
      feesEnabled: boolean(rawCosts.feesEnabled, true),
      slippageEnabled: boolean(rawCosts.slippageEnabled, true),
      fundingEnabled: boolean(rawCosts.fundingEnabled, true),
      takerFeePct: clamp(rawCosts.takerFeePct, 0.055, 0, 0.5),
      slippagePct: clamp(rawCosts.slippagePct, 0.02, 0, 1),
      fundingRatePct8h: clamp(rawCosts.fundingRatePct8h, 0.01, 0, 0.5),
      maintenanceMarginRate: clamp(rawCosts.maintenanceMarginRate, 0.005, 0.001, 0.05),
    },
  };
}
