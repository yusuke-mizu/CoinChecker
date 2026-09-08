import type { Metadata } from "next";
import { ModelLab } from "@/components/model/ModelLab";

export const metadata: Metadata = {
  title: "Model / Calibration",
  description: "予測モデルの学習状況と、出した確率が実績と一致しているかの検証",
};

export default function ModelPage() {
  return <ModelLab />;
}
