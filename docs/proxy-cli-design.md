# Proxy CLI — Design Document (Phase 1)

> **Status:** Draft for report / implementation planning.  
> **Date:** 2026-07-12.  
> **Repo:** `proxy-ai`.  
> **Sources:** PDF “Proxy CLI” (Idea + Design), design review session 2026-07-12, Gemini Apps Personal Context / Memory (public), agent coding integration patterns (Cursor, Codex, Claude Code).  
> **Audience:** Author (báo cáo chi tiết), implementer, reviewer kiến trúc.  
> **Companion:** review canvas `proxy-cli-design-review.canvas.tsx` (tóm tắt quyết định).

---

## 1. Context

Khi làm việc với Gemini, điểm tiện nổi bật không chỉ là model mà là **bộ nhớ xuyên phiên**: nhớ tech stack user hay dùng, dự án từng trao đổi, thói quen code — rồi dùng lại ở cuộc hội thoại mới (ví dụ lấy dự án ABC cũ làm ref khi gen code). Gemini công bố công khai các lớp gần với “personal memory”:

| Lớp Gemini (public) | Ý nghĩa |
|---|---|
| **Saved info / Memory** | Fact user bảo “remember…”, sở thích, ràng buộc |
| **Instructions for Gemini** | Luật đứng xuyên mọi chat |
| **Learn from past chats** | Cá nhân hóa từ lịch sử hội thoại |
| **Personal Intelligence / Connected apps** | Gmail, Drive, Photos, YouTube… (hệ sinh thái Google) |

**Ý tưởng ban đầu (PDF):** tạo proxy server chạy local, tổng hợp context các cuộc hội thoại, ghi thành bộ nhớ dài hạn (LTM) để dùng cho phiên sau.

**Định vị sản phẩm (đã chốt):** không clone Gemini (Notes/Drive/mic). Phase 1 là **personal coding memory cho agent coding phổ biến** (Cursor, Codex, …) chạy trên máy user. Cross-app kiểu Gemini xếp **happy-to-have / TODO**, không chặn MVP.

Repo `proxy-ai` hiện mới có LICENSE — tài liệu này là nền tảng thiết kế trước khi implement.

---

## 2. Scope and ownership

| Domain | Phase 1 |
|---|---|
| Local OpenAI-compatible API gateway | **In scope — core** |
| LTM store (SQLite) + schema | **In scope — core** |
| Session / working memory (RAM in-process) | **In scope — core** |
| Memory worker (distill async) | **In scope — core** |
| Localhost UI quản lý LTM (xem / checkbox / reset) | **In scope — core** |
| Tích hợp Cursor (Override OpenAI Base URL) | **In scope — target đầu** |
| Tích hợp Codex (`openai_base_url` / Responses) | **In scope MVP hoặc ngay sau — P1 cứng** |
| Face Anthropic cho Claude Code | **P1 — sau Cursor+Codex** |
| Agent runtime tự viết (loop + tools) | **Out of scope** — client sở hữu |
| Redis / multi-instance | **Out of scope MVP** |
| Sync cloud / multi-user remote proxy | **Out of scope** |
| Gemini-style connected apps (Drive, Notes, …) | **Happy-to-have** |

### Out of scope (Phase 1, explicitly)

- Tự xây coding agent cạnh tranh Cursor / Codex / Claude Code
- Auto-infer “thói quen xấu” / nhãn tính cách từ chat
- Inject LTM bằng ảnh (vision) để “tiết kiệm token”
- Redis làm conversation store
- Mã hóa LTM at-rest bắt buộc (có thể là option sau; Phase 1: file local + redaction)
- Multi-tenant / remote hosted proxy
- Training model trên dữ liệu user

---

## 3. Goals

1. **Passive memory middleware** — một process local nhận LLM API từ agent coding, gắn LTM vào context, forward upstream, quan sát hội thoại, distill vào SQLite.
2. **Bộ nhớ xuyên phiên kiểu Gemini (coding-only)** — stacks, style, projects, facts; habits dưới dạng checkbox user kiểm soát.
3. **Chi phí duy trì thấp** — distill bằng Ollama local (không đốt model coding đắt); mặc định `qwen2.5:3b`.
4. **User agency** — UI localhost: xem LTM, bật/tắt habit, chọn field lưu, reset.
5. **Privacy by design hẹp** — schema allowlist + prompt cấm secret + keyword redaction trước khi lưu.

### What “done” looks like for Phase 1

- User chạy Proxy CLI trên máy (`127.0.0.1:8787`), trỏ Cursor (và ideally Codex) vào base URL đó.
- Mở conversation mới → profile LTM + habits đang bật được inject (text ngắn).
- Trong phiên, proxy cập nhật session store; không reload full LTM mỗi turn từ DB.
- Sau **30 phút idle** hoặc khi **mở conversation mới** → distill async bằng Ollama → merge vào LTM.
- User mở `http://127.0.0.1:<ui-port>` xem/sửa checkbox habits / reset LTM.
- Không có credential / `.env` / path tuyệt đối nhạy cảm bị lưu vào LTM trong happy path (có filter + schema).

---

## 4. Architecture overview

```
  User (Cursor / Codex / …)
           │
           │  OPENAI_BASE_URL = http://127.0.0.1:8787/v1
           │  (Claude Code sau: ANTHROPIC_BASE_URL → face Anthropic)
           ▼
  ┌────────────────────────────────────────────────────────────┐
  │  Local Proxy Server (1 process)                            │
  │                                                            │
  │  ┌──────────────┐   ┌─────────────────┐   ┌─────────────┐ │
  │  │ Gateway      │──►│ Session store   │   │ LTM store   │ │
  │  │ (forward +   │   │ (RAM)           │   │ (SQLite)    │ │
  │  │  inject LTM) │   └────────┬────────┘   └──────▲──────┘ │
  │  └──────┬───────┘            │                   │        │
  │         │                    │  idle 30m /       │        │
  │         │                    │  new conversation │        │
  │         │                    ▼                   │        │
  │         │            ┌─────────────────┐         │        │
  │         │            │ Memory worker   │─────────┘        │
  │         │            │ (distill async) │                  │
  │         │            │ → Ollama local  │                  │
  │         │            └─────────────────┘                  │
  │         │                                                 │
  │  ┌──────┴──────────────────────────────────────────────┐  │
  │  │ Management UI (localhost) — profile / habits / reset │  │
  │  └─────────────────────────────────────────────────────┘  │
  └────────────────────────────┬───────────────────────────────┘
                               │ HTTPS
                               ▼
                     Upstream LLM API
                     (api.openai.com hoặc provider user cấu hình)
```

### Key boundaries

| Boundary | Quy tắc |
|---|---|
| **Client ⇄ Proxy** | Client sở hữu agent loop + tools. Proxy **không** chạy tool, không quyết định turn. |
| **Proxy ⇄ Upstream** | Transparent forward (streaming pass-through) sau khi assemble messages. |
| **Proxy ⇄ Ollama** | Chỉ dùng cho **distill** (call riêng), không thay model coding của user. |
| **Proxy ⇄ SQLite** | LTM durable; session không ghi LTM mỗi turn. |
| **User ⇄ UI** | Quản lý LTM trên localhost; không expose ra mạng LAN mặc định (bind `127.0.0.1`). |

### Vì sao passive (không phải memory agent chủ động)?

Các agent phổ biến **đã sở hữu** loop:

| Agent | Ai sở hữu loop? | Seam gắn Proxy CLI | Khớp |
|---|---|---|---|
| Cursor | Cursor | Override OpenAI Base URL → `/v1` | Passive |
| Codex CLI | Codex | `openai_base_url` / `model_providers.*.base_url` | Passive (+ Responses) |
| Claude Code | Claude Code | `ANTHROPIC_BASE_URL` → `/v1/messages` | Passive (face Anthropic P1) |
| Cline / Continue / Aider… | Client | OpenAI-compatible base URL | Passive |

Xây agent runtime riêng = cạnh tranh sai chỗ. Proxy CLI = **middleware memory**.

---

## 5. Components

| # | Component | Type | Where | Phase | Notes |
|---|---|---|---|---|---|
| 1 | Gateway | HTTP server | Local process | P1 | OpenAI-compatible `/v1`; inject + forward + stream |
| 2 | Session store | In-memory map | Same process | P1 | Working memory theo `conversation_id` |
| 3 | LTM store | SQLite file | Disk user | P1 | Profile + habits + facts… |
| 4 | Memory worker | Async job | Same process | P1 | Distill idle / new convo |
| 5 | Distill runtime | Ollama HTTP | Local | P1 | Default `qwen2.5:3b` |
| 6 | Redaction | Lib + rules | Same process | P1 | Trước distill + trước persist |
| 7 | Management UI | Local web | `127.0.0.1` | P1 | View / checkbox / reset / model picker |
| 8 | Anthropic face | HTTP adapter | Same process | P1+ | Claude Code |
| 9 | Heuristic fallback | Rules | Same process | P1 | Khi Ollama thiếu/fail |

### Đề xuất layout repo (implement sau)

```
proxy-ai/
├── README.md
├── docs/
│   └── proxy-cli-design.md          # tài liệu này
├── apps/
│   └── proxy/                       # process chính (gateway + worker + UI static)
├── packages/
│   ├── ltm/                         # schema, SQLite repos, assemble, validate
│   ├── distill/                     # prompts, Ollama client, merge, retry
│   ├── redact/                      # keyword / secret filters
│   └── proto/                       # shared types (OpenAI wire subset)
└── …
```

(Chi tiết package có thể chỉnh khi implement; ranh giới trách nhiệm giữ như bảng trên.)

---

## 6. Decisions made (Phase 1)

| Area | Decision | Rationale |
|---|---|---|
| Kiến trúc | **Passive proxy** (middleware), không tự viết agent runtime | Cursor/Codex/Claude đã sở hữu loop; seam = base URL |
| Positioning | Personal coding memory local; không clone Gemini ecosystem | Cross-app = happy-to-have |
| Conversation store | **RAM in-process** | MVP local một process; Redis over-spec |
| LTM store | **SQLite file** | Durable, portable, đủ cho single-user |
| Habits / “thói quen xấu” | **Checkbox** user bật; bổ sung dần; **không** auto-infer | Tránh false positive / nhãn tiêu cực suy luận |
| LTM schema | Map Gemini public → coding fields (§7) | Có baseline public; hẹp để giảm rủi ro privacy |
| Distill trigger | **Idle 30 phút** **hoặc** **mở conversation mới** (+ nút manual optional) | Passive proxy không bắt “tắt app” tin cậy |
| Distill caller | **API call riêng từ proxy** | Không xen vào đoạn chat user |
| Distill merge | Gửi LTM hiện tại + transcript → JSON LTM mới cùng schema | Dedup/conflict trong một prompt |
| Distill model | Ollama **local-first**; default **`qwen2.5:3b`** | JSON/schema + multilingual + coding extract tốt hơn Llama 3.2 3B ở tier này |
| Distill options (nhẹ) | `qwen2.5:3b`, `llama3.2:3b` | User chọn; Llama = option latency |
| Distill options (khoẻ) | `llama3.1:8b`, `gemma2:9b` | Máy đủ RAM, cần merge chính xác hơn |
| Distill fallback | Heuristic → optional API mini (tắt mặc định) | Không đốt model coding; vẫn chạy khi Ollama thiếu |
| Injection format | **Text ngắn** (Markdown/YAML), **không ảnh** | Vision đắt hơn và dễ lỗi parse |
| Injection timing | Một lần khi start conversation; **re-attach idempotent** nếu client nuốt mất system block | Client có thể rebuild `messages[]` |
| “Model quên trong cửa sổ dài” | Coi là trách nhiệm Agent/Model | Proxy không cố nhồi lại mỗi turn ngoài đảm bảo block còn đó |
| Privacy | Schema allowlist + distill prompt cấm secret + keyword redaction | Schema hẹp ≠ miễn filter; transcript raw vẫn nhạy cảm trước distill |
| Bind address | `127.0.0.1` only (default) | Tránh lộ LTM trên LAN |
| Target client MVP | Cursor + Codex | Claude Code = P1 face Anthropic |

### So sánh đã dùng để chọn default distill (`qwen2.5:3b` vs `llama3.2:3b`)

| Tiêu chí (distill LTM) | qwen2.5:3b | llama3.2:3b |
|---|---|---|
| JSON / schema compliance | Mạnh hơn (structured output là điểm mạnh Qwen2.5) | Yếu hơn ở 3B trên nhiều bench |
| Instruction / merge | Ổn định hơn | Cần few-shot mới ổn |
| Coding / tech fact | Mạnh hơn một bậc | Đủ dùng |
| Đa ngữ (kể cả VI) | 29+ languages incl. Vietnamese | Chủ yếu EN |
| Tốc độ | Hơi chậm hơn | Thường nhanh hơn chút |
| **Vai trò** | **Default** | Option nhẹ |

---

## 7. LTM Schema

Map từ Gemini → schema coding-only.

### 7.1 Logical model

```text
LtmProfile
  identity?: { role?: string, ui_locale?: string }
  stacks: string[]                 // ngôn ngữ, framework, tools
  style: string[]                  // bullet ngắn — style code/review
  projects: ProjectFact[]
  facts: MemoryFact[]
  habits: HabitCheckbox[]
  meta: { updated_at, version }

ProjectFact
  name: string
  stack?: string[]
  notes?: string                   // không secret, không path tuyệt đối

MemoryFact
  id: string
  text: string                     // 1–2 câu
  topic: "stack" | "style" | "project" | "preference" | "other"
  updated_at: string               // ISO-8601
  source_session?: string

HabitCheckbox
  id: string
  label: string                    // hiển thị UI
  enabled: boolean
  inject_text: string              // rule inject khi enabled
  seed: boolean                    // true nếu đến từ seed list
```

### 7.2 SQLite (đề xuất bảng)

| Table | Columns (chính) |
|---|---|
| `profile` | `id=1`, `identity_json`, `updated_at`, `schema_version` |
| `stacks` | `id`, `value`, `updated_at` |
| `style_items` | `id`, `value`, `updated_at` |
| `projects` | `id`, `name`, `stack_json`, `notes`, `updated_at` |
| `facts` | `id`, `text`, `topic`, `source_session`, `updated_at` |
| `habits` | `id`, `label`, `enabled`, `inject_text`, `seed`, `updated_at` |
| `sessions` | `id`, `started_at`, `ended_at`, `status`, `client` |
| `session_events` | optional audit — có thể chỉ giữ transcript tạm trên RAM |

`schema_version` cho phép migrate khi báo cáo / Phase 2 mở rộng field.

### 7.3 Seed habits (đề xuất ban đầu — user bổ sung dần)

| id | label | inject_text (ý) | enabled default |
|---|---|---|---|
| `habit.verify-before-claim` | Double-check trước khi khẳng định đã xong | Prefer verifying with tests/commands before claiming success | off |
| `habit.no-invented-apis` | Không bịa API / file | Do not invent files, APIs, or configs that are not in the repo | off |
| `habit.prefer-existing-patterns` | Ưu tiên pattern sẵn có trong repo | Follow existing project patterns over new abstractions | off |
| `habit.ask-destructive` | Hỏi trước thao tác phá hủy | Ask before destructive git/ops (reset, force push, rm -rf) | off |
| `habit.typecheck-tests` | Nhắc chạy typecheck/test khi đụng code | When changing code, run or suggest typecheck/tests | off |

UI: danh sách checkbox; user bật từng cái. Distill **không** được thêm/xóa/sửa `habits[]`.

### 7.4 Giới hạn nội dung được lưu

**Được:** kỹ thuật coding, stack, style, convention, tóm tắt dự án kỹ thuật, lesson learned không chứa secret.  
**Không được:** API key, token, password, `.env`, private key, PII, tên khách hàng nhạy cảm, path tuyệt đối máy user, URL nội bộ bí mật.

---

## 8. Memory lifecycle

| Sự kiện | Hành động |
|---|---|
| Mở / resume conversation | Resolve `conversation_id` → load LTM (+ habits enabled) → assemble profile text → gắn vào session cache |
| Trong phiên | Append turn vào session store (RAM); **không** reload full LTM từ DB mỗi LLM call |
| Mỗi LLM call | Dùng context đã assemble; nếu block inject thiếu trong `messages[]` → re-attach idempotent |
| Idle **30 phút** không có LLM call | Memory worker distill session → merge LTM (async) |
| Phát hiện **conversation mới** | Distill / flush phiên cũ (nếu còn dirty) → khởi tạo session mới + inject |
| User bấm “Kết thúc phiên” (UI) | Distill ngay |
| User Reset LTM | Xóa/truncate theo policy UI (giữ hoặc reset seed habits — mặc định: giữ seed, `enabled=false`) |

```
Open conversation
    → Retrieve LTM → assemble → session.profile_text
During session
    → update session/working only
Idle 30m OR new conversation OR manual end
    → redact transcript → distill (Ollama) → validate JSON → write LTM
Each LLM call
    → ensure inject present → forward upstream
```

---

## 9. Distill policy

### 9.1 Triggers (chốt)

1. **Idle timeout = 30 phút** kể từ LLM call cuối của session.  
2. **New conversation** = flush phiên trước.  
3. **Manual** “Kết thúc phiên” trên UI (optional).  

**Không** dựa vào: tắt Cursor / close tab / quit app (passive proxy không nhận event đáng tin).

### 9.2 Phát hiện conversation / session id

Thứ tự ưu tiên (implement):

1. Header client nếu có (`X-Conversation-Id`, metadata Codex/Cursor nếu xuất hiện trên wire).  
2. Body field nếu API có (`conversation_id` / `metadata`).  
3. Heuristic: fingerprint = hash ổn định từ `(client_hint, first_user_message_normalized, day_bucket?)` — tài liệu hóa là best-effort.  
4. Nếu không tách được conversation: coi toàn bộ traffic trong cửa sổ idle như một session (vẫn distill được theo idle).

Ghi rõ trong báo cáo: độ chính xác “new conversation” phụ thuộc client; idle 30p là lưới an toàn.

### 9.3 Distill call (không vào chat user)

Proxy gọi Ollama (OpenAI-compatible local) với prompt dạng:

```text
SYSTEM: You update a coding-only long-term memory profile.
- Output ONLY valid JSON matching the schema.
- Merge with existing profile: keep, update, add, or remove contradictory facts.
- Never add/modify habits[].
- Never store secrets, credentials, PII, absolute paths, customer names.
- Prefer short bullet facts. Max N facts / style lines (budget).

USER:
Existing LTM JSON:
{...}

Session transcript (already redacted):
{...}
```

### 9.4 Validate & retry

1. Parse JSON.  
2. Validate against schema (Zod / JSON Schema).  
3. Strip bất kỳ key ngoài allowlist.  
4. Re-run redaction trên field text.  
5. Fail → retry 1 lần với repair prompt; vẫn fail → giữ LTM cũ, log lỗi, optional heuristic extract stacks keywords.

### 9.5 Model selection

| Tier | Ollama tags | Default? |
|---|---|---|
| Nhẹ | `qwen2.5:3b`, `llama3.2:3b` | **`qwen2.5:3b`** |
| Khoẻ | `llama3.1:8b`, `gemma2:9b` | User chọn |

Pipeline: selected Ollama model → heuristic fallback → API mini (nếu user bật).

---

## 10. Context injection (token budget)

### 10.1 Format (chốt: text ngắn)

Ví dụ block inject (Markdown):

```markdown
<!-- proxy-cli:ltm v1 -->
# User coding memory (local)
## Identity
- …

## Stacks
- TypeScript, NestJS, …

## Style
- Prefer existing patterns; small diffs

## Projects
- ABC: NestJS + Postgres — …

## Standing rules (enabled habits)
- Do not invent APIs/files not in the repo

## Facts
- …
<!-- /proxy-cli:ltm -->
```

Markers `proxy-cli:ltm` dùng để detect “đã inject chưa” và thay thế idempotent (không nhân bản block).

### 10.2 Ngân sách (đề xuất số — chỉnh khi đo)

| Phần | Max gợi ý |
|---|---|
| Toàn bộ LTM block | **≤ ~800–1200 tokens** (cứng hóa config) |
| `style[]` | ≤ 8 bullets |
| `facts[]` đưa vào inject | top K theo `updated_at` / relevance đơn giản (K ≤ 15) |
| `projects[]` | ≤ 5 gần nhất |
| Habits | chỉ `enabled=true` |

Ưu tiên cắt khi vượt budget: facts cũ → project notes dài → style → stacks → habits (habits cắt cuối cùng vì user chủ động bật).

### 10.3 Chỗ gắn trong messages

1. Nếu đã có `system` message: append / replace LTM subsection trong system.  
2. Nếu không: chèn `system` (hoặc `developer` nếu wire hỗ trợ) ở đầu.  
3. Không gửi ảnh / vision payload.

### 10.4 Idempotent re-attach

Mỗi request:

- Scan `messages` tìm marker `proxy-cli:ltm`.  
- Có và khớp version/session → giữ.  
- Không có → inject.  
- Có nhưng stale (user đổi habits giữa phiên) → replace block từ session cache mới.

---

## 11. Privacy & retention

### 11.1 Ba lớp (chốt)

| Lớp | Cơ chế |
|---|---|
| 1. Schema allowlist | Chỉ persist field đã định; reject key lạ từ model |
| 2. Distill prompt | Cấm secret / PII / path tuyệt đối / tên khách |
| 3. Keyword / pattern redaction | Chạy trên transcript trước distill và trên output trước ghi DB |

### 11.2 Redaction (đề xuất loại)

- Patterns: `sk-`, `sk-ant-`, `api_key`, `Bearer `, AWS keys, private key PEM, JWT-like, `.env` assignments.  
- Paths: `/Users/...`, `C:\Users\...` → thay `[PATH]`.  
- Email / phone (optional heuristic).  

Thư viện: có thể dùng tập rule tự viết +/hoặc lib detect secret phổ biến (đánh giá license khi implement).

### 11.3 Retention / user controls

| Action | Behaviour |
|---|---|
| View LTM | UI localhost đọc SQLite |
| Toggle habit | Update `habits.enabled` |
| Delete fact / project | Soft hoặc hard delete từng mục |
| Reset LTM | Xóa facts/projects/stacks/style/identity; seed habits giữ, `enabled=false` |
| Export | JSON download (optional Phase 1.1) |
| Temporary / no-store session | Flag “không distill phiên này” (optional) |

### 11.4 Network exposure

- Default bind `127.0.0.1`.  
- Không log full transcript ra file mặc định (hoặc ring buffer RAM only).  
- Upstream API key: user cung cấp; proxy forward header, không ghi key vào LTM.

---

## 12. Multi-agent integration

### 12.1 Cursor

| Item | Chi tiết |
|---|---|
| Seam | Settings → Models → Override OpenAI Base URL → `http://127.0.0.1:8787/v1` (hoặc tunnel HTTPS nếu Cursor chặn private network) |
| Wire | Chat Completions (+ streaming); kiểm tra sớm Agent mode vs Ask/Plan |
| Rủi ro P1 | Một số bản Cursor hạn chế custom base URL / Agent; có thể cần HTTPS tunnel (ngrok/cloudflared) |
| MVP | Ưu tiên chứng minh Ask/Plan + Agent nếu khả dụng |

### 12.2 Codex CLI

| Item | Chi tiết |
|---|---|
| Seam | `openai_base_url` trong `~/.codex/config.toml` hoặc `[model_providers.*] base_url` |
| Wire | **Responses API** ngày càng là mặc định — gateway Phase 1 nên hỗ trợ `/v1/responses` sớm (P1 cứng), không chỉ `/v1/chat/completions` |
| Agent loop | Codex sở hữu — proxy chỉ memory middleware |

### 12.3 Claude Code (P1)

| Item | Chi tiết |
|---|---|
| Seam | `ANTHROPIC_BASE_URL` |
| Wire | Anthropic Messages `/v1/messages` (+ SSE) |
| Cách làm | Face Anthropic trên cùng process **hoặc** document stack với translator có sẵn phía trước Proxy CLI OpenAI face |

### 12.4 Ma trận API surface

| Endpoint | MVP | P1 | Ghi chú |
|---|---|---|---|
| `POST /v1/chat/completions` (+ stream) | ✓ | | Cursor + nhiều client |
| `POST /v1/responses` (+ stream) | | ✓ | Codex |
| `POST /v1/messages` (Anthropic) | | ✓ | Claude Code |
| Models list / embeddings | Best-effort passthrough | | Không cần cho LTM |

---

## 13. Management UI (localhost)

**Mục tiêu:** cho phép user quản lý thông tin lưu trên URL cục bộ (theo PDF).

### 13.1 Màn hình tối thiểu

1. **Overview** — số facts, projects, stacks; thời điểm distill cuối.  
2. **Profile editor** — xem/sửa stacks, style, projects, facts (CRUD đơn giản).  
3. **Habits** — checkbox list + thêm habit custom (label + inject_text).  
4. **Distill settings** — model dropdown (`qwen2.5:3b` …), idle minutes (default 30), nút “Kết thúc phiên / Distill now”.  
5. **Danger zone** — Reset LTM, (sau) Export.

### 13.2 Non-goals UI Phase 1

- Auth user (bind localhost là đủ).  
- Multi-user.  
- Fancy analytics.

---

## 14. Gateway behaviour (request path)

```
1. Accept request (chat/completions or responses)
2. Authenticate upstream key from incoming Authorization (passthrough)
3. Resolve conversation_id → get or create Session
4. If new conversation: schedule distill of previous dirty session
5. Append inbound user/assistant turns to session buffer (redacted copy for distill; raw only in RAM)
6. Assemble messages:
     - ensure LTM inject block present (from session.profile_text)
7. Forward to upstream (stream or JSON)
8. Tee assistant output into session buffer (for distill)
9. Update last_activity_at
10. Return response unchanged to client (minus any debug headers)
```

Streaming: byte/event passthrough; không buffer toàn bộ trước khi trả trừ khi cần cho distill (có thể buffer song song).

---

## 15. Failure modes

| Situation | Behaviour |
|---|---|
| Upstream LLM down | Trả lỗi upstream nguyên xi |
| Ollama missing / model chưa pull | Log warning; heuristic fallback; UI hiện banner “cài Ollama + pull model” |
| Distill JSON invalid | Retry 1; rồi skip write; giữ LTM cũ |
| SQLite locked / corrupt | Không crash gateway; queue write; UI báo lỗi |
| Proxy process restart | Session RAM mất → không distill phiên dở (chấp nhận MVP); LTM disk còn |
| Cursor chặn localhost | Document tunnel HTTPS; không đổi kiến trúc |
| Inject vượt context window | Cắt theo budget §10.2 trước khi gửi |

---

## 16. Phased delivery

### Phase 1 (MVP)

- Passive gateway `/v1/chat/completions` + streaming  
- SQLite LTM + schema §7  
- RAM sessions  
- Inject text + idempotent re-attach  
- Distill: idle 30m + new conversation; Ollama `qwen2.5:3b` default  
- UI: view / habits checkbox / reset / model picker  
- Redaction + schema validation  
- Target: **Cursor**

### Phase 1.1

- `/v1/responses` cho **Codex**  
- Export JSON  
- Cải thiện conversation-id detection  
- Nút Distill now + “không lưu phiên này”

### Phase 1.2

- Anthropic `/v1/messages` face (**Claude Code**)  
- Tunable project-scoped LTM tag  
- Optional API-mini distill fallback

### Later / happy-to-have

- Gemini-style connected apps / cross-app context  
- Encryption at rest  
- Multi-device sync  
- Richer relevance retrieval (embeddings) thay top-K facts

---

## 17. Configuration (đề xuất)

```toml
# ví dụ config — tên file quyết định lúc implement
bind_host = "127.0.0.1"
gateway_port = 8787
ui_port = 8788

upstream_base_url = "https://api.openai.com/v1"
# upstream key: từ request header hoặc env PROXY_UPSTREAM_API_KEY

sqlite_path = "~/.proxy-cli/ltm.sqlite"

[distill]
idle_minutes = 30
ollama_base_url = "http://127.0.0.1:11434"
model = "qwen2.5:3b"
# allowed_models = ["qwen2.5:3b", "llama3.2:3b", "llama3.1:8b", "gemma2:9b"]
max_inject_tokens = 1000
heuristic_fallback = true
api_mini_fallback = false

[privacy]
redact = true
```

---

## 18. Open items / assumptions

| # | Item | Assumption tạm | Cần xác nhận khi impl / báo cáo |
|---|---|---|---|
| O1 | Cursor Agent + custom base URL ổn định trên máy user | Ask/Plan chắc hơn Agent | Spike sớm trên Cursor bản đang dùng |
| O2 | Heuristic conversation-id đủ dùng | Idle 30p bù | Thu thập header thực tế từ Cursor/Codex |
| O3 | Seed habits list §7.3 | Đủ để demo | Author bổ sung tay theo thói quen thật |
| O4 | Exact max inject tokens | 800–1200 | Đo trên vài session thật |
| O5 | Codex Responses shape | Passthrough + inject tương đương | Spike `/v1/responses` |
| O6 | License lib redaction | Rule tự viết trước | Nếu dùng lib ngoài — ghi license vào báo cáo |

---

## 19. Traceability — quyết định từ buổi review

| Chủ đề review | Kết luận ghi vào design |
|---|---|
| PDF Idea (Gemini-like memory) | Giữ ý; thu hẹp coding-only local |
| PDF Design (gateway + LTM + worker) | Giữ; bỏ Redis MVP; agent runtime = client |
| Thói quen xấu | Checkbox, bổ sung dần |
| Passive vs active agent | Passive — theo Cursor/Codex/Claude |
| Gemini vs local | Định hướng / happy-to-have |
| LTM schema | Map Gemini Saved info / Instructions / past chats |
| Distill trigger | Idle 30p + new conversation |
| Distill model | Không dùng model đang code; Ollama; default qwen2.5:3b |
| Merge | Prompt LTM cũ + transcript → JSON mới |
| Injection | Text ngắn, 1 lần đầu phiên + re-attach |
| Privacy | 3 lớp; schema hẹp vẫn cần redact |

---

## 20. References

- PDF: Proxy CLI — Idea + Design (2026-07-12 export).  
- Gemini Apps Help / Personal Intelligence / Personal context (public product pages, 2025–2026).  
- Cursor: Override OpenAI Base URL.  
- OpenAI Codex: `openai_base_url` / custom `model_providers` (Responses-oriented).  
- Claude Code: `ANTHROPIC_BASE_URL` + Anthropic Messages API.  
- SLM comparisons (Qwen2.5-3B vs Llama-3.2-3B) — structured JSON / instruction following (các benchmark cộng đồng 2025–2026).  
- Style tham chiếu cấu trúc design: `sc-teleoperation-v2/docs/cockpit-phase1-design.md`, `docs/superpowers/specs/*-design.md`.

---

## 21. Document history

| Date | Change |
|---|---|
| 2026-07-12 | First full design — tổng hợp PDF + review session + P0 lock |
