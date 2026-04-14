import type { Operation } from "../parser/types.js";
import type { AuthConfig, HttpResponse } from "./types.js";
import { maskToken } from "../auth/config.js";

export async function executeRequest(
  op: Operation,
  params: Record<string, unknown>,
  auth: AuthConfig,
  baseUrl: string,
  verbose = false
): Promise<HttpResponse> {
  const url = buildUrl(op, params, baseUrl);
  const headers = buildHeaders(op, params, auth);
  const body = buildBody(op, params);
  const method = op.method;

  if (verbose) {
    const authNames = authHeaderNames(auth);
    console.error(`→ ${method} ${url}`);
    for (const [k, v] of Object.entries(headers)) {
      const display = authNames.has(k.toLowerCase()) ? maskToken(v) : v;
      console.error(`  ${k}: ${display}`);
    }
    if (body) {
      console.error(`  Body: ${JSON.stringify(body)}`);
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  let data: unknown;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  } else {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (verbose) {
    console.error(`← ${res.status} ${res.statusText}`);
  }

  return { status: res.status, headers: responseHeaders, data };
}

function buildUrl(
  op: Operation,
  params: Record<string, unknown>,
  baseUrl: string
): string {
  // Substitute path params
  let path = op.path;
  for (const p of op.params) {
    if (p.in === "path" && params[p.name] !== undefined) {
      path = path.replace(`{${p.name}}`, String(params[p.name]));
    }
  }

  // Ensure baseUrl trailing slash doesn't break path joining
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const url = new URL(normalizedBase + path);

  // Add query params
  for (const p of op.params) {
    if (p.in === "query" && params[p.name] !== undefined) {
      url.searchParams.set(p.name, String(params[p.name]));
    }
  }

  return url.toString();
}

function buildHeaders(
  op: Operation,
  params: Record<string, unknown>,
  auth: AuthConfig
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Content-type for methods with body
  if (["POST", "PUT", "PATCH"].includes(op.method)) {
    headers["Content-Type"] = "application/json";
  }

  headers["Accept"] = "application/json";

  // Header params from spec
  for (const p of op.params) {
    if (p.in === "header" && params[p.name] !== undefined) {
      headers[p.name] = String(params[p.name]);
    }
  }

  // Auth
  switch (auth.type) {
    case "bearer":
      headers["Authorization"] = `Bearer ${auth.value}`;
      break;
    case "apiKey":
      headers[auth.headerName ?? "X-API-Key"] = auth.value;
      break;
    case "basic":
      headers["Authorization"] = `Basic ${Buffer.from(auth.value).toString("base64")}`;
      break;
    case "headers":
      if (auth.headers) {
        for (const [k, v] of Object.entries(auth.headers)) {
          headers[k] = v;
        }
      }
      break;
  }

  return headers;
}

function authHeaderNames(auth: AuthConfig): Set<string> {
  const names = new Set<string>();
  switch (auth.type) {
    case "bearer":
    case "basic":
      names.add("authorization");
      break;
    case "apiKey":
      names.add((auth.headerName ?? "X-API-Key").toLowerCase());
      break;
    case "headers":
      if (auth.headers) {
        for (const name of Object.keys(auth.headers)) names.add(name.toLowerCase());
      }
      break;
  }
  return names;
}

function buildBody(
  op: Operation,
  params: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!["POST", "PUT", "PATCH"].includes(op.method)) return undefined;

  const bodyParams = op.params.filter((p) => p.in === "body");
  if (bodyParams.length === 0) return undefined;

  const body: Record<string, unknown> = {};
  for (const p of bodyParams) {
    if (params[p.name] !== undefined) {
      body[p.name] = params[p.name];
    }
  }

  return Object.keys(body).length > 0 ? body : undefined;
}
