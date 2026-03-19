import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "../src/server";
import path from "path";

const DIST = path.resolve(__dirname, "../../../packages/web/dist");

let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(() => {
  server = createServer({ distDir: DIST, port: 0, posthogToken: "" });
  base = `http://localhost:${server.port}`;
});

afterAll(() => server.stop());

// ── CORS / method guards ──────────────────────────────────────────────────────

test("OPTIONS returns 204 with CORS headers", async () => {
  const res = await fetch(`${base}/api.json`, { method: "OPTIONS" });
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});

test("POST returns 405", async () => {
  const res = await fetch(`${base}/api.json`, { method: "POST" });
  expect(res.status).toBe(405);
});

// ── Static API routes ─────────────────────────────────────────────────────────

test("GET /api.json returns 200 with CORS", async () => {
  const res = await fetch(`${base}/api.json`);
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  const body = await res.json();
  expect(typeof body).toBe("object");
});

test("GET /api/providers.json returns provider list", async () => {
  const res = await fetch(`${base}/api/providers.json`);
  expect(res.status).toBe(200);
  const body = await res.json() as unknown[];
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBeGreaterThan(0);
});

test("GET /api/providers/anthropic.json returns anthropic provider", async () => {
  const res = await fetch(`${base}/api/providers/anthropic.json`);
  expect(res.status).toBe(200);
  const body = await res.json() as { id: string };
  expect(body.id).toBe("anthropic");
});

test("GET /api/providers/nonexistent.json returns 404", async () => {
  const res = await fetch(`${base}/api/providers/nonexistent.json`);
  expect(res.status).toBe(404);
});

test("GET /api/models/anthropic/claude-sonnet-4-6.json returns model", async () => {
  const res = await fetch(`${base}/api/models/anthropic/claude-sonnet-4-6.json`);
  expect(res.status).toBe(200);
});

// ── Dynamic routes ────────────────────────────────────────────────────────────

test("GET /api/search.json returns paginated results", async () => {
  const res = await fetch(`${base}/api/search.json?limit=5`);
  expect(res.status).toBe(200);
  const body = await res.json() as { total: number; results: unknown[] };
  expect(body.total).toBeGreaterThan(0);
  expect(body.results.length).toBeLessThanOrEqual(5);
});

test("GET /api/search.json filters by provider", async () => {
  const res = await fetch(`${base}/api/search.json?provider=anthropic`);
  expect(res.status).toBe(200);
  const body = await res.json() as { results: { provider: string }[] };
  expect(body.results.every((r) => r.provider === "anthropic")).toBe(true);
});

test("GET /model-schema.json returns JSON Schema with model enum", async () => {
  const res = await fetch(`${base}/model-schema.json`);
  expect(res.status).toBe(200);
  const body = await res.json() as { $defs: { Model: { enum: string[] } } };
  expect(Array.isArray(body.$defs.Model.enum)).toBe(true);
  expect(body.$defs.Model.enum.length).toBeGreaterThan(0);
  expect(body.$defs.Model.enum[0]).toMatch(/^\w[\w-]+\//);
});

// ── /v1/* aliases ─────────────────────────────────────────────────────────────

test("GET /v1/api.json aliases to /api.json", async () => {
  const res = await fetch(`${base}/v1/api.json`);
  expect(res.status).toBe(200);
});

test("GET /v1/api/search.json aliases to /api/search.json", async () => {
  const res = await fetch(`${base}/v1/api/search.json?limit=1`);
  expect(res.status).toBe(200);
});

// ── Homepage + logos ──────────────────────────────────────────────────────────

test("GET / returns HTML", async () => {
  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
});

test("GET /logos/anthropic.svg returns SVG", async () => {
  const res = await fetch(`${base}/logos/anthropic.svg`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("svg");
});

test("GET /logos/nonexistent.svg falls back to default logo", async () => {
  const res = await fetch(`${base}/logos/nonexistent-provider-xyz.svg`);
  expect(res.status).toBe(200);
});

test("GET /unknown-path redirects to /", async () => {
  const res = await fetch(`${base}/some-unknown-path`, { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
});
