import {
  LTM_MARKER_END,
  LTM_MARKER_START,
  type ChatMessage,
} from "@proxy-cli/proto";
import { messageContentToString } from "./conversation-id.js";

export function ensureLtmInject(
  messages: ChatMessage[],
  profileText: string,
): ChatMessage[] {
  const cloned = messages.map((m) => ({ ...m }));
  const systemIdx = cloned.findIndex(
    (m) => m.role === "system" || m.role === "developer",
  );

  if (systemIdx === -1) {
    return [{ role: "system", content: profileText }, ...cloned];
  }

  const existing = messageContentToString(cloned[systemIdx]!.content);
  if (existing.includes(LTM_MARKER_START) && existing.includes(LTM_MARKER_END)) {
    const start = existing.indexOf(LTM_MARKER_START);
    const end = existing.indexOf(LTM_MARKER_END) + LTM_MARKER_END.length;
    const replaced =
      existing.slice(0, start) + profileText.trim() + existing.slice(end);
    cloned[systemIdx] = { ...cloned[systemIdx]!, content: replaced.trim() };
    return cloned;
  }

  cloned[systemIdx] = {
    ...cloned[systemIdx]!,
    content: `${existing.trim()}\n\n${profileText.trim()}`.trim(),
  };
  return cloned;
}

export function ensureLtmInInstructions(
  instructions: string | undefined,
  profileText: string,
): string {
  const base = instructions?.trim() ?? "";
  if (!base) return profileText.trim();
  if (base.includes(LTM_MARKER_START) && base.includes(LTM_MARKER_END)) {
    const start = base.indexOf(LTM_MARKER_START);
    const end = base.indexOf(LTM_MARKER_END) + LTM_MARKER_END.length;
    return (base.slice(0, start) + profileText.trim() + base.slice(end)).trim();
  }
  return `${base}\n\n${profileText.trim()}`.trim();
}
