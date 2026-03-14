import type { OperationGroup, OpenAPISpec } from "../parser/types.js";
import type { FullDiscovery, FullGroup, FullCommand } from "./types.js";
import { generateCommandSchema } from "./command.js";

const SMALL_API_THRESHOLD = 20;

export function shouldUseFullDiscovery(groups: OperationGroup[]): boolean {
  const total = groups.reduce((sum, g) => sum + g.operations.length, 0);
  return total <= SMALL_API_THRESHOLD;
}

export function generateFullDiscovery(
  groups: OperationGroup[],
  info: { title: string; version: string; description?: string },
  spec: OpenAPISpec
): FullDiscovery {
  const totalCommands = groups.reduce((sum, g) => sum + g.operations.length, 0);

  return {
    name: info.title.toLowerCase().replace(/\s+/g, "-"),
    version: info.version,
    description: info.description ?? info.title,
    groups: groups.map((g): FullGroup => ({
      name: g.tag,
      description: g.description,
      commands: g.operations.map((op): FullCommand => {
        const schema = generateCommandSchema(op, g.tag, spec);
        const cmdName = schema.command.split(".").slice(1).join(".");
        return {
          name: cmdName,
          description: op.summary || op.description,
          method: op.method,
          hint: methodToHint(op.method),
          ...(op.params.filter((p) => p.in === "path").length > 0
            ? { args: op.params.filter((p) => p.in === "path").map((p) => p.name) }
            : {}),
          params: schema.params,
          auth: schema.auth,
        };
      }),
    })),
    _meta: {
      protocol: "mcp-c/1",
      total_commands: totalCommands,
      mode: "full",
    },
  };
}

function methodToHint(method: string): FullCommand["hint"] {
  switch (method) {
    case "GET":
    case "HEAD":
      return "read-only";
    case "DELETE":
      return "destructive";
    default:
      return "write";
  }
}
