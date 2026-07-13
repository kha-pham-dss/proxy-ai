import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openLtmDb } from "./db.js";
import { LtmRepository } from "./repo.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function repo(): LtmRepository {
  const dir = mkdtempSync(join(tmpdir(), "proxy-cli-ltm-"));
  dirs.push(dir);
  return new LtmRepository(openLtmDb(join(dir, "ltm.sqlite")));
}

describe("LtmRepository", () => {
  it("seeds habits disabled by default", () => {
    const r = repo();
    const profile = r.loadProfile();
    expect(profile.habits.length).toBeGreaterThanOrEqual(5);
    expect(profile.habits.every((h) => h.enabled === false || !h.seed || true)).toBe(true);
    expect(profile.habits.filter((h) => h.seed).every((h) => h.enabled === false)).toBe(true);
  });

  it("persists stacks and resets while keeping seed habits", () => {
    const r = repo();
    r.setStacks(["TypeScript", "NestJS"]);
    r.setHabitEnabled("habit.no-invented-apis", true);
    expect(r.loadProfile().stacks).toEqual(["TypeScript", "NestJS"]);
    expect(r.loadProfile().habits.find((h) => h.id === "habit.no-invented-apis")?.enabled).toBe(
      true,
    );

    r.resetLtm();
    const after = r.loadProfile();
    expect(after.stacks).toEqual([]);
    expect(after.habits.find((h) => h.id === "habit.no-invented-apis")?.enabled).toBe(false);
    expect(after.habits.filter((h) => h.seed).length).toBeGreaterThanOrEqual(5);
  });
});
