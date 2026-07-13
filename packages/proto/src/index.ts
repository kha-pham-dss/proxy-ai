import { z } from "zod";

export const LTM_MARKER_START = "<!-- proxy-cli:ltm v1 -->";
export const LTM_MARKER_END = "<!-- /proxy-cli:ltm -->";
export const LTM_SCHEMA_VERSION = 1;

export const HabitCheckboxSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean(),
  inject_text: z.string().min(1),
  seed: z.boolean().default(false),
});

export const ProjectFactSchema = z.object({
  name: z.string().min(1),
  stack: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const MemoryFactSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  topic: z.enum(["stack", "style", "project", "preference", "other"]),
  updated_at: z.string().min(1),
  source_session: z.string().optional(),
});

export const LtmIdentitySchema = z.object({
  role: z.string().optional(),
  ui_locale: z.string().optional(),
});

export const LtmProfileSchema = z.object({
  identity: LtmIdentitySchema.optional(),
  stacks: z.array(z.string()).default([]),
  style: z.array(z.string()).default([]),
  projects: z.array(ProjectFactSchema).default([]),
  facts: z.array(MemoryFactSchema).default([]),
  habits: z.array(HabitCheckboxSchema).default([]),
  meta: z
    .object({
      updated_at: z.string(),
      version: z.number().int().nonnegative(),
    })
    .optional(),
});

export type HabitCheckbox = z.infer<typeof HabitCheckboxSchema>;
export type ProjectFact = z.infer<typeof ProjectFactSchema>;
export type MemoryFact = z.infer<typeof MemoryFactSchema>;
export type LtmIdentity = z.infer<typeof LtmIdentitySchema>;
export type LtmProfile = z.infer<typeof LtmProfileSchema>;

export type ChatRole = "system" | "user" | "assistant" | "developer" | "tool";

export interface ChatMessage {
  role: ChatRole | string;
  content: unknown;
}

export interface SessionTurn {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
}

export const ALLOWED_DISTILL_MODELS = [
  "qwen2.5:3b",
  "llama3.2:3b",
  "llama3.1:8b",
  "gemma2:9b",
] as const;

export type DistillModel = (typeof ALLOWED_DISTILL_MODELS)[number];

/** Strip unknown keys from a distill model JSON blob to the allowlisted profile shape. */
export function stripToLtmProfile(input: unknown): LtmProfile {
  const parsed = LtmProfileSchema.parse(input);
  return {
    identity: parsed.identity,
    stacks: parsed.stacks ?? [],
    style: parsed.style ?? [],
    projects: parsed.projects ?? [],
    facts: parsed.facts ?? [],
    habits: parsed.habits ?? [],
    meta: parsed.meta,
  };
}
