export interface Env {
  ASSETS: Fetcher;
  PosthogToken: string;
}

/** Current API version — increment when making breaking schema changes */
const API_VERSION = "1";

// ── Analytics helper ──────────────────────────────────────────────────────────

function trackHit(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
): void {
  const agent = request.headers.get("user-agent") || "unknown";
  if (!agent.includes("opencode") && !agent.includes("bun")) return;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const country = request.headers.get("cf-ipcountry") || "unknown";

  ctx.waitUntil(
    fetch("https://us.i.posthog.com/i/v0/e/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: JSON.parse(env.PosthogToken).value,
        event: "hit",
        distinct_id: ip,
        properties: {
          $process_person_profile: false,
          user_agent: agent,
          country,
          path: pathname,
        },
      }),
    }).catch(() => {
      // Swallow analytics errors — never fail a request due to tracking
    }),
  );
}

// ── JSON response helper ──────────────────────────────────────────────────────

function jsonResponse(
  body: unknown,
  status = 200,
  cache = "public, max-age=3600",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "X-API-Version": API_VERSION,
    },
  });
}

/** Proxy an ASSETS response while injecting CORS and versioning headers */
async function corsProxy(resp: Response): Promise<Response> {
  const headers = new Headers(resp.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("X-API-Version", API_VERSION);
  return new Response(resp.body, { status: resp.status, headers });
}

// ── Request method guard ──────────────────────────────────────────────────────

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD, OPTIONS" },
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    // Only allow read methods on all routes
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      return methodNotAllowed();
    }

    // Handle OPTIONS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "X-API-Version": API_VERSION,
        },
      });
    }

    // ── /v1/* path aliases — strip the version prefix so all routing below
    // handles the canonical paths. Consumers can pin to /v1/ to signal intent
    // to use a stable schema; a future breaking change would introduce /v2/.
    const routePath = pathname.startsWith("/v1/")
      ? pathname.slice(3) // remove "/v1" keeping the leading "/"
      : pathname;

    trackHit(request, env, ctx, routePath);

    // ── /model-schema.json — dynamic JSON Schema of all model IDs ────────────
    if (routePath === "/model-schema.json") {
      const apiUrl = new URL(url);
      apiUrl.pathname = "/_api.json";
      const apiResponse = await env.ASSETS.fetch(
        new Request(apiUrl.toString(), request),
      );
      const providers = (await apiResponse.json()) as Record<
        string,
        { models: Record<string, unknown> }
      >;

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

    // ── /api.json — full catalog ──────────────────────────────────────────────
    if (routePath === "/api.json") {
      url.pathname = "/_api.json";
      const resp = await env.ASSETS.fetch(new Request(url.toString(), request));
      return corsProxy(resp);
    }

    // ── /api/providers.json — provider list (no nested models) ───────────────
    if (routePath === "/api/providers.json") {
      url.pathname = "/_api/providers.json";
      const resp = await env.ASSETS.fetch(new Request(url.toString(), request));
      return corsProxy(resp);
    }

    // ── /api/providers/:id.json — single provider with models ────────────────
    const providerMatch = routePath.match(/^\/api\/providers\/([^/]+)\.json$/);
    if (providerMatch) {
      url.pathname = `/_api/providers/${providerMatch[1]}.json`;
      const resp = await env.ASSETS.fetch(new Request(url.toString(), request));
      if (resp.status === 404) {
        return jsonResponse({ error: "Provider not found" }, 404);
      }
      return corsProxy(resp);
    }

    // ── /api/models/:provider/:model(.json) — single model lookup ────────────
    const modelMatch = routePath.match(/^\/api\/models\/(.+?)\.json$/);
    if (modelMatch) {
      url.pathname = `/_api/models/${modelMatch[1]}.json`;
      const resp = await env.ASSETS.fetch(new Request(url.toString(), request));
      if (resp.status === 404) {
        return jsonResponse({ error: "Model not found" }, 404);
      }
      return corsProxy(resp);
    }

    // ── /api/search.json — filtered model search (dynamic, computed) ─────────
    if (routePath === "/api/search.json") {
      const apiUrl = new URL(url);
      apiUrl.pathname = "/_api.json";
      const apiResponse = await env.ASSETS.fetch(
        new Request(apiUrl.toString(), request),
      );
      const allProviders = (await apiResponse.json()) as Record<
        string,
        {
          id: string;
          name: string;
          models: Record<string, Record<string, unknown>>;
        }
      >;

      const params = url.searchParams;
      const q = params.get("q")?.toLowerCase();
      const filterProvider = params.get("provider")
        ?.split(",")
        .map((s) => s.trim());
      const filterFamily = params.get("family");
      const filterReasoning = params.get("reasoning");
      const filterToolCall = params.get("tool_call");
      const filterStructured = params.get("structured_output");
      const filterOpenWeights = params.get("open_weights");
      const filterMinContext = params.get("min_context")
        ? parseInt(params.get("min_context")!, 10)
        : undefined;
      const filterMaxInputCost = params.get("max_input_cost")
        ? parseFloat(params.get("max_input_cost")!)
        : undefined;
      const filterMaxOutputCost = params.get("max_output_cost")
        ? parseFloat(params.get("max_output_cost")!)
        : undefined;
      const filterModalityInput = params.get("modality_input");
      const filterStatus = params.get("status");
      const limitParam = Math.min(parseInt(params.get("limit") ?? "100", 10), 1000);
      const offsetParam = parseInt(params.get("offset") ?? "0", 10);

      const results: unknown[] = [];

      for (const [providerId, provider] of Object.entries(allProviders)) {
        if (filterProvider && !filterProvider.includes(providerId)) continue;

        for (const [modelId, model] of Object.entries(provider.models)) {
          // Text search
          if (q) {
            const searchText = `${providerId} ${modelId} ${(model as Record<string, unknown>)["name"] ?? ""} ${(model as Record<string, unknown>)["family"] ?? ""}`.toLowerCase();
            if (!searchText.includes(q)) continue;
          }

          // Capability filters
          if (filterReasoning !== null && filterReasoning !== undefined) {
            const want = filterReasoning === "true";
            if ((model as Record<string, unknown>)["reasoning"] !== want) continue;
          }
          if (filterToolCall !== null && filterToolCall !== undefined) {
            const want = filterToolCall === "true";
            if ((model as Record<string, unknown>)["tool_call"] !== want) continue;
          }
          if (filterStructured !== null && filterStructured !== undefined) {
            const want = filterStructured === "true";
            if ((model as Record<string, unknown>)["structured_output"] !== want) continue;
          }
          if (filterOpenWeights !== null && filterOpenWeights !== undefined) {
            const want = filterOpenWeights === "true";
            if ((model as Record<string, unknown>)["open_weights"] !== want) continue;
          }
          if (filterFamily) {
            if ((model as Record<string, unknown>)["family"] !== filterFamily) continue;
          }

          // Context window
          const limit = (model as Record<string, unknown>)["limit"] as Record<string, number> | undefined;
          if (filterMinContext !== undefined) {
            if (!limit || (limit["context"] ?? 0) < filterMinContext) continue;
          }

          // Cost filters
          const cost = (model as Record<string, unknown>)["cost"] as Record<string, number> | undefined;
          if (filterMaxInputCost !== undefined) {
            if (!cost || cost["input"] > filterMaxInputCost) continue;
          }
          if (filterMaxOutputCost !== undefined) {
            if (!cost || cost["output"] > filterMaxOutputCost) continue;
          }

          // Modality input filter
          if (filterModalityInput) {
            const mods = ((model as Record<string, unknown>)["modalities"] as Record<string, string[]> | undefined);
            if (!mods?.["input"]?.includes(filterModalityInput)) continue;
          }

          // Status filter (default: exclude deprecated)
          const modelStatus = (model as Record<string, unknown>)["status"] as string | undefined;
          if (filterStatus !== null && filterStatus !== undefined) {
            if (modelStatus !== filterStatus) continue;
          } else {
            // Default: exclude deprecated
            if (modelStatus === "deprecated") continue;
          }

          results.push({ provider: providerId, id: modelId, ...model });
        }
      }

      const total = results.length;
      const paginated = results.slice(offsetParam, offsetParam + limitParam);

      return jsonResponse({
        total,
        offset: offsetParam,
        limit: limitParam,
        results: paginated,
      });
    }

    // ── Homepage routes ───────────────────────────────────────────────────────
    if (
      routePath === "/" ||
      routePath === "/index.html" ||
      routePath === "/index"
    ) {
      url.pathname = "/_index";
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }

    // ── Logo routes ───────────────────────────────────────────────────────────
    if (routePath.startsWith("/logos/")) {
      const logoResponse = await env.ASSETS.fetch(
        new Request(url.toString(), request),
      );
      if (logoResponse.status === 404) {
        const defaultUrl = new URL(url);
        defaultUrl.pathname = "/logos/default.svg";
        return env.ASSETS.fetch(new Request(defaultUrl.toString(), request));
      }
      return logoResponse;
    }

    // ── Catch-all: redirect to homepage ──────────────────────────────────────
    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  },
};
