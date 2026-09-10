import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";
import { ProductDisclaimer } from "@/components/product/ProductDisclaimer";
import { ProductNav } from "@/components/product/ProductNav";
import { PRODUCT_NAME } from "@/lib/copy/product";

export const metadata: Metadata = {
  title: `詳細分析 | ${PRODUCT_NAME}`,
  description: "銘柄ごとの詳細な参考指標。投資助言・自動売買ではありません。",
};

export default function AnalysisPage() {
  return (
    <div className="min-h-full">
      <ProductNav />
      <Dashboard />
      <ProductDisclaimer />
    </div>
  );
}
