# Proxy CLI Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local passive memory proxy (gateway + SQLite LTM + distill worker + management UI) that Cursor, Codex, and Claude Code can point at via base URL, with README setup guides for each.

**Architecture:** Single Node/TypeScript process (`apps/proxy`) hosting OpenAI-compatible `/v1/chat/completions` + `/v1/responses`, Anthropic `/v1/messages`, session RAM store, async Ollama distill, and localhost UI. Shared logic in `packages/{proto,redact,ltm,distill}`.

**Tech Stack:** pnpm workspaces, TypeScript, Hono (HTTP), better-sqlite3, Zod, Vitest. Distill via Ollama HTTP. UI: static HTML + small client JS served by the same process.

---

## File map

```
proxy-ai/
├── package.json                 # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── README.md                    # install + Cursor/Codex/Claude guides
├── apps/proxy/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts             # entry: load config, start servers
│   │   ├── config.ts
│   │   ├── session-store.ts
│   │   ├── conversation-id.ts
│   │   ├── inject.ts
│   │   ├── gateway/
│   │   │   ├── openai-chat.ts
│   │   │   ├── openai-responses.ts
│   │   │   ├── anthropic-messages.ts
│   │   │   └── upstream.ts
│   │   ├── worker.ts
│   │   ├── ui-routes.ts
│   │   └── public/              # management UI static assets
│   └── tests/
├── packages/proto/
│   ├── package.json
│   └── src/index.ts             # shared wire/message types + LTM markers
├── packages/redact/
│   ├── package.json
│   └── src/index.ts
├── packages/ltm/
│   ├── package.json
│   └── src/{schema.ts,db.ts,repo.ts,assemble.ts,seed.ts,index.ts}
└── packages/distill/
    ├── package.json
    └── src/{prompt.ts,ollama.ts,heuristic.ts,merge.ts,index.ts}
```

---

### Task 1: Scaffold monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: package stubs under `apps/proxy` and `packages/*`

- [ ] **Step 1:** Create root workspace files with scripts `build`, `dev`, `test`, `start`
- [ ] **Step 2:** Create each package with `"type": "module"`, `tsx`/`vitest`, workspace deps
- [ ] **Step 3:** `pnpm install` and confirm `pnpm -r build` (empty exports ok)

---

### Task 2: `@proxy-cli/proto` + `@proxy-cli/redact`

**Files:**
- Create: `packages/proto/src/index.ts`
- Create: `packages/redact/src/index.ts`
- Test: `packages/redact/src/index.test.ts`

- [ ] **Step 1:** Define LTM marker constants, ChatMessage types, LtmProfile Zod schema (identity, stacks, style, projects, facts, habits, meta)
- [ ] **Step 2:** Implement `redactText(input)` covering `sk-`, `sk-ant-`, Bearer, PEM, JWT-like, `.env` assignments, `/Users/...` and `C:\Users\...` → `[PATH]`
- [ ] **Step 3:** Vitest: secrets and paths redacted; normal code unchanged
- [ ] **Step 4:** Commit scaffold + redact

---

### Task 3: `@proxy-cli/ltm` (SQLite + assemble)

**Files:**
- Create: `packages/ltm/src/{schema.ts,db.ts,repo.ts,assemble.ts,seed.ts,index.ts}`
- Test: `packages/ltm/src/assemble.test.ts`, `packages/ltm/src/repo.test.ts`

- [ ] **Step 1:** Open/migrate SQLite tables per design §7.2; seed habits §7.3 (all `enabled=false`)
- [ ] **Step 2:** Repo CRUD: load profile, upsert stacks/style/projects/facts, toggle habit, reset LTM (keep seeds, disable)
- [ ] **Step 3:** `assembleProfileText(profile)` → Markdown with `<!-- proxy-cli:ltm v1 -->` markers; enforce budgets (style≤8, facts≤15, projects≤5, ~1000 tokens soft)
- [ ] **Step 4:** Tests for assemble markers + reset behavior
- [ ] **Step 5:** Commit

---

### Task 4: `@proxy-cli/distill`

**Files:**
- Create: `packages/distill/src/{prompt.ts,ollama.ts,heuristic.ts,merge.ts,index.ts}`
- Test: `packages/distill/src/heuristic.test.ts`, `packages/distill/src/merge.test.ts`

- [ ] **Step 1:** Build distill system/user prompts (never modify habits; no secrets)
- [ ] **Step 2:** Ollama client `POST /api/chat` or OpenAI-compat `/v1/chat/completions`; parse JSON; validate with Zod; retry once with repair prompt
- [ ] **Step 3:** Heuristic fallback: extract stacks keywords from transcript when Ollama fails
- [ ] **Step 4:** `runDistill({ existing, transcript, model })` → validated LtmProfile (habits preserved from existing)
- [ ] **Step 5:** Commit

---

### Task 5: Session store + inject + conversation id

**Files:**
- Create: `apps/proxy/src/{session-store.ts,conversation-id.ts,inject.ts,config.ts}`
- Test: `apps/proxy/tests/inject.test.ts`, `apps/proxy/tests/conversation-id.test.ts`

- [ ] **Step 1:** Config from env/TOML defaults: bind `127.0.0.1`, gateway `8787`, ui `8788`, sqlite `~/.proxy-cli/ltm.sqlite`, distill idle 30m, model `qwen2.5:3b`
- [ ] **Step 2:** In-memory `SessionStore` keyed by conversation id (turns, profile_text, last_activity, dirty)
- [ ] **Step 3:** Resolve id: `X-Conversation-Id` → body `conversation_id`/`metadata` → fingerprint hash → fallback `"default"`
- [ ] **Step 4:** Idempotent inject: find/replace LTM markers in system message
- [ ] **Step 5:** Commit

---

### Task 6: Gateway (OpenAI chat + Responses + Anthropic)

**Files:**
- Create: `apps/proxy/src/gateway/{upstream.ts,openai-chat.ts,openai-responses.ts,anthropic-messages.ts}`
- Create: `apps/proxy/src/index.ts`, `apps/proxy/src/worker.ts`
- Test: `apps/proxy/tests/inject-gateway.test.ts` (unit inject path)

- [ ] **Step 1:** Upstream fetch with Authorization passthrough; streaming tee into session buffer
- [ ] **Step 2:** `POST /v1/chat/completions` — inject → forward → buffer assistant
- [ ] **Step 3:** `POST /v1/responses` — inject into `instructions` or input messages equivalently
- [ ] **Step 4:** `POST /v1/messages` — Anthropic face: map system/messages, inject, forward to Anthropic or translate to OpenAI upstream based on config
- [ ] **Step 5:** Models list passthrough best-effort; health `GET /health`
- [ ] **Step 6:** Worker: idle 30m poll + on new conversation schedule distill; write LTM via repo
- [ ] **Step 7:** Commit

**Anthropic upstream note:** Default `upstream_base_url` is OpenAI. For Claude Code, config `anthropic_upstream_base_url = "https://api.anthropic.com"` and forward `/v1/messages` with Anthropic headers. OpenAI clients use OpenAI upstream. Same process hosts both faces.

---

### Task 7: Management UI

**Files:**
- Create: `apps/proxy/src/ui-routes.ts`, `apps/proxy/src/public/{index.html,app.js,styles.css}`

- [ ] **Step 1:** UI server on `ui_port` (8788): Overview, Profile editor, Habits checkboxes, Distill settings, Danger zone Reset
- [ ] **Step 2:** JSON API under `/api/*` (profile GET/PATCH, habits toggle, distill-now, reset, settings)
- [ ] **Step 3:** Bind `127.0.0.1` only
- [ ] **Step 4:** Commit

---

### Task 8: README + CLI entry

**Files:**
- Modify: `README.md`
- Create: `apps/proxy/src/cli.ts` or bin `proxy-cli`

- [ ] **Step 1:** Document install (Node 22+, pnpm, Ollama optional), `pnpm install && pnpm --filter @proxy-cli/proxy dev`
- [ ] **Step 2:** Cursor: Override OpenAI Base URL → `http://127.0.0.1:8787/v1`
- [ ] **Step 3:** Codex: `~/.codex/config.toml` `openai_base_url` / model_providers
- [ ] **Step 4:** Claude Code: `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` (+ API key)
- [ ] **Step 5:** Prerequisites (Ollama pull `qwen2.5:3b`), UI URL, privacy notes
- [ ] **Step 6:** Final verify `pnpm test` + smoke start

---

## Spec coverage checklist

| Design section | Task |
|---|---|
| §5 components / layout | 1 |
| §7 LTM schema + seeds | 3 |
| §8–9 lifecycle + distill | 4, 5, 6 |
| §10 injection | 5, 6 |
| §11 redaction | 2 |
| §12 Cursor/Codex/Claude | 6, 8 |
| §13 UI | 7 |
| §14 gateway path | 6 |
| §17 config | 5 |

## Execution

User requested immediate implementation (`Impl`). Execute inline in this session on branch `feat/phase1-proxy-cli` (current workspace).
