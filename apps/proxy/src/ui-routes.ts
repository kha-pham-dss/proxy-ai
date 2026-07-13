import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { ALLOWED_DISTILL_MODELS } from "@proxy-cli/proto";
import type { LtmRepository } from "@proxy-cli/ltm";
import type { ProxyConfig } from "./config.js";
import type { SessionStore } from "./session-store.js";
import type { MemoryWorker } from "./worker.js";

const here = dirname(fileURLToPath(import.meta.url));

function publicPath(name: string): string {
  // Prefer src/public in dev (tsx), dist/public in production
  const candidates = [
    join(here, "public", name),
    join(here, "../src/public", name),
  ];
  for (const p of candidates) {
    try {
      return p;
    } catch {
      // continue
    }
  }
  return candidates[0]!;
}

function readPublic(name: string): string {
  const candidates = [
    join(here, "public", name),
    join(here, "../src/public", name),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error(`Missing public asset: ${name}`);
}

export function createUiApp(deps: {
  config: ProxyConfig;
  ltm: LtmRepository;
  sessions: SessionStore;
  worker: MemoryWorker;
}): Hono {
  const app = new Hono();

  app.get("/", (c) =>
    c.html(readPublic("index.html")),
  );
  app.get("/app.js", (c) =>
    c.body(readPublic("app.js"), 200, {
      "Content-Type": "application/javascript; charset=utf-8",
    }),
  );
  app.get("/styles.css", (c) =>
    c.body(readPublic("styles.css"), 200, {
      "Content-Type": "text/css; charset=utf-8",
    }),
  );

  app.get("/api/overview", (c) => {
    const profile = deps.ltm.loadProfile();
    const worker = deps.worker.status();
    return c.json({
      facts: profile.facts.length,
      projects: profile.projects.length,
      stacks: profile.stacks.length,
      style: profile.style.length,
      habitsEnabled: profile.habits.filter((h) => h.enabled).length,
      lastDistillAt:
        deps.ltm.getSetting("last_distill_at") ?? worker.lastDistillAt ?? null,
      lastDistillSource: deps.ltm.getSetting("last_distill_source") ?? null,
      activeSessions: worker.activeSessions,
      lastError: worker.lastError ?? null,
      model: deps.config.distill.model,
      idleMinutes: deps.config.distill.idleMinutes,
    });
  });

  app.get("/api/profile", (c) => c.json(deps.ltm.loadProfile()));

  app.patch("/api/profile", async (c) => {
    const body = await c.req.json<{
      identity?: { role?: string; ui_locale?: string } | null;
      stacks?: string[];
      style?: string[];
    }>();
    if (body.identity !== undefined) {
      deps.ltm.setIdentity(body.identity);
    }
    if (body.stacks) deps.ltm.setStacks(body.stacks);
    if (body.style) deps.ltm.setStyle(body.style);
    return c.json(deps.ltm.loadProfile());
  });

  app.put("/api/projects", async (c) => {
    const body = await c.req.json<{
      name: string;
      stack?: string[];
      notes?: string;
    }>();
    deps.ltm.upsertProject(body);
    return c.json(deps.ltm.loadProfile());
  });

  app.delete("/api/projects/:name", (c) => {
    deps.ltm.deleteProject(c.req.param("name"));
    return c.json(deps.ltm.loadProfile());
  });

  app.put("/api/facts", async (c) => {
    const body = await c.req.json<{
      id: string;
      text: string;
      topic: "stack" | "style" | "project" | "preference" | "other";
      updated_at?: string;
    }>();
    deps.ltm.upsertFact({
      ...body,
      updated_at: body.updated_at ?? new Date().toISOString(),
    });
    return c.json(deps.ltm.loadProfile());
  });

  app.delete("/api/facts/:id", (c) => {
    deps.ltm.deleteFact(c.req.param("id"));
    return c.json(deps.ltm.loadProfile());
  });

  app.post("/api/habits/:id/toggle", async (c) => {
    const body = await c.req.json<{ enabled: boolean }>();
    deps.ltm.setHabitEnabled(c.req.param("id"), body.enabled);
    return c.json(deps.ltm.loadProfile());
  });

  app.post("/api/habits", async (c) => {
    const body = await c.req.json<{
      id: string;
      label: string;
      inject_text: string;
      enabled?: boolean;
    }>();
    deps.ltm.addCustomHabit({
      id: body.id,
      label: body.label,
      inject_text: body.inject_text,
      enabled: body.enabled ?? false,
    });
    return c.json(deps.ltm.loadProfile());
  });

  app.get("/api/settings", (c) =>
    c.json({
      model: deps.config.distill.model,
      allowedModels: ALLOWED_DISTILL_MODELS,
      idleMinutes: deps.config.distill.idleMinutes,
      ollamaBaseUrl: deps.config.distill.ollamaBaseUrl,
      gateway: `http://${deps.config.bindHost}:${deps.config.gatewayPort}/v1`,
      anthropicBase: `http://${deps.config.bindHost}:${deps.config.gatewayPort}`,
    }),
  );

  app.patch("/api/settings", async (c) => {
    const body = await c.req.json<{ model?: string; idleMinutes?: number }>();
    if (body.model && (ALLOWED_DISTILL_MODELS as readonly string[]).includes(body.model)) {
      deps.config.distill.model = body.model as typeof deps.config.distill.model;
      deps.ltm.setSetting("distill_model", body.model);
    }
    if (typeof body.idleMinutes === "number" && body.idleMinutes > 0) {
      deps.config.distill.idleMinutes = body.idleMinutes;
      deps.ltm.setSetting("idle_minutes", String(body.idleMinutes));
    }
    return c.json({
      model: deps.config.distill.model,
      idleMinutes: deps.config.distill.idleMinutes,
    });
  });

  app.post("/api/distill-now", async (c) => {
    const result = await deps.worker.distillNow();
    return c.json(result);
  });

  app.post("/api/reset", (c) => {
    deps.ltm.resetLtm();
    return c.json({ ok: true, profile: deps.ltm.loadProfile() });
  });

  void publicPath;
  return app;
}
