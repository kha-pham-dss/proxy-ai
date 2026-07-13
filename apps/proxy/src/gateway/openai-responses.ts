import type { Context } from "hono";
import type { ChatMessage } from "@proxy-cli/proto";
import { redactText } from "@proxy-cli/redact";
import type { LtmRepository } from "@proxy-cli/ltm";
import { assembleProfileText } from "@proxy-cli/ltm";
import type { ProxyConfig } from "../config.js";
import {
  messageContentToString,
  resolveConversationId,
} from "../conversation-id.js";
import { ensureLtmInInstructions, ensureLtmInject } from "../inject.js";
import type { SessionStore } from "../session-store.js";
import type { MemoryWorker } from "../worker.js";
import { filterRequestHeaders, forwardUpstream, pickUpstreamAuth } from "./upstream.js";

export function createOpenAiResponsesHandler(deps: {
  config: ProxyConfig;
  sessions: SessionStore;
  ltm: LtmRepository;
  worker: MemoryWorker;
}): (c: Context) => Promise<Response> {
  return async (c: Context): Promise<Response> => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const clientHint = "codex";
    const conversationId = resolveConversationId({
      headers: c.req.raw.headers,
      body,
      clientHint,
    });

    const profile = deps.ltm.loadProfile();
    const profileText = assembleProfileText(profile, {
      maxChars: deps.config.distill.maxInjectTokens * 4,
    });

    const { session, created } = deps.sessions.getOrCreate(
      conversationId,
      profileText,
      clientHint,
    );
    if (!created) {
      deps.sessions.updateProfileText(conversationId, profileText);
      session.profileText = profileText;
    } else {
      void deps.worker.distillDirtyExcept(conversationId);
    }

    // Buffer user input
    const userText = extractResponsesUserText(body);
    if (userText) {
      deps.sessions.appendTurn(conversationId, {
        role: "user",
        content: deps.config.privacy.redact ? redactText(userText) : userText,
        at: new Date().toISOString(),
      });
    }

    const outbound: Record<string, unknown> = { ...body };
    if (typeof body.instructions === "string" || body.instructions === undefined) {
      outbound.instructions = ensureLtmInInstructions(
        body.instructions as string | undefined,
        session.profileText,
      );
    } else if (Array.isArray(body.input)) {
      outbound.input = ensureLtmInject(
        body.input as ChatMessage[],
        session.profileText,
      );
    } else if (typeof body.input === "string") {
      outbound.instructions = ensureLtmInInstructions(
        body.instructions as string | undefined,
        session.profileText,
      );
    }

    const stream = Boolean(body.stream);
    const auth = pickUpstreamAuth(c.req.raw.headers, deps.config.upstreamApiKey);
    const headers = filterRequestHeaders(c.req.raw.headers, {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    });

    const upstream = await forwardUpstream({
      url: `${deps.config.upstreamBaseUrl}/responses`,
      headers,
      body: JSON.stringify(outbound),
    });

    if (stream && upstream.body) {
      const [clientStream, teeStream] = upstream.body.tee();
      void collectResponsesStream(teeStream).then((assistantText) => {
        if (assistantText) {
          deps.sessions.appendTurn(conversationId, {
            role: "assistant",
            content: deps.config.privacy.redact
              ? redactText(assistantText)
              : assistantText,
            at: new Date().toISOString(),
          });
        }
        deps.sessions.touch(conversationId);
      });
      return new Response(clientStream, {
        status: upstream.status,
        headers: (() => {
          const h = new Headers();
          const ct = upstream.headers.get("content-type");
          h.set("content-type", ct ?? "text/event-stream; charset=utf-8");
          return h;
        })(),
      });
    }

    const data = (await upstream.json()) as Record<string, unknown>;
    const assistantText = extractResponsesOutputText(data);
    if (assistantText) {
      deps.sessions.appendTurn(conversationId, {
        role: "assistant",
        content: deps.config.privacy.redact
          ? redactText(assistantText)
          : assistantText,
        at: new Date().toISOString(),
      });
    }
    deps.sessions.touch(conversationId);
    return c.json(data, upstream.status as 200);
  };
}

function extractResponsesUserText(body: Record<string, unknown>): string {
  if (typeof body.input === "string") return body.input;
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!item || typeof item !== "object") continue;
      const row = item as { role?: string; content?: unknown };
      if (row.role === "user") return messageContentToString(row.content);
    }
  }
  return "";
}

function extractResponsesOutputText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text;
  const output = data.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as { content?: unknown; type?: string };
    if (Array.isArray(row.content)) {
      for (const c of row.content) {
        if (c && typeof c === "object" && typeof (c as { text?: string }).text === "string") {
          parts.push((c as { text: string }).text);
        }
      }
    }
  }
  return parts.join("\n");
}

async function collectResponsesStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            text?: string;
          };
          if (typeof json.delta === "string") content += json.delta;
          if (json.type?.includes("output_text") && typeof json.text === "string") {
            content += json.text;
          }
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return content;
}
