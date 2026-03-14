import { describe, it, expect } from "vitest";
import { loadSpec } from "../parser/loader.js";
import { extractOperations } from "../parser/extractor.js";
import { shouldUseFullDiscovery, generateFullDiscovery } from "./full.js";
import path from "node:path";

const FIXTURE = path.resolve("test/fixtures/petstore.yaml");

describe("shouldUseFullDiscovery", () => {
  it("returns true for small APIs (≤ 20 commands)", async () => {
    const spec = await loadSpec(FIXTURE);
    const groups = extractOperations(spec);
    // petstore has 8 commands
    expect(shouldUseFullDiscovery(groups)).toBe(true);
  });

  it("returns false for large APIs (> 20 commands)", () => {
    // Simulate a large API with 30 operations
    const groups = Array.from({ length: 5 }, (_, i) => ({
      tag: `group${i}`,
      description: `Group ${i}`,
      operations: Array.from({ length: 6 }, (_, j) => ({
        id: `op${i}_${j}`,
        method: "GET",
        path: `/g${i}/r${j}`,
        summary: `Op ${j}`,
        description: `Op ${j}`,
        params: [],
        bodyRequired: false,
        security: [],
      })),
    }));
    expect(shouldUseFullDiscovery(groups)).toBe(false);
  });
});

describe("generateFullDiscovery", () => {
  it("returns all groups with all command details", async () => {
    const spec = await loadSpec(FIXTURE);
    const groups = extractOperations(spec);
    const full = generateFullDiscovery(groups, spec.info, spec);

    expect(full._meta.mode).toBe("full");
    expect(full._meta.total_commands).toBe(8);
    expect(full.groups).toHaveLength(2);

    // pets group should have all commands with params
    const pets = full.groups.find((g) => g.name === "pets")!;
    expect(pets.commands).toHaveLength(5);

    const create = pets.commands.find((c) => c.name === "create")!;
    expect(create.params.length).toBeGreaterThan(0);
    expect(create.auth.required).toBe(true);
    expect(create.hint).toBe("write");

    const list = create.params.find((p) => p.name === "name");
    expect(list).toBeDefined();
  });

  it("includes hints and args", async () => {
    const spec = await loadSpec(FIXTURE);
    const groups = extractOperations(spec);
    const full = generateFullDiscovery(groups, spec.info, spec);

    const pets = full.groups.find((g) => g.name === "pets")!;
    const del = pets.commands.find((c) => c.name === "delete")!;
    expect(del.hint).toBe("destructive");
    expect(del.args).toEqual(["petId"]);
  });
});
