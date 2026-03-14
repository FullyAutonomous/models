import { describe, expect, it } from "bun:test";

// ── Pure comparison helpers extracted for testing ─────────────────────────────

interface ModelData {
  name?: string;
  provider?: string;
  input_cost?: number;
  output_cost?: number;
  context?: number;
  reasoning?: boolean;
  [key: string]: unknown;
}

function fmt(value: unknown, isCost = false): string {
  if (value === undefined || value === null) return "-";
  if (isCost) return `$${(value as number).toFixed(2)}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ") || "-";
  if (typeof value === "number") return value.toLocaleString();
  return String(value) || "-";
}

function getBestValue(
  models: ModelData[],
  key: string,
  betterLow?: boolean,
  betterHigh?: boolean,
): unknown {
  const vals = models
    .map((m) => m[key])
    .filter((v) => v !== undefined && v !== null) as number[];
  if (vals.length === 0) return undefined;
  if (betterLow) return Math.min(...vals);
  if (betterHigh) return Math.max(...vals);
  return undefined;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Comparison: fmt formatting", () => {
  it("formats undefined as dash", () => {
    expect(fmt(undefined)).toBe("-");
    expect(fmt(null)).toBe("-");
  });

  it("formats cost with $ prefix", () => {
    expect(fmt(2.5, true)).toBe("$2.50");
    expect(fmt(0, true)).toBe("$0.00");
    expect(fmt(15.123, true)).toBe("$15.12");
  });

  it("formats booleans as Yes/No", () => {
    expect(fmt(true)).toBe("Yes");
    expect(fmt(false)).toBe("No");
  });

  it("formats arrays as comma-separated", () => {
    expect(fmt(["text", "image"])).toBe("text, image");
    expect(fmt([])).toBe("-");
  });

  it("formats numbers with locale separators", () => {
    expect(fmt(128000)).toBe("128,000");
    expect(fmt(1000000)).toBe("1,000,000");
  });

  it("formats strings as-is", () => {
    expect(fmt("openai")).toBe("openai");
    expect(fmt("")).toBe("-");
  });
});

describe("Comparison: getBestValue", () => {
  const models: ModelData[] = [
    { input_cost: 2.5, context: 128000 },
    { input_cost: 1.1, context: 200000 },
    { input_cost: 5.0, context: 32000 },
  ];

  it("returns minimum for betterLow", () => {
    expect(getBestValue(models, "input_cost", true)).toBe(1.1);
  });

  it("returns maximum for betterHigh", () => {
    expect(getBestValue(models, "context", false, true)).toBe(200000);
  });

  it("returns undefined when no direction specified", () => {
    expect(getBestValue(models, "input_cost")).toBeUndefined();
  });

  it("returns undefined when all values are missing", () => {
    expect(getBestValue(models, "nonexistent", true)).toBeUndefined();
  });

  it("handles models with missing values", () => {
    const partial: ModelData[] = [
      { input_cost: 2.5 },
      {}, // missing cost
      { input_cost: 1.0 },
    ];
    expect(getBestValue(partial, "input_cost", true)).toBe(1.0);
  });

  it("returns correct best with single model", () => {
    const single: ModelData[] = [{ context: 128000 }];
    expect(getBestValue(single, "context", false, true)).toBe(128000);
  });
});

describe("Comparison: model selection constraints", () => {
  const MAX_COMPARE = 5;
  const selectedModels = new Set<string>();

  function toggleCompare(modelKey: string): boolean {
    if (selectedModels.has(modelKey)) {
      selectedModels.delete(modelKey);
      return true;
    }
    if (selectedModels.size >= MAX_COMPARE) {
      return false; // rejected
    }
    selectedModels.add(modelKey);
    return true;
  }

  it("allows selecting up to MAX_COMPARE models", () => {
    selectedModels.clear();
    for (let i = 0; i < MAX_COMPARE; i++) {
      expect(toggleCompare(`model-${i}`)).toBe(true);
    }
    expect(selectedModels.size).toBe(MAX_COMPARE);
  });

  it("rejects selection beyond MAX_COMPARE", () => {
    selectedModels.clear();
    for (let i = 0; i < MAX_COMPARE; i++) {
      toggleCompare(`model-${i}`);
    }
    expect(toggleCompare("model-extra")).toBe(false);
    expect(selectedModels.size).toBe(MAX_COMPARE);
  });

  it("allows deselecting a model", () => {
    selectedModels.clear();
    toggleCompare("model-a");
    toggleCompare("model-a");
    expect(selectedModels.size).toBe(0);
  });

  it("requires at least 2 to compare", () => {
    selectedModels.clear();
    toggleCompare("model-a");
    expect(selectedModels.size < 2).toBe(true);
    toggleCompare("model-b");
    expect(selectedModels.size >= 2).toBe(true);
  });
});
