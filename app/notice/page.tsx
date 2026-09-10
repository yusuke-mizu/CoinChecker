import type { Metadata } from "next";
import Link from "next/link";
import { ProductDisclaimer } from "@/components/product/ProductDisclaimer";
import { ProductNav } from "@/components/product/ProductNav";
import { PRODUCT_NAME } from "@/lib/copy/product";

export const metadata: Metadata = {
  title: `注意事項 | ${PRODUCT_NAME}`,
  description: "投資助言ではないこと、損失の可能性を明示した注意事項です。",
};

export default function NoticePage() {
  return (
    <div className="min-h-full">
      <ProductNav />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 text-sm leading-7 text-zinc-400">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">注意事項・免責</h1>
          <p className="mt-2">
            利用前に必ずお読みください。ここを読まずに実弾取引を始めることはおすすめしません。
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-zinc-200">1. これは投資助言ではありません</h2>
          <p>
            {PRODUCT_NAME}{" "}
            は、公開されている相場データをもとに到達見込みや損切目安を整理するツールです。
            特定の銘柄の購入・売却・保有を勧めるものではありません。画面の判定は発注指示ではありません。
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-zinc-200">2. 損失が出ることがあります</h2>
          <p>
            暗号資産の先物・レバレッジ取引は値動きが大きく、短時間で証拠金の大半、あるいは証拠金を超える損失が出ることがあります。
            表示している確率は過去の似た局面からの推定であり、次の値動きを当てるものではありません。
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-zinc-200">3. 数字の扱い</h2>
          <p>
            期待値や到達見込みは目安です。入金額やレバレッジの根拠にしないでください。
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-zinc-200">4. 自動では発注しません</h2>
          <p>
            注文、決済、資金移動、リバース、コピートレードは行いません。取引所の口座・APIキーも不要です。
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-zinc-200">5. データの限界</h2>
          <p>
            足データは公開されている先物市場のものを使います。流動性が薄い銘柄、欠損のある銘柄は表示から外れます。
            手数料・スリッページ・資金調達率の見積もりは目安であり、実際の約定とは異なります。
          </p>
        </section>

        <p>
          <Link href="/" className="text-zinc-200 underline decoration-zinc-600 underline-offset-2">
            ボードへ戻る
          </Link>
        </p>
      </main>
      <ProductDisclaimer />
    </div>
  );
}
