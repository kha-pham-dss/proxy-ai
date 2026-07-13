import { runDistill } from "@proxy-cli/distill";
import type { LtmRepository } from "@proxy-cli/ltm";
import type { ProxyConfig } from "./config.js";
import type { SessionStore } from "./session-store.js";

export class MemoryWorker {
  private timer?: ReturnType<typeof setInterval>;
  private lastDistillAt?: string;
  private lastError?: string;

  constructor(
    private readonly config: ProxyConfig,
    private readonly sessions: SessionStore,
    private readonly ltm: LtmRepository,
  ) {}

  start(): void {
    const everyMs = 30_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, everyMs);
    // Don't keep process alive solely for the timer in tests
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  status(): { lastDistillAt?: string; lastError?: string; activeSessions: number } {
    return {
      lastDistillAt: this.lastDistillAt,
      lastError: this.lastError,
      activeSessions: this.sessions.list().length,
    };
  }

  async tick(): Promise<void> {
    const idleMs = this.config.distill.idleMinutes * 60_000;
    const idle = this.sessions.findIdle(idleMs);
    for (const session of idle) {
      await this.distillSession(session.id);
    }
  }

  async distillDirtyExcept(keepId: string): Promise<void> {
    for (const session of this.sessions.list()) {
      if (session.id === keepId) continue;
      if (session.dirty && !session.noStore) {
        await this.distillSession(session.id);
      }
    }
  }

  async distillSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session || session.noStore || !session.dirty || session.distillInFlight) {
      return { ok: true };
    }
    session.distillInFlight = true;
    try {
      const existing = this.ltm.loadProfile();
      const result = await runDistill({
        existing,
        transcript: session.turns,
        ollamaBaseUrl: this.config.distill.ollamaBaseUrl,
        model: this.config.distill.model,
        heuristicFallback: this.config.distill.heuristicFallback,
      });
      this.ltm.replaceProfile(result.profile, { preserveHabits: true });
      this.sessions.markClean(sessionId);
      this.lastDistillAt = new Date().toISOString();
      this.lastError = result.error;
      this.ltm.setSetting("last_distill_at", this.lastDistillAt);
      this.ltm.setSetting("last_distill_source", result.source);
      return { ok: true, error: result.error };
    } catch (err) {
      session.distillInFlight = false;
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      return { ok: false, error: message };
    }
  }

  async distillNow(): Promise<{ ok: boolean; error?: string; distilled: string[] }> {
    const distilled: string[] = [];
    let lastError: string | undefined;
    for (const session of this.sessions.list()) {
      if (!session.dirty || session.noStore) continue;
      const result = await this.distillSession(session.id);
      if (result.ok) distilled.push(session.id);
      else lastError = result.error;
    }
    return { ok: !lastError, error: lastError, distilled };
  }
}
