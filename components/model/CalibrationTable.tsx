import type { CalibrationBin } from "@/lib/types/prediction";

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

/**
 * Predicted probability against realised frequency.
 *
 * The gap column is the point of the whole screen: it answers whether a stated
 * 64% behaved like a 64%. Bins with too few samples are shown greyed rather
 * than hidden, because an empty bin is itself information about coverage.
 */
export function CalibrationTable({
  bins,
  emptyLabel = "まだ十分な件数がありません",
}: {
  bins: CalibrationBin[];
  emptyLabel?: string;
}) {
  const populated = bins.filter((bin) => bin.count > 0);
  if (populated.length === 0) {
    return <p className="text-[11px] text-zinc-500">{emptyLabel}</p>;
  }
  const maxCount = Math.max(...populated.map((bin) => bin.count));

  return (
    <table className="w-full text-[11px]">
      <thead className="text-zinc-500">
        <tr className="border-b border-zinc-800">
          <th className="py-1 text-left font-normal">予測確率帯</th>
          <th className="py-1 text-right font-normal">予測平均</th>
          <th className="py-1 text-right font-normal">実績確率</th>
          <th className="py-1 text-right font-normal">乖離</th>
          <th className="py-1 text-right font-normal">件数</th>
          <th className="py-1 pl-2 text-left font-normal">分布</th>
        </tr>
      </thead>
      <tbody className="font-mono text-zinc-300">
        {populated.map((bin) => {
          const gap = bin.actual - bin.predicted;
          const thin = bin.count < 30;
          return (
            <tr key={bin.lower} className="border-b border-zinc-900">
              <td className={`py-1 ${thin ? "text-zinc-600" : "text-zinc-400"}`}>
                {pct(bin.lower)}–{pct(bin.upper)}
              </td>
              <td className="py-1 text-right">{(bin.predicted * 100).toFixed(1)}%</td>
              <td className="py-1 text-right">{(bin.actual * 100).toFixed(1)}%</td>
              <td
                className={`py-1 text-right ${
                  Math.abs(gap) < 0.03
                    ? "text-emerald-300"
                    : Math.abs(gap) < 0.08
                      ? "text-amber-300"
                      : "text-rose-300"
                }`}
              >
                {gap >= 0 ? "+" : ""}
                {(gap * 100).toFixed(1)}pt
              </td>
              <td className="py-1 text-right text-zinc-400">{bin.count.toLocaleString()}</td>
              <td className="py-1 pl-2">
                <span
                  className="inline-block h-1.5 rounded bg-zinc-600"
                  style={{ width: `${Math.max(2, (bin.count / maxCount) * 100)}%` }}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
