import { pctChange, percentileRank, zScore } from "@/lib/scoring/stats";
import type {
  FuturesPositioning,
  OiChangeBand,
  PositioningStructure,
  TimeframeIndicators,
} from "@/lib/types/scoring";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function bandFromAbsPct(pct: number | null, z: number | null): OiChangeBand {
  if (pct == null) return "UNAVAILABLE";
  const abs = Math.abs(pct);
  const zAbs = z == null ? 0 : Math.abs(z);
  if (zAbs >= 2.5 || abs >= 10) return "EXTREME";
  if (zAbs >= 1.5 || abs >= 5) return "HIGH";
  if (zAbs >= 1 || abs >= 2) return "NOTICE";
  return "NORMAL";
}

export function computeFuturesPositioning(input: {
  oiHistory: Array<{ ts: number; oi: number; oiUsd: number | null }>;
  fundingRate: number | null;
  fundingNextTime: number | null;
  fundingHistory: number[];
  tf1h: TimeframeIndicators | null;
  tf15m: TimeframeIndicators | null;
  tf4h: TimeframeIndicators | null;
}): FuturesPositioning {
  const oiHist = input.oiHistory;
  const availableOi = oiHist.length >= 4;
  const last = availableOi ? oiHist[oiHist.length - 1] : null;
  const at = (barsAgo: number) =>
    availableOi && oiHist.length > barsAgo ? oiHist[oiHist.length - 1 - barsAgo].oi : null;
  const oiChange15mPct = last && at(3) != null ? pctChange(last.oi, at(3) as number) : null;
  const oiChange1hPct = last && at(12) != null ? pctChange(last.oi, at(12) as number) : null;
  const oiChange4hPct = last && at(48) != null ? pctChange(last.oi, at(48) as number) : null;
  const prev15 = last && at(6) != null && at(3) != null ? pctChange(at(3) as number, at(6) as number) : null;
  const oiAccel =
    oiChange15mPct != null && prev15 != null ? oiChange15mPct - prev15 : null;
  const oiReturns: number[] = [];
  if (oiHist.length >= 8) {
    for (let i = 3; i < oiHist.length; i += 1) {
      const ch = pctChange(oiHist[i].oi, oiHist[i - 3].oi);
      if (ch != null) oiReturns.push(ch);
    }
  }
  const oiZScore = oiChange15mPct != null ? zScore(oiReturns, oiChange15mPct) : null;
  const oiPercentile = oiChange15mPct != null ? percentileRank(oiReturns, oiChange15mPct) : null;
  const oiBand = bandFromAbsPct(oiChange1hPct ?? oiChange15mPct, oiZScore);

  const availableFunding = input.fundingRate != null || input.fundingHistory.length > 0;
  const fundingRate = input.fundingRate ?? (input.fundingHistory[0] ?? null);
  const fundingChange =
    fundingRate != null && input.fundingHistory.length > 1
      ? fundingRate - input.fundingHistory[1]
      : null;
  const fundingPercentile =
    fundingRate != null && input.fundingHistory.length >= 8
      ? percentileRank(input.fundingHistory, fundingRate)
      : null;
  const fundingZScore =
    fundingRate != null && input.fundingHistory.length >= 8
      ? zScore(input.fundingHistory, fundingRate)
      : null;

  const priceChange1hPct =
    input.tf1h?.lastClose != null && input.tf1h.prevClose != null
      ? pctChange(input.tf1h.lastClose, input.tf1h.prevClose)
      : null;

  const priceUp = (priceChange1hPct ?? 0) > 0.15;
  const priceDown = (priceChange1hPct ?? 0) < -0.15;
  const oiUp = (oiChange1hPct ?? oiChange15mPct ?? 0) > 0.4;
  const oiDown = (oiChange1hPct ?? oiChange15mPct ?? 0) < -0.4;
  const volSpike = (input.tf15m?.volumeRatio ?? 0) >= 1.5;
  const fundPos = fundingRate != null && fundingRate > 0;
  const fundNeg = fundingRate != null && fundingRate < 0;
  const longHot = (fundingPercentile ?? 50) >= 90;
  const shortHot = (fundingPercentile ?? 50) <= 10;
  const rsiOs = (input.tf15m?.rsi ?? 50) <= 30;
  const rsiOb = (input.tf15m?.rsi ?? 50) >= 70;

  const flags: string[] = [];
  let structure: PositioningStructure = "NEUTRAL";
  if (!availableOi) {
    structure = "UNAVAILABLE";
  } else if (priceUp && oiUp) {
    structure = longHot ? "LONG OVERCROWDED" : "LONG BUILDUP";
  } else if (priceUp && oiDown) {
    structure = "SHORT COVERING / SQUEEZE CANDIDATE";
  } else if (priceDown && oiUp) {
    structure = shortHot ? "SHORT OVERCROWDED" : "SHORT BUILDUP";
  } else if (priceDown && oiDown) {
    structure = "LONG LIQUIDATION CANDIDATE";
  }

  if (structure === "LONG LIQUIDATION CANDIDATE" && volSpike && rsiOs) {
    flags.push("LONG LIQUIDATION CANDIDATE");
  }
  if (structure === "SHORT COVERING / SQUEEZE CANDIDATE" && volSpike && fundNeg) {
    flags.push("SHORT SQUEEZE CANDIDATE");
  }
  if (longHot && structure === "LONG BUILDUP") flags.push("LONG OVERCROWDED");
  if (shortHot && structure === "SHORT BUILDUP") flags.push("SHORT OVERCROWDED");
  if ((oiChange1hPct ?? 0) >= 10 && volSpike) flags.push("OI EXPLOSION");

  let oiMomentum = 0;
  if (availableOi) {
    const mag = Math.abs(oiChange1hPct ?? oiChange15mPct ?? 0);
    oiMomentum += mag >= 10 ? 18 : mag >= 5 ? 14 : mag >= 2 ? 8 : 4;
    if ((oiAccel ?? 0) > 1) oiMomentum += 4;
    if ((oiAccel ?? 0) < -1) oiMomentum += 3;
  }
  oiMomentum = clamp(oiMomentum, 0, 25);

  let fundingBias = 0;
  if (availableFunding && fundingRate != null) {
    const p = fundingPercentile ?? 50;
    fundingBias += p > 55 && p < 85 ? 12 : p >= 85 ? 8 : p < 45 && p > 15 ? 12 : p <= 15 ? 8 : 6;
    if (fundingChange != null && Math.abs(fundingChange) > 0.00005) fundingBias += 5;
    else fundingBias += 2;
  }
  fundingBias = clamp(fundingBias, 0, 25);

  let priceOi = 0;
  if (availableOi && priceChange1hPct != null) {
    if (priceDown && oiDown) priceOi = 22;
    else if (priceUp && oiDown) priceOi = 20;
    else if (priceUp && oiUp) priceOi = 18;
    else if (priceDown && oiUp) priceOi = 18;
    else priceOi = 8;
  }
  priceOi = clamp(priceOi, 0, 25);

  let liquidation = 0;
  if (availableOi) {
    if (oiDown && volSpike) liquidation += 10;
    if (Math.abs(priceChange1hPct ?? 0) >= 1.2) liquidation += 5;
    if (longHot || shortHot) liquidation += 4;
    if (rsiOs || rsiOb) liquidation += 3;
    if ((input.tf15m?.lowerWick ?? 0) >= 0.45 || (input.tf15m?.upperWick ?? 0) >= 0.45) {
      liquidation += 3;
    }
  }
  liquidation = clamp(liquidation, 0, 25);

  const partMax = 25 * (availableFunding ? 4 : 3);
  const raw = availableFunding
    ? oiMomentum + fundingBias + priceOi + liquidation
    : oiMomentum + priceOi + liquidation;
  const score = partMax > 0 ? clamp(Math.round((raw / partMax) * 100), 0, 100) : 0;

  let longPoints = 0;
  const longNotes: string[] = [];
  if (availableOi && priceUp && oiUp) {
    longPoints += 8;
    longNotes.push("Price UP + OI UP");
  }
  if (availableOi && priceUp && oiDown) {
    longPoints += 7;
    longNotes.push("Price UP + OI DOWN (covering)");
  }
  if (availableFunding && fundingRate != null && fundingRate >= 0 && (fundingPercentile ?? 50) < 90) {
    longPoints += 5;
    longNotes.push("Funding 中立〜適度なプラス");
  }
  if (longHot) {
    longPoints -= 5;
    longNotes.push("Funding percentile ≥90 過熱 -5");
  }
  if (oiUp && Math.abs(priceChange1hPct ?? 0) < 0.15) {
    longPoints -= 4;
    longNotes.push("OI急増だが価格が伸びない");
  }
  longPoints = clamp(longPoints, 0, 20);

  let shortPoints = 0;
  const shortNotes: string[] = [];
  if (availableOi && priceDown && oiUp) {
    shortPoints += 8;
    shortNotes.push("Price DOWN + OI UP");
  }
  if (availableOi && priceDown && oiDown) {
    shortPoints += 7;
    shortNotes.push("Price DOWN + OI DOWN (liquidation)");
  }
  if (availableFunding && fundingRate != null && fundingRate <= 0 && (fundingPercentile ?? 50) > 10) {
    shortPoints += 5;
    shortNotes.push("Funding 中立〜適度なマイナス");
  }
  if (shortHot) {
    shortPoints -= 5;
    shortNotes.push("Funding percentile ≤10 squeeze risk -5");
  }
  if (oiUp && priceDown && Math.abs(priceChange1hPct ?? 0) < 0.15) {
    shortPoints -= 4;
    shortNotes.push("OI急増＋下落幅が小さい");
  }
  shortPoints = clamp(shortPoints, 0, 20);

  if (!availableOi && !availableFunding) {
    longPoints = 0;
    shortPoints = 0;
    longNotes.push("OI unavailable / Funding unavailable");
    shortNotes.push("OI unavailable / Funding unavailable");
  }

  const narrativeJa =
    structure === "LONG BUILDUP"
      ? "上昇方向への新規ポジション形成が確認されているが、Funding上昇によるLong overcrowdingには注意"
      : structure === "LONG OVERCROWDED"
        ? "ロングが積み上がりつつ過熱。トレンド継続と清算リスクを分けて見る"
        : structure === "SHORT BUILDUP"
          ? "下落方向へ新規ショートが増えている可能性"
          : structure === "SHORT OVERCROWDED"
            ? "ショート過密。下落継続とショートスクイーズの両方に注意"
            : structure === "LONG LIQUIDATION CANDIDATE"
              ? "価格下落＋OI減少。ロング清算の可能性。短期リバウンドにも注意"
              : structure === "SHORT COVERING / SQUEEZE CANDIDATE"
                ? "価格上昇＋OI減少。ショートカバー/スクイーズの可能性"
                : structure === "UNAVAILABLE"
                  ? "OI unavailable。Funding も欠ける場合は先物スコアを無効化して再正規化する"
                  : "Price / OI / Funding の関係は中立寄り";

  return {
    availableOi,
    availableFunding,
    currentOi: last?.oi ?? null,
    oiUsd: last?.oiUsd ?? null,
    oiChange15mPct,
    oiChange1hPct,
    oiChange4hPct,
    oiAccel,
    oiBand,
    oiZScore,
    oiPercentile,
    fundingRate,
    fundingNextTime: input.fundingNextTime,
    fundingChange,
    fundingPercentile,
    fundingZScore,
    priceChange1hPct,
    structure,
    narrativeJa,
    score,
    oiMomentum,
    fundingBias: availableFunding ? fundingBias : 0,
    priceOi,
    liquidation,
    flags,
    longPoints,
    shortPoints,
    longReason: longNotes.join(" / ") || "Futures positioning 中立",
    shortReason: shortNotes.join(" / ") || "Futures positioning 中立",
  };
}

export function unavailableFutures(): FuturesPositioning {
  return computeFuturesPositioning({
    oiHistory: [],
    fundingRate: null,
    fundingNextTime: null,
    fundingHistory: [],
    tf1h: null,
    tf15m: null,
    tf4h: null,
  });
}
