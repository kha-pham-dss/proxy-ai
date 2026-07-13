# proxy-ai (Proxy CLI)

Local **passive memory proxy** for coding agents: OpenAI-compatible + Anthropic faces on your machine, long-term memory (LTM) in SQLite, async distill via Ollama.

Design: [`docs/proxy-cli-design.md`](docs/proxy-cli-design.md)

## What it does

1. You point Cursor / Codex / Claude Code at `http://127.0.0.1:8787`
2. Proxy injects a short coding-only LTM profile (stacks, style, projects, facts, enabled habits)
3. Request is forwarded to your upstream provider (OpenAI / Anthropic / …)
4. After **30 minutes idle** or a **new conversation**, a local Ollama model distills the session into SQLite
5. Manage memory at `http://127.0.0.1:8788`

## Requirements

- Node.js **20+**
- [pnpm](https://pnpm.io/) **9+**
- An upstream API key (OpenAI and/or Anthropic, depending on the client)
- Optional but recommended: [Ollama](https://ollama.com/) with a distill model

```bash
ollama pull qwen2.5:3b
```

## Install & run

```bash
git clone <this-repo> && cd proxy-ai
pnpm install
pnpm build
pnpm start
```

Dev (auto-reload):

```bash
pnpm install
pnpm dev
```

Defaults:

| Service | URL |
|---|---|
| Gateway | `http://127.0.0.1:8787/v1` |
| Anthropic face | `http://127.0.0.1:8787` (`/v1/messages`) |
| Management UI | `http://127.0.0.1:8788` |
| LTM DB | `~/.proxy-cli/ltm.sqlite` |

### Useful env vars

| Variable | Default | Meaning |
|---|---|---|
| `PROXY_GATEWAY_PORT` | `8787` | Gateway port |
| `PROXY_UI_PORT` | `8788` | UI port |
| `PROXY_UPSTREAM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible upstream |
| `PROXY_ANTHROPIC_UPSTREAM_BASE_URL` | `https://api.anthropic.com` | Anthropic upstream |
| `PROXY_UPSTREAM_API_KEY` | _(empty)_ | Fallback key if the client does not send one |
| `PROXY_DISTILL_MODEL` | `qwen2.5:3b` | Ollama distill model |
| `PROXY_DISTILL_IDLE_MINUTES` | `30` | Idle distill timeout |
| `PROXY_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama base URL |
| `PROXY_SQLITE_PATH` | `~/.proxy-cli/ltm.sqlite` | LTM database path |

Keep the proxy running while you use the coding agent.

---

## Connect Cursor

1. Start Proxy CLI (`pnpm start`).
2. Open **Cursor Settings → Models**.
3. Enable **Override OpenAI Base URL** (wording may vary by Cursor version).
4. Set base URL to:

```text
http://127.0.0.1:8787/v1
```

5. Keep using your normal OpenAI (or OpenAI-compatible) API key in Cursor — the proxy forwards `Authorization` upstream.
6. Open a new chat / Agent session and confirm the UI at `http://127.0.0.1:8788` shows activity after a few turns.

**Notes**

- Prefer verifying Ask/Plan first if Agent + custom base URL is restricted on your Cursor build.
- If Cursor blocks private-network / localhost URLs, use an HTTPS tunnel (e.g. cloudflared / ngrok) and point the override at that URL — architecture stays the same.

Wire used: `POST /v1/chat/completions` (+ streaming).

---

## Connect Codex CLI

1. Start Proxy CLI.
2. Edit `~/.codex/config.toml` (create if missing). Minimal example:

```toml
# Point Codex at Proxy CLI (OpenAI-compatible + Responses)
openai_base_url = "http://127.0.0.1:8787/v1"

# Or, with an explicit provider:
# [model_providers.proxy_cli]
# name = "Proxy CLI"
# base_url = "http://127.0.0.1:8787/v1"
# wire_api = "responses"
```

3. Ensure your OpenAI API key is available to Codex as usual (`OPENAI_API_KEY` or Codex’s key store). The proxy forwards it.
4. Run Codex and start a task. After the session goes idle (or you open a new one), check the management UI for distilled facts.

Wire used: `POST /v1/responses` (+ streaming). Chat Completions also works if your Codex provider is configured for it.

---

## Connect Claude Code

1. Start Proxy CLI.
2. Point Claude Code at the Anthropic face on the same process:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_API_KEY="sk-ant-..."   # your real Anthropic key (forwarded upstream)
```

3. Run Claude Code as usual. Requests hit `POST /v1/messages` on the proxy, which injects LTM and forwards to `https://api.anthropic.com`.

Optional: override Anthropic upstream:

```bash
export PROXY_ANTHROPIC_UPSTREAM_BASE_URL="https://api.anthropic.com"
```

**Notes**

- Claude Code owns the agent loop; Proxy CLI only adds memory middleware.
- Use a fresh session after changing habits in the UI so the inject block refreshes.

---

## Management UI

Open [http://127.0.0.1:8788](http://127.0.0.1:8788) to:

- View stacks / style / projects / facts
- Toggle **habits** (only enabled ones are injected)
- Change distill model / idle minutes
- **Distill now** or **Reset LTM** (seed habits kept, disabled)

---

## API surface

| Endpoint | Client |
|---|---|
| `POST /v1/chat/completions` | Cursor, OpenAI-compatible tools |
| `POST /v1/responses` | Codex |
| `POST /v1/messages` | Claude Code |
| `GET /v1/models` | Best-effort passthrough |
| `GET /health` | Liveness |

---

## Privacy (Phase 1)

- Binds to `127.0.0.1` by default
- Schema allowlist + distill prompt bans secrets
- Keyword redaction on transcripts before distill / persist
- Upstream API keys are forwarded, not written into LTM

---

## Develop

```bash
pnpm test
pnpm typecheck
pnpm build
```

Monorepo layout:

```text
apps/proxy          # gateway + worker + UI
packages/ltm        # SQLite LTM + assemble
packages/distill    # Ollama distill + heuristic fallback
packages/redact     # secret / path redaction
packages/proto      # shared types + Zod schema
```

## License

See [LICENSE](LICENSE).
