export const DATA_SOURCE_NOTES = [
  "TradingView has no public market-data REST API. Scraping TradingView is prohibited by their Terms of Service.",
  "BTCC official symbol list (GET /v1/config/symbollist) and klines (ReqKline) require authenticated login. This app does not call order/position APIs.",
  "USDT symbols are loaded from CoinGecko public BTCC exchange tickers (paginated, order=base_target). Phase 1-3 scores BTC first; later phases intersect that list with OKX USDT SWAP for OHLCV.",
  "OHLCV and 24h ticker come from OKX public SWAP market data for the same USDT instrument.",
  "BTC dominance comes from CoinGecko /global (spot snapshot, not a dominance trend series).",
];

export const DISCLAIMER =
  "This is a trade decision support tool. It never places, cancels, or manages orders. Displayed labels are candidates, not buy/sell instructions.";
