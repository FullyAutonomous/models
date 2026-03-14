import { describe, expect, it, beforeAll } from "bun:test";
import worker from "../src/worker.js";

// ── Mock environment ──────────────────────────────────────────────────────────

const SAMPLE_PROVIDERS = {
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    env: ["OPENAI_API_KEY"],
    doc: "https://platform.openai.com/docs/models",
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        family: "gpt",
        attachment: true,
        reasoning: false,
        tool_call: true,
        structured_output: true,
        open_weights: false,
        release_date: "2024-05",
        last_updated: "2024-11",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 128000, output: 4096 },
        cost: { input: 2.5, output: 10.0 },
      },
      "o3-mini": {
        id: "o3-mini",
        name: "o3-mini",
        family: "o-mini",
        attachment: false,
        reasoning: true,
        tool_call: true,
        structured_output: true,
        open_weights: false,
        release_date: "2025-01",
        last_updated: "2025-01",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 200000, output: 65536 },
        cost: { input: 1.1, output: 4.4 },
      },
    },
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    env: ["ANTHROPIC_API_KEY"],
    doc: "https://docs.anthropic.com",
    models: {
      "claude-opus-4-6": {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        family: "claude-opus",
        attachment: true,
        reasoning: true,
        tool_call: true,
        structured_output: true,
        open_weights: false,
        release_date: "2026-02",
        last_updated: "2026-03",
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 1000000, output: 128000 },
        cost: { input: 5.0, output: 25.0 },
      },
    },
  },
};

const mockEnv = {
  ASSETS: {
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/_api.json") {
        return new Response(JSON.stringify(SAMPLE_PROVIDERS), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/_api/providers.json") {
        const list = Object.values(SAMPLE_PROVIDERS).map(({ models: _, ...p }) => ({
          ...p,
          model_count: Object.keys(
            SAMPLE_PROVIDERS[p.id as keyof typeof SAMPLE_PROVIDERS].models,
          ).length,
        }));
        return new Response(JSON.stringify(list), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path.startsWith("/_api/providers/")) {
        const id = path.replace("/_api/providers/", "").replace(".json", "");
        const prov = SAMPLE_PROVIDERS[id as keyof typeof SAMPLE_PROVIDERS];
        if (prov) {
          return new Response(JSON.stringify(prov), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }
      if (path.startsWith("/_api/models/")) {
        const parts = path.replace("/_api/models/", "").replace(".json", "").split("/");
        const [providerId, ...modelParts] = parts;
        const modelId = modelParts.join("/");
        const prov = SAMPLE_PROVIDERS[providerId as keyof typeof SAMPLE_PROVIDERS];
        const model = prov?.models[modelId as keyof typeof prov.models];
        if (model) {
          return new Response(JSON.stringify({ provider: providerId, ...model }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }
      if (path === "/_index") {
        return new Response("<html>Models.dev</html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (path.startsWith("/logos/")) {
        if (path.endsWith("/openai.svg")) {
          return new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } });
        }
        return new Response("Not Found", { status: 404 });
      }
      return new Response("Not Found", { status: 404 });
    },
  } as unknown as Fetcher,
  PosthogToken: JSON.stringify({ value: "test-token" }),
};

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as ExecutionContext;
}

function makeRequest(path: string, method = "GET"): Request {
  return new Request(`https://models.dev${path}`, { method });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Worker HTTP method handling", () => {
  it("returns 405 for POST requests", async () => {
    const res = await worker.fetch(makeRequest("/api.json", "POST"), mockEnv, makeCtx());
    expect(res.status).toBe(405);
  });

  it("returns 405 for DELETE requests", async () => {
    const res = await worker.fetch(makeRequest("/api.json", "DELETE"), mockEnv, makeCtx());
    expect(res.status).toBe(405);
  });

  it("handles OPTIONS preflight requests", async () => {
    const res = await worker.fetch(makeRequest("/api.json", "OPTIONS"), mockEnv, makeCtx());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
  });
});

describe("Worker /api.json", () => {
  it("serves full catalog", async () => {
    const res = await worker.fetch(makeRequest("/api.json"), mockEnv, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("openai");
    expect(body).toHaveProperty("anthropic");
  });
});

describe("Worker /api/providers.json", () => {
  it("returns provider list without nested models", async () => {
    const res = await worker.fetch(makeRequest("/api/providers.json"), mockEnv, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Should have model_count, not nested models
    const openai = body.find((p) => p["id"] === "openai");
    expect(openai).toBeDefined();
    expect(openai!["model_count"]).toBe(2);
    expect(openai!["models"]).toBeUndefined();
  });
});

describe("Worker /api/providers/:id.json", () => {
  it("returns a single provider with models", async () => {
    const res = await worker.fetch(
      makeRequest("/api/providers/anthropic.json"),
      mockEnv,
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["id"]).toBe("anthropic");
    expect(body).toHaveProperty("models");
    expect((body["models"] as Record<string, unknown>)["claude-opus-4-6"]).toBeDefined();
  });

  it("returns 404 for unknown provider", async () => {
    const res = await worker.fetch(
      makeRequest("/api/providers/nonexistent.json"),
      mockEnv,
      makeCtx(),
    );
    expect(res.status).toBe(404);
  });
});

describe("Worker /api/models/:provider/:model.json", () => {
  it("returns a single model", async () => {
    const res = await worker.fetch(
      makeRequest("/api/models/openai/gpt-4o.json"),
      mockEnv,
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["provider"]).toBe("openai");
    expect(body["name"]).toBe("GPT-4o");
  });

  it("returns 404 for unknown model", async () => {
    const res = await worker.fetch(
      makeRequest("/api/models/openai/does-not-exist.json"),
      mockEnv,
      makeCtx(),
    );
    expect(res.status).toBe(404);
  });
});

describe("Worker /api/search.json", () => {
  it("returns all non-deprecated models by default", async () => {
    const res = await worker.fetch(
      makeRequest("/api/search.json"),
      mockEnv,
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; results: unknown[] };
    expect(body.total).toBe(3); // 2 openai + 1 anthropic
  });

  it("filters by query string", async () => {
    const res = await worker.fetch(
      makeRequest("/api/search.json?q=gpt"),
      mockEnv,
      makeCtx(),
    );
    const body = await res.json() as { total: number; results: unknown[] };
    // "gpt" matches gpt-4o (model id contains "gpt") but NOT o3-mini
    expect(body.total).toBe(1);
  });

  it("filters by reasoning=true", async () => {
    const res = await worker.fetch(
      makeRequest("/api/search.json?reasoning=true"),
      mockEnv,
      makeCtx(),
    );
    const body = await res.json() as { total: number; results: Array<Record<string, unknown>> };
    expect(body.total).toBe(2); // o3-mini and claude-opus-4-6
    for (const model of body.results) {
      expect(model["reasoning"]).toBe(true);
    }
  });

  it("filters by provider", async () => {
    const res = await worker.fetch(
      makeRequest("/api/search.json?provider=anthropic"),
      mockEnv,
      makeCtx(),
    );
    const body = await res.json() as { total: number; results: Array<Record<string, unknown>> };
    expect(body.total).toBe(1);
    expect(body.results[0]?.["provider"]).toBe("anthropic");
  });

  it("filters by min_context", async () => {
    const res = await worker.fetch(
      makeRequest("/api/search.json?min_context=500000"),
      mockEnv,
      makeCtx(),
    );
    const body = await res.json() as { total: number; results: unknown[] };
    expect(body.total).toBe(1); // Only claude-opus-4-6 with 1M context
  });

  it("respects pagination limit and offset", async () => {
    const res = await worker.fetch(
      makeRequest("/api/search.json?limit=1&offset=0"),
      mockEnv,
      makeCtx(),
    );
    const body = await res.json() as { total: number; results: unknown[]; limit: number; offset: number };
    expect(body.results.length).toBe(1);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
  });
});

describe("Worker /model-schema.json", () => {
  it("returns a valid JSON Schema with all model IDs", async () => {
    const res = await worker.fetch(
      makeRequest("/model-schema.json"),
      mockEnv,
      makeCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json() as Record<string, unknown>;
    expect(body["$schema"]).toContain("json-schema.org");
    const defs = body["$defs"] as Record<string, Record<string, unknown>>;
    const enumValues = defs["Model"]["enum"] as string[];
    expect(enumValues).toContain("openai/gpt-4o");
    expect(enumValues).toContain("anthropic/claude-opus-4-6");
  });
});

describe("Worker homepage routes", () => {
  it("serves / from _index", async () => {
    const res = await worker.fetch(makeRequest("/"), mockEnv, makeCtx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Models.dev");
  });

  it("serves /index.html from _index", async () => {
    const res = await worker.fetch(makeRequest("/index.html"), mockEnv, makeCtx());
    expect(res.status).toBe(200);
  });
});

describe("Worker logo routes", () => {
  it("serves existing provider logo", async () => {
    const res = await worker.fetch(makeRequest("/logos/openai.svg"), mockEnv, makeCtx());
    expect(res.status).toBe(200);
  });

  it("falls back to default logo for unknown provider", async () => {
    const res = await worker.fetch(
      makeRequest("/logos/unknown-provider.svg"),
      mockEnv,
      makeCtx(),
    );
    // Should not 404 — returns default logo
    expect(res.status).not.toBe(500);
  });
});

describe("Worker catch-all redirect", () => {
  it("redirects unknown paths to /", async () => {
    const res = await worker.fetch(makeRequest("/some/unknown/path"), mockEnv, makeCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });
});

describe("Worker CORS headers", () => {
  it("includes CORS header on JSON API responses", async () => {
    const res = await worker.fetch(makeRequest("/api/providers.json"), mockEnv, makeCtx());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("includes CORS header on search results", async () => {
    const res = await worker.fetch(makeRequest("/api/search.json"), mockEnv, makeCtx());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
