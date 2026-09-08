const base = "http://localhost:3000";

const info = await (await fetch(`${base}/api/opportunities`)).json();
console.log(`universe total=${info.total} batchSize=${info.batchSize}`);
console.log(`first symbols: ${(info.symbols ?? []).slice(0, 10).join(" ")}`);

const started = Date.now();
const batch = await (
  await fetch(`${base}/api/opportunities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offset: 0, limit: 12 }),
  })
).json();
console.log(`\nbatch took ${Date.now() - started}ms`);
if (batch.error || batch.message) {
  console.log("ERROR", JSON.stringify(batch).slice(0, 800));
  process.exit(1);
}
console.log(`regime: ${batch.btcRegime?.label}`);
console.log(`requested=${batch.requested} evaluated=${batch.evaluated}`);
for (const item of batch.excluded ?? []) console.log(`  excluded ${item.symbol}: ${item.reason}`);

for (const row of batch.rows.slice(0, 4)) {
  console.log(
    `\n${row.display} ${row.lastPrice} atr=${row.atrPct.toFixed(2)}% rsi=${row.rsi?.toFixed(0)} trend=${row.trend} funding=${row.fundingRatePct} oi=${row.openInterestUsd} flow=${row.orderFlowDelta} ess=${row.effectiveSampleSize}/${row.sampleSize}`,
  );
  for (const side of [row.long, row.short]) {
    if (!side) continue;
    console.log(
      `  ${side.direction} ${side.verdict} stars=${side.stars} | TP ${side.targetRangeLabel} p=${side.profitProbability.toFixed(0)}% | SL -${side.stop.pct}% p=${side.stopProbability.toFixed(0)}% | EV ${side.expectedValuePct.toFixed(3)}% (${side.expectedValuePerHourPct.toFixed(3)}/h) | lev ${side.leverage.recommendedMin}-${side.leverage.recommendedMax}x | hold ${side.holding.label} | conf ${side.confidence} | ${side.basis}`,
    );
    console.log(`    SL根拠: ${side.stop.reason}`);
    console.log(
      `    horizons: ${side.horizons.map((h) => `${h.label} +${h.levelPct}% ${h.probability.toFixed(0)}%`).join(" | ")}`,
    );
  }
}
