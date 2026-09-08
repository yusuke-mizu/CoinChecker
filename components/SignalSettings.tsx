"use client";

import { useState } from "react";
import type { SignalSettings as Settings, TrackingDurationHours } from "@/lib/types/signals";

export function SignalSettings({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "h-8 rounded border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs";
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">SIGNAL TRACKING 設定</h2>
          <p className="mt-1 text-[11px] text-amber-300">
            認証なしの共有KVです。設定とSignal Historyは全利用者で共通です。
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft((value) => ({ ...value, enabled: event.target.checked }))}
          />
          自動追跡
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-zinc-500">
          Entry閾値
          <input
            className={`${inputClass} ml-2 w-16`}
            type="number"
            min={0}
            max={100}
            value={draft.entryThreshold}
            onChange={(event) => setDraft((value) => ({ ...value, entryThreshold: Number(event.target.value) }))}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          STRONG
          <input
            className={`${inputClass} ml-2 w-16`}
            type="number"
            min={1}
            max={100}
            value={draft.strongEntryThreshold}
            onChange={(event) => setDraft((value) => ({ ...value, strongEntryThreshold: Number(event.target.value) }))}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          WATCH
          <input
            className={`${inputClass} ml-2 w-16`}
            type="number"
            min={0}
            max={99}
            value={draft.watchEntryThreshold}
            onChange={(event) => setDraft((value) => ({ ...value, watchEntryThreshold: Number(event.target.value) }))}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          Timing閾値
          <input
            className={`${inputClass} ml-2 w-16`}
            type="number"
            min={0}
            max={100}
            value={draft.timingThreshold}
            onChange={(event) => setDraft((value) => ({ ...value, timingThreshold: Number(event.target.value) }))}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          Tracking
          <select
            className={`${inputClass} ml-2`}
            value={draft.topN ?? "all"}
            onChange={(event) => setDraft((value) => ({
              ...value,
              topN: event.target.value === "all" ? null : Number(event.target.value),
            }))}
          >
            <option value={10}>TOP 10</option>
            <option value={20}>TOP 20</option>
            <option value="all">全件</option>
          </select>
        </label>
        <label className="text-[11px] text-zinc-500">
          期間
          <select
            className={`${inputClass} ml-2`}
            value={draft.durationHours}
            onChange={(event) => setDraft((value) => ({
              ...value,
              durationHours: Number(event.target.value) as TrackingDurationHours,
            }))}
          >
            <option value={6}>6h</option>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
            <option value={168}>7days</option>
          </select>
        </label>
        <label className="text-[11px] text-zinc-500">
          全体警告件数
          <input
            className={`${inputClass} ml-2 w-16`}
            type="number"
            min={2}
            max={20}
            value={draft.portfolioProtectionCount}
            onChange={(event) => setDraft((value) => ({
              ...value,
              portfolioProtectionCount: Number(event.target.value),
            }))}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          Set Risk倍率
          <input
            className={`${inputClass} ml-2 w-16`}
            type="number"
            min={1}
            max={20}
            value={draft.setLeverage}
            onChange={(event) => setDraft((value) => ({
              ...value,
              setLeverage: Number(event.target.value),
            }))}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          Hard Stop上限
          <input
            className={`${inputClass} ml-2 w-16`}
            type="number"
            min={1}
            max={25}
            step={0.5}
            value={draft.hardStopPct}
            onChange={(event) => setDraft((value) => ({
              ...value,
              hardStopPct: Number(event.target.value),
            }))}
          />
          %
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="h-8 rounded bg-zinc-100 px-3 text-xs font-medium text-zinc-950 disabled:opacity-50"
        >
          {saving ? "保存中" : "共有設定を保存"}
        </button>
      </div>
    </section>
  );
}
