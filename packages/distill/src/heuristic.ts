import type { LtmProfile, SessionTurn } from "@proxy-cli/proto";
import { createHash } from "node:crypto";

const STACK_KEYWORDS = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "Kotlin",
  "Swift",
  "React",
  "Next.js",
  "NestJS",
  "Express",
  "FastAPI",
  "Django",
  "Flask",
  "PostgreSQL",
  "MySQL",
  "SQLite",
  "Redis",
  "Docker",
  "Kubernetes",
  "pnpm",
  "npm",
  "Vite",
  "Vitest",
  "Jest",
  "Prisma",
  "Drizzle",
  "Hono",
  "Claude",
  "Codex",
  "Cursor",
];

export function heuristicDistill(
  existing: LtmProfile,
  transcript: SessionTurn[],
): LtmProfile {
  const blob = transcript.map((t) => t.content).join("\n");
  const found = STACK_KEYWORDS.filter((k) =>
    blob.toLowerCase().includes(k.toLowerCase()),
  );
  const stacks = unique([...(existing.stacks ?? []), ...found]);

  const userLines = transcript
    .filter((t) => t.role === "user")
    .map((t) => t.content.trim())
    .filter((c) => c.length > 20 && c.length < 240)
    .slice(-3);

  const newFacts = userLines.map((text) => ({
    id: `heuristic-${hash(text).slice(0, 10)}`,
    text: text.replace(/\s+/g, " ").slice(0, 180),
    topic: "other" as const,
    updated_at: new Date().toISOString(),
  }));

  return {
    ...existing,
    stacks,
    facts: uniqueById([...(existing.facts ?? []), ...newFacts]).slice(0, 15),
    habits: existing.habits,
    meta: {
      updated_at: new Date().toISOString(),
      version: existing.meta?.version ?? 1,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(item.id, item);
  return [...map.values()];
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
