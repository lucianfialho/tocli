import { Command } from "commander";
import type { OperationGroup, Operation, OpenAPISpec } from "../parser/types.js";
import type { RuntimeConfig } from "./types.js";
import { executeRequest } from "./http.js";
import { commandNamesForGroup } from "../cli/command-names.js";
import { flagNameForParam, optionKeyForParam, optionValueForParam } from "../cli/options.js";

export function buildCommands(
  program: Command,
  groups: OperationGroup[],
  config: RuntimeConfig,
  spec: OpenAPISpec
): void {
  for (const group of groups) {
    const groupCmd = program
      .command(group.tag)
      .description(group.description);
    const commandNames = commandNamesForGroup(group);

    for (const [index, op] of group.operations.entries()) {
      const cmdName = commandNames[index];
      const cmd = groupCmd
        .command(cmdName)
        .description(op.summary || op.description);

      addParams(cmd, op);

      cmd.action(async (optsAndArgs: Record<string, unknown>) => {
        const params = collectParams(op, optsAndArgs);
        const auth = config.auth;
        const baseUrl = config.baseUrl;

        try {
          const result = await executeRequest(op, params, auth, baseUrl, config.verbose);

          if (config.quiet) {
            process.exit(result.status >= 400 ? 1 : 0);
          }

          if (result.status >= 400) {
            console.error(`Error: ${result.status} ${JSON.stringify(result.data)}`);
            process.exit(1);
          }

          // Output will be formatted by the output module later
          // For now, just print JSON
          console.log(JSON.stringify(result.data, null, 2));
        } catch (err) {
          console.error(`Request failed: ${(err as Error).message}`);
          process.exit(1);
        }
      });
    }
  }
}

function addParams(cmd: Command, op: Operation): void {
  const optionKeys = new Set<string>();
  for (const p of op.params) {
    const optionKey = optionKeyForParam(p.name);
    if (optionKeys.has(optionKey)) continue;
    optionKeys.add(optionKey);
    const flagName = flagNameForParam(p.name);
    const flag = `--${flagName} <${flagName}>`;
    const desc = p.description || p.name;

    if (p.enum) {
      if (p.required) {
        cmd.requiredOption(flag, desc);
      } else {
        cmd.option(flag, desc);
      }
    } else if (p.type === "boolean") {
      cmd.option(`--${flagName}`, desc);
    } else if (p.required) {
      cmd.requiredOption(flag, desc);
    } else {
      if (p.default !== undefined) {
        cmd.option(flag, desc, String(p.default));
      } else {
        cmd.option(flag, desc);
      }
    }
  }
}

function collectParams(
  op: Operation,
  opts: Record<string, unknown>
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const p of op.params) {
    const value = optionValueForParam(opts, p.name);
    if (value === undefined) continue;

    // Type coercion
    switch (p.type) {
      case "integer":
      case "number":
        params[p.name] = Number(value);
        break;
      case "boolean":
        params[p.name] = value === true || value === "true";
        break;
      case "object":
      case "array":
        if (typeof value === "string") {
          try {
            params[p.name] = JSON.parse(value);
          } catch {
            params[p.name] = value;
          }
        } else {
          params[p.name] = value;
        }
        break;
      default:
        params[p.name] = value;
    }
  }

  return params;
}
