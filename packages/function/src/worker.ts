export interface Env {
  ASSETS: any;
  PosthogToken: string;
}

/** Current API version served by this worker */
const API_VERSION = "1";

/**
 * Add the X-API-Version response header and CORS headers to any Response.
 * This helper ensures all API responses are consistently tagged.
 */
function withApiHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-API-Version", API_VERSION);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const country = request.headers.get("cf-ipcountry") || "unknown";
    const agent = request.headers.get("user-agent") || "unknown";

    // ── Analytics ─────────────────────────────────────────────────────────────
    if (agent.includes("opencode") || agent.includes("bun")) {
      ctx.waitUntil(
        fetch("https://us.i.posthog.com/i/v0/e/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: JSON.parse(env.PosthogToken).value,
            event: "hit",
            distinct_id: ip,
            properties: {
              $process_person_profile: false,
              user_agent: agent,
              country,
              path: url.pathname,
            },
          }),
        }).catch(() => {}),
      );
    }

    // ── OPTIONS preflight ────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
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

    // ── /v1/* path aliases — normalise to unversioned paths ──────────────────
    // Allows consumers to pin to /v1/api.json and be guaranteed to receive
    // the current v1 schema. A future breaking change would introduce /v2/.
    let pathname = url.pathname;
    if (pathname.startsWith("/v1/")) {
      pathname = pathname.slice(3); // remove "/v1" prefix, keep leading /
    }

    // ── /model-schema.json ───────────────────────────────────────────────────
    if (pathname === "/model-schema.json") {
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

      const schema = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://models.dev/model-schema.json",
        $defs: {
          Model: {
            type: "string",
            enum: modelIds.sort(),
            description: "AI model identifier in provider/model format",
          },
        },
      };

      return withApiHeaders(
        new Response(JSON.stringify(schema, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
          },
        }),
      );
    }

    // ── /api.json ────────────────────────────────────────────────────────────
    if (pathname === "/api.json") {
      url.pathname = "/_api.json";
      const resp = await env.ASSETS.fetch(new Request(url.toString(), request));
      return withApiHeaders(resp);
    }

    // ── Homepage routes ──────────────────────────────────────────────────────
    if (
      pathname === "/" ||
      pathname === "/index.html" ||
      pathname === "/index"
    ) {
      url.pathname = "/_index";
    } else if (pathname.startsWith("/logos/")) {
      // Check if the specific provider logo exists in static assets
      const logoResponse = await env.ASSETS.fetch(
        new Request(url.toString(), request),
      );

      if (logoResponse.status === 404) {
        // Fallback to default logo
        const defaultUrl = new URL(url);
        defaultUrl.pathname = "/logos/default.svg";
        return await env.ASSETS.fetch(
          new Request(defaultUrl.toString(), request),
        );
      }

      return logoResponse;
    } else {
      // redirect to "/"
      return new Response(null, {
        status: 302,
        headers: { Location: "/" },
      });
    }

    return await env.ASSETS.fetch(new Request(url.toString(), request));
  },
};
