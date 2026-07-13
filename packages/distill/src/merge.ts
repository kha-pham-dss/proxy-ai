import { redactDeep, redactText } from "@proxy-cli/redact";
import {
  LtmProfileSchema,
  stripToLtmProfile,
  type LtmProfile,
  type SessionTurn,
} from "@proxy-cli/proto";
import { heuristicDistill } from "./heuristic.js";
import { extractJsonObject, ollamaChat } from "./ollama.js";
import {
  buildDistillSystemPrompt,
  buildDistillUserPrompt,
  buildRepairPrompt,
} from "./prompt.js";

export interface DistillOptions {
  existing: LtmProfile;
  transcript: SessionTurn[];
  ollamaBaseUrl: string;
  model: string;
  heuristicFallback?: boolean;
}

export interface DistillResult {
  profile: LtmProfile;
  source: "ollama" | "heuristic" | "unchanged";
  error?: string;
}

export async function runDistill(options: DistillOptions): Promise<DistillResult> {
  const redactedTranscript = options.transcript.map((t) => ({
    ...t,
    content: redactText(t.content),
  }));

  if (redactedTranscript.length === 0) {
    return { profile: options.existing, source: "unchanged" };
  }

  try {
    const system = buildDistillSystemPrompt();
    const user = buildDistillUserPrompt(options.existing, redactedTranscript);
    let raw = await ollamaChat({
      baseUrl: options.ollamaBaseUrl,
      model: options.model,
      system,
      user,
    });

    let merged = parseAndMerge(raw, options.existing);
    if (!merged.ok) {
      raw = await ollamaChat({
        baseUrl: options.ollamaBaseUrl,
        model: options.model,
        system,
        user: buildRepairPrompt(raw, merged.error),
      });
      merged = parseAndMerge(raw, options.existing);
      if (!merged.ok) {
        throw new Error(merged.error);
      }
    }

    return { profile: merged.profile, source: "ollama" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.heuristicFallback !== false) {
      return {
        profile: heuristicDistill(options.existing, redactedTranscript),
        source: "heuristic",
        error: message,
      };
    }
    return { profile: options.existing, source: "unchanged", error: message };
  }
}

function parseAndMerge(
  raw: string,
  existing: LtmProfile,
): { ok: true; profile: LtmProfile } | { ok: false; error: string } {
  try {
    const json = extractJsonObject(raw);
    const cleaned = redactDeep(json);
    const parsed = LtmProfileSchema.partial().parse(cleaned);
    const stripped = stripToLtmProfile({
      identity: parsed.identity ?? existing.identity,
      stacks: parsed.stacks ?? existing.stacks,
      style: parsed.style ?? existing.style,
      projects: parsed.projects ?? existing.projects,
      facts: parsed.facts ?? existing.facts,
      habits: [],
      meta: {
        updated_at: new Date().toISOString(),
        version: existing.meta?.version ?? 1,
      },
    });

    // Always preserve habits from existing LTM — distill must not mutate them.
    return {
      ok: true,
      profile: {
        ...stripped,
        habits: existing.habits,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
