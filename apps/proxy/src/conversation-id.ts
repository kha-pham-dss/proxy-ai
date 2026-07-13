import { fingerprintConversationId } from "./session-store.js";

export function resolveConversationId(input: {
  headers: Headers | Record<string, string | undefined>;
  body: Record<string, unknown>;
  clientHint?: string;
}): string {
  const headerVal = getHeader(input.headers, "x-conversation-id");
  if (headerVal) return headerVal;

  if (typeof input.body.conversation_id === "string" && input.body.conversation_id) {
    return input.body.conversation_id;
  }

  const metadata = input.body.metadata;
  if (metadata && typeof metadata === "object") {
    const meta = metadata as Record<string, unknown>;
    for (const key of ["conversation_id", "session_id", "thread_id"]) {
      if (typeof meta[key] === "string" && meta[key]) return meta[key] as string;
    }
  }

  const firstUser = extractFirstUserMessage(input.body);
  if (firstUser) {
    return fingerprintConversationId({
      clientHint: input.clientHint,
      firstUserMessage: firstUser,
    });
  }

  return "default";
}

function getHeader(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && v) return v;
  }
  return undefined;
}

function extractFirstUserMessage(body: Record<string, unknown>): string | undefined {
  const messages = body.messages;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const msg = m as { role?: string; content?: unknown };
      if (msg.role === "user") return messageContentToString(msg.content);
    }
  }

  const input = body.input;
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const row = item as { role?: string; content?: unknown };
      if (row.role === "user") return messageContentToString(row.content);
    }
  }

  return undefined;
}

export function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as { text?: string; type?: string; content?: string };
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    const t = (content as { text?: unknown }).text;
    if (typeof t === "string") return t;
  }
  return "";
}
