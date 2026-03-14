/**
 * Shared utilities for model data generation scripts.
 *
 * These functions were previously duplicated across generate-venice.ts,
 * generate-vercel.ts, generate-wandb.ts, generate-friendli.ts, and
 * generate-helicone.ts. Centralising them here ensures consistency and
 * reduces maintenance burden.
 */

import { ModelFamilyValues } from "./family.js";
import type { ModelFamily } from "./family.js";

// ── Date utilities ────────────────────────────────────────────────────────────

/** Returns today's date in YYYY-MM-DD format. */
export function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Converts a Unix timestamp (seconds) to a YYYY-MM-DD date string. */
export function timestampToDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

// ── Number formatting ─────────────────────────────────────────────────────────

/**
 * Formats a number for TOML output.
 * Numbers >= 1000 are formatted with underscores for readability (e.g. 131_072).
 */
export function formatNumber(n: number): string {
  if (n >= 1000) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "_");
  }
  return n.toString();
}

// ── Family inference ──────────────────────────────────────────────────────────

/**
 * Checks whether all characters of `family` appear in `target` in order
 * (subsequence matching). Used as a fallback when substring matching fails.
 */
function isSubsequence(target: string, family: string): boolean {
  const t = target.toLowerCase();
  const f = family.toLowerCase();
  let fi = 0;
  for (let i = 0; i < t.length && fi < f.length; i++) {
    if (t[i] === f[fi]) fi++;
  }
  return fi === f.length;
}

/**
 * Checks whether `family` appears as a substring of `target`.
 */
function isSubstring(target: string, family: string): boolean {
  return target.toLowerCase().includes(family.toLowerCase());
}

/**
 * Infers a ModelFamily from a model ID and/or display name.
 *
 * Algorithm (two passes, longer families tested first to avoid false matches):
 * 1. Substring match on modelId
 * 2. Substring match on modelName
 * 3. Subsequence match on modelId
 * 4. Subsequence match on modelName
 *
 * Returns undefined if no family can be inferred.
 */
export function inferFamily(
  modelId: string,
  modelName: string,
): ModelFamily | undefined {
  const sorted = [...ModelFamilyValues].sort((a, b) => b.length - a.length);

  // Pass 1: substring match (more reliable)
  for (const family of sorted) {
    if (isSubstring(modelId, family)) return family as ModelFamily;
  }
  for (const family of sorted) {
    if (isSubstring(modelName, family)) return family as ModelFamily;
  }

  // Pass 2: subsequence match (more permissive fallback)
  for (const family of sorted) {
    if (isSubsequence(modelId, family)) return family as ModelFamily;
  }
  for (const family of sorted) {
    if (isSubsequence(modelName, family)) return family as ModelFamily;
  }

  return undefined;
}

// ── Existing model loading ────────────────────────────────────────────────────

/**
 * Represents the structure of an existing TOML model file.
 * All fields are optional because we're reading from unknown TOML.
 */
export interface ExistingModel {
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  open_weights?: boolean;
  interleaved?: boolean | { field: string };
  status?: string;
  cost?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache_read?: number;
    cache_write?: number;
    input_audio?: number;
    output_audio?: number;
    context_over_200k?: {
      input?: number;
      output?: number;
      reasoning?: number;
      cache_read?: number;
      cache_write?: number;
    };
  };
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
  provider?: {
    npm?: string;
    api?: string;
    shape?: string;
  };
}

/**
 * Loads and parses an existing TOML model file.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function loadExistingModel(
  filePath: string,
): Promise<ExistingModel | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;

    const toml = await import(filePath, { with: { type: "toml" } }).then(
      (mod) => mod.default,
    );
    return toml as ExistingModel;
  } catch (e) {
    console.warn(`Warning: Failed to parse existing file ${filePath}:`, e);
    return null;
  }
}

// ── Change detection ──────────────────────────────────────────────────────────

export interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

/** Price epsilon: differences smaller than this are treated as equal. */
const PRICE_EPSILON = 0.001;

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return "(unset)";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

/**
 * Compares an existing model with an incoming merged model and returns
 * a list of meaningful field-level changes.
 *
 * Price changes smaller than PRICE_EPSILON are ignored.
 * Limit changes where both values are 0 are ignored.
 */
export function detectChanges(
  existing: ExistingModel | null,
  incoming: Record<string, unknown>,
): FieldChange[] {
  if (!existing) return [];

  const changes: FieldChange[] = [];

  function compare(field: string, oldVal: unknown, newVal: unknown): void {
    if (oldVal === undefined && newVal === undefined) return;
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return;

    // Ignore tiny price differences
    const isPriceField =
      field.startsWith("cost.") || field.includes("_cost");
    if (
      isPriceField &&
      typeof oldVal === "number" &&
      typeof newVal === "number" &&
      Math.abs(oldVal - newVal) < PRICE_EPSILON
    ) {
      return;
    }

    // Ignore limit fields when both are 0 (not meaningful)
    if (
      field.startsWith("limit.") &&
      oldVal === 0 &&
      newVal === 0
    ) {
      return;
    }

    changes.push({
      field,
      oldValue: formatValue(oldVal),
      newValue: formatValue(newVal),
    });
  }

  // Compare scalar fields
  const scalarFields = [
    "name", "family", "attachment", "reasoning", "tool_call",
    "structured_output", "temperature", "knowledge",
    "release_date", "last_updated", "open_weights", "status",
  ];
  for (const f of scalarFields) {
    compare(f, (existing as Record<string, unknown>)[f], incoming[f]);
  }

  // Compare limit fields
  const existingLimit = existing.limit ?? {};
  const incomingLimit = (incoming["limit"] as Record<string, unknown>) ?? {};
  for (const f of ["context", "input", "output"] as const) {
    compare(`limit.${f}`, existingLimit[f], incomingLimit[f]);
  }

  // Compare cost fields (flat)
  const existingCost = existing.cost ?? {};
  const incomingCost = (incoming["cost"] as Record<string, unknown>) ?? {};
  for (const f of [
    "input", "output", "reasoning", "cache_read", "cache_write",
    "input_audio", "output_audio",
  ]) {
    compare(`cost.${f}`, (existingCost as Record<string, unknown>)[f], incomingCost[f]);
  }

  return changes;
}

// ── TOML formatting ───────────────────────────────────────────────────────────

/**
 * Canonical TOML field order for model files.
 * Matches the ordering recommended in the project's README.
 */
export interface TomlModelSpec {
  name: string;
  family?: string;
  attachment: boolean;
  reasoning: boolean;
  tool_call: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date: string;
  last_updated: string;
  open_weights: boolean;
  status?: string;
  interleaved?: boolean | { field: string };
  cost?: {
    input: number;
    output: number;
    reasoning?: number;
    cache_read?: number;
    cache_write?: number;
    input_audio?: number;
    output_audio?: number;
    context_over_200k?: {
      input: number;
      output: number;
      reasoning?: number;
      cache_read?: number;
      cache_write?: number;
    };
  };
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  modalities: {
    input: string[];
    output: string[];
  };
  provider?: {
    npm?: string;
    api?: string;
    shape?: string;
  };
}

/**
 * Serialises a model spec to TOML with a canonical field order.
 * This ensures consistent formatting across all generation scripts.
 */
export function formatToml(model: TomlModelSpec): string {
  const lines: string[] = [];

  lines.push(`name = "${model.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  if (model.family) lines.push(`family = "${model.family}"`);
  lines.push(`attachment = ${model.attachment}`);
  lines.push(`reasoning = ${model.reasoning}`);
  lines.push(`tool_call = ${model.tool_call}`);
  if (model.structured_output !== undefined) {
    lines.push(`structured_output = ${model.structured_output}`);
  }
  if (model.temperature !== undefined) {
    lines.push(`temperature = ${model.temperature}`);
  }
  if (model.knowledge) lines.push(`knowledge = "${model.knowledge}"`);
  lines.push(`release_date = "${model.release_date}"`);
  lines.push(`last_updated = "${model.last_updated}"`);
  lines.push(`open_weights = ${model.open_weights}`);
  if (model.status) lines.push(`status = "${model.status}"`);

  if (model.interleaved !== undefined) {
    lines.push("");
    if (model.interleaved === true) {
      lines.push("interleaved = true");
    } else if (typeof model.interleaved === "object") {
      lines.push("[interleaved]");
      lines.push(`field = "${(model.interleaved as { field: string }).field}"`);
    }
  }

  if (model.cost) {
    lines.push("");
    lines.push("[cost]");
    lines.push(`input = ${model.cost.input}`);
    lines.push(`output = ${model.cost.output}`);
    if (model.cost.reasoning !== undefined) {
      lines.push(`reasoning = ${model.cost.reasoning}`);
    }
    if (model.cost.cache_read !== undefined) {
      lines.push(`cache_read = ${model.cost.cache_read}`);
    }
    if (model.cost.cache_write !== undefined) {
      lines.push(`cache_write = ${model.cost.cache_write}`);
    }
    if (model.cost.input_audio !== undefined) {
      lines.push(`input_audio = ${model.cost.input_audio}`);
    }
    if (model.cost.output_audio !== undefined) {
      lines.push(`output_audio = ${model.cost.output_audio}`);
    }
    if (model.cost.context_over_200k) {
      const c200 = model.cost.context_over_200k;
      lines.push("");
      lines.push("[cost.context_over_200k]");
      lines.push(`input = ${c200.input}`);
      lines.push(`output = ${c200.output}`);
      if (c200.reasoning !== undefined) lines.push(`reasoning = ${c200.reasoning}`);
      if (c200.cache_read !== undefined) lines.push(`cache_read = ${c200.cache_read}`);
      if (c200.cache_write !== undefined) lines.push(`cache_write = ${c200.cache_write}`);
    }
  }

  lines.push("");
  lines.push("[limit]");
  lines.push(`context = ${formatNumber(model.limit.context)}`);
  if (model.limit.input !== undefined) {
    lines.push(`input = ${formatNumber(model.limit.input)}`);
  }
  lines.push(`output = ${formatNumber(model.limit.output)}`);

  lines.push("");
  lines.push("[modalities]");
  lines.push(
    `input = [${model.modalities.input.map((m) => `"${m}"`).join(", ")}]`,
  );
  lines.push(
    `output = [${model.modalities.output.map((m) => `"${m}"`).join(", ")}]`,
  );

  if (model.provider) {
    lines.push("");
    lines.push("[provider]");
    if (model.provider.npm) lines.push(`npm = "${model.provider.npm}"`);
    if (model.provider.api) lines.push(`api = "${model.provider.api}"`);
    if (model.provider.shape) lines.push(`shape = "${model.provider.shape}"`);
  }

  return lines.join("\n") + "\n";
}
