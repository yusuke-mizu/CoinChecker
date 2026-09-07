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
      label: "DATA SOURCE: MOCK / TEST MODE",
      testMode: true,
      detail: "開発用のダミーデータです。BTCCの相場ではありません。",
    };
  }
  return {
    label: "DATA SOURCE: OKX / TEST MODE",
    testMode: true,
    detail: "公開OKX USDT-M足で採点しています。BTCCの公式データとして表示していません。",
  };
}
