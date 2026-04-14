import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeRequest } from "./http.js";
import type { Operation } from "../parser/types.js";
import type { AuthConfig } from "./types.js";

const BASE_URL = "https://petstore.example.com/v1";
const NO_AUTH: AuthConfig = { type: "none", value: "" };

function makeOp(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "listPets",
    method: "GET",
    path: "/pets",
    summary: "List pets",
    description: "List pets",
    params: [],
    bodyRequired: false,
    security: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("executeRequest", () => {
  it("substitutes path params in URL", async () => {
    const op = makeOp({
      id: "getPet",
      path: "/pets/{petId}",
      params: [{ name: "petId", in: "path", type: "integer", required: true, description: "" }],
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify({ id: 123, name: "Rex" })),
    }));

    await executeRequest(op, { petId: 123 }, NO_AUTH, BASE_URL);

    expect(fetch).toHaveBeenCalledWith(
      "https://petstore.example.com/v1/pets/123",
      expect.objectContaining({ method: "GET" })
    );

    vi.unstubAllGlobals();
  });

  it("appends query params to URL", async () => {
    const op = makeOp({
      params: [
        { name: "limit", in: "query", type: "integer", required: false, description: "" },
        { name: "status", in: "query", type: "enum", required: false, description: "", enum: ["available"] },
      ],
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify([])),
    }));

    await executeRequest(op, { limit: 10, status: "available" }, NO_AUTH, BASE_URL);

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=10");
    expect(calledUrl).toContain("status=available");

    vi.unstubAllGlobals();
  });

  it("sends JSON body for POST requests", async () => {
    const op = makeOp({
      id: "createPet",
      method: "POST",
      params: [
        { name: "name", in: "body", type: "string", required: true, description: "" },
        { name: "tag", in: "body", type: "string", required: false, description: "" },
      ],
      bodyRequired: true,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 201,
      statusText: "Created",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify({ id: 1, name: "Rex" })),
    }));

    await executeRequest(op, { name: "Rex", tag: "dog" }, NO_AUTH, BASE_URL);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = callArgs[1] as RequestInit;
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ name: "Rex", tag: "dog" });
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    vi.unstubAllGlobals();
  });

  it("sets Bearer auth header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify([])),
    }));

    const auth: AuthConfig = { type: "bearer", value: "sk-test-123" };
    await executeRequest(makeOp(), {}, auth, BASE_URL);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-123");

    vi.unstubAllGlobals();
  });

  it("sets API key header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify({})),
    }));

    const auth: AuthConfig = { type: "apiKey", value: "my-key", headerName: "X-API-Key" };
    await executeRequest(makeOp(), {}, auth, BASE_URL);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("my-key");

    vi.unstubAllGlobals();
  });

  it("sets multiple headers for multi-header auth (VTEX-style)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify({})),
    }));

    const auth: AuthConfig = {
      type: "headers",
      value: "",
      headers: {
        "X-VTEX-API-AppKey": "my-key",
        "X-VTEX-API-AppToken": "my-token",
      },
    };
    await executeRequest(makeOp(), {}, auth, BASE_URL);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-VTEX-API-AppKey"]).toBe("my-key");
    expect(headers["X-VTEX-API-AppToken"]).toBe("my-token");

    vi.unstubAllGlobals();
  });

  it("masks auth header values in verbose output (multi-header)", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve("{}"),
    }));

    const auth: AuthConfig = {
      type: "headers",
      value: "",
      headers: {
        "X-VTEX-API-AppKey": "vtexappkey-sanavita-SECRET",
        "X-VTEX-API-AppToken": "FJRVTFCDCJWZQWDYPQELDCWWGEONETPXMVPDVMBQSBBE",
      },
    };
    await executeRequest(makeOp(), {}, auth, BASE_URL, true);

    const logged = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("vtexappkey-sanavita-SECRET");
    expect(logged).not.toContain("FJRVTFCDCJWZQWDYPQELDCWWGEONETPXMVPDVMBQSBBE");
    expect(logged).toMatch(/X-VTEX-API-AppKey: vtex\.\.\.CRET/);
    expect(logged).toMatch(/X-VTEX-API-AppToken: FJRV\.\.\.SBBE/);

    stderr.mockRestore();
    vi.unstubAllGlobals();
  });

  it("masks apiKey header value in verbose output", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve("{}"),
    }));

    const auth: AuthConfig = { type: "apiKey", value: "super-secret-key-value", headerName: "X-Custom-Key" };
    await executeRequest(makeOp(), {}, auth, BASE_URL, true);

    const logged = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("super-secret-key-value");
    expect(logged).toMatch(/X-Custom-Key: supe\.\.\.alue/);

    stderr.mockRestore();
    vi.unstubAllGlobals();
  });

  it("returns status, headers, and parsed data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"], ["x-request-id", "abc"]]),
      text: () => Promise.resolve(JSON.stringify([{ id: 1, name: "Rex" }])),
    }));

    const result = await executeRequest(makeOp(), {}, NO_AUTH, BASE_URL);

    expect(result.status).toBe(200);
    expect(result.data).toEqual([{ id: 1, name: "Rex" }]);
    expect(result.headers["x-request-id"]).toBe("abc");

    vi.unstubAllGlobals();
  });

  it("handles non-JSON responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "text/plain"]]),
      text: () => Promise.resolve("plain text response"),
    }));

    const result = await executeRequest(makeOp(), {}, NO_AUTH, BASE_URL);
    expect(result.data).toBe("plain text response");

    vi.unstubAllGlobals();
  });

  it("skips undefined params", async () => {
    const op = makeOp({
      params: [
        { name: "limit", in: "query", type: "integer", required: false, description: "" },
        { name: "offset", in: "query", type: "integer", required: false, description: "" },
      ],
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify([])),
    }));

    await executeRequest(op, { limit: 10 }, NO_AUTH, BASE_URL);

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=10");
    expect(calledUrl).not.toContain("offset");

    vi.unstubAllGlobals();
  });
});
