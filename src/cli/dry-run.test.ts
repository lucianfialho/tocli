import { describe, expect, it, vi } from "vitest";
import { printDryRun } from "./dry-run.js";
import type { Operation } from "../parser/types.js";
import type { RuntimeConfig } from "../executor/types.js";

const op: Operation = {
  id: "startImport",
  method: "GET",
  path: "/#mode=preview",
  summary: "",
  description: "",
  params: [
    { name: "mode", in: "query", type: "enum", required: true, description: "", enum: ["preview"] },
    { name: "fileId", in: "query", type: "string", required: true, description: "" },
  ],
  bodyRequired: false,
  security: [],
};

const config: RuntimeConfig = {
  specPath: "openapi.json",
  baseUrl: "http://localhost:3000",
  auth: { type: "none", value: "" },
  output: "json",
  verbose: false,
  quiet: false,
  dryRun: true,
  validate: false,
};

describe("printDryRun", () => {
  it("prints query-like path fragments as search params", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    printDryRun(op, { mode: "preview", fileId: "file-123" }, config);

    const output = stdout.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("GET http://localhost:3000/?mode=preview&fileId=file-123");
    expect(output).not.toContain("#mode=preview");

    stdout.mockRestore();
  });
});
