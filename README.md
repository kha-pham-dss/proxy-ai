# proxy-ai (Proxy CLI)

Local **passive memory proxy** for coding agents (Cursor, Codex, …): OpenAI-compatible gateway on the machine, long-term memory (LTM) in SQLite, distill via Ollama.

**See [`docs/proxy-cli-design.md`](docs/proxy-cli-design.md) for the full Phase 1 design** (dùng làm nguồn viết báo cáo chi tiết).

## Status

Design locked (2026-07-12). Implementation not started — repo currently contains LICENSE + design docs only.

## Phase 1 in one paragraph

A single local process accepts LLM API traffic from Cursor/Codex, injects a short coding-only LTM profile (Gemini-inspired schema + user checkbox habits), forwards to the upstream provider, and asynchronously distills ended sessions (idle 30 minutes or new conversation) with Ollama (`qwen2.5:3b` default). Management UI on localhost for view / habits / reset. No self-owned agent runtime.

## Quick links

| Doc | Purpose |
|---|---|
| [docs/proxy-cli-design.md](docs/proxy-cli-design.md) | Full design: architecture, schema, distill, privacy, multi-agent, MVP phases |
| Review canvas (Cursor) | Decision summary from design review session |

## License

See [LICENSE](LICENSE).
