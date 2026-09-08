"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { readApiJson } from "@/lib/client/api-json";
import type { LiveCalibration } from "@/lib/model/live-calibration";
import type {
  DirectionModel,
  ModelSummary,
  OutcomeModel,
  TrainedModel,
} from "@/lib/types/prediction";
import { CalibrationTable } from "./CalibrationTable";

type ModelResponse = {
  active: string | null;
  model: TrainedModel | null;
  versions: ModelSummary[];
};

type PredictionsResponse = {
  calibration: LiveCalibration;
  resolvedNow: number;
  total: number;
  updatedAt: string;
};

type TrainResponse = {
  version: string;
  summary: ModelSummary;
  elapsedMs: number;
  notes: string[];
};

const HEAD_LABEL: Record<OutcomeModel["outcome"], string> = {
  REACH: "到達確率（TPに触れるか）",
  TARGET: "TP先着確率",
  STOP: "SL先着確率",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 px-2.5 py-2">
      <p className="text-[10px] text-zinc-500">{label}</p>
      <p className="font-mono text-[13px] text-zinc-100">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-zinc-600">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h2 className="text-[11px] font-semibold tracking-[0.12em] text-zinc-300">{title}</h2>
      {children}
    </section>
  );
}

function HeadPanel({ head }: { head: OutcomeModel }) {
  const metrics = head.metrics;
  const improved = metrics.brier < metrics.baselineBrier;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-400">{HEAD_LABEL[head.outcome]}</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Stat label="ROC-AUC" value={metrics.auc.toFixed(3)} hint="0.5 = 判別力なし" />
        <Stat
          label="Brier Score"
          value={metrics.brier.toFixed(4)}
          hint={`解析近似 ${metrics.baselineBrier.toFixed(4)} ${improved ? "より良い" : "より悪い"}`}
        />
        <Stat
          label="Calibration Error"
          value={`${(head.calibration.expectedCalibrationError * 100).toFixed(2)}pt`}
          hint="予測と実績の平均乖離"
        />
        <Stat label="Log Loss" value={metrics.logLoss.toFixed(4)} />
        <Stat label="Accuracy" value={`${(metrics.accuracy * 100).toFixed(1)}%`} />
        <Stat label="Precision" value={`${(metrics.precision * 100).toFixed(1)}%`} />
        <Stat label="Recall" value={`${(metrics.recall * 100).toFixed(1)}%`} />
        <Stat
          label="陽性率 / 学習件数"
          value={`${(metrics.positiveRate * 100).toFixed(1)}% / ${head.model.trainRows.toLocaleString()}`}
        />
      </div>
      <CalibrationTable bins={head.calibration.bins} />
    </div>
  );
}

function ImportancePanel({ direction }: { direction: DirectionModel }) {
  const items = direction.target.importance.slice(0, 14);
  if (items.length === 0) return <p className="text-[11px] text-zinc-500">係数がありません</p>;
  const max = Math.max(...items.map((entry) => entry.absWeight));
  return (
    <ul className="space-y-1">
      {items.map((entry) => (
        <li key={entry.name} className="flex items-center gap-2 text-[11px]">
          <span className="w-44 shrink-0 truncate font-mono text-zinc-400">{entry.name}</span>
          <span className="flex-1">
            <span
              className={`inline-block h-1.5 rounded ${
                entry.weight >= 0 ? "bg-emerald-500/60" : "bg-rose-500/60"
              }`}
              style={{ width: `${Math.max(2, (entry.absWeight / max) * 100)}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-zinc-500">
            {entry.weight >= 0 ? "+" : ""}
            {entry.weight.toFixed(3)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ModelLab() {
  const [data, setData] = useState<ModelResponse | null>(null);
  const [live, setLive] = useState<PredictionsResponse | null>(null);
  const [training, setTraining] = useState(false);
  const [trainLog, setTrainLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<"long" | "short">("long");

  const load = useCallback(async () => {
    try {
      const [models, predictions] = await Promise.all([
        fetch("/api/model").then((response) => readApiJson<ModelResponse>(response, "GET /api/model")),
        fetch("/api/predictions").then((response) =>
          readApiJson<PredictionsResponse>(response, "GET /api/predictions"),
        ),
      ]);
      setData(models);
      setLive(predictions);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const train = useCallback(async () => {
    setTraining(true);
    setError(null);
    setTrainLog(["学習を開始しました。履歴取得と学習で数十秒かかります。"]);
    try {
      const response = await fetch("/api/model/train", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activate: true }),
      });
      const result = await readApiJson<TrainResponse>(response, "POST /api/model/train");
      setTrainLog([
        `${result.version} を学習し、有効化しました（${(result.elapsedMs / 1000).toFixed(1)}秒）`,
        ...result.notes,
      ]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setTrainLog([]);
    } finally {
      setTraining(false);
    }
  }, [load]);

  const model = data?.model ?? null;
  const direction = model ? (side === "long" ? model.long : model.short) : null;
  const calibration = live?.calibration;

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold tracking-[0.14em] text-zinc-100">
              MODEL / PROBABILITY CALIBRATION
            </h1>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              予測モデルの学習状況と、出した確率が実際にその通りだったかを検証する画面です。
              「このアプリの64%は本当に64%なのか」を確かめるための数字だけを置いています。
            </p>
          </div>
          <nav className="flex gap-2 text-[11px]">
            <Link
              href="/"
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800"
            >
              Entry Board
            </Link>
            <Link
              href="/simulation"
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800"
            >
              Simulation
            </Link>
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-[11px]">
          <button
            type="button"
            onClick={train}
            disabled={training}
            className="rounded bg-emerald-500/20 px-3 py-1.5 font-semibold tracking-[0.1em] text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            {training ? "学習中…" : "モデルを学習"}
          </button>
          <span className="text-zinc-500">
            {model
              ? `稼働中 ${model.version} ・ ${model.training.totalRows.toLocaleString()} サンプル ・ ${model.training.symbols.length} 銘柄`
              : "モデル未公開（Entry Boardは履歴ベース推定で動作中）"}
          </span>
          <button
            type="button"
            onClick={load}
            className="ml-auto rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800"
          >
            再読込
          </button>
        </div>

        {error && (
          <p className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
            {error}
          </p>
        )}
        {trainLog.length > 0 && (
          <ul className="space-y-0.5 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[10px] leading-5 text-zinc-400">
            {trainLog.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </header>

      <Section title="実運用の確率検証（Prediction Log）">
        <p className="text-[10px] leading-5 text-zinc-500">
          Entry Boardが実際に出した予測を、結果が判明する前に保存し、
          保有時間経過後に同じ先着判定ルールで答え合わせしたものです。学習データではありません。
        </p>
        {calibration && calibration.resolved > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Stat
                label="判定済 / 待機中"
                value={`${calibration.resolved.toLocaleString()} / ${calibration.pending.toLocaleString()}`}
              />
              <Stat label="Hit Rate" value={`${(calibration.hitRate * 100).toFixed(1)}%`} hint="TP先着の実績" />
              <Stat label="Brier Score" value={calibration.brier.toFixed(4)} />
              <Stat
                label="Calibration Error"
                value={`${(calibration.expectedCalibrationError * 100).toFixed(2)}pt`}
              />
              <Stat label="ROC-AUC" value={calibration.auc.toFixed(3)} />
              <Stat label="Log Loss" value={calibration.logLoss.toFixed(4)} />
              <Stat
                label="予測EV 平均"
                value={`${calibration.predictedEvPct >= 0 ? "+" : ""}${calibration.predictedEvPct.toFixed(3)}%`}
              />
              <Stat
                label="実績リターン 平均"
                value={`${calibration.realisedReturnPct >= 0 ? "+" : ""}${calibration.realisedReturnPct.toFixed(3)}%`}
                hint="手数料控除前"
              />
            </div>
            <CalibrationTable bins={calibration.bins} />
            {calibration.ambiguousSameBar > 0 && (
              <p className="text-[10px] text-zinc-500">
                うち {calibration.ambiguousSameBar} 件は同一足でTPとSLの両方に触れたため、
                保守側（SL先着）として集計しています。
              </p>
            )}
            {calibration.byModelVersion.length > 1 && (
              <ul className="space-y-0.5 text-[10px] text-zinc-500">
                {calibration.byModelVersion.map((entry) => (
                  <li key={entry.version}>
                    <span className="font-mono text-zinc-400">{entry.version}</span> — 判定済{" "}
                    {entry.resolved} 件 / Hit {(entry.hitRate * 100).toFixed(1)}% / Brier{" "}
                    {entry.brier.toFixed(4)}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[11px] text-zinc-500">
            まだ判定済みの予測がありません（待機中 {calibration?.pending ?? 0} 件）。Entry
            BoardでSCANを実行し、推奨保有時間が経過してからこの画面を開くと集計されます。
          </p>
        )}
      </Section>

      {model && direction ? (
        <>
          <Section title="学習データの出所">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Stat label="バージョン" value={model.version} />
              <Stat label="サンプル数" value={model.training.totalRows.toLocaleString()} />
              <Stat
                label="学習期間"
                value={`${model.training.firstSampleAt.slice(0, 10)} 〜 ${model.training.lastSampleAt.slice(0, 10)}`}
              />
              <Stat
                label="同一足の不確定"
                value={`${model.training.ambiguousSameBarRows.toLocaleString()} 件`}
                hint="すべてSL先着として処理"
              />
            </div>
            <p className="text-[10px] leading-5 text-zinc-500">
              対象銘柄: {model.training.symbols.join(", ")}（{model.training.venue} /{" "}
              {model.training.barMinutes}分足）
            </p>
            <ul className="space-y-0.5 text-[10px] leading-5 text-zinc-500">
              {model.notes.map((note) => (
                <li key={note}>・{note}</li>
              ))}
            </ul>
          </Section>

          <Section title="Out-of-sample 評価">
            <div className="flex gap-1.5">
              {(["long", "short"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSide(option)}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    side === option
                      ? "border-zinc-500 bg-zinc-800 text-zinc-100"
                      : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                  }`}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-5 text-zinc-500">
              時系列の後ろ20%を学習から外し、その区間だけで測った数値です。Platt
              Scalingもこの区間で当てているため、学習データを当て直した数字ではありません。
            </p>
            <div className="space-y-4">
              <HeadPanel head={direction.reach} />
              <HeadPanel head={direction.target} />
              <HeadPanel head={direction.stop} />
            </div>
          </Section>

          <Section title="Walk-forward validation">
            <p className="text-[10px] leading-5 text-zinc-500">
              過去だけで学習し、その直後の期間で検証する手順を前に送りながら繰り返します。
              未来のデータで過去を学習していないことを担保するためのものです。
            </p>
            {model.walkForward.length === 0 ? (
              <p className="text-[11px] text-zinc-500">
                サンプル数が足りず、walk-forward検証は実行されていません。
              </p>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="text-zinc-500">
                  <tr className="border-b border-zinc-800">
                    <th className="py-1 text-left font-normal">Fold</th>
                    <th className="py-1 text-left font-normal">検証期間</th>
                    <th className="py-1 text-right font-normal">学習</th>
                    <th className="py-1 text-right font-normal">検証</th>
                    <th className="py-1 text-right font-normal">AUC</th>
                    <th className="py-1 text-right font-normal">Brier</th>
                    <th className="py-1 text-right font-normal">解析近似</th>
                    <th className="py-1 text-right font-normal">Cal. Error</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-zinc-300">
                  {model.walkForward.map((fold) => (
                    <tr key={fold.index} className="border-b border-zinc-900">
                      <td className="py-1 text-zinc-400">#{fold.index}</td>
                      <td className="py-1 text-zinc-400">
                        {fold.testFrom.slice(0, 10)} 〜 {fold.testUntil.slice(0, 10)}
                      </td>
                      <td className="py-1 text-right">{fold.trainRows.toLocaleString()}</td>
                      <td className="py-1 text-right">{fold.testRows.toLocaleString()}</td>
                      <td className="py-1 text-right">{fold.metrics.auc.toFixed(3)}</td>
                      <td className="py-1 text-right">{fold.metrics.brier.toFixed(4)}</td>
                      <td className="py-1 text-right text-zinc-500">
                        {fold.metrics.baselineBrier.toFixed(4)}
                      </td>
                      <td className="py-1 text-right">
                        {(fold.calibration.expectedCalibrationError * 100).toFixed(2)}pt
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Feature Importance（TP先着モデル・標準化係数）">
            <p className="text-[10px] leading-5 text-zinc-500">
              正の係数はTP先着確率を押し上げ、負の係数は押し下げる方向に働きます。
              L2正則化で情報を持たない特徴量は係数がゼロに落ち、モデルから除外されます。
            </p>
            <ImportancePanel direction={direction} />
          </Section>

          {data && data.versions.length > 1 && (
            <Section title="モデル履歴">
              <ul className="space-y-0.5 text-[10px] text-zinc-500">
                {data.versions.map((entry) => (
                  <li key={entry.version}>
                    <span
                      className={`font-mono ${
                        entry.version === data.active ? "text-emerald-300" : "text-zinc-400"
                      }`}
                    >
                      {entry.version}
                    </span>{" "}
                    — {new Date(entry.createdAt).toLocaleString("ja-JP")} /{" "}
                    {entry.totalRows.toLocaleString()} サンプル / LONG AUC{" "}
                    {entry.longTargetAuc.toFixed(3)} / SHORT AUC {entry.shortTargetAuc.toFixed(3)}
                    {entry.version === data.active && " ・稼働中"}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      ) : (
        <Section title="モデル未公開">
          <p className="text-[11px] leading-5 text-zinc-400">
            まだ学習済みモデルがありません。「モデルを学習」を押すと、Binanceの15m足履歴から
            特徴量と先着ラベルを生成し、LONG / SHORTそれぞれの到達確率・TP先着・SL先着モデルを
            学習します。完了するまでEntry Boardは従来の履歴ベース推定で動作します。
          </p>
        </Section>
      )}

      <footer className="space-y-1 text-[10px] leading-5 text-zinc-500">
        <p>
          確率は過去の類似局面の実績から推定した値であり、将来を保証しません。Calibration
          が良好であっても、それは「平均的に言い過ぎていない」ことを意味するだけです。
        </p>
        <p>
          勝率だけでモデルを採用しないでください。判断材料はOut-of-sampleでの期待値と、
          確率が校正されているかどうかです。
        </p>
      </footer>
    </main>
  );
}
