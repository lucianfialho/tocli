import { describe, it, expect } from "vitest";
import { formatOutput } from "./formatters.js";

describe("formatOutput", () => {
  const sampleArray = [
    { id: 1, name: "Rex", status: "available" },
    { id: 2, name: "Luna", status: "pending" },
    { id: 3, name: "Max", status: "sold" },
  ];

  it("json mode outputs compact JSON", () => {
    const result = formatOutput(sampleArray, { format: "json" });
    expect(result).toBe(JSON.stringify(sampleArray));
    expect(result).not.toContain("\n");
  });

  it("pretty mode outputs indented JSON", () => {
    const result = formatOutput(sampleArray, { format: "pretty" });
    expect(result).toContain("\n");
    expect(result).toContain("Rex");
  });

  it("quiet mode outputs nothing", () => {
    const result = formatOutput(sampleArray, { format: "quiet" });
    expect(result).toBe("");
  });

  it("table mode formats arrays as columns", () => {
    const result = formatOutput(sampleArray, { format: "table" });
    expect(result).toContain("id");
    expect(result).toContain("name");
    expect(result).toContain("status");
    expect(result).toContain("Rex");
    expect(result).toContain("Luna");
    const lines = result.split("\n");
    expect(lines.length).toBe(5); // header + separator + 3 rows
  });

  it("table mode handles empty arrays", () => {
    const result = formatOutput([], { format: "table" });
    expect(result).toBe("(empty)");
  });

  it("maxItems truncates array", () => {
    const result = formatOutput(sampleArray, { format: "json", maxItems: 2 });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Rex");
    expect(parsed[1].name).toBe("Luna");
  });

  it("yaml mode outputs YAML", () => {
    const result = formatOutput(sampleArray, { format: "yaml" });
    expect(result).toContain("name: Rex");
    expect(result).toContain("status: available");
    expect(result).toContain("- id: 1");
  });

  it("maxItems does not truncate when under limit", () => {
    const result = formatOutput(sampleArray, { format: "json", maxItems: 10 });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(3);
  });
});
