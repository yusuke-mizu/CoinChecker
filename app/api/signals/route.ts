import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/json-error";
import { transitionSignalStore } from "@/lib/scoring/signal-tracking";
import { readSignalStore, writeSignalStore } from "@/lib/server/signal-store";
import type {
  SignalObservation,
  SignalScoreSnapshot,
  SignalSettings,
  TrackingDurationHours,
} from "@/lib/types/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 1_000_000;
const MAX_OBSERVATIONS = 500;
const DURATIONS = new Set([6, 12, 24, 48, 168]);
const VENUES = new Set(["okx", "bybit", "binance"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= Date.now() + 5 * 60_000;
}

function parseSnapshot(value: unknown): SignalScoreSnapshot | null {
  if (!record(value)) return null;
  const scored = [
    value.entry,
    value.oppositeEntry,
    value.timing,
    value.oppositeTiming,
    value.trend,
    value.expectedMove,
    value.range,
    value.drift,
    value.reversal,
    value.dataQuality,
    value.exitAlert,
    value.chasingPenalty,
  ];
  if (!scored.every(score)) return null;
  if (value.scoreModel !== "expectancy-v1") return null;
  for (const metric of [value.potentialRewardPct, value.potentialRiskPct, value.rewardRisk]) {
    if (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0 || metric > 100) return null;
  }
  if (typeof value.entryType !== "string" || value.entryType.length > 40) return null;
  if (typeof value.entryDecision !== "string" || value.entryDecision.length > 40) return null;
  for (const metric of [value.overheat, value.oversold, value.compoundingQuality]) {
    if (metric != null && !score(metric)) return null;
  }
  for (const price of [
    value.entryZoneLow,
    value.entryZoneHigh,
    value.structureStop,
    value.hardStop,
    value.invalidationLevel,
    value.breakoutLevel,
    value.target1,
    value.target2,
  ]) {
    if (price != null && (typeof price !== "number" || !Number.isFinite(price) || price <= 0)) return null;
  }
  if (
    value.riskTier != null &&
    !["LOW RISK", "MEDIUM RISK", "HIGH RISK", "EXTREME RISK"].includes(String(value.riskTier))
  ) return null;
  if (value.futures != null && !score(value.futures)) return null;
  if (typeof value.price !== "number" || !Number.isFinite(value.price) || value.price <= 0) return null;
  if (!["up", "down", "none"].includes(String(value.driftSide))) return null;
  if (value.btcCorrelation != null && (
    typeof value.btcCorrelation !== "number" ||
    !Number.isFinite(value.btcCorrelation) ||
    value.btcCorrelation < -1 ||
    value.btcCorrelation > 1
  )) return null;
  if (value.btcBeta != null && (
    typeof value.btcBeta !== "number" ||
    !Number.isFinite(value.btcBeta) ||
    value.btcBeta < -5 ||
    value.btcBeta > 5
  )) return null;
  if (value.confidence != null && !["HIGH", "MEDIUM", "LOW"].includes(String(value.confidence))) return null;
  if (value.marketVenue != null && !VENUES.has(String(value.marketVenue))) return null;
  if (typeof value.signalLabel !== "string" || value.signalLabel.length > 80) return null;
  if (!timestamp(value.observedAt)) return null;
  if (!Array.isArray(value.reasons) || value.reasons.length > 8 || value.reasons.some(
    (item) => typeof item !== "string" || item.length > 160,
  )) return null;
  return value as SignalScoreSnapshot;
}

function parseObservations(value: unknown): SignalObservation[] | null {
  if (!Array.isArray(value) || value.length > MAX_OBSERVATIONS) return null;
  const parsed: SignalObservation[] = [];
  for (const item of value) {
    if (!record(item)) return null;
    if (typeof item.symbol !== "string" || !/^[A-Z0-9]{2,30}USDT$/.test(item.symbol)) return null;
    if (typeof item.display !== "string" || item.display.length > 60) return null;
    if (!["LONG", "SHORT"].includes(String(item.direction))) return null;
    if (typeof item.isDominant !== "boolean") return null;
    if (typeof item.scoringAvailable !== "boolean") return null;
    if (item.regime != null && (typeof item.regime !== "string" || item.regime.length > 40)) return null;
    const snapshot = item.snapshot == null ? null : parseSnapshot(item.snapshot);
    if (item.snapshot != null && !snapshot) return null;
    parsed.push({
      symbol: item.symbol,
      display: item.display,
      direction: item.direction as "LONG" | "SHORT",
      isDominant: item.isDominant,
      scoringAvailable: item.scoringAvailable,
      regime: item.regime as string | null,
      snapshot,
    });
  }
  return parsed;
}

function parseSettings(value: unknown, current: SignalSettings): SignalSettings | null {
  if (!record(value)) return null;
  const next = { ...current };
  if (typeof value.enabled === "boolean") next.enabled = value.enabled;
  if (value.entryThreshold !== undefined) {
    if (!score(value.entryThreshold)) return null;
    next.entryThreshold = Math.round(value.entryThreshold);
  }
  if (value.strongEntryThreshold !== undefined) {
    if (!score(value.strongEntryThreshold)) return null;
    next.strongEntryThreshold = Math.round(value.strongEntryThreshold);
  }
  if (value.watchEntryThreshold !== undefined) {
    if (!score(value.watchEntryThreshold)) return null;
    next.watchEntryThreshold = Math.round(value.watchEntryThreshold);
  }
  if (value.timingThreshold !== undefined) {
    if (!score(value.timingThreshold)) return null;
    next.timingThreshold = Math.round(value.timingThreshold);
  }
  if (value.topN !== undefined) {
    if (value.topN !== null && (
      typeof value.topN !== "number" ||
      !Number.isInteger(value.topN) ||
      value.topN < 1 ||
      value.topN > 100
    )) return null;
    next.topN = value.topN;
  }
  if (value.durationHours !== undefined) {
    if (typeof value.durationHours !== "number" || !DURATIONS.has(value.durationHours)) return null;
    next.durationHours = value.durationHours as TrackingDurationHours;
  }
  if (value.portfolioProtectionCount !== undefined) {
    if (
      typeof value.portfolioProtectionCount !== "number" ||
      !Number.isInteger(value.portfolioProtectionCount) ||
      value.portfolioProtectionCount < 2 ||
      value.portfolioProtectionCount > 20
    ) return null;
    next.portfolioProtectionCount = value.portfolioProtectionCount;
  }
  if (value.setLeverage !== undefined) {
    if (
      typeof value.setLeverage !== "number" ||
      !Number.isInteger(value.setLeverage) ||
      value.setLeverage < 1 ||
      value.setLeverage > 20
    ) return null;
    next.setLeverage = value.setLeverage;
  }
  if (value.hardStopPct !== undefined) {
    if (
      typeof value.hardStopPct !== "number" ||
      !Number.isFinite(value.hardStopPct) ||
      value.hardStopPct < 1 ||
      value.hardStopPct > 25
    ) return null;
    next.hardStopPct = Math.round(value.hardStopPct * 10) / 10;
  }
  if (next.strongEntryThreshold <= next.watchEntryThreshold) return null;
  return next;
}

const noStore = { "cache-control": "no-store" };

export async function GET() {
  try {
    const document = await readSignalStore();
    return NextResponse.json({ success: true, ...document }, { headers: noStore });
  } catch (error) {
    return apiError(error, "Signal metadata unavailable", 503);
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ success: false, error: "Request too large" }, { status: 413 });
    }
    const body = await request.json().catch(() => null);
    const observations = record(body) ? parseObservations(body.observations) : null;
    if (!observations) {
      return NextResponse.json({ success: false, error: "Invalid observations" }, { status: 400 });
    }
    const previous = await readSignalStore();
    const next = transitionSignalStore(previous, observations, previous.settings);
    await writeSignalStore(next);
    return NextResponse.json({ success: true, ...next }, { status: 201, headers: noStore });
  } catch (error) {
    return apiError(error, "Signal metadata update failed", 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const previous = await readSignalStore();
    const settings = parseSettings(body, previous.settings);
    if (!settings) {
      return NextResponse.json({ success: false, error: "Invalid signal settings" }, { status: 400 });
    }
    const next = { ...previous, settings, updatedAt: new Date().toISOString() };
    await writeSignalStore(next);
    return NextResponse.json({ success: true, ...next }, { headers: noStore });
  } catch (error) {
    return apiError(error, "Signal settings update failed", 503);
  }
}
