import type { SymbolAnalysis } from "@/lib/types/scoring";

function byLong(a: SymbolAnalysis, b: SymbolAnalysis): number {
  return (b.long?.total ?? -1) - (a.long?.total ?? -1);
}

function byShort(a: SymbolAnalysis, b: SymbolAnalysis): number {
  return (b.short?.total ?? -1) - (a.short?.total ?? -1);
}

export function applyRanks(rows: SymbolAnalysis[]): SymbolAnalysis[] {
  const scored = rows.filter((row) => row.status === "ok" && row.long && row.short);
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
    .filter((row) => row.status === "ok" && row.long)
    .sort(byLong)
    .slice(0, limit);
}

export function topShort(rows: SymbolAnalysis[], limit = 5): SymbolAnalysis[] {
  return [...rows]
    .filter((row) => row.status === "ok" && row.short)
    .sort(byShort)
    .slice(0, limit);
}
