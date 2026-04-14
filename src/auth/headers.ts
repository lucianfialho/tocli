export interface ParsedHeader {
  name: string;
  value: string;
}

/**
 * Parse a header flag in the form "Name: Value".
 * Returns null for invalid input (empty name, missing colon).
 * The value may contain additional colons (e.g. URLs) — only the first ":" splits.
 */
export function parseHeaderFlag(raw: string): ParsedHeader | null {
  const idx = raw.indexOf(":");
  if (idx === -1) return null;
  const name = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1).trim();
  if (!name) return null;
  // Reject CR/LF — header injection (RFC 7230 §3.2.4 forbids them in values/names)
  if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) return null;
  // Header names per RFC 7230: token chars only (no whitespace, no control chars)
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return null;
  return { name, value };
}
