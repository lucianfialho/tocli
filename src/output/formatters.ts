import { stringify as toYaml } from "yaml";

export interface OutputOptions {
  format: "json" | "pretty" | "table" | "yaml" | "quiet";
  maxItems?: number;
}

const NO_COLOR = !!process.env["NO_COLOR"];

export function formatOutput(data: unknown, options: OutputOptions): string {
  let processed = data;
  if (options.maxItems && Array.isArray(processed)) {
    processed = processed.slice(0, options.maxItems);
  }

  switch (options.format) {
    case "quiet":
      return "";
    case "json":
      return JSON.stringify(processed);
    case "pretty":
      return colorize(JSON.stringify(processed, null, 2));
    case "table":
      return formatTable(processed);
    case "yaml":
      return toYaml(processed);
    default:
      return JSON.stringify(processed, null, 2);
  }
}

function formatTable(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) {
    return Array.isArray(data) ? "(empty)" : JSON.stringify(data, null, 2);
  }

  const items = data as Record<string, unknown>[];
  const keys = Object.keys(items[0]);

  const widths = new Map<string, number>();
  for (const key of keys) {
    widths.set(key, key.length);
  }
  for (const item of items) {
    for (const key of keys) {
      const len = String(item[key] ?? "").length;
      widths.set(key, Math.max(widths.get(key)!, len));
    }
  }

  const header = keys.map((k) => k.padEnd(widths.get(k)!)).join("  ");
  const separator = keys.map((k) => "─".repeat(widths.get(k)!)).join("──");
  const rows = items.map((item) =>
    keys.map((k) => String(item[k] ?? "").padEnd(widths.get(k)!)).join("  ")
  );

  return [header, separator, ...rows].join("\n");
}

function colorize(json: string): string {
  if (NO_COLOR) return json;

  return json
    .replace(/"([^"]+)":/g, `\x1b[36m"$1"\x1b[0m:`)
    .replace(/: "([^"]*)"/g, `: \x1b[32m"$1"\x1b[0m`)
    .replace(/: (\d+)/g, `: \x1b[33m$1\x1b[0m`)
    .replace(/: (true|false)/g, `: \x1b[35m$1\x1b[0m`)
    .replace(/: (null)/g, `: \x1b[90m$1\x1b[0m`);
}
