import { NO_PUBLIC_PERP } from "@/lib/analysis/listed-only";
import type {
  PositioningStructure,
  ReversalSide,
  SignalLabel,
  SymbolAnalysis,
  TrendLabel,
} from "@/lib/types/scoring";

export type Advice = {
  tag: string;
  action: string;
  why: string;
};

export function adviceFor(row: SymbolAnalysis): Advice {
  const rev = row.reversal?.signal ?? "NO REVERSAL";
  if (row.dataSource === NO_PUBLIC_PERP) {
    return {
      tag: "掲載のみ",
      action: "一覧には出すが、今は採点できない。",
      why: "BTCCには載っているが、公開USDT-Mの足が無い（OKX / Bybit / Binance）。",
    };
  }
  if (row.setup) {
    return {
      tag: row.setup.headline,
      action: row.setup.action,
      why: row.setup.why,
    };
  }
  if (row.status !== "ok") {
    return {
      tag: "データ不足",
      action: "今は判断しない",
      why: "足が足りないか取得失敗です。スコアは参考にしないでください。",
    };
  }
  if (row.signal === "SHORT-TERM REVERSAL CANDIDATE" || rev === "BULLISH REVERSAL" || rev === "BEARISH REVERSAL") {
    if (rev === "BULLISH REVERSAL") {
      return {
        tag: "反転（上）",
        action: "売りの保有は縮小・決済を検討。新規の買いは小さく。",
        why: "下落の途中で跳ね上がりやすい形です。トレンド転換の確定ではありません。",
      };
    }
    if (rev === "BEARISH REVERSAL") {
      return {
        tag: "反転（下）",
        action: "買いの保有は利確・縮小を検討。新規の買いは見送り寄り。",
        why: "上昇の途中で落ちやすい形です。まだトレンド継続の可能性もあります。",
      };
    }
    return {
      tag: "短期反転",
      action: "新規エントリーは控えめ。持っているならサイズ縮小を検討。",
      why: "先物の清算・カバーの匂いが強い一方、大きなトレンドはまだ弱いです。",
    };
  }
  if (row.signal.includes("LONG") && (row.difference ?? 0) > 12) {
    const strong = row.signal.includes("VERY") || row.signal.includes("STRONG");
    return {
      tag: strong ? "買い 強め" : row.signal.includes("WATCH") ? "買い 監視" : "買い 検討",
      action: strong
        ? "ロング候補。ただし一気に張らず、逆行10%ルールは別で見る。"
        : "ロングを検討してよいが、確定シグナルではない。",
      why: row.bias === "LONG優勢" ? "買い側の点が高い" : row.bias === "SHORT優勢" ? "売り側の点が高い" : row.bias ?? "買い側の点が高い",
    };
  }
  if (row.signal.includes("SHORT") && (row.difference ?? 0) < -12) {
    const strong = row.signal.includes("VERY") || row.signal.includes("STRONG");
    return {
      tag: strong ? "売り 強め" : row.signal.includes("WATCH") ? "売り 監視" : "売り 検討",
      action: strong
        ? "ショート候補。スクイーズには注意。逆行10%ルールは別で見る。"
        : "ショートを検討してよいが、確定シグナルではない。",
      why: row.bias === "SHORT優勢" ? "売り側の点が高い" : row.bias === "LONG優勢" ? "買い側の点が高い" : row.bias ?? "売り側の点が高い",
    };
  }
  if (row.signal.includes("CONFLICT")) {
    return {
      tag: "見送り",
      action: "売買しない。方向が食い違っています。",
      why: "買い点も売り点も高く、どっちつかずです。",
    };
  }
  return {
    tag: "見送り",
    action: "今は触らない方がいい。",
    why: "買いも売りも材料が足りないか、差が小さいです。",
  };
}

export function signalJa(signal: SignalLabel | string): string {
  switch (signal) {
    case "VERY STRONG LONG CANDIDATE":
      return "買い 強め";
    case "STRONG LONG CANDIDATE":
      return "買い 検討";
    case "LONG CANDIDATE":
      return "買い 候補";
    case "WATCH LONG":
      return "買い 監視";
    case "VERY STRONG SHORT CANDIDATE":
      return "売り 強め";
    case "STRONG SHORT CANDIDATE":
      return "売り 検討";
    case "SHORT CANDIDATE":
      return "売り 候補";
    case "WATCH SHORT":
      return "売り 監視";
    case "SHORT-TERM REVERSAL CANDIDATE":
      return "短期反転";
    case "CONFLICT / NO SIGNAL":
      return "見送り（矛盾）";
    case "NO SIGNAL":
      return "見送り";
    case "DATA INSUFFICIENT":
      return "データ不足";
    case "DATA ERROR":
      return "データエラー";
    default:
      return signal;
  }
}

export function reversalJa(side: ReversalSide | string | null | undefined): string {
  if (side === "BULLISH REVERSAL") return "反転↑ 売りの人は注意";
  if (side === "BEARISH REVERSAL") return "反転↓ 買いの人は注意";
  if (side === "NO REVERSAL") return "反転なし";
  return "—";
}

export function trendJa(trend: TrendLabel | string | null | undefined): string {
  switch (trend) {
    case "Strong Bullish":
      return "強い上昇";
    case "Bullish":
      return "上昇";
    case "Range":
      return "横ばい";
    case "Bearish":
      return "下落";
    case "Strong Bearish":
      return "強い下落";
    case "Unknown":
      return "不明";
    default:
      return trend ?? "—";
  }
}

export function futuresJa(structure: PositioningStructure | string | null | undefined): string {
  switch (structure) {
    case "LONG BUILDUP":
      return "買い増し中（新規ロングが増えている）";
    case "SHORT BUILDUP":
      return "売り増し中（新規ショートが増えている）";
    case "LONG LIQUIDATION CANDIDATE":
      return "買い清算の匂い（落ちながら建玉減）";
    case "SHORT COVERING / SQUEEZE CANDIDATE":
      return "売り決済・スクイーズの匂い";
    case "LONG OVERCROWDED":
      return "買い過密（加熱）";
    case "SHORT OVERCROWDED":
      return "売り過密（スクイーズ注意）";
    case "NEUTRAL":
      return "先物は中立";
    case "UNAVAILABLE":
      return "OIが取れていない";
    default:
      return structure ?? "—";
  }
}

export function riskJa(level: string): string {
  switch (level) {
    case "NORMAL":
      return "通常";
    case "CAUTION":
      return "警戒";
    case "HIGH RISK":
      return "高リスク（サイズ縮小を検討）";
    case "VERY HIGH RISK":
      return "かなり危険（新規は慎重に）";
    case "EXTREME":
      return "極度（新規は見送り推奨）";
    default:
      return level;
  }
}

export function macdJa(bias: string | null | undefined): string {
  if (bias === "Bullish") return "上向き";
  if (bias === "Bearish") return "下向き";
  if (bias === "Neutral") return "中立";
  return "—";
}

export function sideJa(side: string): string {
  if (side === "LONG") return "買い";
  if (side === "SHORT") return "売り";
  return side;
}

export function alertTypeJa(type: string): string {
  if (type === "ENTRY") return "新規";
  if (type === "REVERSAL") return "反転";
  if (type === "EXIT") return "決済検討";
  return type;
}

export function flagJa(flag: string): string {
  switch (flag) {
    case "LONG LIQUIDATION CANDIDATE":
      return "買い清算の匂い";
    case "SHORT SQUEEZE CANDIDATE":
      return "売りスクイーズの匂い";
    case "LONG OVERCROWDED":
      return "買い過密";
    case "SHORT OVERCROWDED":
      return "売り過密";
    case "OI EXPLOSION":
      return "建玉急増";
    default:
      return futuresJa(flag);
  }
}

export function exitLevelJa(level: string | null | undefined): string {
  switch (level) {
    case "CRITICAL":
      return "かなり危険";
    case "HIGH ALERT":
      return "危険";
    case "CAUTION":
      return "警戒";
    case "WATCH":
      return "監視";
    case "NORMAL":
      return "通常";
    default:
      return level ?? "—";
  }
}
