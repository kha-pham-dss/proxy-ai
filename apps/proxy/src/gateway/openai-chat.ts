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
import { ensureLtmInject } from "../inject.js";
import type { SessionStore } from "../session-store.js";
import type { MemoryWorker } from "../worker.js";
import { filterRequestHeaders, forwardUpstream, pickUpstreamAuth } from "./upstream.js";

export function createOpenAiChatHandler(deps: {
  config: ProxyConfig;
  sessions: SessionStore;
  ltm: LtmRepository;
  worker: MemoryWorker;
}): (c: Context) => Promise<Response> {
  return async (c: Context): Promise<Response> => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const clientHint = c.req.header("user-agent")?.includes("Cursor")
      ? "cursor"
      : "openai-chat";
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
      // New conversation → flush other dirty sessions
      void deps.worker.distillDirtyExcept(conversationId);
    }

    const messages = Array.isArray(body.messages)
      ? (body.messages as ChatMessage[])
      : [];

    // Buffer latest user turn
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      const content = messageContentToString(lastUser.content);
      deps.sessions.appendTurn(conversationId, {
        role: "user",
        content: deps.config.privacy.redact ? redactText(content) : content,
        at: new Date().toISOString(),
      });
    }

    const injected = ensureLtmInject(messages, session.profileText);
    const outbound = { ...body, messages: injected };
    const stream = Boolean(body.stream);

    const auth = pickUpstreamAuth(c.req.raw.headers, deps.config.upstreamApiKey);
    const headers = filterRequestHeaders(c.req.raw.headers, {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    });

    const upstreamUrl = `${deps.config.upstreamBaseUrl}/chat/completions`;
    const upstream = await forwardUpstream({
      url: upstreamUrl,
      headers,
      body: JSON.stringify(outbound),
    });

    if (!upstream.ok && !stream) {
      const errText = await upstream.text();
      return c.body(errText, upstream.status as 400);
    }

    if (stream && upstream.body) {
      const [clientStream, teeStream] = upstream.body.tee();
      void collectChatStream(teeStream).then((assistantText) => {
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
        headers: passthroughHeaders(upstream.headers),
      });
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const assistantText = messageContentToString(data.choices?.[0]?.message?.content);
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

async function collectChatStream(stream: ReadableStream<Uint8Array>): Promise<string> {
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
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) content += delta;
          const msg = json.choices?.[0]?.message?.content;
          if (msg) content += msg;
        } catch {
          // ignore partial JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return content;
}

function passthroughHeaders(headers: Headers): Headers {
  const out = new Headers();
  for (const [k, v] of headers.entries()) {
    const lower = k.toLowerCase();
    if (["content-type", "cache-control", "x-request-id"].includes(lower)) {
      out.set(k, v);
    }
  }
  if (!out.has("content-type")) {
    out.set("content-type", "text/event-stream; charset=utf-8");
  }
  return out;
}
