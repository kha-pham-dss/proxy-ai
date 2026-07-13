const PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED_KEY]" },
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: "[REDACTED_KEY]" },
  { re: /\bBearer\s+[A-Za-z0-9._\-+=/]{8,}/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  {
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED_JWT]",
  },
  {
    re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  {
    re: /(?:^|\n)\s*(?:export\s+)?([A-Z0-9_]*API_KEY|[A-Z0-9_]*SECRET|[A-Z0-9_]*TOKEN|[A-Z0-9_]*PASSWORD|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*["']?[^\s"']+/gim,
    replacement: "$1=[REDACTED]",
  },
  {
    re: /(?:^|\n)\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*["']?[^\s"']*(?:\.env)[^\s"']*/gim,
    replacement: "$1=[REDACTED_ENV]",
  },
  { re: /\/Users\/[^\s"'`]+/g, replacement: "[PATH]" },
  { re: /\/home\/[^\s"'`]+/g, replacement: "[PATH]" },
  { re: /C:\\Users\\[^\s"'`]+/gi, replacement: "[PATH]" },
  {
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[EMAIL]",
  },
];

export function redactText(input: string): string {
  let out = input;
  for (const { re, replacement } of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}
