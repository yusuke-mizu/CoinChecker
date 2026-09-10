import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/copy/product";

export function ProductDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-[10px] leading-5 text-zinc-500">
        表示は過去データに基づく推定です。将来の損益を約束しません。自動売買は行いません。
        レバレッジ取引は証拠金を超える損失が出ることがあります。投資判断はご自身の責任で行ってください。
        詳細は
        <Link href="/notice" className="mx-1 underline decoration-zinc-600 underline-offset-2">
          注意事項
        </Link>
        を必ずお読みください。
      </p>
    );
  }

  return (
    <footer className="border-t border-zinc-800 px-4 py-6 text-[11px] leading-6 text-zinc-500">
      <div className="mx-auto max-w-6xl space-y-2">
        <p>
          {PRODUCT_NAME}は相場の読み取りを補助するツールであり、投資助言・売買推奨・運用代行ではありません。
          画面の「条件は揃っている」は発注指示ではありません。確率・期待値・推奨SL/TP/レバレッジは推定値です。
        </p>
        <p>
          暗号資産の先物・レバレッジ取引は、短時間で大きく値動きし、預けた証拠金を超える損失が出ることがあります。
        </p>
        <p>
          <Link href="/notice" className="underline decoration-zinc-600 underline-offset-2">
            注意事項・免責
          </Link>
        </p>
      </div>
    </footer>
  );
}
