import { describe, test, expect } from "bun:test";
import { serveStatic, safeResolvePath } from "../src/static";
import path from "path";

const DIST = path.resolve(__dirname, "../../../packages/web/dist");

describe("safeResolvePath", () => {
  test("resolves normal path within dist", () => {
    const result = safeResolvePath(DIST, "/_api.json");
    expect(result).toBe(path.join(DIST, "_api.json"));
  });

  test("blocks path traversal", () => {
    const result = safeResolvePath(DIST, "/../../../etc/passwd");
    expect(result).toBeNull();
  });

  test("blocks encoded traversal", () => {
    const result = safeResolvePath(DIST, "/..%2F..%2Fetc%2Fpasswd");
    expect(result).toBeNull();
  });

  test("blocks null-byte injection", () => {
    const result = safeResolvePath(DIST, "/\x00etc/passwd");
    expect(result).toBeNull();
  });
});

describe("serveStatic", () => {
  test("returns 200 for existing file", async () => {
    const resp = await serveStatic(DIST, "/_api.json");
    expect(resp.status).toBe(200);
  });

  test("returns 404 for missing file", async () => {
    const resp = await serveStatic(DIST, "/does-not-exist.json");
    expect(resp.status).toBe(404);
  });
});
