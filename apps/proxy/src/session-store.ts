import { createHash } from "node:crypto";
import type { SessionTurn } from "@proxy-cli/proto";

export interface ProxySession {
  id: string;
  clientHint?: string;
  profileText: string;
  turns: SessionTurn[];
  dirty: boolean;
  lastActivityAt: number;
  createdAt: number;
  distillInFlight: boolean;
  noStore: boolean;
}

export class SessionStore {
  private readonly sessions = new Map<string, ProxySession>();

  get(id: string): ProxySession | undefined {
    return this.sessions.get(id);
  }

  getOrCreate(
    id: string,
    profileText: string,
    clientHint?: string,
  ): { session: ProxySession; created: boolean } {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastActivityAt = Date.now();
      return { session: existing, created: false };
    }
    const session: ProxySession = {
      id,
      clientHint,
      profileText,
      turns: [],
      dirty: false,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      distillInFlight: false,
      noStore: false,
    };
    this.sessions.set(id, session);
    return { session, created: true };
  }

  list(): ProxySession[] {
    return [...this.sessions.values()];
  }

  touch(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.lastActivityAt = Date.now();
  }

  appendTurn(id: string, turn: SessionTurn): void {
    const s = this.sessions.get(id);
    if (!s || s.noStore) return;
    s.turns.push(turn);
    s.dirty = true;
    s.lastActivityAt = Date.now();
  }

  updateProfileText(id: string, profileText: string): void {
    const s = this.sessions.get(id);
    if (s) s.profileText = profileText;
  }

  markClean(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      s.dirty = false;
      s.distillInFlight = false;
    }
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  findIdle(idleMs: number, now = Date.now()): ProxySession[] {
    return this.list().filter(
      (s) => s.dirty && !s.distillInFlight && !s.noStore && now - s.lastActivityAt >= idleMs,
    );
  }
}

export function fingerprintConversationId(parts: {
  clientHint?: string;
  firstUserMessage?: string;
  dayBucket?: string;
}): string {
  const day =
    parts.dayBucket ?? new Date().toISOString().slice(0, 10);
  const normalized = (parts.firstUserMessage ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const raw = `${parts.clientHint ?? "unknown"}|${normalized}|${day}`;
  return `fp-${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}
