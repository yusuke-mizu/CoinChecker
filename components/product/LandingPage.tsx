import Link from "next/link";
import { ProductDisclaimer } from "./ProductDisclaimer";
import { ProductNav } from "./ProductNav";
import {
  PRODUCT_NAME,
  PRODUCT_ONE_LINER,
  PRODUCT_PRICE_LABEL,
  PRODUCT_PRICE_NOTE,
  PRODUCT_TAGLINE,
} from "@/lib/copy/product";

const INCLUDED = [
  "複数のUSDT建て先物をまとめて一覧するエントリーボード",
  "LONG と SHORT を別々に見た、到達見込み・損切見込み・期待値",
  "時間帯ごとの到達見込み（15分〜数時間）",
  "その場の価格から見たSL / TP / 保有時間の目安",
  "詳細分析と、仮説を確認するためのシミュレーション",
];

const NOT_INCLUDED = [
  "利益が出ること、勝率が安定することの保証",
  "自動売買・自動注文・シグナル配信の運用代行",
  "「今すぐ買え / 売れ」という投資助言",
  "元本保証、損失補填、返金による運用損の穴埋め",
  "特定の取引所での口座開設や入金の代行",
];

export function LandingPage() {
  return (
    <div className="min-h-full">
      <ProductNav />
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-10">
        <section className="space-y-4">
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">読み取り専用の判断支援</p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">{PRODUCT_NAME}</h1>
          <p className="text-base text-zinc-300">{PRODUCT_TAGLINE}</p>
          <p className="text-sm leading-7 text-zinc-400">{PRODUCT_ONE_LINER}</p>
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-4">
            <div>
              <p className="text-[11px] text-zinc-500">販売価格</p>
              <p className="text-3xl font-semibold tabular-nums text-zinc-50">{PRODUCT_PRICE_LABEL}</p>
              <p className="text-[11px] text-zinc-500">{PRODUCT_PRICE_NOTE}。追加課金はありません。</p>
            </div>
            <p className="max-w-sm text-[12px] leading-6 text-zinc-400">
              この金額でお渡しするのは分析画面の利用です。相場で増えるお金ではありません。
              購入前に下の「できないこと」を必ず確認してください。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/board"
              className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white"
            >
              ボードを開く
            </Link>
            <Link
              href="/notice"
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
            >
              注意事項を読む
            </Link>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-[0.12em] text-zinc-200">できること</h2>
          <ul className="space-y-2 text-sm leading-6 text-zinc-400">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-zinc-600">・</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold tracking-[0.12em] text-amber-100">
            できないこと（ここを読み飛ばさないでください）
          </h2>
          <ul className="space-y-2 text-sm leading-6 text-zinc-300">
            {NOT_INCLUDED.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-amber-500/80">・</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] leading-6 text-zinc-400">
            数字が高く見えても、見送りが正しいことがあります。候補がゼロ件でも、ツールの不具合ではありません。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-[0.12em] text-zinc-200">使い方</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-400">
            <li>エントリーボードで銘柄を読み込みます。</li>
            <li>期待値・到達見込み・損切見込みを見比べます。確率が高い順だけを信じないでください。</li>
            <li>気になる銘柄を開き、時間帯とSL / TPの目安を確認します。</li>
            <li>実弾の前に、少額またはシミュレーションで自分のルールと照らしてください。</li>
          </ol>
        </section>

        <section className="space-y-2 text-[12px] leading-6 text-zinc-500">
          <h2 className="text-sm font-semibold tracking-[0.12em] text-zinc-300">購入にあたって</h2>
          <p>
            販売価格は {PRODUCT_PRICE_LABEL}（{PRODUCT_PRICE_NOTE}）です。決済方法・販売者情報は、お求めの販売ページに記載があります。
          </p>
          <p>
            デジタル商品のため、内容を確認したうえでのご購入をお願いします。相場で損失が出ても、代金の返金対象にはなりません。
            商品説明と提供内容が明らかに異なる場合は、販売者へご連絡ください。
          </p>
        </section>
      </main>
      <ProductDisclaimer />
    </div>
  );
}
