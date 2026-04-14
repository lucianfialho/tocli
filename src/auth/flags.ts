import type { OpenAPISpec } from "../parser/types.js";
import type { AuthConfig } from "./types.js";
import { getProfile } from "./config.js";

export interface AuthFlags {
  token?: string;
  apiKey?: string;
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

function detectAuthFromSpec(spec: OpenAPISpec): Omit<AuthConfig, "value"> | null {
  const schemes = spec.components?.securitySchemes;
  if (!schemes) return null;

  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "http" && scheme.scheme === "bearer") {
      return { type: "bearer" };
    }
    if (scheme.type === "apiKey" && scheme.in === "header") {
      return { type: "apiKey", headerName: scheme.name };
    }
    if (scheme.type === "http" && scheme.scheme === "basic") {
      return { type: "basic" };
    }
  }

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
