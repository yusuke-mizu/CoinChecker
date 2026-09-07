export const DATA_SOURCE_NOTES = [
  "TradingView has no public market-data REST API. Scraping TradingView is prohibited by their Terms of Service.",
  "BTCC official symbol list (GET /v1/config/symbollist) and klines (ReqKline) require authenticated login. This app does not call order/position APIs.",
  "CoinGecko BTCC USDT names are all listed. If the same name has a public USDT-M perp on OKX/Bybit/Binance, it is scored. Otherwise it stays visible as listed-only (no candles, no score). BTCC official klines still require login.",
  "OI history: OKX GET /api/v5/rubik/stat/contracts/open-interest-history (5m). Funding: GET /api/v5/public/funding-rate and funding-rate-history. Missing OI/Funding does not stop analysis; those buckets are marked unavailable and scores are renormalized. No guessed values.",
  "BTC dominance comes from CoinGecko /global (spot snapshot, not a dominance trend series).",
];

export const DISCLAIMER =
  "This is a trade decision support tool. It never places, cancels, or manages orders. Displayed labels are candidates, not buy/sell instructions.";
