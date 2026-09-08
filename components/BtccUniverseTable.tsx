"use client";

import type { BtccCandidate } from "@/lib/types/market";
import type { SymbolAnalysis } from "@/lib/types/scoring";

export function BtccUniverseTable({
  candidates,
  analyses,
  mode,
  onMode,
  onSelect,
}: {
  candidates: BtccCandidate[];
  analyses: Map<string, SymbolAnalysis>;
  mode: "all" | "confirmed";
  onMode: (mode: "all" | "confirmed") => void;
  onSelect: (row: SymbolAnalysis) => void;
}) {
  const filtered = candidates.filter(
    (candidate) => mode === "all" || candidate.listingVerification !== "DISCOVERED",
  );
  const scoring = filtered.filter(
    (candidate) => analyses.get(candidate.symbol)?.availability === "SCORING_AVAILABLE",
  );
  const unavailable = filtered.filter(
    (candidate) => analyses.get(candidate.symbol)?.availability !== "SCORING_AVAILABLE",
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">BTCC監視対象</h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            Listing確認は第三者情報です。BTCC公式・USDT-M Perpetual確定を意味しません。
          </p>
        </div>
        <div className="flex gap-1">
          {(["all", "confirmed"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onMode(key)}
              className={`h-8 rounded-md px-3 text-xs ${
                mode === key
                  ? "bg-zinc-100 text-zinc-950"
                  : "border border-zinc-700 text-zinc-400"
              }`}
            >
              {key === "all" ? "All Discovered" : "Confirmed Only"}
            </button>
          ))}
        </div>
      </div>

      <CandidateTable title="SCORING AVAILABLE" rows={scoring} analyses={analyses} onSelect={onSelect} />
      <CandidateTable title="DATA UNAVAILABLE / LIMITED" rows={unavailable} analyses={analyses} onSelect={onSelect} />
    </section>
  );
}

function CandidateTable({
  title,
  rows,
  analyses,
  onSelect,
}: {
  title: string;
  rows: BtccCandidate[];
  analyses: Map<string, SymbolAnalysis>;
  onSelect: (row: SymbolAnalysis) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-[11px] tracking-[0.14em] text-zinc-400">
        {title} ({rows.length})
      </div>
      <table className="w-full min-w-[1180px] text-left text-xs">
        <thead className="bg-zinc-900/70 text-[10px] uppercase text-zinc-500">
          <tr>
            {[
              "Symbol",
              "BTCC Listing",
              "Contract",
              "Market Data",
              "OI",
              "Funding",
              "Data Source",
              "Data Quality",
              "LONG",
              "SHORT",
              "Entry Timing",
              "Status",
            ].map((label) => (
              <th key={label} className="px-2 py-2 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={12} className="px-3 py-5 text-center text-zinc-500">該当銘柄なし</td>
            </tr>
          ) : (
            rows.map((candidate) => {
              const analysis = analyses.get(candidate.symbol);
              const quality = analysis?.dataQuality ?? candidate.dataQuality;
              const availability = analysis?.availability ?? candidate.availability;
              const selectable = Boolean(analysis);
              return (
                <tr
                  key={candidate.symbol}
                  onClick={() => analysis && onSelect(analysis)}
                  className={`border-t border-zinc-800 ${selectable ? "cursor-pointer hover:bg-zinc-900/80" : ""}`}
                >
                  <td className="px-2 py-2 font-mono text-zinc-100">{candidate.display}</td>
                  <td className="px-2 py-2 text-amber-200">
                    {candidate.listingVerification === "OFFICIAL_CONFIRMED"
                      ? "✓ OFFICIAL"
                      : candidate.listingVerification === "THIRD_PARTY_CONFIRMED"
                        ? "△ THIRD-PARTY"
                        : "? DISCOVERED"}
                  </td>
                  <td className="px-2 py-2">{candidate.contract}</td>
                  <td className="px-2 py-2">
                    {availability === "DISCOVERED" ? "UNAVAILABLE" : "✓ AVAILABLE"}
                  </td>
                  <td className="px-2 py-2">{analysis?.futures?.availableOi ? "✓" : "N/A"}</td>
                  <td className="px-2 py-2">{analysis?.futures?.availableFunding ? "✓" : "N/A"}</td>
                  <td className="px-2 py-2 text-[10px] text-zinc-400">
                    <div>
                      Listing:{" "}
                      {candidate.sources.listing
                        .map((source) => source.provider.toUpperCase())
                        .join(" / ") || "N/A"}
                    </div>
                    <div>OHLCV: {analysis?.sources.ohlcv?.provider.toUpperCase() ?? candidate.marketVenue?.toUpperCase() ?? "N/A"}</div>
                    <div>OI: {analysis?.sources.oi?.provider.toUpperCase() ?? "N/A"}</div>
                    <div>Funding: {analysis?.sources.funding?.provider.toUpperCase() ?? "N/A"}</div>
                  </td>
                  <td className="px-2 py-2 font-mono">
                    {quality.score} <span className="text-zinc-500">/100 {quality.band}</span>
                  </td>
                  <td className="px-2 py-2 font-mono text-emerald-300">{analysis?.entryExpectancy.long?.total ?? "N/A"}</td>
                  <td className="px-2 py-2 font-mono text-rose-300">{analysis?.entryExpectancy.short?.total ?? "N/A"}</td>
                  <td className="px-2 py-2 font-mono">{analysis?.timing?.score ?? "N/A"}</td>
                  <td className="px-2 py-2 text-[10px]">
                    {availability === "SCORING_AVAILABLE"
                      ? analysis?.confidence ?? "AVAILABLE"
                      : availability === "MARKET_DATA_AVAILABLE"
                        ? "LIMITED"
                        : "DATA UNAVAILABLE"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
