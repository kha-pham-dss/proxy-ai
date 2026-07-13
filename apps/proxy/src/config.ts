import { homedir } from "node:os";
import { join } from "node:path";
import { ALLOWED_DISTILL_MODELS, type DistillModel } from "@proxy-cli/proto";

export interface ProxyConfig {
  bindHost: string;
  gatewayPort: number;
  uiPort: number;
  upstreamBaseUrl: string;
  anthropicUpstreamBaseUrl: string;
  upstreamApiKey?: string;
  sqlitePath: string;
  distill: {
    idleMinutes: number;
    ollamaBaseUrl: string;
    model: DistillModel;
    maxInjectTokens: number;
    heuristicFallback: boolean;
  };
  privacy: {
    redact: boolean;
  };
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadConfig(): ProxyConfig {
  const modelRaw = process.env.PROXY_DISTILL_MODEL ?? "qwen2.5:3b";
  const model = (ALLOWED_DISTILL_MODELS as readonly string[]).includes(modelRaw)
    ? (modelRaw as DistillModel)
    : "qwen2.5:3b";

  return {
    bindHost: process.env.PROXY_BIND_HOST ?? "127.0.0.1",
    gatewayPort: envInt("PROXY_GATEWAY_PORT", 8787),
    uiPort: envInt("PROXY_UI_PORT", 8788),
    upstreamBaseUrl: (
      process.env.PROXY_UPSTREAM_BASE_URL ?? "https://api.openai.com/v1"
    ).replace(/\/$/, ""),
    anthropicUpstreamBaseUrl: (
      process.env.PROXY_ANTHROPIC_UPSTREAM_BASE_URL ?? "https://api.anthropic.com"
    ).replace(/\/$/, ""),
    upstreamApiKey: process.env.PROXY_UPSTREAM_API_KEY,
    sqlitePath: expandHome(
      process.env.PROXY_SQLITE_PATH ?? "~/.proxy-cli/ltm.sqlite",
    ),
    distill: {
      idleMinutes: envInt("PROXY_DISTILL_IDLE_MINUTES", 30),
      ollamaBaseUrl: (
        process.env.PROXY_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
      ).replace(/\/$/, ""),
      model,
      maxInjectTokens: envInt("PROXY_MAX_INJECT_TOKENS", 1000),
      heuristicFallback: envBool("PROXY_HEURISTIC_FALLBACK", true),
    },
    privacy: {
      redact: envBool("PROXY_REDACT", true),
    },
  };
}
