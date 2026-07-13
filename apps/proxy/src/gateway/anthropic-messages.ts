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
import { filterRequestHeaders, forwardUpstream } from "./upstream.js";

export function createAnthropicMessagesHandler(deps: {
  config: ProxyConfig;
  sessions: SessionStore;
  ltm: LtmRepository;
  worker: MemoryWorker;
}): (c: Context) => Promise<Response> {
  return async (c: Context): Promise<Response> => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const clientHint = "claude-code";
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

    const messages = Array.isArray(body.messages)
      ? (body.messages as ChatMessage[])
      : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      const content = messageContentToString(lastUser.content);
      deps.sessions.appendTurn(conversationId, {
        role: "user",
        content: deps.config.privacy.redact ? redactText(content) : content,
        at: new Date().toISOString(),
      });
    }

    const outbound: Record<string, unknown> = { ...body };
    if (typeof body.system === "string" || Array.isArray(body.system)) {
      const systemText = Array.isArray(body.system)
        ? body.system
            .map((b) =>
              typeof b === "string"
                ? b
                : messageContentToString((b as { text?: string }).text),
            )
            .join("\n")
        : (body.system as string);
      outbound.system = ensureLtmInInstructions(systemText, session.profileText);
    } else {
      outbound.system = session.profileText;
      // Also inject into messages if no system field — keep Anthropic shape valid
      outbound.messages = ensureLtmInject(messages, session.profileText).filter(
        (m) => m.role !== "system",
      );
    }

    // If system was set as string, keep messages as-is (Anthropic style)
    if (typeof outbound.system === "string" && Array.isArray(body.messages)) {
      outbound.messages = body.messages;
    }

    const stream = Boolean(body.stream);
    const apiKey =
      c.req.header("x-api-key") ??
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
      deps.config.upstreamApiKey;

    const headers = filterRequestHeaders(c.req.raw.headers, {
      "Content-Type": "application/json",
      "anthropic-version": c.req.header("anthropic-version") ?? "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    });

    const upstream = await forwardUpstream({
      url: `${deps.config.anthropicUpstreamBaseUrl}/v1/messages`,
      headers,
      body: JSON.stringify(outbound),
    });

    if (stream && upstream.body) {
      const [clientStream, teeStream] = upstream.body.tee();
      void collectAnthropicStream(teeStream).then((assistantText) => {
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
          h.set(
            "content-type",
            upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
          );
          return h;
        })(),
      });
    }

    const data = (await upstream.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const assistantText = (data.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");
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

async function collectAnthropicStream(
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
        if (!payload) continue;
        try {
          const json = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (json.type === "content_block_delta" && json.delta?.text) {
            content += json.delta.text;
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
