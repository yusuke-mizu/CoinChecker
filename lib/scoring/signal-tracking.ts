import { scoreExitAlert } from "./exit-alert";
import type { MarketEnvSnapshot, SymbolAnalysis } from "@/lib/types/scoring";
import type {
  SignalAlertPriority,
  SignalDirection,
  SignalObservation,
  SignalPerformanceCheckpoint,
  SignalPerformanceHorizon,
  SignalScoreSnapshot,
  SignalSettings,
  SignalStatus,
  SignalStoreDocument,
  TrackedSignal,
} from "@/lib/types/signals";

const MAX_EVENTS = 12;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;

export const DEFAULT_SIGNAL_SETTINGS: SignalSettings = {
  enabled: true,
  entryThreshold: 75,
  strongEntryThreshold: 80,
  watchEntryThreshold: 65,
  timingThreshold: 70,
  topN: 10,
  durationHours: 24,
  portfolioProtectionCount: 2,
  setLeverage: 1,
};

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function sideValues(row: SymbolAnalysis, direction: SignalDirection) {
  const own = direction === "LONG" ? row.long : row.short;
  const opposite = direction === "LONG" ? row.short : row.long;
  const expectancy =
    direction === "LONG" ? row.entryExpectancy.long : row.entryExpectancy.short;
  const oppositeExpectancy =
    direction === "LONG" ? row.entryExpectancy.short : row.entryExpectancy.long;
  return {
    own,
    opposite,
    expectancy,
    oppositeExpectancy,
    reversal: direction === "LONG" ? row.reversal?.bearish : row.reversal?.bullish,
  };
}

export function dominantDirection(row: SymbolAnalysis): SignalDirection | null {
  if (row.long == null || row.short == null || row.difference == null) return null;
  if (row.difference > 0) return "LONG";
  if (row.difference < 0) return "SHORT";
  return null;
}

export function toSignalObservation(
  row: SymbolAnalysis,
  market: MarketEnvSnapshot | null,
  requestedDirection?: SignalDirection,
): SignalObservation | null {
  const dominant = dominantDirection(row);
  const direction = requestedDirection ?? dominant;
  if (!direction) return null;
  const side = sideValues(row, direction);
  const price = row.ticker?.last ?? null;
  if (
    row.availability !== "SCORING_AVAILABLE" ||
    !row.rankingEligible ||
    !side.own ||
    !side.opposite ||
    !side.expectancy ||
    !side.oppositeExpectancy ||
    side.reversal == null ||
    price == null ||
    price <= 0
  ) {
    return {
      symbol: row.symbol,
      display: row.display,
      direction,
      isDominant: direction === dominant,
      scoringAvailable: false,
      regime: row.regime?.regime ?? null,
      snapshot: null,
    };
  }

  const exit = scoreExitAlert({
    side: direction,
    tf4h: row.indicators["4h"] ?? null,
    tf1h: row.indicators["1h"] ?? null,
    tf15m: row.indicators["15m"] ?? null,
    btc4h: market?.btc4h ?? null,
    futures: row.futures,
    reversalScore: side.reversal,
    trendScore: side.own.breakdown.trend4h + side.own.breakdown.trend1h,
  });
  const snapshot: SignalScoreSnapshot = {
    scoreModel: "expectancy-v1",
    entry: side.expectancy.total,
    oppositeEntry: side.oppositeExpectancy.total,
    timing: side.expectancy.timingScore,
    oppositeTiming: side.oppositeExpectancy.timingScore,
    trend: side.expectancy.trendQuality,
    expectedMove: side.expectancy.expectedMoveScore,
    potentialRewardPct: side.expectancy.potentialRewardPct,
    potentialRiskPct: side.expectancy.potentialRiskPct,
    rewardRisk: side.expectancy.rewardRisk,
    chasingPenalty: side.expectancy.chasingPenalty,
    entryType: side.expectancy.entryType,
    entryDecision: side.expectancy.decision,
    range: row.regime?.rangeScore ?? 0,
    drift: row.regime?.driftScore ?? 0,
    driftSide: row.regime?.driftSide ?? "none",
    reversal: side.reversal,
    futures: row.futures?.score ?? null,
    dataQuality: row.dataQuality.score,
    exitAlert: exit.score,
    price,
    btcCorrelation: row.btcCorrelation,
    confidence: row.confidence,
    marketVenue: row.marketVenue,
    signalLabel: row.signal,
    observedAt: row.updatedAt,
    reasons: exit.reasons.slice(0, 8),
  };
  return {
    symbol: row.symbol,
    display: row.display,
    direction,
    isDominant: direction === dominant,
    scoringAvailable: true,
    regime: row.regime?.regime ?? null,
    snapshot,
  };
}

export function qualifiesForTracking(
  observation: SignalObservation,
  settings: SignalSettings,
): boolean {
  const value = observation.snapshot;
  return Boolean(
    settings.enabled &&
      observation.isDominant &&
      observation.scoringAvailable &&
      value &&
      value.entry >= settings.entryThreshold &&
      value.timing >= settings.timingThreshold &&
      observation.regime !== "RANGING",
  );
}

export function priceChangeSinceSignal(
  direction: SignalDirection,
  signalPrice: number,
  currentPrice: number,
): number {
  const raw = ((currentPrice - signalPrice) / signalPrice) * 100;
  return direction === "LONG" ? raw : -raw;
}

function adverseRegime(snapshot: SignalScoreSnapshot, direction: SignalDirection): number {
  const adverseDrift =
    (direction === "LONG" && snapshot.driftSide === "down") ||
    (direction === "SHORT" && snapshot.driftSide === "up")
      ? snapshot.drift
      : 0;
  return Math.max(adverseDrift, snapshot.range * 0.5);
}

export function scoreDeterioration(
  baseline: SignalScoreSnapshot,
  current: SignalScoreSnapshot,
  direction: SignalDirection,
): number {
  const drop = (before: number, now: number) =>
    clamp(((before - now) / Math.max(before, 1)) * 100);
  const edge0 = Math.max(baseline.entry - baseline.oppositeEntry, 1);
  const edgeNow = current.entry - current.oppositeEntry;
  const edgeDrop = clamp(((edge0 - edgeNow) / edge0) * 100);
  const reversalRise = clamp(current.reversal - baseline.reversal);
  const regimeRise = clamp(adverseRegime(current, direction) - adverseRegime(baseline, direction));
  return Math.round(
    clamp(
      drop(baseline.entry, current.entry) * 0.35 +
        drop(baseline.timing, current.timing) * 0.2 +
        edgeDrop * 0.2 +
        reversalRise * 0.15 +
        regimeRise * 0.1,
    ),
  );
}

export function scoreTakeProfit(input: {
  priceChangePct: number;
  peakFavorablePct: number;
  deterioration: number;
  exitAlert: number;
  reversal: number;
}): number {
  if (input.priceChangePct <= 0) return 0;
  const maturity = clamp((input.priceChangePct / 10) * 100);
  const giveback = clamp(
    ((input.peakFavorablePct - input.priceChangePct) /
      Math.max(input.peakFavorablePct, 0.01)) *
      100,
  );
  return Math.round(
    clamp(
      maturity * 0.4 +
        input.deterioration * 0.2 +
        input.exitAlert * 0.2 +
        giveback * 0.1 +
        input.reversal * 0.1,
    ),
  );
}

function statusFor(input: {
  settings: SignalSettings;
  baseline: SignalScoreSnapshot;
  current: SignalScoreSnapshot;
  priceChangePct: number;
  deterioration: number;
  takeProfit: number;
}): { status: SignalStatus; priority: SignalAlertPriority } {
  const { settings, baseline, current, priceChangePct, deterioration, takeProfit } = input;
  const oppositeQualified =
    current.oppositeEntry >= settings.entryThreshold &&
    current.oppositeTiming >= settings.timingThreshold &&
    current.oppositeEntry > current.entry;
  if (
    priceChangePct <= -10 ||
    (priceChangePct <= -7 && current.exitAlert >= 70) ||
    (priceChangePct < 0 && current.exitAlert >= 90)
  ) {
    return { status: "STOP_LOSS_WATCH", priority: "STOP_LOSS" };
  }
  if (
    (oppositeQualified && current.exitAlert >= 70) ||
    (current.reversal >= 90 && current.exitAlert >= 80)
  ) {
    return { status: "INVALIDATED", priority: "STRONG_EXIT" };
  }
  if (current.exitAlert >= 85) {
    return { status: "EXIT_WATCH", priority: "STRONG_EXIT" };
  }
  if (takeProfit >= 80) {
    return { status: "TAKE_PROFIT_WATCH", priority: "STRONG_TAKE_PROFIT" };
  }
  if (takeProfit >= 65) {
    return { status: "TAKE_PROFIT_WATCH", priority: "TAKE_PROFIT" };
  }
  if (current.reversal >= 70 && current.reversal > baseline.reversal) {
    return { status: "WEAKENING", priority: "REVERSAL" };
  }
  if (deterioration >= 35 || current.exitAlert >= 50) {
    return { status: "WEAKENING", priority: "WEAKENING" };
  }
  return { status: "ACTIVE", priority: "ACTIVE" };
}

function idFor(observation: SignalObservation, now: string): string {
  return `${observation.symbol}-${observation.direction}-${Date.parse(now).toString(36)}`;
}

function appendEvent(
  signal: TrackedSignal,
  nextStatus: SignalStatus,
  now: string,
): TrackedSignal["events"] {
  if (signal.status === nextStatus) return signal.events;
  return [...signal.events, { at: now, from: signal.status, to: nextStatus }].slice(-MAX_EVENTS);
}

const PERFORMANCE_WINDOWS: Record<
  SignalPerformanceHorizon,
  { hours: number; toleranceMinutes: number }
> = {
  "1h": { hours: 1, toleranceMinutes: 45 },
  "4h": { hours: 4, toleranceMinutes: 60 },
  "12h": { hours: 12, toleranceMinutes: 180 },
  "24h": { hours: 24, toleranceMinutes: 360 },
};

function newPerformance(createdAt: string): SignalPerformanceCheckpoint[] {
  const created = Date.parse(createdAt);
  return (Object.entries(PERFORMANCE_WINDOWS) as Array<
    [SignalPerformanceHorizon, { hours: number; toleranceMinutes: number }]
  >).map(([horizon, window]) => ({
    horizon,
    targetAt: new Date(created + window.hours * 60 * 60_000).toISOString(),
    sampledAt: null,
    lagMinutes: null,
    sampledPrice: null,
    returnPct: null,
    state: "PENDING",
  }));
}

function updatePerformance(
  signal: TrackedSignal,
  observation: SignalObservation | undefined,
  now: string,
): SignalPerformanceCheckpoint[] {
  const currentPrice = observation?.snapshot?.price;
  const nowMs = Date.parse(now);
  const checkpoints = signal.performance?.length
    ? signal.performance
    : newPerformance(signal.createdAt);
  return checkpoints.map((checkpoint) => {
    if (checkpoint.state !== "PENDING") return checkpoint;
    const targetMs = Date.parse(checkpoint.targetAt);
    if (nowMs < targetMs) return checkpoint;
    const window = PERFORMANCE_WINDOWS[checkpoint.horizon];
    const lagMinutes = Math.round((nowMs - targetMs) / 60_000);
    if (currentPrice != null && lagMinutes <= window.toleranceMinutes) {
      return {
        ...checkpoint,
        sampledAt: now,
        lagMinutes,
        sampledPrice: currentPrice,
        returnPct: priceChangeSinceSignal(
          signal.direction,
          signal.baseline.price,
          currentPrice,
        ),
        state: "OBSERVED",
      };
    }
    if (lagMinutes > window.toleranceMinutes) {
      return { ...checkpoint, lagMinutes, state: "MISSED" };
    }
    return checkpoint;
  });
}

export function transitionSignalStore(
  previous: SignalStoreDocument | null,
  observations: SignalObservation[],
  settings: SignalSettings,
  now = new Date().toISOString(),
): SignalStoreDocument {
  const nowMs = Date.parse(now);
  const byKey = new Map(
    observations.map((item) => [`${item.symbol}:${item.direction}`, item]),
  );
  const updated: TrackedSignal[] = [];

  for (const signal of previous?.signals ?? []) {
    const observation = byKey.get(`${signal.symbol}:${signal.direction}`);
    const withPerformance = {
      ...signal,
      performance: updatePerformance(signal, observation, now),
    };
    if (
      ["EXPIRED", "INVALIDATED"].includes(signal.status) &&
      nowMs - Date.parse(signal.lastEvaluatedAt) > TERMINAL_RETENTION_MS
    ) {
      continue;
    }
    if (nowMs >= Date.parse(signal.expiresAt) && signal.status !== "INVALIDATED") {
      updated.push({
        ...withPerformance,
        status: "EXPIRED",
        alertPriority: "ACTIVE",
        events: appendEvent(signal, "EXPIRED", now),
      });
      continue;
    }
    if (["EXPIRED", "INVALIDATED"].includes(signal.status)) {
      updated.push(withPerformance);
      continue;
    }

    if (!observation?.snapshot) {
      updated.push({ ...withPerformance, evaluationState: "DATA_UNAVAILABLE" });
      continue;
    }
    const current = observation.snapshot;
    const baseline =
      signal.baseline.scoreModel === "expectancy-v1"
        ? signal.baseline
        : {
            ...current,
            price: signal.baseline.price,
            observedAt: signal.baseline.observedAt,
          };
    const priceChangePct = priceChangeSinceSignal(
      signal.direction,
      baseline.price,
      current.price,
    );
    const peakFavorablePct = Math.max(signal.peakFavorablePct, priceChangePct, 0);
    const deterioration = scoreDeterioration(baseline, current, signal.direction);
    const takeProfit = scoreTakeProfit({
      priceChangePct,
      peakFavorablePct,
      deterioration,
      exitAlert: current.exitAlert,
      reversal: current.reversal,
    });
    const next = statusFor({
      settings,
      baseline,
      current,
      priceChangePct,
      deterioration,
      takeProfit,
    });
    updated.push({
      ...withPerformance,
      display: observation.display,
      baseline,
      current,
      lastEvaluatedAt: now,
      lastQualifiedAt: qualifiesForTracking(observation, settings)
        ? now
        : signal.lastQualifiedAt,
      evaluationState: "AVAILABLE",
      peakFavorablePct,
      priceChangePct,
      deteriorationScore: deterioration,
      takeProfitScore: takeProfit,
      status: next.status,
      alertPriority: next.priority,
      events: appendEvent(signal, next.status, now),
    });
  }

  const existingKeys = new Set(
    updated
      .filter((item) => !["EXPIRED", "INVALIDATED"].includes(item.status))
      .map((item) => `${item.symbol}:${item.direction}`),
  );
  const admissions = observations
    .filter((item) => qualifiesForTracking(item, settings) && item.snapshot)
    .sort(
      (a, b) =>
        (b.snapshot?.entry ?? 0) - (a.snapshot?.entry ?? 0) ||
        (b.snapshot?.timing ?? 0) - (a.snapshot?.timing ?? 0),
    )
    .slice(0, settings.topN ?? undefined);

  for (const observation of admissions) {
    const key = `${observation.symbol}:${observation.direction}`;
    if (existingKeys.has(key) || !observation.snapshot) continue;
    const expiresAt = new Date(
      nowMs + settings.durationHours * 60 * 60_000,
    ).toISOString();
    updated.push({
      id: idFor(observation, now),
      symbol: observation.symbol,
      display: observation.display,
      direction: observation.direction,
      createdAt: now,
      lastQualifiedAt: now,
      lastEvaluatedAt: now,
      expiresAt,
      evaluationState: "AVAILABLE",
      baseline: observation.snapshot,
      current: observation.snapshot,
      peakFavorablePct: 0,
      priceChangePct: 0,
      deteriorationScore: 0,
      takeProfitScore: 0,
      status: "NEW",
      alertPriority: "ACTIVE",
      events: [{ at: now, from: null, to: "NEW" }],
      performance: newPerformance(now),
    });
    existingKeys.add(key);
  }

  return { version: 1, settings, signals: updated.slice(-250), updatedAt: now };
}
