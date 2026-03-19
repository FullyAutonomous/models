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
