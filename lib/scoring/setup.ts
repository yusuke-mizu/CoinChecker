import type { DirectionScore, ReversalAssessment } from "@/lib/types/scoring";
import type { RegimeSnapshot } from "@/lib/scoring/regime";
import type { TimingAssessment } from "@/lib/scoring/entry-timing";

export type SetupKind =
  | "STRONG_WINDOW"
  | "ENTRY_WAIT"
  | "RANGE_NO_ENTRY"
  | "RANGE_BREAKOUT"
  | "RANGE_DRIFT"
  | "PULLBACK"
  | "REVERSAL_RISK"
  | "NEUTRAL";

export type SetupVerdict = {
  kind: SetupKind;
  headline: string;
  action: string;
  why: string;
};

export function confidenceFrom(input: {
  hasOi: boolean;
  hasFunding: boolean;
  tfCount: number;
}): "HIGH" | "MEDIUM" | "LOW" {
  if (input.tfCount < 2) return "LOW";
  if (!input.hasOi || !input.hasFunding) return "MEDIUM";
  return "HIGH";
}

export function nextEntryWindow(timing: TimingAssessment, regime: RegimeSnapshot): {
  label: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
} {
  if (timing.score >= 70) {
    return {
      label: "いまの窓（タイミング点が高い）",
      confidence: "MEDIUM",
      reasons: ["現在の足・出来高がエントリー条件に近い。未来の価格予測ではない。"],
    };
  }
  const hour = (new Date().getUTCHours() + 9) % 24;
  const next = hour < 16 ? "16:00〜20:00 JST" : hour < 20 ? "20:00〜24:00 JST" : "翌08:00〜12:00 JST";
  return {
    label: next,
    confidence: "LOW",
    reasons: [
      "時間帯の過去統計は未配線のため履歴不足。",
      regime.regime === "TRENDING" ? "大きな方向は残っている可能性" : "Regimeがレンジ/移行なら待ち寄り",
      "未来の価格を当てる機能ではない。",
    ],
  };
}

export function decideSetup(input: {
  long: DirectionScore;
  short: DirectionScore;
  regime: RegimeSnapshot;
  timing: TimingAssessment;
  reversal: ReversalAssessment;
  tf4hTrend?: string;
  tf1hTrend?: string;
  tf15mTrend?: string;
}): SetupVerdict {
  const entry = Math.max(input.long.total, input.short.total);
  const side = input.long.total >= input.short.total ? "買い" : "売り";
  const { regime, timing, reversal } = input;

  if (regime.rangeScore >= 80 && !regime.breakout) {
    if (regime.driftScore >= 74) {
      return {
        kind: "RANGE_DRIFT",
        headline: "レンジ＋一方向Drift",
        action: "新規は基本見送り。ブレイクか10%ルールまで様子。",
        why: `Range ${regime.rangeScore} / Drift ${regime.driftScore}（${regime.driftSide}）`,
      };
    }
    return {
      kind: "RANGE_NO_ENTRY",
      headline: "RANGE — NO ENTRY",
      action: "レンジ。新規エントリーは基本しない。",
      why: `Range ${regime.rangeScore}。確定シグナルではない。`,
    };
  }

  if (regime.rangeScore >= 80 && regime.breakout) {
    return {
      kind: "RANGE_BREAKOUT",
      headline: "RANGE BREAKOUT CANDIDATE",
      action: `${side}のブレイク候補として監視。まだ確定ではない。`,
      why: "レンジ高 + 出来高/OIの拡張。",
    };
  }

  const pullback =
    (input.tf4hTrend?.includes("Bull") &&
      input.tf1hTrend?.includes("Bull") &&
      (input.tf15mTrend === "Range" || input.tf15mTrend?.includes("Bear"))) ||
    (input.tf4hTrend?.includes("Bear") &&
      input.tf1hTrend?.includes("Bear") &&
      (input.tf15mTrend === "Range" || input.tf15mTrend?.includes("Bull")));

  const revHigh = Math.max(reversal.bullish, reversal.bearish);
  if (pullback && revHigh >= 70) {
    return {
      kind: "REVERSAL_RISK",
      headline: "押し目ではなく反転リスク",
      action: "押し目買い/売りにしない。サイズ縮小を検討。",
      why: "上位足の方向と短期悪化が同時。",
    };
  }
  if (pullback && timing.score >= 55 && entry >= 70) {
    return {
      kind: "PULLBACK",
      headline: "PULLBACK ENTRY CANDIDATE",
      action: "押し目の監視。転換確定ではない。",
      why: "4H/1Hは方向あり、15Mは一時的な逆行。",
    };
  }

  if (entry >= 70 && timing.score < 50) {
    return {
      kind: "ENTRY_WAIT",
      headline: "ENTRY WAIT",
      action: `銘柄は${side}候補だが、今のタイミングは待つ。`,
      why: timing.waitReasons.slice(0, 4).join(" / ") || `Entry ${entry} / Timing ${timing.score}`,
    };
  }

  if (entry >= 70 && timing.score >= 70) {
    return {
      kind: "STRONG_WINDOW",
      headline: timing.score >= 80 ? "STRONG ENTRY WINDOW" : "GOOD ENTRY WINDOW",
      action: `${side}候補 + 今の窓。確定シグナルではない。`,
      why: `Entry ${entry} / Timing ${timing.score}`,
    };
  }

  return {
    kind: "NEUTRAL",
    headline: timing.label,
    action: "材料が中途半端。無理に触らない方がいい。",
    why: `Entry ${entry} / Timing ${timing.score} / ${regime.regime}`,
  };
}
