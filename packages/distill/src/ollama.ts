export interface OllamaChatOptions {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
}

export async function ollamaChat(options: OllamaChatOptions): Promise<string> {
  const base = options.baseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

  try {
    // Prefer OpenAI-compatible endpoint; fall back to native /api/chat.
    const openaiUrl = `${base}/v1/chat/completions`;
    const openaiRes = await fetch(openaiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
      }),
    });

    if (openaiRes.ok) {
      const data = (await openaiRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (content) return content;
    }

    const nativeRes = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
      }),
    });

    if (!nativeRes.ok) {
      throw new Error(`Ollama error ${nativeRes.status}: ${await nativeRes.text()}`);
    }

    const data = (await nativeRes.json()) as { message?: { content?: string } };
    if (!data.message?.content) {
      throw new Error("Ollama returned empty content");
    }
    return data.message.content;
  } finally {
    clearTimeout(timer);
  }
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return JSON.parse(fence[1].trim());
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("No JSON object found in model output");
}
