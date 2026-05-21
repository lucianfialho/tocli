import { parseHeaderFlag } from "../auth/headers.js";

export function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

export function getFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
    }
  }
  return values;
}

export function filterTocliFlags(argv: string[]): string[] {
  const valueFlags = new Set(["--spec", "--output", "--max-items", "--token", "--api-key", "--basic", "--base-url", "--profile", "--env", "--header", "-H"]);
  const boolFlags = new Set(["--verbose", "--quiet", "--dry-run", "--validate", "--agent-help", "--filter-pii"]);
  const result: string[] = [];
  let i = 0;
  while (i < argv.length) {
    if (valueFlags.has(argv[i])) { i += 2; continue; }
    if (boolFlags.has(argv[i])) { i++; continue; }
    result.push(argv[i]);
    i++;
  }
  return result;
}

export function parseHeaderArgs(args: string[]): Record<string, string> | undefined {
  const raws = getFlagValues(args, "--header").concat(getFlagValues(args, "-H"));
  if (raws.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const raw of raws) {
    const parsed = parseHeaderFlag(raw);
    if (!parsed) {
      console.error(`Error: invalid --header '${raw}'. Expected "Name: Value" with RFC-valid name and no CR/LF.`);
      process.exit(1);
    }
    headers[parsed.name] = parsed.value;
  }
  return headers;
}
