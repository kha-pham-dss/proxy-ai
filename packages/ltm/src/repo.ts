import { redactText } from "@proxy-cli/redact";
import {
  LTM_SCHEMA_VERSION,
  type HabitCheckbox,
  type LtmIdentity,
  type LtmProfile,
  type MemoryFact,
  type ProjectFact,
} from "@proxy-cli/proto";
import type { LtmDb } from "./db.js";
import { SEED_HABITS } from "./seed.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class LtmRepository {
  constructor(private readonly db: LtmDb) {}

  loadProfile(): LtmProfile {
    const profileRow = this.db
      .prepare("SELECT identity_json, updated_at, schema_version FROM profile WHERE id = 1")
      .get() as
      | { identity_json: string | null; updated_at: string; schema_version: number }
      | undefined;

    const stacks = (
      this.db.prepare("SELECT value FROM stacks ORDER BY updated_at DESC").all() as Array<{
        value: string;
      }>
    ).map((r) => r.value);

    const style = (
      this.db.prepare("SELECT value FROM style_items ORDER BY updated_at DESC").all() as Array<{
        value: string;
      }>
    ).map((r) => r.value);

    const projects = (
      this.db
        .prepare("SELECT name, stack_json, notes FROM projects ORDER BY updated_at DESC")
        .all() as Array<{ name: string; stack_json: string | null; notes: string | null }>
    ).map(
      (r): ProjectFact => ({
        name: r.name,
        stack: r.stack_json ? (JSON.parse(r.stack_json) as string[]) : undefined,
        notes: r.notes ?? undefined,
      }),
    );

    const facts = (
      this.db
        .prepare(
          "SELECT id, text, topic, source_session, updated_at FROM facts ORDER BY updated_at DESC",
        )
        .all() as Array<{
        id: string;
        text: string;
        topic: MemoryFact["topic"];
        source_session: string | null;
        updated_at: string;
      }>
    ).map(
      (r): MemoryFact => ({
        id: r.id,
        text: r.text,
        topic: r.topic,
        updated_at: r.updated_at,
        source_session: r.source_session ?? undefined,
      }),
    );

    const habits = (
      this.db
        .prepare(
          "SELECT id, label, enabled, inject_text, seed FROM habits ORDER BY seed DESC, label ASC",
        )
        .all() as Array<{
        id: string;
        label: string;
        enabled: number;
        inject_text: string;
        seed: number;
      }>
    ).map(
      (r): HabitCheckbox => ({
        id: r.id,
        label: r.label,
        enabled: Boolean(r.enabled),
        inject_text: r.inject_text,
        seed: Boolean(r.seed),
      }),
    );

    let identity: LtmIdentity | undefined;
    if (profileRow?.identity_json) {
      identity = JSON.parse(profileRow.identity_json) as LtmIdentity;
    }

    return {
      identity,
      stacks,
      style,
      projects,
      facts,
      habits,
      meta: {
        updated_at: profileRow?.updated_at ?? nowIso(),
        version: profileRow?.schema_version ?? LTM_SCHEMA_VERSION,
      },
    };
  }

  replaceProfile(profile: LtmProfile, options?: { preserveHabits?: boolean }): void {
    const existing = this.loadProfile();
    const habits = options?.preserveHabits !== false ? existing.habits : profile.habits;
    const updatedAt = nowIso();

    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM stacks").run();
      this.db.prepare("DELETE FROM style_items").run();
      this.db.prepare("DELETE FROM projects").run();
      this.db.prepare("DELETE FROM facts").run();

      const insertStack = this.db.prepare(
        "INSERT INTO stacks (value, updated_at) VALUES (?, ?)",
      );
      for (const value of unique(profile.stacks.map((s) => redactText(s.trim())).filter(Boolean))) {
        insertStack.run(value, updatedAt);
      }

      const insertStyle = this.db.prepare(
        "INSERT INTO style_items (value, updated_at) VALUES (?, ?)",
      );
      for (const value of unique(profile.style.map((s) => redactText(s.trim())).filter(Boolean))) {
        insertStyle.run(value, updatedAt);
      }

      const insertProject = this.db.prepare(
        "INSERT INTO projects (name, stack_json, notes, updated_at) VALUES (?, ?, ?, ?)",
      );
      for (const p of profile.projects) {
        insertProject.run(
          redactText(p.name),
          p.stack ? JSON.stringify(p.stack.map((s) => redactText(s))) : null,
          p.notes ? redactText(p.notes) : null,
          updatedAt,
        );
      }

      const insertFact = this.db.prepare(
        "INSERT INTO facts (id, text, topic, source_session, updated_at) VALUES (?, ?, ?, ?, ?)",
      );
      for (const f of profile.facts) {
        insertFact.run(
          f.id,
          redactText(f.text),
          f.topic,
          f.source_session ?? null,
          f.updated_at || updatedAt,
        );
      }

      this.db
        .prepare(
          "UPDATE profile SET identity_json = ?, updated_at = ?, schema_version = ? WHERE id = 1",
        )
        .run(
          profile.identity ? JSON.stringify(redactDeepIdentity(profile.identity)) : null,
          updatedAt,
          LTM_SCHEMA_VERSION,
        );

      // Habits are never overwritten by distill merges.
      void habits;
    });
    tx();
  }

  setIdentity(identity: LtmIdentity | null): void {
    this.db
      .prepare("UPDATE profile SET identity_json = ?, updated_at = ? WHERE id = 1")
      .run(identity ? JSON.stringify(identity) : null, nowIso());
  }

  setStacks(values: string[]): void {
    const updatedAt = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM stacks").run();
      const insert = this.db.prepare("INSERT INTO stacks (value, updated_at) VALUES (?, ?)");
      for (const value of unique(values.map((v) => redactText(v.trim())).filter(Boolean))) {
        insert.run(value, updatedAt);
      }
      this.touchProfile(updatedAt);
    });
    tx();
  }

  setStyle(values: string[]): void {
    const updatedAt = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM style_items").run();
      const insert = this.db.prepare("INSERT INTO style_items (value, updated_at) VALUES (?, ?)");
      for (const value of unique(values.map((v) => redactText(v.trim())).filter(Boolean))) {
        insert.run(value, updatedAt);
      }
      this.touchProfile(updatedAt);
    });
    tx();
  }

  upsertProject(project: ProjectFact): void {
    const updatedAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO projects (name, stack_json, notes, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           stack_json = excluded.stack_json,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
      )
      .run(
        redactText(project.name),
        project.stack ? JSON.stringify(project.stack.map((s) => redactText(s))) : null,
        project.notes ? redactText(project.notes) : null,
        updatedAt,
      );
    this.touchProfile(updatedAt);
  }

  deleteProject(name: string): void {
    this.db.prepare("DELETE FROM projects WHERE name = ?").run(name);
    this.touchProfile(nowIso());
  }

  upsertFact(fact: MemoryFact): void {
    this.db
      .prepare(
        `INSERT INTO facts (id, text, topic, source_session, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           topic = excluded.topic,
           source_session = excluded.source_session,
           updated_at = excluded.updated_at`,
      )
      .run(
        fact.id,
        redactText(fact.text),
        fact.topic,
        fact.source_session ?? null,
        fact.updated_at || nowIso(),
      );
    this.touchProfile(nowIso());
  }

  deleteFact(id: string): void {
    this.db.prepare("DELETE FROM facts WHERE id = ?").run(id);
    this.touchProfile(nowIso());
  }

  setHabitEnabled(id: string, enabled: boolean): void {
    const result = this.db
      .prepare("UPDATE habits SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, nowIso(), id);
    if (result.changes === 0) {
      throw new Error(`Unknown habit: ${id}`);
    }
  }

  addCustomHabit(habit: Omit<HabitCheckbox, "seed">): void {
    this.db
      .prepare(
        `INSERT INTO habits (id, label, enabled, inject_text, seed, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      )
      .run(
        habit.id,
        habit.label,
        habit.enabled ? 1 : 0,
        habit.inject_text,
        nowIso(),
      );
  }

  resetLtm(): void {
    const updatedAt = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM stacks").run();
      this.db.prepare("DELETE FROM style_items").run();
      this.db.prepare("DELETE FROM projects").run();
      this.db.prepare("DELETE FROM facts").run();
      this.db.prepare("DELETE FROM habits WHERE seed = 0").run();
      this.db.prepare("UPDATE habits SET enabled = 0, updated_at = ? WHERE seed = 1").run(updatedAt);
      this.db
        .prepare(
          "UPDATE profile SET identity_json = NULL, updated_at = ?, schema_version = ? WHERE id = 1",
        )
        .run(updatedAt, LTM_SCHEMA_VERSION);

      // Re-seed any missing seed habits
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO habits (id, label, enabled, inject_text, seed, updated_at)
        VALUES (?, ?, 0, ?, 1, ?)
      `);
      for (const h of SEED_HABITS) {
        insert.run(h.id, h.label, h.inject_text, updatedAt);
      }
    });
    tx();
  }

  getSetting(key: string, fallback?: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? fallback;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  private touchProfile(updatedAt: string): void {
    this.db.prepare("UPDATE profile SET updated_at = ? WHERE id = 1").run(updatedAt);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function redactDeepIdentity(identity: LtmIdentity): LtmIdentity {
  return {
    role: identity.role ? redactText(identity.role) : undefined,
    ui_locale: identity.ui_locale,
  };
}
