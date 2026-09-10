import type { Metadata } from "next";
import { SimulationLab } from "@/components/simulation/SimulationLab";
import { ProductDisclaimer } from "@/components/product/ProductDisclaimer";
import { ProductNav } from "@/components/product/ProductNav";
import { PRODUCT_NAME } from "@/lib/copy/product";

export const metadata: Metadata = {
  title: `シミュレーション | ${PRODUCT_NAME}`,
  description: "仮説を過去データで確認するための参考環境です。将来の成績は保証しません。",
};

export default function SimulationPage() {
  return (
    <div className="min-h-full">
      <ProductNav />
      <SimulationLab />
      <ProductDisclaimer />
    </div>
  );
}
