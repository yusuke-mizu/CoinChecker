import type { Candle, CoreTimeframe } from "@/lib/types/market";

export function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function formatCorr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function signalClass(signal: string): string {
  if (signal.includes("DATA")) return "text-rose-300 border-rose-500/40 bg-rose-500/10";
  if (signal.includes("CONFLICT") || signal === "NO SIGNAL") {
    return "text-zinc-300 border-zinc-500/40 bg-zinc-500/10";
  }
  if (signal.includes("REVERSAL")) return "text-amber-200 border-amber-400/50 bg-amber-400/10";
  if (signal.includes("VERY STRONG")) return "text-amber-200 border-amber-400/50 bg-amber-400/10";
  if (signal.includes("SHORT")) return "text-rose-200 border-rose-400/40 bg-rose-400/10";
  if (signal.includes("LONG")) return "text-emerald-200 border-emerald-400/40 bg-emerald-400/10";
  if (signal.includes("WATCH")) return "text-yellow-200 border-yellow-400/40 bg-yellow-400/10";
  return "text-zinc-300 border-zinc-500/40 bg-zinc-500/10";
}

export function riskClass(level: string): string {
  if (level.includes("EXTREME") || level.includes("CRITICAL") || level === "VERY HIGH RISK") {
    return "text-rose-200 border-rose-500/50 bg-rose-500/15";
  }
  if (level.includes("HIGH")) return "text-orange-200 border-orange-500/40 bg-orange-500/10";
  if (level.includes("CAUTION") || level === "WATCH") {
    return "text-amber-200 border-amber-500/40 bg-amber-500/10";
  }
  if (level === "VERY HIGH") return "text-rose-200 border-rose-500/50 bg-rose-500/15";
  return "text-emerald-200 border-emerald-500/40 bg-emerald-500/10";
}

export type OhlcvPayload = {
  symbol: string;
  timeframe: CoreTimeframe;
  candles: Candle[];
  ema20: Array<number | null>;
  ema50: Array<number | null>;
  ema200: Array<number | null>;
};
