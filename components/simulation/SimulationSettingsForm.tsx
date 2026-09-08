"use client";

import { STRATEGY_MODULES } from "@/lib/simulation/strategies";
import { HOLDING_OPTIONS, SIM_TIMEFRAMES } from "@/lib/simulation/settings";
import type { HoldingOption, SimTimeframe, SimulationSettings, StrategyId } from "@/lib/types/simulation";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="text-zinc-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[10px] text-zinc-600">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-zinc-100 outline-none focus:border-cyan-600";

export function SimulationSettingsForm({
  settings,
  disabled,
  onChange,
}: {
  settings: SimulationSettings;
  disabled: boolean;
  onChange: (next: SimulationSettings) => void;
}) {
  const patch = (partial: Partial<SimulationSettings>) => onChange({ ...settings, ...partial });
  const patchParams = (partial: Partial<SimulationSettings["params"]>) =>
    onChange({ ...settings, params: { ...settings.params, ...partial } });
  const patchCosts = (partial: Partial<SimulationSettings["costs"]>) =>
    onChange({ ...settings, costs: { ...settings.costs, ...partial } });

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Symbols" hint="カンマ区切り。最大8銘柄。">
          <input
            className={inputClass}
            value={settings.symbols.join(", ")}
            onChange={(event) =>
              patch({
                symbols: event.target.value
                  .split(",")
                  .map((item) => item.trim().toUpperCase())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <Field label="Initial Capital (JPY)">
          <input
            type="number"
            className={inputClass}
            value={settings.initialCapital}
            min={1000}
            step={1000}
            onChange={(event) => patch({ initialCapital: Number(event.target.value) })}
          />
        </Field>
        <Field label={`Leverage ${settings.leverage}x`} hint="高いほど清算距離が縮まります。">
          <input
            type="range"
            className="mt-2 w-full"
            min={1}
            max={20}
            step={1}
            value={settings.leverage}
            onChange={(event) => patch({ leverage: Number(event.target.value) })}
          />
        </Field>
        <Field label="Direction">
          <select
            className={inputClass}
            value={settings.direction}
            onChange={(event) =>
              patch({ direction: event.target.value as SimulationSettings["direction"] })
            }
          >
            <option value="BOTH">BOTH</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Holding Time" hint="足数へ換算して強制決済します。">
          <select
            className={inputClass}
            value={settings.holding}
            onChange={(event) => patch({ holding: event.target.value as HoldingOption })}
          >
            {HOLDING_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Risk per Trade (%)" hint="1トレードで晒す証拠金比率。">
          <input
            type="number"
            className={inputClass}
            value={settings.riskPerTradePct}
            min={0.1}
            max={20}
            step={0.1}
            onChange={(event) => patch({ riskPerTradePct: Number(event.target.value) })}
          />
        </Field>
        <Field label="Position Count" hint="同時保有上限。超過分はSkip。">
          <input
            type="number"
            className={inputClass}
            value={settings.positionCount}
            min={1}
            max={30}
            step={1}
            onChange={(event) => patch({ positionCount: Number(event.target.value) })}
          />
        </Field>
        <Field label="Compounding">
          <select
            className={inputClass}
            value={settings.compounding ? "ON" : "OFF"}
            onChange={(event) => patch({ compounding: event.target.value === "ON" })}
          >
            <option value="ON">ON</option>
            <option value="OFF">OFF</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Stop Loss">
          <select
            className={inputClass}
            value={settings.stopMode}
            onChange={(event) =>
              patch({ stopMode: event.target.value as SimulationSettings["stopMode"] })
            }
          >
            <option value="DYNAMIC">DYNAMIC (Structure + ATR)</option>
            <option value="FIXED">FIXED (%)</option>
          </select>
        </Field>
        {settings.stopMode === "FIXED" ? (
          <Field label="Fixed Stop (%)">
            <input
              type="number"
              className={inputClass}
              value={settings.fixedStopPct}
              min={0.3}
              max={15}
              step={0.1}
              onChange={(event) => patch({ fixedStopPct: Number(event.target.value) })}
            />
          </Field>
        ) : (
          <Field label="ATR Stop Multiplier">
            <input
              type="number"
              className={inputClass}
              value={settings.params.atrStopMultiplier}
              min={0.5}
              max={5}
              step={0.1}
              onChange={(event) => patchParams({ atrStopMultiplier: Number(event.target.value) })}
            />
          </Field>
        )}
        <Field label="Take Profit">
          <select
            className={inputClass}
            value={settings.takeProfitMode}
            onChange={(event) =>
              patch({ takeProfitMode: event.target.value as SimulationSettings["takeProfitMode"] })
            }
          >
            <option value="DYNAMIC">DYNAMIC (R倍)</option>
            <option value="FIXED">FIXED (%)</option>
          </select>
        </Field>
        {settings.takeProfitMode === "FIXED" ? (
          <Field label="TP1 / TP2 (%)">
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                className={`${inputClass} mt-0`}
                value={settings.fixedTarget1Pct}
                step={0.1}
                onChange={(event) => patch({ fixedTarget1Pct: Number(event.target.value) })}
              />
              <input
                type="number"
                className={`${inputClass} mt-0`}
                value={settings.fixedTarget2Pct}
                step={0.1}
                onChange={(event) => patch({ fixedTarget2Pct: Number(event.target.value) })}
              />
            </div>
          </Field>
        ) : (
          <Field label="TP1 / TP2 (R倍)" hint="TP1で一部利確し、残りは建値Stop。">
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                className={`${inputClass} mt-0`}
                value={settings.params.target1R}
                step={0.1}
                onChange={(event) => patchParams({ target1R: Number(event.target.value) })}
              />
              <input
                type="number"
                className={`${inputClass} mt-0`}
                value={settings.params.target2R}
                step={0.1}
                onChange={(event) => patchParams({ target2R: Number(event.target.value) })}
              />
            </div>
          </Field>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="RSI Oversold / Overbought">
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              className={`${inputClass} mt-0`}
              value={settings.params.rsiOversold}
              onChange={(event) => patchParams({ rsiOversold: Number(event.target.value) })}
            />
            <input
              type="number"
              className={`${inputClass} mt-0`}
              value={settings.params.rsiOverbought}
              onChange={(event) => patchParams({ rsiOverbought: Number(event.target.value) })}
            />
          </div>
        </Field>
        <Field label="EMA Fast / Slow">
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              className={`${inputClass} mt-0`}
              value={settings.params.emaFast}
              onChange={(event) => patchParams({ emaFast: Number(event.target.value) })}
            />
            <input
              type="number"
              className={`${inputClass} mt-0`}
              value={settings.params.emaSlow}
              onChange={(event) => patchParams({ emaSlow: Number(event.target.value) })}
            />
          </div>
        </Field>
        <Field label="Breakout Lookback / Min Volume Ratio">
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              className={`${inputClass} mt-0`}
              value={settings.params.breakoutLookback}
              onChange={(event) => patchParams({ breakoutLookback: Number(event.target.value) })}
            />
            <input
              type="number"
              className={`${inputClass} mt-0`}
              value={settings.params.minVolumeRatio}
              step={0.1}
              onChange={(event) => patchParams({ minVolumeRatio: Number(event.target.value) })}
            />
          </div>
        </Field>
        <Field label="Fee / Slippage / Funding" hint="Fundingは履歴ではなくモデル定数です。">
          <div className="mt-1 space-y-1 text-[11px]">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.costs.feesEnabled}
                onChange={(event) => patchCosts({ feesEnabled: event.target.checked })}
              />
              Taker Fee
              <input
                type="number"
                className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1 font-mono"
                value={settings.costs.takerFeePct}
                step={0.005}
                onChange={(event) => patchCosts({ takerFeePct: Number(event.target.value) })}
              />
              %
            </span>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.costs.slippageEnabled}
                onChange={(event) => patchCosts({ slippageEnabled: event.target.checked })}
              />
              Slippage
              <input
                type="number"
                className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1 font-mono"
                value={settings.costs.slippagePct}
                step={0.005}
                onChange={(event) => patchCosts({ slippagePct: Number(event.target.value) })}
              />
              %
            </span>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.costs.fundingEnabled}
                onChange={(event) => patchCosts({ fundingEnabled: event.target.checked })}
              />
              Funding
              <input
                type="number"
                className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1 font-mono"
                value={settings.costs.fundingRatePct8h}
                step={0.005}
                onChange={(event) => patchCosts({ fundingRatePct8h: Number(event.target.value) })}
              />
              % / 8h
            </span>
          </div>
        </Field>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="text-xs text-zinc-400">Timeframes</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SIM_TIMEFRAMES.map((timeframe) => (
              <button
                key={timeframe}
                type="button"
                onClick={() => patch({ timeframes: toggle(settings.timeframes, timeframe) as SimTimeframe[] })}
                className={`rounded border px-2 py-1 text-xs ${
                  settings.timeframes.includes(timeframe)
                    ? "border-cyan-600 bg-cyan-950/40 text-cyan-200"
                    : "border-zinc-700 text-zinc-400"
                }`}
              >
                {timeframe}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-zinc-400">
            Trading Methods（個別に検証するため、まとめて1つのスコアにはしません）
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {STRATEGY_MODULES.map((module) => (
              <button
                key={module.id}
                type="button"
                title={module.description}
                onClick={() =>
                  patch({ strategies: toggle(settings.strategies, module.id) as StrategyId[] })
                }
                className={`rounded border px-2 py-1 text-xs ${
                  settings.strategies.includes(module.id)
                    ? "border-emerald-600 bg-emerald-950/40 text-emerald-200"
                    : "border-zinc-700 text-zinc-400"
                }`}
              >
                {module.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
