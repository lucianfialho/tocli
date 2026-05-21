import { describe, expect, it } from "vitest";
import { commandNamesForGroup } from "./command-names.js";
import type { OperationGroup } from "../parser/types.js";

function makeGroup(overrides: Partial<OperationGroup> = {}): OperationGroup {
  return {
    tag: "jobs",
    description: "Manage jobs",
    operations: [
      {
        id: "syncJob",
        method: "GET",
        path: "/jobs/sync",
        summary: "",
        description: "",
        params: [],
        bodyRequired: false,
        security: [],
      },
      {
        id: "syncJob",
        method: "POST",
        path: "/jobs/sync",
        summary: "",
        description: "",
        params: [],
        bodyRequired: false,
        security: [],
      },
    ],
    ...overrides,
  };
}

describe("commandNamesForGroup", () => {
  it("keeps unique simplified command names unchanged", () => {
    const names = commandNamesForGroup(makeGroup({
      operations: [
        {
          id: "listPets",
          method: "GET",
          path: "/pets",
          summary: "",
          description: "",
          params: [],
          bodyRequired: false,
          security: [],
        },
      ],
      tag: "pets",
    }));

    expect(names).toEqual(["list"]);
  });

  it("adds HTTP method suffixes for duplicate simplified names", () => {
    expect(commandNamesForGroup(makeGroup())).toEqual([
      "sync-get",
      "sync-post",
    ]);
  });
});
