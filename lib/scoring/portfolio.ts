import type { ExitAlert, MarketRisk, TimeframeIndicators } from "@/lib/types/scoring";

export type PortfolioRisk = {
  longCount: number;
  shortCount: number;
  highExitCount: number;
  total: number;
  level: "NORMAL" | "ELEVATED" | "VERY HIGH";
  message: string;
};

export function computePortfolioRisk(input: {
  sides: Array<"LONG" | "SHORT">;
  exits: ExitAlert[];
  btc4h: TimeframeIndicators | null;
  marketRisk: MarketRisk | null;
}): PortfolioRisk {
  const longCount = input.sides.filter((s) => s === "LONG").length;
  const shortCount = input.sides.filter((s) => s === "SHORT").length;
  const total = input.sides.length;
  const highExitCount = input.exits.filter((e) => e.score >= 70).length;
  const btcBear =
    input.btc4h?.trend === "Bearish" || input.btc4h?.trend === "Strong Bearish";
  const frac = total ? highExitCount / total : 0;
  let level: PortfolioRisk["level"] = "NORMAL";
  if (total >= 3 && frac >= 0.6 && (btcBear || (input.marketRisk?.score ?? 0) >= 60)) {
    level = "VERY HIGH";
  } else if (total >= 2 && frac >= 0.4) {
    level = "ELEVATED";
  }
  const message =
    level === "VERY HIGH"
      ? "PORTFOLIO EXIT RISK: VERY HIGH — 複数銘柄のEXITとBTC方向が重なっています。自動決済はしません。"
      : level === "ELEVATED"
        ? "保有のうち EXIT HIGH 以上の比率が高めです。優先順位を確認してください。"
        : "バスケット全体のEXIT偏りは通常範囲です。";
  return { longCount, shortCount, highExitCount, total, level, message };
}
