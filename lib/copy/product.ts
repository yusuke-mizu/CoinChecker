/** Public-facing product copy. Keep claims modest so a buyer is not sold a profit. */
export const PRODUCT_NAME = "Coin Checker";
export const PRODUCT_TAGLINE = "今この価格から入った場合の、短期の到達見込みを整理する";
export const PRODUCT_PRICE_YEN = 2980;
export const PRODUCT_PRICE_LABEL = "2,980円";
export const PRODUCT_PRICE_NOTE = "税込・買い切り";

export const PRODUCT_ONE_LINER =
  "暗号資産USDT建て先物について、いまの価格からLONG / SHORTした場合の到達見込み・損切目安・期待値を一覧する、読み取り専用の判断支援ツールです。";

export function formatYen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

export const PUBLIC_NAV = [
  { href: "/", label: "商品案内" },
  { href: "/board", label: "エントリーボード" },
  { href: "/analysis", label: "詳細分析" },
  { href: "/simulation", label: "シミュレーション" },
  { href: "/notice", label: "注意事項" },
] as const;

/** Verdict text shown to buyers. Internal codes stay unchanged. */
export const PUBLIC_VERDICT: Record<string, string> = {
  "ENTER NOW": "条件は揃っている",
  "GOOD BUT WAIT": "もう少し待つ",
  "WAIT FOR PULLBACK": "押し目を待つ",
  "NO ENTRY": "見送り",
};

export const INTERNAL_NOTE_MARKERS = [
  "学習モデル",
  "フォールバック",
  "未公開",
  "検証",
  "EMPIRICAL",
  "BLENDED",
  "LEARNED",
];

export function isPublicNote(note: string): boolean {
  return !INTERNAL_NOTE_MARKERS.some((marker) => note.includes(marker));
}
