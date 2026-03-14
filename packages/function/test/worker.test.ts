import { describe, expect, it } from "bun:test";
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
        open_weights: false,
        release_date: "2024-05",
        last_updated: "2024-11",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 128000, output: 4096 },
        cost: { input: 2.5, output: 10.0 },
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
      if (path === "/_index") {
        return new Response("<html>Models.dev</html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (path.startsWith("/logos/openai")) {
        return new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } });
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

describe("Worker API versioning", () => {
  it("returns X-API-Version header on /api.json", async () => {
    const res = await worker.fetch(makeRequest("/api.json"), mockEnv, makeCtx());
    expect(res.headers.get("X-API-Version")).toBe("1");
  });

  it("returns X-API-Version header on /model-schema.json", async () => {
    const res = await worker.fetch(makeRequest("/model-schema.json"), mockEnv, makeCtx());
    expect(res.headers.get("X-API-Version")).toBe("1");
  });

  it("returns CORS header on /api.json", async () => {
    const res = await worker.fetch(makeRequest("/api.json"), mockEnv, makeCtx());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("serves /v1/api.json as an alias for /api.json", async () => {
    const resV1 = await worker.fetch(makeRequest("/v1/api.json"), mockEnv, makeCtx());
    const resBase = await worker.fetch(makeRequest("/api.json"), mockEnv, makeCtx());
    expect(resV1.status).toBe(resBase.status);
    // Both should have X-API-Version = 1
    expect(resV1.headers.get("X-API-Version")).toBe("1");
  });

  it("serves /v1/model-schema.json as an alias for /model-schema.json", async () => {
    const resV1 = await worker.fetch(makeRequest("/v1/model-schema.json"), mockEnv, makeCtx());
    expect(resV1.status).toBe(200);
    expect(resV1.headers.get("X-API-Version")).toBe("1");
    const body = await resV1.json() as Record<string, unknown>;
    expect(body["$schema"]).toContain("json-schema.org");
  });

  it("returns X-API-Version on OPTIONS preflight", async () => {
    const res = await worker.fetch(makeRequest("/api.json", "OPTIONS"), mockEnv, makeCtx());
    expect(res.status).toBe(204);
    expect(res.headers.get("X-API-Version")).toBe("1");
  });
});

describe("Worker existing routes still work", () => {
  it("serves /", async () => {
    const res = await worker.fetch(makeRequest("/"), mockEnv, makeCtx());
    expect(res.status).toBe(200);
  });

  it("serves /logos/openai.svg", async () => {
    const res = await worker.fetch(makeRequest("/logos/openai.svg"), mockEnv, makeCtx());
    expect(res.status).toBe(200);
  });

  it("redirects unknown paths to /", async () => {
    const res = await worker.fetch(makeRequest("/unknown-path"), mockEnv, makeCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("serves /api.json with full data", async () => {
    const res = await worker.fetch(makeRequest("/api.json"), mockEnv, makeCtx());
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("openai");
  });

  it("serves /model-schema.json with valid JSON Schema", async () => {
    const res = await worker.fetch(makeRequest("/model-schema.json"), mockEnv, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const defs = body["$defs"] as Record<string, Record<string, unknown>>;
    expect(defs["Model"]["enum"]).toContain("openai/gpt-4o");
  });
});
