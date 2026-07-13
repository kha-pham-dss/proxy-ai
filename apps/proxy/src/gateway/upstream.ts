export async function forwardUpstream(options: {
  url: string;
  method?: string;
  headers: Headers | Record<string, string>;
  body?: string | null;
  duplex?: boolean;
}): Promise<Response> {
  const init: RequestInit = {
    method: options.method ?? "POST",
    headers: options.headers,
    body: options.body,
  };
  // Node fetch streaming request body support when needed
  if (options.duplex) {
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }
  return fetch(options.url, init);
}

export function pickUpstreamAuth(
  incoming: Headers,
  fallbackKey?: string,
): string | undefined {
  const auth = incoming.get("authorization");
  if (auth) return auth;
  const anthropic = incoming.get("x-api-key");
  if (anthropic) return anthropic.startsWith("Bearer ") ? anthropic : `Bearer ${anthropic}`;
  if (fallbackKey) return `Bearer ${fallbackKey}`;
  return undefined;
}

export function filterRequestHeaders(
  incoming: Headers,
  extra?: Record<string, string>,
): Headers {
  const out = new Headers();
  const allow = new Set([
    "authorization",
    "content-type",
    "accept",
    "openai-organization",
    "openai-project",
    "x-api-key",
    "anthropic-version",
    "anthropic-beta",
  ]);
  for (const [k, v] of incoming.entries()) {
    if (allow.has(k.toLowerCase())) out.set(k, v);
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) out.set(k, v);
  }
  return out;
}
