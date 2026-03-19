import { describe, test, expect, beforeAll } from "bun:test";
import { getProviders, resetCache } from "../src/providers";
import path from "path";

const DIST = path.resolve(__dirname, "../../../packages/web/dist");

describe("getProviders", () => {
  beforeAll(() => resetCache());

  test("loads providers from dist", async () => {
    const providers = await getProviders(DIST);
    expect(typeof providers).toBe("object");
    const keys = Object.keys(providers);
    expect(keys.length).toBeGreaterThan(0);
  });

  test("returns same reference on second call (cached)", async () => {
    const a = await getProviders(DIST);
    const b = await getProviders(DIST);
    expect(a).toBe(b);
  });
});
