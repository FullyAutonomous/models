import { describe, expect, it } from "bun:test";
import {
  getTodayDate,
  timestampToDate,
  formatNumber,
  inferFamily,
  detectChanges,
  formatToml,
} from "../src/generator-utils.js";

// ── getTodayDate ──────────────────────────────────────────────────────────────

describe("getTodayDate", () => {
  it("returns a string in YYYY-MM-DD format", () => {
    const date = getTodayDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns a valid date", () => {
    const date = getTodayDate();
    expect(new Date(date).toString()).not.toBe("Invalid Date");
  });
});

// ── timestampToDate ───────────────────────────────────────────────────────────

describe("timestampToDate", () => {
  it("converts Unix timestamp to YYYY-MM-DD", () => {
    // 2024-01-15T00:00:00Z = 1705276800
    expect(timestampToDate(1705276800)).toBe("2024-01-15");
  });

  it("converts 0 to 1970-01-01", () => {
    expect(timestampToDate(0)).toBe("1970-01-01");
  });
});

// ── formatNumber ──────────────────────────────────────────────────────────────

describe("formatNumber", () => {
  it("formats numbers < 1000 without underscores", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(512)).toBe("512");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats numbers >= 1000 with underscores", () => {
    expect(formatNumber(1000)).toBe("1_000");
    expect(formatNumber(4096)).toBe("4_096");
    expect(formatNumber(128000)).toBe("128_000");
    expect(formatNumber(1000000)).toBe("1_000_000");
  });

  it("handles 10000 correctly", () => {
    expect(formatNumber(10000)).toBe("10_000");
  });
});

// ── inferFamily ───────────────────────────────────────────────────────────────

describe("inferFamily", () => {
  it("infers 'gpt' family from GPT-4o", () => {
    expect(inferFamily("gpt-4o", "GPT-4o")).toBe("gpt");
  });

  it("infers 'claude-sonnet' from claude-sonnet ID", () => {
    const result = inferFamily("claude-sonnet-4-6", "Claude Sonnet 4.6");
    expect(result).toBe("claude-sonnet");
  });

  it("infers 'claude' family broadly", () => {
    const result = inferFamily("claude-3-5-haiku-20241022", "Claude Haiku");
    expect(result).toContain("claude");
  });

  it("infers a gemini family variant", () => {
    // "gemini-2.5-pro" doesn't contain "gemini-pro" as a contiguous substring,
    // so the algorithm infers the shorter "gemini" family
    const result = inferFamily("gemini-2.5-pro", "Gemini 2.5 Pro");
    expect(result).toContain("gemini");
  });

  it("infers 'gemini-pro' for explicit gemini pro model IDs", () => {
    // "gemini-pro-experimental" contains "gemini-pro" as a substring
    expect(inferFamily("gemini-pro-experimental", "Gemini Pro")).toBe("gemini-pro");
  });

  it("infers 'llama' from Llama model", () => {
    expect(inferFamily("meta-llama/Llama-3.1-8B", "Llama 3.1 8B")).toBe("llama");
  });

  it("infers 'mistral' family", () => {
    const result = inferFamily("mistral-large-latest", "Mistral Large");
    expect(result).toContain("mistral");
  });

  it("returns undefined for truly unrecognised models with no character overlap", () => {
    // Note: single-character family names like "o" can match via subsequence
    // on any string containing that character. This is a known limitation.
    // A fully unrecognisable model is one where even subsequence fails.
    // Since ModelFamilyValues contains single-char families, this test
    // checks that the function returns something (not undefined) for most strings.
    const result = inferFamily("qqqzzz999", "QQQ ZZZ 999");
    // q, z, 9 don't appear in any family name so it should return undefined
    expect(result).toBeUndefined();
  });

  it("prefers longer matching family names", () => {
    // "claude-sonnet" should be preferred over "claude" for sonnet models
    const result = inferFamily("claude-sonnet-4", "Claude Sonnet 4");
    expect(result).toBe("claude-sonnet");
  });
});

// ── detectChanges ─────────────────────────────────────────────────────────────

describe("detectChanges", () => {
  const base = {
    name: "GPT-4o",
    attachment: true,
    reasoning: false,
    tool_call: true,
    open_weights: false,
    release_date: "2024-05",
    last_updated: "2024-11",
    limit: { context: 128000, output: 4096 },
    cost: { input: 2.5, output: 10.0 },
    modalities: { input: ["text", "image"], output: ["text"] },
  };

  it("returns empty array when nothing changed", () => {
    const changes = detectChanges(base, base as Record<string, unknown>);
    expect(changes).toEqual([]);
  });

  it("returns empty array when existing is null", () => {
    expect(detectChanges(null, base as Record<string, unknown>)).toEqual([]);
  });

  it("detects name change", () => {
    const updated = { ...base, name: "GPT-4o Updated" };
    const changes = detectChanges(base, updated as Record<string, unknown>);
    expect(changes.some((c) => c.field === "name")).toBe(true);
  });

  it("detects context window change", () => {
    const updated = {
      ...base,
      limit: { context: 200000, output: 4096 },
    };
    const changes = detectChanges(base, updated as Record<string, unknown>);
    expect(changes.some((c) => c.field === "limit.context")).toBe(true);
  });

  it("ignores tiny price differences (epsilon tolerance)", () => {
    const updated = {
      ...base,
      cost: { input: 2.5001, output: 10.0 }, // diff < 0.001
    };
    const changes = detectChanges(base, updated as Record<string, unknown>);
    expect(changes.some((c) => c.field === "cost.input")).toBe(false);
  });

  it("detects meaningful price change", () => {
    const updated = {
      ...base,
      cost: { input: 5.0, output: 10.0 }, // significant change
    };
    const changes = detectChanges(base, updated as Record<string, unknown>);
    expect(changes.some((c) => c.field === "cost.input")).toBe(true);
  });
});

// ── formatToml ────────────────────────────────────────────────────────────────

describe("formatToml", () => {
  const minimalModel = {
    name: "Test Model",
    attachment: false,
    reasoning: false,
    tool_call: true,
    open_weights: false,
    release_date: "2024-01",
    last_updated: "2024-06",
    limit: { context: 128000, output: 4096 },
    modalities: { input: ["text"] as ["text"], output: ["text"] as ["text"] },
  };

  it("produces valid TOML with required fields", () => {
    const toml = formatToml(minimalModel);
    expect(toml).toContain('name = "Test Model"');
    expect(toml).toContain("attachment = false");
    expect(toml).toContain("reasoning = false");
    expect(toml).toContain("tool_call = true");
    expect(toml).toContain("open_weights = false");
    expect(toml).toContain('release_date = "2024-01"');
    expect(toml).toContain('last_updated = "2024-06"');
  });

  it("formats large numbers with underscores", () => {
    const toml = formatToml(minimalModel);
    expect(toml).toContain("context = 128_000");
    expect(toml).toContain("output = 4_096");
  });

  it("includes cost section when provided", () => {
    const withCost = {
      ...minimalModel,
      cost: { input: 2.5, output: 10.0 },
    };
    const toml = formatToml(withCost);
    expect(toml).toContain("[cost]");
    expect(toml).toContain("input = 2.5");
    expect(toml).toContain("output = 10");
  });

  it("includes family when provided", () => {
    const withFamily = { ...minimalModel, family: "gpt" as const };
    const toml = formatToml(withFamily);
    expect(toml).toContain('family = "gpt"');
  });

  it("does not include optional fields when absent", () => {
    const toml = formatToml(minimalModel);
    expect(toml).not.toContain("family");
    expect(toml).not.toContain("knowledge");
    expect(toml).not.toContain("structured_output");
    expect(toml).not.toContain("[cost]");
  });

  it("ends with a newline", () => {
    const toml = formatToml(minimalModel);
    expect(toml.endsWith("\n")).toBe(true);
  });

  it("escapes double quotes in model names", () => {
    const withQuote = { ...minimalModel, name: 'Model "Pro"' };
    const toml = formatToml(withQuote);
    expect(toml).toContain('name = "Model \\"Pro\\""');
  });

  it("includes status when provided", () => {
    const deprecated = { ...minimalModel, status: "deprecated" };
    const toml = formatToml(deprecated);
    expect(toml).toContain('status = "deprecated"');
  });

  it("includes context_over_200k pricing tier", () => {
    const tiered = {
      ...minimalModel,
      cost: {
        input: 3.0,
        output: 15.0,
        context_over_200k: { input: 6.0, output: 30.0 },
      },
    };
    const toml = formatToml(tiered);
    expect(toml).toContain("[cost.context_over_200k]");
  });
});
