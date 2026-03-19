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
