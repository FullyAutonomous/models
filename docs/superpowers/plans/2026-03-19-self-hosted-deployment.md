# Self-Hosted Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cloudflare Workers + SST deployment with a self-hosted Bun HTTP server behind Caddy, deployed to a Linux/Ubuntu dedicated server via GitHub Actions SSH.

**Architecture:** A new `packages/server/` Bun HTTP server replaces `packages/function/src/worker.ts`, translating all Cloudflare-specific APIs (asset bindings, `cf-*` headers, `ctx.waitUntil`) to standard Bun equivalents. Caddy sits in front handling TLS via Let's Encrypt and proxies all traffic to the Bun process. GitHub Actions builds the web dist, rsyncs it and the server package to the server, then restarts a systemd service.

**Tech Stack:** Bun 1.x (HTTP server + test runner), Caddy 2.x (reverse proxy + TLS), systemd (process management), GitHub Actions (CI/CD via SSH + rsync)

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `packages/server/package.json` | Server package metadata |
| Create | `packages/server/src/server.ts` | Bun HTTP server — all routing logic |
| Create | `packages/server/src/static.ts` | Static file serving helper (path safety, content-type) |
| Create | `packages/server/src/analytics.ts` | PostHog fire-and-forget tracking |
| Create | `packages/server/src/providers.ts` | Cached provider data loader |
| Create | `packages/server/test/server.test.ts` | Integration tests for all routes |
| Create | `Caddyfile` | Caddy reverse proxy + TLS config |
| Create | `deploy/models-dev.service` | systemd unit for the Bun server |
| Modify | `.github/workflows/deploy.yml` | Replace SST/Cloudflare with SSH+rsync deploy |
| Modify | `package.json` | Remove `sst`/`@cloudflare/workers-types`, add server scripts |
| Delete | `sst.config.ts` | No longer needed |

---

## Task 1: Server package scaffold

**Files:**
- Create: `packages/server/package.json`

- [ ] **Step 1.1: Create package.json**

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "@models.dev/server",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/server.ts",
    "dev": "bun --hot run src/server.ts"
  },
  "devDependencies": {
    "@tsconfig/bun": "catalog:",
    "@types/bun": "catalog:"
  }
}
```

- [ ] **Step 1.2: Create tsconfig.json**

```json
{
  "extends": "@tsconfig/bun/tsconfig.json"
}
```
Save to: `packages/server/tsconfig.json`

- [ ] **Step 1.3: Commit**

```bash
git add packages/server/
git commit -m "feat(server): scaffold server package"
```

---

## Task 2: Provider data loader

The search and schema endpoints both need to read `_api.json`. This module loads it once and caches it in memory — avoids re-reading the 1.6 MB file on every request.

**Files:**
- Create: `packages/server/src/providers.ts`

- [ ] **Step 2.1: Write the failing test**

Create `packages/server/test/providers.test.ts`:

```typescript
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
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd packages/server && bun test test/providers.test.ts
```
Expected: FAIL — `Cannot find module '../src/providers'`

- [ ] **Step 2.3: Implement providers.ts**

```typescript
import path from "path";

export type ModelRecord = Record<string, unknown>;
export type ProviderRecord = {
  id: string;
  name: string;
  models: Record<string, ModelRecord>;
};
export type ProvidersMap = Record<string, ProviderRecord>;

let cache: ProvidersMap | null = null;

export async function getProviders(distDir: string): Promise<ProvidersMap> {
  if (!cache) {
    const file = Bun.file(path.join(distDir, "_api.json"));
    cache = await file.json();
  }
  return cache!;
}

/** Call between tests to clear the in-memory cache */
export function resetCache(): void {
  cache = null;
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd packages/server && bun test test/providers.test.ts
```
Expected: PASS (requires `packages/web/dist/_api.json` — run `cd packages/web && bun run script/build.ts` first if missing)

- [ ] **Step 2.5: Commit**

```bash
git add packages/server/src/providers.ts packages/server/test/providers.test.ts
git commit -m "feat(server): add cached provider data loader"
```

---

## Task 3: Static file helper

Translates URL pathnames to safe filesystem reads, guarding against path traversal.

**Files:**
- Create: `packages/server/src/static.ts`

- [ ] **Step 3.1: Write the failing test**

Create `packages/server/test/static.test.ts`:

```typescript
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
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd packages/server && bun test test/static.test.ts
```
Expected: FAIL — `Cannot find module '../src/static'`

- [ ] **Step 3.3: Implement static.ts**

```typescript
import path from "path";

/**
 * Resolves a URL pathname to an absolute file path within distDir.
 * Returns null if the resolved path escapes distDir (path traversal guard).
 * Strips the leading "/" and any query string before resolving.
 */
export function safeResolvePath(distDir: string, pathname: string): string | null {
  // Guard against null-byte injection
  if (pathname.includes('\x00')) return null;

  // Strip leading slash; decode URI components
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\//, "");
  } catch {
    return null;
  }

  const resolved = path.resolve(distDir, relative);

  // Guard: resolved path must start with distDir
  if (!resolved.startsWith(path.resolve(distDir) + path.sep) &&
      resolved !== path.resolve(distDir)) {
    return null;
  }

  return resolved;
}

/**
 * Serves a static file from distDir for the given URL pathname.
 * Returns a 404 Response if the file does not exist or path is unsafe.
 */
export async function serveStatic(
  distDir: string,
  pathname: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const filePath = safeResolvePath(distDir, pathname);
  if (!filePath) {
    return new Response("Not Found", { status: 404 });
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(file, {
    status: 200,
    headers: extraHeaders,
  });
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
cd packages/server && bun test test/static.test.ts
```
Expected: PASS

- [ ] **Step 3.5: Commit**

```bash
git add packages/server/src/static.ts packages/server/test/static.test.ts
git commit -m "feat(server): add safe static file helper"
```

---

## Task 4: Analytics helper

Fire-and-forget PostHog tracking. Mirrors the worker's `trackHit` but uses standard headers.

**Files:**
- Create: `packages/server/src/analytics.ts`

- [ ] **Step 4.1: Implement analytics.ts**

No unit test needed — it's a fire-and-forget side effect. Covered implicitly by server integration tests (the server doesn't crash when analytics is called).

```typescript
/**
 * Sends a hit event to PostHog for requests from opencode/bun user agents.
 * Errors are swallowed — analytics must never fail a request.
 */
export function trackHit(
  request: Request,
  posthogToken: string,
  pathname: string,
): void {
  const agent = request.headers.get("user-agent") || "unknown";
  if (!agent.includes("opencode") && !agent.includes("bun")) return;
  if (!posthogToken) return;

  // X-Forwarded-For is set by Caddy for the real client IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  fetch("https://us.i.posthog.com/i/v0/e/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: posthogToken,
      event: "hit",
      distinct_id: ip,
      properties: {
        $process_person_profile: false,
        user_agent: agent,
        path: pathname,
      },
    }),
  }).catch(() => {
    // Swallow — never fail a request due to analytics
  });
}
```

- [ ] **Step 4.2: Commit**

```bash
git add packages/server/src/analytics.ts
git commit -m "feat(server): add PostHog analytics helper"
```

---

## Task 5: Bun HTTP server

The main server. Translates the Cloudflare Worker routing logic to `Bun.serve()`.

**Files:**
- Create: `packages/server/src/server.ts`

- [ ] **Step 5.1: Write the failing integration tests**

Create `packages/server/test/server.test.ts`:

```typescript
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
  // Enum values should be in provider/model format
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
  expect(res.status).toBe(200); // default logo served
});

test("GET /unknown-path redirects to /", async () => {
  const res = await fetch(`${base}/some-unknown-path`, { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
cd packages/server && bun test test/server.test.ts
```
Expected: FAIL — `Cannot find module '../src/server'`

- [ ] **Step 5.3: Implement server.ts**

```typescript
import path from "path";
import { getProviders } from "./providers";
import { serveStatic } from "./static";
import { trackHit } from "./analytics";

const API_VERSION = "1";

interface ServerOptions {
  distDir: string;
  port: number;
  posthogToken: string;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "X-API-Version": API_VERSION,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      ...corsHeaders(),
    },
  });
}

async function addCorsHeaders(resp: Response): Promise<Response> {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, headers });
}

export function createServer(opts: ServerOptions) {
  const { distDir, port, posthogToken } = opts;

  return Bun.serve({
    port,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD, OPTIONS" },
        });
      }

      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(),
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Strip /v1 prefix (versioned aliases)
      const routePath = url.pathname.startsWith("/v1/")
        ? url.pathname.slice(3)
        : url.pathname;

      trackHit(request, posthogToken, routePath);

      // ── /model-schema.json ────────────────────────────────────────────────
      if (routePath === "/model-schema.json") {
        const providers = await getProviders(distDir);
        const modelIds: string[] = [];
        for (const [providerId, provider] of Object.entries(providers)) {
          for (const modelId of Object.keys(provider.models)) {
            modelIds.push(`${providerId}/${modelId}`);
          }
        }
        return jsonResponse({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: "https://models.dev/model-schema.json",
          $defs: {
            Model: {
              type: "string",
              enum: modelIds.sort(),
              description: "AI model identifier in provider/model format",
            },
          },
        });
      }

      // ── /api.json ─────────────────────────────────────────────────────────
      if (routePath === "/api.json") {
        return addCorsHeaders(await serveStatic(distDir, "/_api.json"));
      }

      // ── /api/providers.json ───────────────────────────────────────────────
      if (routePath === "/api/providers.json") {
        return addCorsHeaders(await serveStatic(distDir, "/_api/providers.json"));
      }

      // ── /api/providers/:id.json ───────────────────────────────────────────
      const providerMatch = routePath.match(/^\/api\/providers\/([^/]+)\.json$/);
      if (providerMatch) {
        const resp = await serveStatic(distDir, `/_api/providers/${providerMatch[1]}.json`);
        if (resp.status === 404) return jsonResponse({ error: "Provider not found" }, 404);
        return addCorsHeaders(resp);
      }

      // ── /api/models/:provider/:model.json ─────────────────────────────────
      const modelMatch = routePath.match(/^\/api\/models\/(.+?)\.json$/);
      if (modelMatch) {
        const resp = await serveStatic(distDir, `/_api/models/${modelMatch[1]}.json`);
        if (resp.status === 404) return jsonResponse({ error: "Model not found" }, 404);
        return addCorsHeaders(resp);
      }

      // ── /api/search.json ──────────────────────────────────────────────────
      if (routePath === "/api/search.json") {
        const providers = await getProviders(distDir);
        const params = url.searchParams;
        const q = params.get("q")?.toLowerCase();
        const filterProvider = params.get("provider")?.split(",").map((s) => s.trim());
        const filterFamily = params.get("family");
        const filterReasoning = params.get("reasoning");
        const filterToolCall = params.get("tool_call");
        const filterStructured = params.get("structured_output");
        const filterOpenWeights = params.get("open_weights");
        const filterMinContext = params.get("min_context") ? parseInt(params.get("min_context")!, 10) : undefined;
        const filterMaxInput = params.get("max_input_cost") ? parseFloat(params.get("max_input_cost")!) : undefined;
        const filterMaxOutput = params.get("max_output_cost") ? parseFloat(params.get("max_output_cost")!) : undefined;
        const filterModalityInput = params.get("modality_input");
        const filterStatus = params.get("status");
        const limit = Math.min(parseInt(params.get("limit") ?? "100", 10), 1000);
        const offset = parseInt(params.get("offset") ?? "0", 10);

        const results: unknown[] = [];

        for (const [providerId, provider] of Object.entries(providers)) {
          if (filterProvider && !filterProvider.includes(providerId)) continue;
          for (const [modelId, model] of Object.entries(provider.models)) {
            const m = model as Record<string, unknown>;
            if (q) {
              const text = `${providerId} ${modelId} ${m["name"] ?? ""} ${m["family"] ?? ""}`.toLowerCase();
              if (!text.includes(q)) continue;
            }
            if (filterReasoning != null && m["reasoning"] !== (filterReasoning === "true")) continue;
            if (filterToolCall != null && m["tool_call"] !== (filterToolCall === "true")) continue;
            if (filterStructured != null && m["structured_output"] !== (filterStructured === "true")) continue;
            if (filterOpenWeights != null && m["open_weights"] !== (filterOpenWeights === "true")) continue;
            if (filterFamily && m["family"] !== filterFamily) continue;
            const lim = m["limit"] as Record<string, number> | undefined;
            if (filterMinContext != null && (!lim || (lim["context"] ?? 0) < filterMinContext)) continue;
            const cost = m["cost"] as Record<string, number> | undefined;
            if (filterMaxInput != null && (!cost || cost["input"] > filterMaxInput)) continue;
            if (filterMaxOutput != null && (!cost || cost["output"] > filterMaxOutput)) continue;
            if (filterModalityInput) {
              const mods = m["modalities"] as Record<string, string[]> | undefined;
              if (!mods?.["input"]?.includes(filterModalityInput)) continue;
            }
            const status = m["status"] as string | undefined;
            if (filterStatus != null) {
              if (status !== filterStatus) continue;
            } else {
              if (status === "deprecated") continue;
            }
            results.push({ provider: providerId, id: modelId, ...m });
          }
        }

        const total = results.length;
        return jsonResponse({ total, offset, limit, results: results.slice(offset, offset + limit) });
      }

      // ── Homepage ──────────────────────────────────────────────────────────
      if (routePath === "/" || routePath === "/index.html" || routePath === "/index") {
        return serveStatic(distDir, "/_index.html");
      }

      // ── Logos (fallback to default) ───────────────────────────────────────
      if (routePath.startsWith("/logos/")) {
        const resp = await serveStatic(distDir, routePath);
        if (resp.status === 404) return serveStatic(distDir, "/logos/default.svg");
        return resp;
      }

      // ── Other static assets (JS, CSS, fonts, favicons) ───────────────────
      const staticResp = await serveStatic(distDir, routePath);
      if (staticResp.status === 200) return staticResp;

      // ── Catch-all: redirect to homepage ──────────────────────────────────
      return new Response(null, { status: 302, headers: { Location: "/" } });
    },
  });
}

// Entrypoint when run directly
if (import.meta.main) {
  const distDir = process.env.DIST_DIR ?? path.resolve("../web/dist");
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const posthogToken = process.env.POSTHOG_TOKEN ?? "";

  const server = createServer({ distDir, port, posthogToken });
  console.log(`Server running at http://localhost:${server.port}`);
  console.log(`Serving dist from: ${distDir}`);
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

```bash
cd packages/server && bun test test/server.test.ts
```
Expected: All tests PASS

- [ ] **Step 5.5: Commit**

```bash
git add packages/server/src/server.ts packages/server/test/server.test.ts
git commit -m "feat(server): implement Bun HTTP server replacing Cloudflare Worker"
```

---

## Task 6: Caddy config

**Files:**
- Create: `Caddyfile`

- [ ] **Step 6.1: Create Caddyfile**

Replace `your-domain.com` with the actual domain before deploying.

```caddyfile
# Caddyfile — models.dev self-hosted
# Caddy automatically obtains and renews TLS certificates via Let's Encrypt.
# Set the DOMAIN environment variable or replace the placeholder directly.

{$DOMAIN:your-domain.com} {
    # Reverse proxy everything to the Bun server
    reverse_proxy localhost:3000 {
        # Pass real client IP to the Bun server
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Compress responses
    encode gzip zstd

    # Cache static assets aggressively (JS/CSS have hashed filenames)
    @static {
        path *.js *.css *.svg *.png *.ico *.woff2
    }
    header @static Cache-Control "public, max-age=31536000, immutable"

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

- [ ] **Step 6.2: Commit**

```bash
git add Caddyfile
git commit -m "feat(deploy): add Caddyfile for self-hosted TLS + reverse proxy"
```

---

## Task 7: systemd service

**Files:**
- Create: `deploy/models-dev.service`

- [ ] **Step 7.1: Create systemd unit**

```ini
[Unit]
Description=models.dev Bun HTTP server
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/models-dev/server
ExecStart=/usr/local/bin/bun run src/server.ts
Restart=always
RestartSec=5

Environment=PORT=3000
Environment=DIST_DIR=/opt/models-dev/dist
# POSTHOG_TOKEN is loaded from /etc/models-dev/env (EnvironmentFile below)
EnvironmentFile=-/etc/models-dev/env

[Install]
WantedBy=multi-user.target
```

The `/etc/models-dev/env` file on the server should contain:
```
POSTHOG_TOKEN=your_token_here
```

- [ ] **Step 7.2: Commit**

```bash
git add deploy/models-dev.service
git commit -m "feat(deploy): add systemd service unit for Bun server"
```

---

## Task 8: GitHub Actions deploy workflow

Replace the SST/Cloudflare deploy with SSH + rsync.

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Secrets required in GitHub repo settings:**
- `SSH_PRIVATE_KEY` — private key for SSH access to the server
- `SSH_HOST` — server hostname or IP
- `SSH_USER` — SSH username (e.g. `deploy`)

- [ ] **Step 8.1: Rewrite deploy.yml**

```yaml
name: Deploy

on:
  push:
    branches:
      - dev
  workflow_dispatch:

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build web
        run: cd packages/web && bun run script/build.ts

      - name: Configure SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H "${{ secrets.SSH_HOST }}" >> ~/.ssh/known_hosts

      - name: Sync dist to server
        run: |
          rsync -az --delete \
            -e "ssh -i ~/.ssh/deploy_key" \
            packages/web/dist/ \
            ${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }}:/opt/models-dev/dist/

      - name: Sync server package to server
        run: |
          rsync -az --delete \
            --exclude node_modules \
            -e "ssh -i ~/.ssh/deploy_key" \
            packages/server/ \
            ${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }}:/opt/models-dev/server/

      - name: Restart server
        run: |
          ssh -i ~/.ssh/deploy_key \
            ${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }} \
            "sudo systemctl restart models-dev"

      - name: Verify server is up
        run: |
          ssh -i ~/.ssh/deploy_key \
            ${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }} \
            "sleep 2 && sudo systemctl is-active models-dev"
```

- [ ] **Step 8.2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(deploy): replace SST/Cloudflare deploy with SSH+rsync to self-hosted server"
```

---

## Task 9: Remove SST and Cloudflare artifacts

**Files:**
- Delete: `sst.config.ts`
- Modify: `package.json` — remove `sst` and `@cloudflare/workers-types` deps, add server test script

- [ ] **Step 9.1: Delete sst.config.ts**

```bash
git rm sst.config.ts
```

- [ ] **Step 9.2: Update root package.json**

Remove from `dependencies`:
- `"@cloudflare/workers-types"`
- `"sst"`

Update `scripts.test` to include the server package:
```json
"test": "bun test packages/core/test/ packages/web/test/ packages/server/test/"
```

Note: `packages/function/test/` can be removed from the test command too since the Worker is being replaced. Keep `packages/function/` source in the repo for historical reference but stop testing it.

- [ ] **Step 9.3: Run bun install to update lockfile**

```bash
bun install
```

- [ ] **Step 9.4: Run full test suite to confirm nothing broken**

```bash
bun test
```
Expected: All tests pass (core, web, server)

- [ ] **Step 9.5: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: remove SST and Cloudflare dependencies"
```

---

## Task 10: Server setup guide (one-time, on the server)

This is not code — it's the manual steps to prepare the server before the first deploy. Document these so they're repeatable.

Create `deploy/SERVER_SETUP.md`:

```markdown
# Server Setup (one-time)

## 1. Install Bun
curl -fsSL https://bun.sh/install | bash

## 2. Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

## 3. Create deploy user and directories
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /opt/models-dev/{dist,server}
sudo chown -R deploy:deploy /opt/models-dev

## 4. Create env file for secrets
sudo mkdir -p /etc/models-dev
echo "POSTHOG_TOKEN=your_token_here" | sudo tee /etc/models-dev/env
sudo chmod 600 /etc/models-dev/env

## 5. Install systemd service
sudo cp /opt/models-dev/server/../deploy/models-dev.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable models-dev

## 6. Configure Caddy
# Edit /etc/caddy/Caddyfile — copy from repo Caddyfile, set your domain
sudo systemctl restart caddy

## 7. Allow deploy user to restart the service without a password
# Add to /etc/sudoers.d/deploy:
echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart models-dev, /usr/bin/systemctl is-active models-dev" | sudo tee /etc/sudoers.d/deploy

## 8. Add deploy SSH key
# On CI: generate key pair, add public key to /home/deploy/.ssh/authorized_keys
# Add private key as SSH_PRIVATE_KEY secret in GitHub repo settings
```

- [ ] **Step 10.1: Commit**

```bash
git add deploy/SERVER_SETUP.md
git commit -m "docs(deploy): add one-time server setup guide"
```

---

## Done

After all tasks:
1. Server setup steps run on the dedicated server (Task 10)
2. GitHub secrets added: `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`
3. Push to `dev` — the new deploy workflow runs, rsync + restart
4. Verify at `https://your-domain.com` that the UI and API endpoints work
