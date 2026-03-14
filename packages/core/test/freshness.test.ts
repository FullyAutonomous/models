import { describe, expect, it } from "bun:test";

// ── Pure freshness helpers ────────────────────────────────────────────────────

function daysSince(dateStr: string, now: Date = new Date()): number {
  const d = new Date(dateStr.length === 7 ? `${dateStr}-01` : dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function isStale(dateStr: string, staleDays: number, now: Date = new Date()): boolean {
  return daysSince(dateStr, now) > staleDays;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const NOW = new Date("2026-03-14");

describe("daysSince", () => {
  it("returns 0 for today", () => {
    expect(daysSince("2026-03-14", NOW)).toBe(0);
  });

  it("returns 1 for yesterday", () => {
    expect(daysSince("2026-03-13", NOW)).toBe(1);
  });

  it("returns correct count for YYYY-MM format (treats as first of month)", () => {
    // "2026-03" = March 1, from March 14 = 13 days
    expect(daysSince("2026-03", NOW)).toBe(13);
  });

  it("returns correct count for YYYY-MM-DD format", () => {
    expect(daysSince("2026-01-01", NOW)).toBe(72);
  });

  it("returns Infinity for invalid date strings", () => {
    expect(daysSince("invalid-date", NOW)).toBe(Infinity);
    expect(daysSince("", NOW)).toBe(Infinity);
  });

  it("returns large numbers for old dates", () => {
    expect(daysSince("2024-01-01", NOW)).toBeGreaterThan(365);
  });
});

describe("isStale", () => {
  it("marks models not updated in > staleDays as stale", () => {
    // 100 days ago vs threshold of 90
    expect(isStale("2025-12-04", 90, NOW)).toBe(true);
  });

  it("does not mark recent models as stale", () => {
    // 10 days ago vs threshold of 90
    expect(isStale("2026-03-04", 90, NOW)).toBe(false);
  });

  it("marks exactly staleDays as not stale", () => {
    // 90 days ago = not stale (threshold is > staleDays, not >=)
    const ninetyDaysAgo = new Date(NOW);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dateStr = ninetyDaysAgo.toISOString().split("T")[0]!;
    expect(isStale(dateStr, 90, NOW)).toBe(false);
  });

  it("marks staleDays+1 as stale", () => {
    const ninetyOneDaysAgo = new Date(NOW);
    ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91);
    const dateStr = ninetyOneDaysAgo.toISOString().split("T")[0]!;
    expect(isStale(dateStr, 90, NOW)).toBe(true);
  });

  it("invalid dates are always considered stale", () => {
    expect(isStale("invalid", 90, NOW)).toBe(true);
  });

  it("uses customizable staleDays threshold", () => {
    // 30 days ago
    const dateStr = "2026-02-12";
    expect(isStale(dateStr, 90, NOW)).toBe(false);  // not stale at 90 days
    expect(isStale(dateStr, 20, NOW)).toBe(true);   // stale at 20 days
  });
});

describe("Freshness report logic", () => {
  const models = [
    { id: "model-a", last_updated: "2026-03-10" }, // 4 days ago
    { id: "model-b", last_updated: "2025-11-01" }, // ~133 days ago
    { id: "model-c", last_updated: "2024-01-01" }, // very old
    { id: "model-d", last_updated: "2026-03-01" }, // 13 days ago
  ];

  it("correctly identifies stale models at 90-day threshold", () => {
    const stale = models.filter(m => isStale(m.last_updated, 90, NOW));
    expect(stale).toHaveLength(2);
    expect(stale.map(m => m.id)).toContain("model-b");
    expect(stale.map(m => m.id)).toContain("model-c");
  });

  it("correctly identifies stale models at 30-day threshold", () => {
    const stale = models.filter(m => isStale(m.last_updated, 30, NOW));
    // model-b (~133 days) and model-c (old) are stale
    expect(stale.length).toBeGreaterThanOrEqual(2);
  });

  it("no stale models at 365-day threshold", () => {
    const stale = models.filter(m => isStale(m.last_updated, 365, NOW));
    // Only model-c (2024-01-01 = ~437 days ago) is stale at 365 days
    expect(stale).toHaveLength(1);
    expect(stale[0]!.id).toBe("model-c");
  });

  it("calculates correct stale percentage", () => {
    const stale = models.filter(m => isStale(m.last_updated, 90, NOW));
    const pct = (stale.length / models.length) * 100;
    expect(pct).toBe(50);
  });
});
