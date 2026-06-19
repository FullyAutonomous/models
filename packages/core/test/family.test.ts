import { describe, expect, it } from "bun:test";
import { ModelFamilyValues, ModelFamily } from "../src/family.js";
import { inferKimiFamily } from "../src/family.js";

describe("ModelFamilyValues", () => {
  it("contains no duplicate entries", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const value of ModelFamilyValues) {
      if (seen.has(value)) {
        duplicates.push(value);
      }
      seen.add(value);
    }
    expect(duplicates).toEqual([]);
  });

  it("parses valid family values", () => {
    expect(ModelFamily.safeParse("trinity").success).toBe(true);
    expect(ModelFamily.safeParse("claude").success).toBe(true);
    expect(ModelFamily.safeParse("gpt").success).toBe(true);
    expect(ModelFamily.safeParse("gemini").success).toBe(true);
  });

  it("rejects invalid family values", () => {
    expect(ModelFamily.safeParse("not-a-real-family").success).toBe(false);
    expect(ModelFamily.safeParse("").success).toBe(false);
    expect(ModelFamily.safeParse(123).success).toBe(false);
  });

  it("trinity appears exactly once", () => {
    const count = ModelFamilyValues.filter((v) => v === "trinity").length;
    expect(count).toBe(1);
  });
});

describe("inferKimiFamily", () => {
  it("ignores K2 versions", () => {
    expect(inferKimiFamily("moonshotai/kimi-k2.5")).toBe("kimi-k2");
    expect(inferKimiFamily("moonshotai/kimi-k2.7-code")).toBe("kimi-k2");
    expect(inferKimiFamily("Kimi K2.6")).toBe("kimi-k2");
  });

  it("preserves thinking variants", () => {
    expect(inferKimiFamily("moonshotai/kimi-k2-thinking")).toBe("kimi-thinking");
    expect(inferKimiFamily("Kimi K2.5 Thinking")).toBe("kimi-thinking");
    expect(inferKimiFamily("moonshotai/kimi-k2.6:thinking")).toBe("kimi-thinking");
  });
});