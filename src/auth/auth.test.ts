import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveAuth, detectApiKeyHeaders } from "./flags.js";
import { saveProfile, loadAuthStore, removeProfile, maskToken } from "./config.js";
import { parseHeaderFlag } from "./headers.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPISpec } from "../parser/types.js";

const minimalSpec: OpenAPISpec = {
  openapi: "3.0.3",
  info: { title: "Test", version: "1.0" },
  paths: { "/test": { get: { summary: "test" } } },
};

const specWithBearer: OpenAPISpec = {
  ...minimalSpec,
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
  },
};

const specWithApiKey: OpenAPISpec = {
  ...minimalSpec,
  components: {
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "X-Custom-Key" },
    },
  },
};

describe("resolveAuth", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tocli-auth-resolve-"));
    vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns none when no auth provided", async () => {
    const auth = await resolveAuth({}, minimalSpec, {});
    expect(auth.type).toBe("none");
  });

  it("--token sets bearer auth", async () => {
    const auth = await resolveAuth({ token: "sk-123" }, minimalSpec, {});
    expect(auth.type).toBe("bearer");
    expect(auth.value).toBe("sk-123");
  });

  it("--api-key sets apiKey auth", async () => {
    const auth = await resolveAuth({ apiKey: "my-key" }, minimalSpec, {});
    expect(auth.type).toBe("apiKey");
    expect(auth.value).toBe("my-key");
  });

  it("detects api key header from spec", async () => {
    const auth = await resolveAuth({ apiKey: "my-key" }, specWithApiKey, {});
    expect(auth.headerName).toBe("X-Custom-Key");
  });

  it("resolves environment variables in token", async () => {
    const auth = await resolveAuth({ token: "$MY_TOKEN" }, minimalSpec, { MY_TOKEN: "resolved-123" });
    expect(auth.value).toBe("resolved-123");
  });

  it("resolves ${VAR} syntax", async () => {
    const auth = await resolveAuth({ token: "${API_KEY}" }, minimalSpec, { API_KEY: "secret" });
    expect(auth.value).toBe("secret");
  });

  it("picks up API_TOKEN from env when spec has auth", async () => {
    const auth = await resolveAuth({}, specWithBearer, { API_TOKEN: "env-token" });
    expect(auth.type).toBe("bearer");
    expect(auth.value).toBe("env-token");
  });

  it("uses .toclirc auth token", async () => {
    const auth = await resolveAuth({ rcAuthType: "bearer", rcAuthToken: "rc-token-123" }, minimalSpec, {});
    expect(auth.type).toBe("bearer");
    expect(auth.value).toBe("rc-token-123");
  });

  it("uses .toclirc auth envVar", async () => {
    const auth = await resolveAuth({ rcAuthType: "bearer", rcAuthEnvVar: "MY_API_TOKEN" }, minimalSpec, { MY_API_TOKEN: "env-resolved" });
    expect(auth.type).toBe("bearer");
    expect(auth.value).toBe("env-resolved");
  });

  it("defaults rcAuthType to bearer when not specified", async () => {
    const auth = await resolveAuth({ rcAuthToken: "tok" }, minimalSpec, {});
    expect(auth.type).toBe("bearer");
    expect(auth.value).toBe("tok");
  });

  it("inline --token takes priority over .toclirc auth", async () => {
    const auth = await resolveAuth({ token: "inline-tok", rcAuthToken: "rc-tok" }, minimalSpec, {});
    expect(auth.value).toBe("inline-tok");
  });

  it(".toclirc auth takes priority over saved profile", async () => {
    await saveProfile("default", { type: "bearer", value: "profile-tok" });
    const auth = await resolveAuth({ rcAuthToken: "rc-tok" }, minimalSpec);
    expect(auth.value).toBe("rc-tok");
  });

  it("resolves env vars in .toclirc auth token", async () => {
    const auth = await resolveAuth({ rcAuthToken: "$SECRET_TOK" }, minimalSpec, { SECRET_TOK: "resolved-secret" });
    expect(auth.value).toBe("resolved-secret");
  });

  it("--basic sets basic auth with user:password value", async () => {
    const auth = await resolveAuth({ basic: "user:pass" }, minimalSpec, {});
    expect(auth.type).toBe("basic");
    expect(auth.value).toBe("user:pass");
  });

  it("--basic resolves env variable", async () => {
    const auth = await resolveAuth({ basic: "$DATAFORSEO_AUTH" }, minimalSpec, { DATAFORSEO_AUTH: "login:secret" });
    expect(auth.type).toBe("basic");
    expect(auth.value).toBe("login:secret");
  });

  it("--basic takes priority over saved profile", async () => {
    await saveProfile("default", { type: "bearer", value: "profile-tok" });
    const auth = await resolveAuth({ basic: "u:p" }, minimalSpec, {});
    expect(auth.type).toBe("basic");
    expect(auth.value).toBe("u:p");
  });
});

describe("auth config (profile persistence)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tocli-test-"));
    vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads a profile", async () => {
    await saveProfile("default", { type: "bearer", value: "sk-test" });
    const store = await loadAuthStore();
    expect(store.profiles["default"]).toEqual({ type: "bearer", value: "sk-test" });
  });

  it("saves multiple profiles", async () => {
    await saveProfile("default", { type: "bearer", value: "sk-prod" });
    await saveProfile("staging", { type: "apiKey", value: "key-staging", headerName: "X-Key" });

    const store = await loadAuthStore();
    expect(Object.keys(store.profiles)).toEqual(["default", "staging"]);
  });

  it("removes a profile", async () => {
    await saveProfile("default", { type: "bearer", value: "sk-test" });
    const removed = await removeProfile("default");
    expect(removed).toBe(true);

    const store = await loadAuthStore();
    expect(store.profiles["default"]).toBeUndefined();
  });

  it("returns false removing nonexistent profile", async () => {
    const removed = await removeProfile("nope");
    expect(removed).toBe(false);
  });
});

const specDualHeader: OpenAPISpec = {
  ...minimalSpec,
  components: {
    securitySchemes: {
      appKey: { type: "apiKey", in: "header", name: "X-VTEX-API-AppKey" },
      appToken: { type: "apiKey", in: "header", name: "X-VTEX-API-AppToken" },
    },
  },
};

describe("parseHeaderFlag", () => {
  it("parses Name: Value", () => {
    expect(parseHeaderFlag("X-Api-Key: abc123")).toEqual({ name: "X-Api-Key", value: "abc123" });
  });

  it("trims whitespace", () => {
    expect(parseHeaderFlag("  X-Key  :  val ")).toEqual({ name: "X-Key", value: "val" });
  });

  it("preserves colons inside value (e.g. URLs)", () => {
    expect(parseHeaderFlag("Referer: https://example.com:8080/x")).toEqual({
      name: "Referer",
      value: "https://example.com:8080/x",
    });
  });

  it("returns null for missing colon", () => {
    expect(parseHeaderFlag("NoColonHere")).toBeNull();
  });

  it("returns null for empty name", () => {
    expect(parseHeaderFlag(": value")).toBeNull();
  });

  it("rejects CR/LF in value (header injection)", () => {
    expect(parseHeaderFlag("X-Key: bad\r\nEvil: yes")).toBeNull();
    expect(parseHeaderFlag("X-Key: bad\nEvil: yes")).toBeNull();
    expect(parseHeaderFlag("X-Key: bad\rEvil: yes")).toBeNull();
  });

  it("rejects invalid characters in header name", () => {
    expect(parseHeaderFlag("X Key: v")).toBeNull();
    expect(parseHeaderFlag("X\tKey: v")).toBeNull();
    expect(parseHeaderFlag("X:Key: v")).toEqual({ name: "X", value: "Key: v" });
  });
});

describe("detectApiKeyHeaders", () => {
  it("returns all apiKey header names", () => {
    const names = detectApiKeyHeaders(specDualHeader);
    expect(names).toEqual(["X-VTEX-API-AppKey", "X-VTEX-API-AppToken"]);
  });

  it("returns empty array when no schemes", () => {
    expect(detectApiKeyHeaders(minimalSpec)).toEqual([]);
  });
});

describe("resolveAuth with multi-header", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tocli-auth-multiheader-"));
    vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns headers auth when --header flags are provided", async () => {
    const auth = await resolveAuth(
      { headers: { "X-VTEX-API-AppKey": "key1", "X-VTEX-API-AppToken": "tok1" } },
      specDualHeader,
      {}
    );
    expect(auth.type).toBe("headers");
    expect(auth.headers).toEqual({
      "X-VTEX-API-AppKey": "key1",
      "X-VTEX-API-AppToken": "tok1",
    });
  });

  it("resolves env vars inside header values", async () => {
    const auth = await resolveAuth(
      { headers: { "X-VTEX-API-AppKey": "$VTEX_KEY", "X-VTEX-API-AppToken": "${VTEX_TOKEN}" } },
      specDualHeader,
      { VTEX_KEY: "resolved-key", VTEX_TOKEN: "resolved-tok" }
    );
    expect(auth.headers).toEqual({
      "X-VTEX-API-AppKey": "resolved-key",
      "X-VTEX-API-AppToken": "resolved-tok",
    });
  });

  it("--header takes priority over --token", async () => {
    const auth = await resolveAuth(
      { headers: { "X-Custom": "v" }, token: "sk-1" },
      minimalSpec,
      {}
    );
    expect(auth.type).toBe("headers");
  });

  it("loads headers profile from disk", async () => {
    await saveProfile("vtex", {
      type: "headers",
      value: "",
      headers: { "X-VTEX-API-AppKey": "stored-key", "X-VTEX-API-AppToken": "stored-tok" },
    });
    const auth = await resolveAuth({ profile: "vtex" }, specDualHeader, {});
    expect(auth.type).toBe("headers");
    expect(auth.headers).toEqual({
      "X-VTEX-API-AppKey": "stored-key",
      "X-VTEX-API-AppToken": "stored-tok",
    });
  });

  it("empty headers object falls through to other resolution", async () => {
    const auth = await resolveAuth({ headers: {}, token: "sk-1" }, minimalSpec, {});
    expect(auth.type).toBe("bearer");
    expect(auth.value).toBe("sk-1");
  });

  it("warns to stderr when $VAR in header resolves to empty", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = await resolveAuth(
      { headers: { "X-VTEX-API-AppKey": "$MISSING_VAR" } },
      specDualHeader,
      {}
    );
    expect(auth.headers?.["X-VTEX-API-AppKey"]).toBe("");
    const logged = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/Warning.*MISSING_VAR.*unset/);
    expect(logged).toContain("X-VTEX-API-AppKey");
    stderr.mockRestore();
  });

  it("warns when $VAR resolves to empty string", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    await resolveAuth(
      { headers: { "X-Key": "$EMPTY_VAR" } },
      specDualHeader,
      { EMPTY_VAR: "" }
    );
    const logged = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/Warning.*EMPTY_VAR.*empty/);
    stderr.mockRestore();
  });
});

describe("detectAuthFromSpec — scheme priority and per-operation security", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tocli-detect-"));
    vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("prefers bearer over apiKey header even when apiKey header appears first", async () => {
    const spec: OpenAPISpec = {
      ...minimalSpec,
      components: {
        securitySchemes: {
          myApiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
      security: [{ myApiKey: [] }, { bearerAuth: [] }],
    };
    const auth = await resolveAuth({}, spec, { API_TOKEN: "tok" });
    expect(auth.type).toBe("bearer");
  });

  it("prefers apiKey header over query param when both are present", async () => {
    const spec: OpenAPISpec = {
      ...minimalSpec,
      components: {
        securitySchemes: {
          hapikey: { type: "apiKey", in: "query", name: "hapikey" },
          private_apps: { type: "apiKey", in: "header", name: "private-app" },
        },
      },
      security: [{ hapikey: [] }, { private_apps: [] }],
    };
    const auth = await resolveAuth({}, spec, { API_KEY: "tok" });
    expect(auth.type).toBe("apiKey");
    expect(auth.headerName).toBe("private-app");
  });

  it("HubSpot-like: no global security, picks header scheme from per-operation security", async () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.3",
      info: { title: "HubSpot", version: "1.0" },
      paths: {
        "/contacts": {
          get: {
            operationId: "list",
            security: [
              { hapikey: [] },
              { private_apps: [] },
              { oauth2: ["crm.objects.contacts.read"] },
            ],
          },
        },
      },
      components: {
        securitySchemes: {
          hapikey: { type: "apiKey", in: "query", name: "hapikey" },
          developer_hapikey: { type: "apiKey", in: "query", name: "hapikey" },
          private_apps: { type: "apiKey", in: "header", name: "private-app" },
          private_apps_legacy: { type: "apiKey", in: "header", name: "private-app-legacy" },
          oauth2: { type: "oauth2" } as any,
        },
      },
    };
    const auth = await resolveAuth({}, spec, { API_KEY: "tok" });
    expect(auth.type).toBe("apiKey");
    expect(auth.headerName).toBe("private-app");
  });

  it("ignores schemes not referenced by any operation when no global security", async () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.3",
      info: { title: "Mixed", version: "1.0" },
      paths: {
        "/data": {
          get: {
            operationId: "getData",
            security: [{ headerKey: [] }],
          },
        },
      },
      components: {
        securitySchemes: {
          queryKey: { type: "apiKey", in: "query", name: "api_key" },
          headerKey: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
    };
    const auth = await resolveAuth({}, spec, { API_KEY: "tok" });
    expect(auth.type).toBe("apiKey");
    expect(auth.headerName).toBe("X-API-Key");
  });

  it("falls back to all schemes when neither global nor per-operation security defined", async () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.3",
      info: { title: "NoSec", version: "1.0" },
      paths: { "/data": { get: { operationId: "getData" } } },
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
    };
    const auth = await resolveAuth({}, spec, { API_KEY: "tok" });
    expect(auth.type).toBe("apiKey");
    expect(auth.headerName).toBe("X-API-Key");
  });
});

describe("maskToken", () => {
  it("masks long tokens", () => {
    expect(maskToken("sk-1234567890abcdef")).toBe("sk-1...cdef");
  });

  it("masks short tokens", () => {
    expect(maskToken("short")).toBe("****");
  });
});
