import type { OpenAPISpec } from "../parser/types.js";
import type { AuthConfig } from "./types.js";
import { getProfile } from "./config.js";

export interface AuthFlags {
  token?: string;
  apiKey?: string;
  basic?: string;
  authHeader?: string;
  headers?: Record<string, string>;
  profile?: string;
  rcAuthType?: string;
  rcAuthToken?: string;
  rcAuthEnvVar?: string;
}

export async function resolveAuth(
  flags: AuthFlags,
  spec: OpenAPISpec,
  env: NodeJS.ProcessEnv = process.env
): Promise<AuthConfig> {
  // Priority 1: Inline flags
  if (flags.headers && Object.keys(flags.headers).length > 0) {
    const resolved: Record<string, string> = {};
    for (const [k, v] of Object.entries(flags.headers)) {
      resolved[k] = resolveEnvVar(v, env, `--header "${k}"`);
    }
    return { type: "headers", value: "", headers: resolved };
  }
  if (flags.token) {
    return { type: "bearer", value: resolveEnvVar(flags.token, env, "--token") };
  }
  if (flags.apiKey) {
    const headerName = detectApiKeyHeader(spec) ?? "X-API-Key";
    return { type: "apiKey", value: resolveEnvVar(flags.apiKey, env, "--api-key"), headerName };
  }
  if (flags.basic) {
    const value = resolveEnvVar(flags.basic, env, "--basic");
    if (!value.includes(":")) {
      console.error(`Warning: --basic expects "user:password" format, got value without colon.`);
    }
    return { type: "basic", value };
  }
  if (flags.authHeader) {
    return { type: "bearer", value: resolveEnvVar(flags.authHeader, env, "--auth-header") };
  }

  // Priority 2: .toclirc auth config
  if (flags.rcAuthToken) {
    const type = (flags.rcAuthType as AuthConfig["type"]) ?? "bearer";
    return { type, value: resolveEnvVar(flags.rcAuthToken, env, ".toclirc auth.token") };
  }
  if (flags.rcAuthEnvVar) {
    const envVal = env[flags.rcAuthEnvVar];
    if (envVal) {
      const type = (flags.rcAuthType as AuthConfig["type"]) ?? "bearer";
      return { type, value: envVal };
    }
  }

  // Priority 3: Environment variables from spec
  const specAuth = detectAuthFromSpec(spec);
  if (specAuth) {
    // Check common env var names
    const envVarNames = ["API_TOKEN", "API_KEY", "AUTH_TOKEN", "BEARER_TOKEN"];
    for (const name of envVarNames) {
      if (env[name]) {
        return { ...specAuth, value: env[name]! };
      }
    }
  }

  // Priority 4: Saved profile
  const profileName = flags.profile ?? "default";
  const profile = await getProfile(profileName);
  if (profile) {
    if (profile.type === "headers" && profile.headers) {
      const resolved: Record<string, string> = {};
      for (const [k, v] of Object.entries(profile.headers)) {
        resolved[k] = resolveEnvVar(v, env, `profile '${profileName}' header "${k}"`);
      }
      return { type: "headers", value: "", headers: resolved };
    }
    return {
      type: profile.type,
      value: resolveEnvVar(profile.value, env, `profile '${profileName}'`),
      headerName: profile.headerName,
    };
  }

  return { type: "none", value: "" };
}

function collectReferencedSchemeNames(spec: OpenAPISpec): Set<string> {
  const names = new Set<string>();

  if (spec.security) {
    for (const req of spec.security) {
      for (const name of Object.keys(req)) names.add(name);
    }
    return names;
  }

  for (const pathItem of Object.values(spec.paths ?? {})) {
    const ops = [pathItem.get, pathItem.post, pathItem.put, pathItem.patch, pathItem.delete, pathItem.head, pathItem.options];
    for (const op of ops) {
      if (op?.security) {
        for (const req of op.security) {
          for (const name of Object.keys(req)) names.add(name);
        }
      }
    }
  }

  return names;
}

function detectAuthFromSpec(spec: OpenAPISpec): Omit<AuthConfig, "value"> | null {
  const schemes = spec.components?.securitySchemes;
  if (!schemes) return null;

  const referencedNames = collectReferencedSchemeNames(spec);
  const entries = Object.entries(schemes);
  const candidates = referencedNames.size > 0
    ? entries.filter(([name]) => referencedNames.has(name))
    : entries;

  let apiKeyHeader: string | null = null;
  let hasBasic = false;

  for (const [, scheme] of candidates) {
    if (scheme.type === "http" && scheme.scheme === "bearer") {
      return { type: "bearer" };
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.name && !apiKeyHeader) {
      apiKeyHeader = scheme.name;
    }
    if (scheme.type === "http" && scheme.scheme === "basic") {
      hasBasic = true;
    }
  }

  if (apiKeyHeader) return { type: "apiKey", headerName: apiKeyHeader };
  if (hasBasic) return { type: "basic" };

  return null;
}

function detectApiKeyHeader(spec: OpenAPISpec): string | undefined {
  const schemes = spec.components?.securitySchemes;
  if (!schemes) return undefined;

  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "apiKey" && scheme.in === "header") {
      return scheme.name;
    }
  }

  return undefined;
}

function resolveEnvVar(value: string, env: NodeJS.ProcessEnv, context?: string): string {
  // Replace $VAR or ${VAR} with env values. Warn when a reference resolves to empty —
  // silent empty headers confuse downstream 401s ("auth wrong" when it's "env unset").
  return value.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g, (_, braced, plain) => {
    const name = braced ?? plain;
    const resolved = env[name];
    if (resolved === undefined || resolved === "") {
      console.error(
        `Warning: env var $${name} is ${resolved === undefined ? "unset" : "empty"}${context ? ` (used in ${context})` : ""}.`
      );
      return "";
    }
    return resolved;
  });
}

/**
 * Detect all apiKey header schemes. Used for multi-header auth detection (e.g. VTEX).
 */
export function detectApiKeyHeaders(spec: OpenAPISpec): string[] {
  const schemes = spec.components?.securitySchemes;
  if (!schemes) return [];
  const names: string[] = [];
  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.name) {
      names.push(scheme.name);
    }
  }
  return names;
}
