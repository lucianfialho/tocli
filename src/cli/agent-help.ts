import { stringify as toYaml } from "yaml";
import type { OperationGroup, OpenAPISpec } from "../parser/types.js";

export function printAgentHelp(groups: OperationGroup[], spec: OpenAPISpec): void {
  const help: Record<string, unknown> = {
    api: spec.info.title,
    base_url: spec.servers?.[0]?.url ?? "http://localhost:3000",
    auth: resolveAuthHint(spec),
    flags: {
      "--output": "json | pretty | table | yaml | quiet",
      "--dry-run": "preview HTTP request without executing (includes curl)",
      "--validate": "validate response against OpenAPI schema",
      "--verbose": "show full HTTP request/response",
      "--max-items": "limit array results",
      "--filter-pii": "redact PII fields in response before output",
    },
    commands: {} as Record<string, unknown>,
  };

  const commands = help.commands as Record<string, unknown>;

  for (const group of groups) {
    const groupCmds: Record<string, unknown> = {};

    for (const op of group.operations) {
      const cmdName = simplifyName(op.id, group.tag);
      const cmd: Record<string, unknown> = {
        method: op.method,
        desc: op.summary || op.description,
      };

      const params = op.params.filter((p) => p.required);
      const optionals = op.params.filter((p) => !p.required);

      if (params.length > 0) {
        cmd.required = params.map((p) => {
          const entry: Record<string, unknown> = { name: p.name, type: p.type };
          if (p.enum) entry.enum = p.enum;
          return entry;
        });
      }

      if (optionals.length > 0) {
        cmd.optional = optionals.map((p) => {
          const entry: Record<string, unknown> = { name: p.name, type: p.type };
          if (p.enum) entry.enum = p.enum;
          if (p.default !== undefined) entry.default = p.default;
          return entry;
        });
      }

      groupCmds[cmdName] = cmd;
    }

    commands[group.tag] = groupCmds;
  }

  console.log(toYaml(help));
}

export function resolveAuthHint(spec: OpenAPISpec): string {
  const schemes = spec.components?.securitySchemes;
  if (!schemes) return "none";

  const apiKeyHeaders: string[] = [];
  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.name) {
      apiKeyHeaders.push(scheme.name);
    }
  }

  if (apiKeyHeaders.length > 1) {
    const parts = apiKeyHeaders.map((h) => `--header "${h}: <value>"`).join(" ");
    return `multi-header ${parts}`;
  }

  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "http" && scheme.scheme === "bearer") return "bearer --token <TOKEN>";
    if (scheme.type === "http" && scheme.scheme === "basic") return "basic --basic <USER:PASSWORD>";
    if (scheme.type === "apiKey") return `apiKey --api-key <KEY> (header: ${scheme.name})`;
  }

  return "none";
}

export function simplifyName(operationId: string, tag: string): string {
  const tagLower = tag.toLowerCase();
  const idLower = operationId.toLowerCase();
  const singular = tagLower.endsWith("s") ? tagLower.slice(0, -1) : tagLower;

  for (const suffix of [tagLower, singular]) {
    if (idLower.endsWith(suffix) && idLower.length > suffix.length) {
      return operationId.slice(0, operationId.length - suffix.length).toLowerCase();
    }
  }
  return operationId.toLowerCase();
}

export function resolveBaseUrl(spec: OpenAPISpec, specSource: string): string {
  const serverUrl = spec.servers?.[0]?.url;

  if (serverUrl?.startsWith("http://") || serverUrl?.startsWith("https://")) {
    return serverUrl;
  }

  if (serverUrl && specSource.startsWith("http")) {
    try {
      const origin = new URL(specSource).origin;
      return origin + (serverUrl.startsWith("/") ? serverUrl : "/" + serverUrl);
    } catch {
      // fall through
    }
  }

  if (specSource.startsWith("http")) {
    try {
      return new URL(specSource).origin;
    } catch {
      // fall through
    }
  }

  return "http://localhost:3000";
}
