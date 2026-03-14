#!/usr/bin/env bun

/**
 * Data Freshness Report
 *
 * Scans all provider model files and reports models / providers whose data
 * has not been updated recently. Outputs a Markdown summary to stdout.
 *
 * Usage:
 *   bun ./packages/core/script/freshness-report.ts
 *   bun ./packages/core/script/freshness-report.ts --stale-days 90
 *   bun ./packages/core/script/freshness-report.ts --format json
 */

import path from "node:path";
import { generate } from "../src/index.js";
import type { Provider, Model } from "../src/index.js";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const staleDaysArg = args.find((a) => a.startsWith("--stale-days="))?.split("=")[1];
const staleDays = staleDaysArg ? parseInt(staleDaysArg, 10) : 90;
const formatArg = args.find((a) => a.startsWith("--format="))?.split("=")[1];
const format: "markdown" | "json" = formatArg === "json" ? "json" : "markdown";
const providerArg = args.find((a) => a.startsWith("--provider="))?.split("=")[1];

// ── Date helpers ──────────────────────────────────────────────────────────────

const NOW = new Date();

function daysSince(dateStr: string): number {
  const d = new Date(dateStr.length === 7 ? `${dateStr}-01` : dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.floor((NOW.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Report types ──────────────────────────────────────────────────────────────

interface StaleModel {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  lastUpdated: string;
  daysSinceUpdate: number;
}

interface ProviderSummary {
  providerId: string;
  providerName: string;
  modelCount: number;
  staleCount: number;
  avgDaysSinceUpdate: number;
  mostRecentUpdate: string;
  mostStaleUpdate: string;
}

// ── Generate data ─────────────────────────────────────────────────────────────

const providersDir = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "providers",
);

const providers = await generate(providersDir);

const staleModels: StaleModel[] = [];
const providerSummaries: ProviderSummary[] = [];
let totalModels = 0;
let totalStale = 0;

for (const [pid, provider] of Object.entries(providers)) {
  if (providerArg && pid !== providerArg) continue;

  const models = Object.entries(provider.models);
  totalModels += models.length;

  const days = models
    .map(([, m]) => daysSince(m.last_updated))
    .filter((d) => isFinite(d));
  const avgDays = days.length > 0 ? days.reduce((a, b) => a + b, 0) / days.length : 0;

  const allDates = models.map(([, m]) => m.last_updated).filter(Boolean);
  const sorted = [...allDates].sort();
  const mostRecentUpdate = sorted[sorted.length - 1] ?? "";
  const mostStaleUpdate = sorted[0] ?? "";

  let staleCount = 0;
  for (const [mid, model] of models) {
    const days = daysSince(model.last_updated);
    if (days > staleDays) {
      staleCount++;
      totalStale++;
      staleModels.push({
        providerId: pid,
        providerName: provider.name,
        modelId: mid,
        modelName: model.name,
        lastUpdated: model.last_updated,
        daysSinceUpdate: days,
      });
    }
  }

  providerSummaries.push({
    providerId: pid,
    providerName: provider.name,
    modelCount: models.length,
    staleCount,
    avgDaysSinceUpdate: Math.round(avgDays),
    mostRecentUpdate,
    mostStaleUpdate,
  });
}

// Sort: most stale providers first
providerSummaries.sort((a, b) => b.avgDaysSinceUpdate - a.avgDaysSinceUpdate);

// Sort stale models: most stale first
staleModels.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

// ── Output ────────────────────────────────────────────────────────────────────

if (format === "json") {
  console.log(
    JSON.stringify(
      {
        generatedAt: NOW.toISOString(),
        staleDaysThreshold: staleDays,
        totalModels,
        totalStale,
        stalePercent: totalModels > 0 ? ((totalStale / totalModels) * 100).toFixed(1) : "0",
        providerSummaries: providerSummaries.filter((p) => p.staleCount > 0),
        topStaleModels: staleModels.slice(0, 50),
      },
      null,
      2,
    ),
  );
} else {
  // Markdown report
  const stalePercent =
    totalModels > 0 ? ((totalStale / totalModels) * 100).toFixed(1) : "0";
  const lines: string[] = [];

  lines.push(`# Data Freshness Report`);
  lines.push(`\nGenerated: ${NOW.toISOString().split("T")[0]}`);
  lines.push(`Stale threshold: models not updated in **${staleDays}+ days**\n`);
  lines.push(`## Summary\n`);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total models | ${totalModels.toLocaleString()} |`);
  lines.push(`| Stale models | ${totalStale.toLocaleString()} (${stalePercent}%) |`);
  lines.push(`| Total providers | ${providerSummaries.length} |`);
  lines.push(
    `| Providers with stale data | ${providerSummaries.filter((p) => p.staleCount > 0).length} |`,
  );

  const staleProviders = providerSummaries.filter((p) => p.staleCount > 0);
  if (staleProviders.length > 0) {
    lines.push(`\n## Providers With Stale Models (>${staleDays} days)\n`);
    lines.push(`| Provider | Total Models | Stale | Avg Days | Most Recent Update |`);
    lines.push(`|----------|-------------|-------|----------|--------------------|`);
    for (const p of staleProviders.slice(0, 20)) {
      lines.push(
        `| ${p.providerName} | ${p.modelCount} | ${p.staleCount} | ${p.avgDaysSinceUpdate} | ${p.mostRecentUpdate} |`,
      );
    }
  }

  const top = staleModels.slice(0, 20);
  if (top.length > 0) {
    lines.push(`\n## Top ${top.length} Most Stale Models\n`);
    lines.push(`| Model | Provider | Last Updated | Days Since Update |`);
    lines.push(`|-------|----------|-------------|-------------------|`);
    for (const m of top) {
      lines.push(
        `| ${m.modelName} | ${m.providerName} | ${m.lastUpdated} | ${m.daysSinceUpdate} |`,
      );
    }
  }

  if (totalStale === 0) {
    lines.push(
      `\n✅ All models have been updated within the last ${staleDays} days.`,
    );
  } else {
    lines.push(
      `\n⚠️ ${totalStale} model${totalStale !== 1 ? "s" : ""} (${stalePercent}%) ` +
        `have not been updated in over ${staleDays} days.`,
    );
  }

  console.log(lines.join("\n"));
}

// Exit with non-zero if stale percentage exceeds threshold (useful for CI)
const stalePercent = totalModels > 0 ? (totalStale / totalModels) * 100 : 0;
if (stalePercent > 80) {
  process.exit(1);
}
