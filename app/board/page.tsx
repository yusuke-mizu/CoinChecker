import type { Metadata } from "next";
import { OpportunityBoard } from "@/components/opportunity/OpportunityBoard";
import { PRODUCT_NAME } from "@/lib/copy/product";

export const metadata: Metadata = {
  title: `エントリーボード | ${PRODUCT_NAME}`,
  description:
    "今の価格からLONG / SHORTした場合の到達見込みと損切目安を一覧します。投資助言ではありません。",
};

export default function BoardPage() {
  return <OpportunityBoard />;
}
