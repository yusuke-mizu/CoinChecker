import { discoverBtccUsdtSymbols } from "@/lib/exchanges/btcc";
import {
  fetchAllVenueContracts,
  fetchSourcedTickers,
  mergeContracts,
  pickVenue,
} from "@/lib/market-data/venue-router";
import { assessAggregateDataQuality, emptyProvenance } from "@/lib/analysis/availability";
import { toDisplaySymbol } from "@/lib/market-data/provider";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type {
  BtccCandidate,
  PerpetualContract,
  SourceAttribution,
  TickerSnapshot,
  UsdtSymbol,
} from "@/lib/types/market";
import type { CandleVenue } from "@/lib/types/venue";

const CACHE_KEY = "universe-btcc-candidates-v2";
const CACHE_MS = 5 * 60_000;
const PRIORITY = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];

export type UniverseResult = {
  candidates: BtccCandidate[];
  symbols: string[];
  tickers: Record<string, TickerSnapshot>;
  contracts: Record<string, PerpetualContract>;
  venues: Record<string, CandleVenue>;
  btccCount: number;
  skippedNoVenue: number;
  skippedNoOkx: number;
  skippedSpotOrNonPerp: number;
  source: string;
  warning: string | null;
  error: string | null;
};

function sortUniverse(symbols: string[], venues: Record<string, CandleVenue>): string[] {
  return [...symbols].sort((a, b) => {
    const pa = PRIORITY.indexOf(a);
    const pb = PRIORITY.indexOf(b);
    if (pa !== -1 || pb !== -1) {
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    }
    const va = venues[a] ? 0 : 1;
    const vb = venues[b] ? 0 : 1;
    if (va !== vb) return va - vb;
    return a.localeCompare(b);
  });
}

export async function loadUniverse(force = false): Promise<UniverseResult> {
  if (!force) {
    const cached = getTtlCache<UniverseResult>(CACHE_KEY);
    if (cached) return cached;
  }

  const [btccResult, coverage, tickerResult] = await Promise.all([
    discoverBtccUsdtSymbols()
      .then((discoveries) => ({ discoveries, error: null as string | null }))
      .catch((error) => ({
        discoveries: [],
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchAllVenueContracts(),
    fetchSourcedTickers(),
  ]);

  const venues: Record<string, CandleVenue> = {};
  let selected: string[] = [];
  let skippedNoVenue = 0;
  let warning: string | null = null;
  const source = "coingecko-btcc-third-party discovery; ohlcv: okx|bybit|binance complement";

  if (btccResult.discoveries.length > 0) {
    for (const discovery of btccResult.discoveries) {
      selected.push(discovery.symbol.symbol);
      const venue = pickVenue(discovery.symbol.symbol, coverage);
      if (venue) {
        venues[discovery.symbol.symbol] = venue;
      } else {
        skippedNoVenue += 1;
      }
    }
    warning =
      skippedNoVenue > 0
        ? `BTCC候補は全件表示します。うち ${skippedNoVenue} 件は同名の公開USDT-M足が無く採点できません。Discoveryは第三者情報、足は OKX → Bybit → Binance の補完データです。`
        : "対象はCoinGeckoで発見したBTCC候補です。BTCC公式確認ではなく、足は OKX → Bybit → Binance の補完データです。";
  } else {
    warning =
      "BTCC候補の第三者Discoveryに失敗しました。OKX銘柄をBTCC銘柄として代用しないため、一覧は空です。" +
      (btccResult.error ? ` ${btccResult.error}` : "");
  }

  selected = sortUniverse(selected, venues);
  const contracts = mergeContracts(coverage, venues);
  const tickers: Record<string, TickerSnapshot> = {};
  const discoveryBySymbol = new Map(
    btccResult.discoveries.map((item) => [item.symbol.symbol, item]),
  );
  for (const discovery of btccResult.discoveries) {
    const row = discovery.symbol;
    const snap = tickerResult.tickers[row.symbol];
    if (snap) {
      tickers[row.symbol] = snap;
    } else if (row.lastPrice != null) {
      tickers[row.symbol] = {
        last: row.lastPrice,
        change24hPct: null,
        high24h: null,
        low24h: null,
        volume24h: row.volume,
      };
    }
  }
  for (const symbol of selected) {
    if (!tickers[symbol] && tickerResult.tickers[symbol]) {
      tickers[symbol] = tickerResult.tickers[symbol];
    }
  }

  const candidates: BtccCandidate[] = selected.map((symbol) => {
    const discovery = discoveryBySymbol.get(symbol);
    const venue = venues[symbol] ?? null;
    const listing = discovery?.evidence ? [discovery.evidence] : [];
    const tickerSource: SourceAttribution | null = tickerResult.sources[symbol]
      ? tickerResult.sources[symbol]
      : discovery?.symbol.lastPrice != null
        ? {
            provider: "coingecko",
            label: "CoinGecko BTCC ticker (third-party)",
            observedAt: discovery.evidence.observedAt,
            url: discovery.evidence.url,
            note: "BTCC perpetual market dataではありません",
          }
        : null;
    const provenance = emptyProvenance(listing);
    provenance.ticker = tickerSource;
    return {
      symbol,
      display: toDisplaySymbol(symbol),
      listingVerification: "THIRD_PARTY_CONFIRMED",
      contract: "UNKNOWN",
      availability: venue ? "MARKET_DATA_AVAILABLE" : "DISCOVERED",
      marketVenue: venue,
      ticker: tickers[symbol] ?? null,
      complementContract: contracts[symbol] ?? null,
      sources: provenance,
      dataQuality: assessAggregateDataQuality({
        validTimeframes: [],
        hasTicker: Boolean(tickers[symbol]),
        hasOi: false,
        hasFunding: false,
      }),
      discoveredAt: discovery?.evidence.observedAt ?? new Date().toISOString(),
      discoveryWarnings: [
        ...(discovery?.warnings ?? []),
        "第三者情報によるBTCC銘柄候補。BTCC公式・Perpetual確定ではありません。",
      ],
    };
  });

  const result: UniverseResult = {
    candidates,
    symbols: selected,
    tickers,
    contracts,
    venues,
    btccCount: btccResult.discoveries.length,
    skippedNoVenue,
    skippedNoOkx: skippedNoVenue,
    skippedSpotOrNonPerp: 0,
    source,
    warning,
    error: btccResult.error,
  };

  return setTtlCache(CACHE_KEY, result, CACHE_MS);
}

export function toUsdtSymbol(symbol: string): UsdtSymbol {
  const compact = symbol.replace(/[-_/]/g, "").toUpperCase();
  return {
    symbol: compact,
    base: compact.endsWith("USDT") ? compact.slice(0, -4) : compact,
    quote: "USDT",
    display: toDisplaySymbol(compact),
    sourceId: "universe",
    lastPrice: null,
    volume: null,
  };
}
