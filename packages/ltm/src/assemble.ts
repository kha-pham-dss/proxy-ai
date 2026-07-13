import {
  LTM_MARKER_END,
  LTM_MARKER_START,
  type LtmProfile,
} from "@proxy-cli/proto";

export interface AssembleOptions {
  maxStyle?: number;
  maxFacts?: number;
  maxProjects?: number;
  maxChars?: number;
}

const DEFAULTS: Required<AssembleOptions> = {
  maxStyle: 8,
  maxFacts: 15,
  maxProjects: 5,
  maxChars: 4000, // ~1000 tokens soft budget
};

export function assembleProfileText(
  profile: LtmProfile,
  options: AssembleOptions = {},
): string {
  const opts = { ...DEFAULTS, ...options };
  const lines: string[] = [LTM_MARKER_START, "# User coding memory (local)"];

  if (profile.identity?.role || profile.identity?.ui_locale) {
    lines.push("## Identity");
    if (profile.identity.role) lines.push(`- Role: ${profile.identity.role}`);
    if (profile.identity.ui_locale) lines.push(`- Locale: ${profile.identity.ui_locale}`);
    lines.push("");
  }

  if (profile.stacks.length) {
    lines.push("## Stacks");
    for (const s of profile.stacks) lines.push(`- ${s}`);
    lines.push("");
  }

  const style = profile.style.slice(0, opts.maxStyle);
  if (style.length) {
    lines.push("## Style");
    for (const s of style) lines.push(`- ${s}`);
    lines.push("");
  }

  const projects = profile.projects.slice(0, opts.maxProjects);
  if (projects.length) {
    lines.push("## Projects");
    for (const p of projects) {
      const stack = p.stack?.length ? ` (${p.stack.join(", ")})` : "";
      const notes = p.notes ? ` — ${p.notes}` : "";
      lines.push(`- ${p.name}${stack}${notes}`);
    }
    lines.push("");
  }

  const enabledHabits = profile.habits.filter((h) => h.enabled);
  if (enabledHabits.length) {
    lines.push("## Standing rules (enabled habits)");
    for (const h of enabledHabits) lines.push(`- ${h.inject_text}`);
    lines.push("");
  }

  const facts = [...profile.facts]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, opts.maxFacts);
  if (facts.length) {
    lines.push("## Facts");
    for (const f of facts) lines.push(`- ${f.text}`);
    lines.push("");
  }

  lines.push(LTM_MARKER_END);

  let text = lines.join("\n").trim() + "\n";

  // Priority trim when over budget: facts → project notes → style → stacks → habits last
  if (text.length > opts.maxChars) {
    const trimmedProfile: LtmProfile = {
      ...profile,
      facts: facts.slice(0, Math.max(3, Math.floor(opts.maxFacts / 2))),
      projects: projects.map((p) => ({ ...p, notes: p.notes?.slice(0, 80) })),
      style: style.slice(0, Math.max(3, Math.floor(opts.maxStyle / 2))),
    };
    text = assembleProfileText(trimmedProfile, {
      ...opts,
      maxChars: opts.maxChars * 2, // prevent recursion loop
    });
    if (text.length > opts.maxChars) {
      text = text.slice(0, opts.maxChars - LTM_MARKER_END.length - 1) + "\n" + LTM_MARKER_END + "\n";
    }
  }

  return text;
}

export function extractLtmBlock(content: string): string | null {
  const start = content.indexOf(LTM_MARKER_START);
  const end = content.indexOf(LTM_MARKER_END);
  if (start === -1 || end === -1 || end < start) return null;
  return content.slice(start, end + LTM_MARKER_END.length);
}

export function stripLtmBlock(content: string): string {
  const start = content.indexOf(LTM_MARKER_START);
  const end = content.indexOf(LTM_MARKER_END);
  if (start === -1 || end === -1 || end < start) return content;
  return (
    content.slice(0, start) + content.slice(end + LTM_MARKER_END.length)
  ).replace(/\n{3,}/g, "\n\n").trim();
}
