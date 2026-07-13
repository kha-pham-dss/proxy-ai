#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { openLtmDb, LtmRepository } from "@proxy-cli/ltm";
import { ALLOWED_DISTILL_MODELS } from "@proxy-cli/proto";
import { loadConfig } from "./config.js";
import { createOpenAiChatHandler } from "./gateway/openai-chat.js";
import { createOpenAiResponsesHandler } from "./gateway/openai-responses.js";
import { createAnthropicMessagesHandler } from "./gateway/anthropic-messages.js";
import { filterRequestHeaders, forwardUpstream, pickUpstreamAuth } from "./gateway/upstream.js";
import { SessionStore } from "./session-store.js";
import { createUiApp } from "./ui-routes.js";
import { MemoryWorker } from "./worker.js";

const config = loadConfig();
const db = openLtmDb(config.sqlitePath);
const ltm = new LtmRepository(db);

// Restore persisted distill settings if present
const savedModel = ltm.getSetting("distill_model");
if (savedModel && (ALLOWED_DISTILL_MODELS as readonly string[]).includes(savedModel)) {
  config.distill.model = savedModel as typeof config.distill.model;
}
const savedIdle = ltm.getSetting("idle_minutes");
if (savedIdle) {
  const n = Number.parseInt(savedIdle, 10);
  if (Number.isFinite(n) && n > 0) config.distill.idleMinutes = n;
}

const sessions = new SessionStore();
const worker = new MemoryWorker(config, sessions, ltm);
worker.start();

const deps = { config, sessions, ltm, worker };

const gateway = new Hono();

gateway.get("/health", (c) =>
  c.json({
    ok: true,
    service: "proxy-cli",
    gateway: `http://${config.bindHost}:${config.gatewayPort}`,
    ui: `http://${config.bindHost}:${config.uiPort}`,
  }),
);

gateway.get("/v1/models", async (c) => {
  const auth = pickUpstreamAuth(c.req.raw.headers, config.upstreamApiKey);
  const headers = filterRequestHeaders(c.req.raw.headers, {
    ...(auth ? { Authorization: auth } : {}),
  });
  try {
    const upstream = await forwardUpstream({
      url: `${config.upstreamBaseUrl}/models`,
      method: "GET",
      headers,
      body: null,
    });
    const data = await upstream.text();
    return c.body(data, upstream.status as 200, {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    });
  } catch (err) {
    return c.json(
      {
        object: "list",
        data: [],
        error: err instanceof Error ? err.message : String(err),
      },
      200,
    );
  }
});

gateway.post("/v1/chat/completions", createOpenAiChatHandler(deps));
gateway.post("/v1/responses", createOpenAiResponsesHandler(deps));
gateway.post("/v1/messages", createAnthropicMessagesHandler(deps));

const ui = createUiApp(deps);

serve(
  {
    fetch: gateway.fetch,
    hostname: config.bindHost,
    port: config.gatewayPort,
  },
  (info) => {
    console.log(
      `[proxy-cli] gateway http://${info.address}:${info.port}/v1 (chat/completions, responses, messages)`,
    );
  },
);

serve(
  {
    fetch: ui.fetch,
    hostname: config.bindHost,
    port: config.uiPort,
  },
  (info) => {
    console.log(`[proxy-cli] UI       http://${info.address}:${info.port}`);
    console.log(`[proxy-cli] LTM      ${config.sqlitePath}`);
    console.log(
      `[proxy-cli] distill  ${config.distill.model} via ${config.distill.ollamaBaseUrl} (idle ${config.distill.idleMinutes}m)`,
    );
  },
);

function shutdown() {
  worker.stop();
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
