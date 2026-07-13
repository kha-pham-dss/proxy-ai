import type { LtmProfile, SessionTurn } from "@proxy-cli/proto";

export function buildDistillSystemPrompt(): string {
  return `You update a coding-only long-term memory profile.
- Output ONLY valid JSON matching this schema:
{
  "identity": { "role"?: string, "ui_locale"?: string },
  "stacks": string[],
  "style": string[],
  "projects": [{ "name": string, "stack"?: string[], "notes"?: string }],
  "facts": [{ "id": string, "text": string, "topic": "stack"|"style"|"project"|"preference"|"other", "updated_at": string, "source_session"?: string }],
  "habits": []
}
- Merge with the existing profile: keep, update, add, or remove contradictory facts.
- Never add/modify habits[]. Always return "habits": [].
- Never store secrets, credentials, PII, absolute paths, or customer names.
- Prefer short bullet facts. Max 15 facts, 8 style lines, 5 projects.
- Use ISO-8601 timestamps for updated_at.`;
}

export function buildDistillUserPrompt(
  existing: LtmProfile,
  transcript: SessionTurn[],
): string {
  const existingForModel = {
    ...existing,
    habits: [],
  };
  return `Existing LTM JSON:
${JSON.stringify(existingForModel, null, 2)}

Session transcript (already redacted):
${JSON.stringify(transcript, null, 2)}`;
}

export function buildRepairPrompt(raw: string, error: string): string {
  return `The previous JSON was invalid (${error}).
Return ONLY corrected valid JSON for the LTM profile schema. No markdown fences.

Previous output:
${raw}`;
}
