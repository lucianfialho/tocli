import type { Operation } from "../parser/types.js";

export function buildOperationUrl(
  op: Operation,
  params: Record<string, unknown>,
  baseUrl: string
): string {
  let path = op.path;
  for (const p of op.params) {
    if (p.in === "path" && params[p.name] !== undefined) {
      path = path.replace(`{${p.name}}`, String(params[p.name]));
    }
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const url = new URL(normalizedBase + path);
  moveQueryLikeFragmentToSearch(url);

  for (const p of op.params) {
    if (p.in === "query" && params[p.name] !== undefined) {
      url.searchParams.set(p.name, String(params[p.name]));
    }
  }

  return url.toString();
}

function moveQueryLikeFragmentToSearch(url: URL): void {
  if (!url.hash) return;

  const fragment = url.hash.slice(1);
  if (!fragment.includes("=")) return;

  const fragmentParams = new URLSearchParams(fragment);
  for (const [name, value] of fragmentParams) {
    if (!url.searchParams.has(name)) {
      url.searchParams.set(name, value);
    }
  }
  url.hash = "";
}
