import { PUBLIC_VERDICT } from "@/lib/copy/product";
import type { OpportunityVerdict } from "@/lib/types/opportunity";

export const VERDICT_ICON: Record<OpportunityVerdict, string> = {
  "ENTER NOW": "●",
  "GOOD BUT WAIT": "●",
  "WAIT FOR PULLBACK": "●",
  "NO ENTRY": "●",
};

export const VERDICT_LABEL: Record<OpportunityVerdict, string> = {
  "ENTER NOW": PUBLIC_VERDICT["ENTER NOW"],
  "GOOD BUT WAIT": PUBLIC_VERDICT["GOOD BUT WAIT"],
  "WAIT FOR PULLBACK": PUBLIC_VERDICT["WAIT FOR PULLBACK"],
  "NO ENTRY": PUBLIC_VERDICT["NO ENTRY"],
};

export function verdictClass(verdict: OpportunityVerdict): string {
  switch (verdict) {
    case "ENTER NOW":
      return "text-emerald-200 border-emerald-400/50 bg-emerald-400/10";
    case "GOOD BUT WAIT":
      return "text-yellow-200 border-yellow-400/40 bg-yellow-400/10";
    case "WAIT FOR PULLBACK":
      return "text-orange-200 border-orange-400/40 bg-orange-400/10";
    default:
      return "text-rose-200 border-rose-400/40 bg-rose-400/10";
  }
}

export function stars(count: number): string {
  return `${"★".repeat(Math.max(0, Math.min(5, count)))}${"☆".repeat(
    Math.max(0, 5 - Math.max(0, Math.min(5, count))),
  )}`;
}

export function starLabel(verdict: OpportunityVerdict, count: number): string {
  if (verdict === "NO ENTRY") return "見送り";
  if (count >= 5) return "条件は揃っている";
  if (count >= 4) return "候補";
  if (count >= 3) return "条件付き";
  return "様子見";
}
