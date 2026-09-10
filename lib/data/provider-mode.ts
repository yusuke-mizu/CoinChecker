export type ProviderMode = "btcc" | "okx" | "mock";

export function getProviderMode(): ProviderMode {
  const raw = (process.env.DATA_PROVIDER ?? process.env.NEXT_PUBLIC_DATA_PROVIDER ?? "okx").toLowerCase();
  if (raw === "btcc") return "btcc";
  if (raw === "mock") return "mock";
  return "okx";
}

export function dataSourceDisplay(mode: ProviderMode = getProviderMode()): {
  label: string;
  testMode: boolean;
  detail: string;
} {
  if (mode === "btcc") {
    return {
      label: "DATA SOURCE: BTCC",
      testMode: false,
      detail: "本番はBTCC USDT-M公式データ。認証がない場合はこの表示になりません。",
    };
  }
  if (mode === "mock") {
    return {
      label: "参考データ（デモ）",
      testMode: true,
      detail: "確認用のダミーデータです。実際の相場ではありません。",
    };
  }
  return {
    label: "公開先物データ（参考）",
    testMode: false,
    detail: "公開されているUSDT建て先物の足を使っています。特定取引所の公式推奨ではありません。",
  };
}
