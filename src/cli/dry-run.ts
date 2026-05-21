import type { Operation } from "../parser/types.js";
import type { RuntimeConfig } from "../executor/types.js";
import { buildOperationUrl } from "../executor/url.js";

export function printDryRun(op: Operation, params: Record<string, unknown>, config: RuntimeConfig): void {
  const url = buildOperationUrl(op, params, config.baseUrl);

  const headers: string[] = [];
  if (["POST", "PUT", "PATCH"].includes(op.method)) {
    headers.push("Content-Type: application/json");
  }
  headers.push("Accept: application/json");
  if (config.auth.type === "bearer") {
    headers.push(`Authorization: Bearer ${config.auth.value}`);
  } else if (config.auth.type === "apiKey") {
    headers.push(`${config.auth.headerName ?? "X-API-Key"}: ${config.auth.value}`);
  } else if (config.auth.type === "headers" && config.auth.headers) {
    for (const [k, v] of Object.entries(config.auth.headers)) {
      headers.push(`${k}: ${v}`);
    }
  }

  const bodyParams = op.params.filter((p) => p.in === "body");
  const body: Record<string, unknown> = {};
  for (const p of bodyParams) {
    if (params[p.name] !== undefined) body[p.name] = params[p.name];
  }

  console.log(`${op.method} ${url}`);
  for (const h of headers) console.log(h);
  if (Object.keys(body).length > 0) {
    console.log("");
    console.log(JSON.stringify(body, null, 2));
  }

  console.log("");
  let curl = `curl -X ${op.method} '${url}'`;
  for (const h of headers) curl += ` \\\n  -H '${h}'`;
  if (Object.keys(body).length > 0) curl += ` \\\n  -d '${JSON.stringify(body)}'`;
  console.log(curl);
}
