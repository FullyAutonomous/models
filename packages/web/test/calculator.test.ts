import { describe, expect, it } from "bun:test";

// ── Pure cost calculation logic ───────────────────────────────────────────────

interface PricingEntry {
  key: string;
  name: string;
  provider: string;
  input: number;
  output: number;
  cache_read?: number;
}

function calcTotalCost(
  entry: PricingEntry,
  inputTokens: number,
  outputTokens: number,
  cacheTokens: number,
  requests: number,
): number {
  const perRequest =
    (inputTokens * entry.input) / 1_000_000 +
    (outputTokens * entry.output) / 1_000_000 +
    (cacheTokens * (entry.cache_read ?? 0)) / 1_000_000;
  return perRequest * requests;
}

function rankModels(
  entries: PricingEntry[],
  inputTokens: number,
  outputTokens: number,
  cacheTokens: number,
  requests: number,
  limit = 20,
): Array<{ entry: PricingEntry; total: number }> {
  return entries
    .map((entry) => ({
      entry,
      total: calcTotalCost(entry, inputTokens, outputTokens, cacheTokens, requests),
    }))
    .sort((a, b) => a.total - b.total)
    .slice(0, limit);
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const gpt4o: PricingEntry = {
  key: "openai/gpt-4o",
  name: "GPT-4o",
  provider: "OpenAI",
  input: 2.5,
  output: 10.0,
  cache_read: 1.25,
};

const gpt4oMini: PricingEntry = {
  key: "openai/gpt-4o-mini",
  name: "GPT-4o Mini",
  provider: "OpenAI",
  input: 0.15,
  output: 0.6,
  cache_read: 0.075,
};

const claudeOpus: PricingEntry = {
  key: "anthropic/claude-opus-4-6",
  name: "Claude Opus 4.6",
  provider: "Anthropic",
  input: 5.0,
  output: 25.0,
  cache_read: 0.5,
};

const freeModel: PricingEntry = {
  key: "zai/glm-4.5-flash",
  name: "GLM-4.5 Flash",
  provider: "Zai",
  input: 0.0,
  output: 0.0,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Cost calculation", () => {
  it("calculates zero cost for free model", () => {
    expect(calcTotalCost(freeModel, 1000, 500, 0, 10000)).toBe(0);
  });

  it("calculates correct monthly cost for simple case", () => {
    // 1K input @ $2.5/1M + 500 output @ $10/1M = $0.0025 + $0.005 = $0.0075 per request
    // * 10,000 requests = $75/month
    const result = calcTotalCost(gpt4o, 1000, 500, 0, 10000);
    expect(result).toBeCloseTo(75, 4);
  });

  it("calculates correct cost with cache tokens", () => {
    // 1K input @ $2.5/1M + 500 output @ $10/1M + 200 cache @ $1.25/1M
    // = $0.0025 + $0.005 + $0.00025 = $0.00775 per request * 10,000 = $77.5
    const result = calcTotalCost(gpt4o, 1000, 500, 200, 10000);
    expect(result).toBeCloseTo(77.5, 4);
  });

  it("calculates cheaper model correctly", () => {
    // gpt-4o-mini: 1K input @ $0.15/1M + 500 output @ $0.6/1M = $0.00015 + $0.0003 = $0.00045/req
    // * 10,000 = $4.50
    const result = calcTotalCost(gpt4oMini, 1000, 500, 0, 10000);
    expect(result).toBeCloseTo(4.5, 4);
  });

  it("scales linearly with request count", () => {
    const oneRequest = calcTotalCost(gpt4o, 1000, 500, 0, 1);
    const tenRequests = calcTotalCost(gpt4o, 1000, 500, 0, 10);
    expect(tenRequests).toBeCloseTo(oneRequest * 10, 8);
  });

  it("handles zero tokens", () => {
    expect(calcTotalCost(gpt4o, 0, 0, 0, 1000)).toBe(0);
  });

  it("handles model without cache_read when cache tokens provided", () => {
    const noCacheModel: PricingEntry = { key: "test", name: "Test", provider: "Test", input: 1.0, output: 2.0 };
    // cache_read defaults to 0 so cache tokens have no cost
    const result = calcTotalCost(noCacheModel, 1000, 1000, 500, 1);
    expect(result).toBeCloseTo((1000 * 1 + 1000 * 2) / 1_000_000, 8);
  });
});

describe("Model ranking", () => {
  const models = [gpt4o, gpt4oMini, claudeOpus, freeModel];

  it("ranks cheapest model first", () => {
    const ranked = rankModels(models, 1000, 500, 0, 10000);
    expect(ranked[0]!.entry.key).toBe("zai/glm-4.5-flash"); // free
    expect(ranked[1]!.entry.key).toBe("openai/gpt-4o-mini"); // cheapest paid
  });

  it("ranks most expensive model last", () => {
    const ranked = rankModels(models, 1000, 500, 0, 10000);
    expect(ranked[ranked.length - 1]!.entry.key).toBe("anthropic/claude-opus-4-6");
  });

  it("respects limit", () => {
    const ranked = rankModels(models, 1000, 500, 0, 10000, 2);
    expect(ranked.length).toBe(2);
  });

  it("includes total cost in results", () => {
    const ranked = rankModels(models, 1000, 500, 0, 10000);
    expect(typeof ranked[0]!.total).toBe("number");
    expect(ranked[0]!.total).toBeGreaterThanOrEqual(0);
  });

  it("total costs are in ascending order", () => {
    const ranked = rankModels(models, 1000, 500, 0, 10000);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.total).toBeGreaterThanOrEqual(ranked[i - 1]!.total);
    }
  });

  it("handles empty model list", () => {
    expect(rankModels([], 1000, 500, 0, 10000)).toEqual([]);
  });

  it("higher output token count increases ranking separation", () => {
    // With high output tokens, models with low output cost rank higher
    // gpt-4o-mini output=$0.60, gpt-4o output=$10.00
    const ranked = rankModels([gpt4o, gpt4oMini], 100, 100000, 0, 1);
    expect(ranked[0]!.entry.key).toBe("openai/gpt-4o-mini");
  });
});
