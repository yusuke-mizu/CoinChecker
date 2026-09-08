import type { SymbolAnalysis } from "@/lib/types/scoring";

function byLong(a: SymbolAnalysis, b: SymbolAnalysis): number {
  return (
    (b.entryExpectancy.long?.total ?? -1) - (a.entryExpectancy.long?.total ?? -1) ||
    (b.entryExpectancy.long?.expectedMoveScore ?? -1) -
      (a.entryExpectancy.long?.expectedMoveScore ?? -1) ||
    a.symbol.localeCompare(b.symbol)
  );
}

function byShort(a: SymbolAnalysis, b: SymbolAnalysis): number {
  return (
    (b.entryExpectancy.short?.total ?? -1) - (a.entryExpectancy.short?.total ?? -1) ||
    (b.entryExpectancy.short?.expectedMoveScore ?? -1) -
      (a.entryExpectancy.short?.expectedMoveScore ?? -1) ||
    a.symbol.localeCompare(b.symbol)
  );
}

export function applyRanks(rows: SymbolAnalysis[]): SymbolAnalysis[] {
  const scored = rows.filter(
    (row) =>
      row.availability === "SCORING_AVAILABLE" &&
      row.rankingEligible &&
      row.status === "ok" &&
      row.entryExpectancy.long &&
      row.entryExpectancy.short,
  );
  const longOrder = [...scored].sort(byLong);
  const shortOrder = [...scored].sort(byShort);
  const longRank = new Map(longOrder.map((row, index) => [row.symbol, index + 1]));
  const shortRank = new Map(shortOrder.map((row, index) => [row.symbol, index + 1]));
  return rows.map((row) => ({
    ...row,
    rankLong: longRank.get(row.symbol) ?? null,
    rankShort: shortRank.get(row.symbol) ?? null,
  }));
}

export function topLong(rows: SymbolAnalysis[], limit = 5): SymbolAnalysis[] {
  return [...rows]
    .filter((row) => row.rankingEligible && row.availability === "SCORING_AVAILABLE" && row.entryExpectancy.long)
    .sort(byLong)
    .slice(0, limit);
}

export function topShort(rows: SymbolAnalysis[], limit = 5): SymbolAnalysis[] {
  return [...rows]
    .filter((row) => row.rankingEligible && row.availability === "SCORING_AVAILABLE" && row.entryExpectancy.short)
    .sort(byShort)
    .slice(0, limit);
}

export function topTiming(rows: SymbolAnalysis[], limit = 5): SymbolAnalysis[] {
  return [...rows]
    .filter((row) => row.rankingEligible && row.availability === "SCORING_AVAILABLE" && row.timing)
    .sort((a, b) => (b.timing?.score ?? 0) - (a.timing?.score ?? 0))
    .slice(0, limit);
}

export function topReversal(
  rows: SymbolAnalysis[],
  side: "bullish" | "bearish",
  limit = 5,
): SymbolAnalysis[] {
  return [...rows]
    .filter(
      (row) => row.rankingEligible && row.availability === "SCORING_AVAILABLE" && row.reversal,
    )
    .sort((a, b) =>
      side === "bullish"
        ? (b.reversal?.bullish ?? 0) - (a.reversal?.bullish ?? 0)
        : (b.reversal?.bearish ?? 0) - (a.reversal?.bearish ?? 0),
    )
    .slice(0, limit);
}
