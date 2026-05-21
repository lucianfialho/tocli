import type { Command } from "commander";
import { executeRequest } from "../executor/http.js";
import { formatOutput } from "../output/formatters.js";
import { validateResponse } from "../validator/schema.js";
import { filterPii } from "@lucianfialho/pii-filter";
import { printDryRun } from "./dry-run.js";
import { commandNamesForGroup } from "./command-names.js";
import { flagNameForParam, optionKeyForParam, optionValueForParam } from "./options.js";
import type { RuntimeConfig } from "../executor/types.js";
import type { OperationGroup, OpenAPISpec } from "../parser/types.js";

export function buildDynamicCommands(
  prog: Command,
  groups: OperationGroup[],
  config: RuntimeConfig,
  spec?: OpenAPISpec
): void {
  for (const group of groups) {
    const groupCmd = prog.command(group.tag).description(group.description);
    const commandNames = commandNamesForGroup(group);

    for (const [index, op] of group.operations.entries()) {
      const cmdName = commandNames[index];
      const cmd = groupCmd.command(cmdName).description(op.summary || op.description);
      const optionKeys = new Set<string>();

      for (const p of op.params) {
        const optionKey = optionKeyForParam(p.name);
        if (optionKeys.has(optionKey)) continue;
        optionKeys.add(optionKey);
        const flagName = flagNameForParam(p.name);
        const flag = `--${flagName} <${flagName}>`;
        const desc = p.description || p.name;
        if (p.required) {
          cmd.requiredOption(flag, desc);
        } else if (p.default !== undefined) {
          cmd.option(flag, desc, String(p.default));
        } else {
          cmd.option(flag, desc);
        }
      }

      cmd.action(async (opts: Record<string, unknown>) => {
        const params: Record<string, unknown> = {};
        for (const p of op.params) {
          const value = optionValueForParam(opts, p.name);
          if (value === undefined) continue;
          if (p.type === "integer" || p.type === "number") {
            params[p.name] = Number(value);
          } else if (p.type === "boolean") {
            params[p.name] = value === true || value === "true";
          } else if ((p.type === "object" || p.type === "array") && typeof value === "string") {
            try {
              params[p.name] = JSON.parse(value);
            } catch {
              params[p.name] = value;
            }
          } else {
            params[p.name] = value;
          }
        }

        if (config.dryRun) {
          printDryRun(op, params, config);
          return;
        }

        try {
          const result = await executeRequest(op, params, config.auth, config.baseUrl, config.verbose);

          if (config.quiet) process.exit(result.status >= 400 ? 1 : 0);

          if (result.status >= 400) {
            console.error(`Error: ${result.status} ${JSON.stringify(result.data)}`);
            process.exit(1);
          }

          let responseData = result.data;
          if (config.filterPii && responseData !== null && typeof responseData === "object") {
            const piiOptions = config.piiSalt
              ? { mode: "pseudonymize" as const, salt: config.piiSalt, knownPiiFields: config.piiFields }
              : { mode: "redact" as const, knownPiiFields: config.piiFields };
            responseData = filterPii(responseData as Record<string, unknown>, piiOptions);
          }

          const formatted = formatOutput(responseData, {
            format: config.output as "json" | "pretty" | "table" | "yaml" | "quiet",
            maxItems: config.maxItems,
          });
          if (formatted) console.log(formatted);

          if (config.validate && spec) {
            const validation = validateResponse(responseData, op.path, op.method, result.status, spec);
            console.error("");
            if (validation.valid) {
              console.error(`\x1b[32m✓\x1b[0m Response matches schema (${validation.fieldsChecked} fields checked)`);
            } else {
              console.error(`\x1b[31m✗\x1b[0m Schema validation failed (${validation.errors.length} error${validation.errors.length > 1 ? "s" : ""}):\n`);
              for (const err of validation.errors) {
                console.error(`  ${err.path}: expected ${err.expected}, got ${err.got}`);
              }
              process.exit(2);
            }
          }
        } catch (err) {
          console.error(`Request failed: ${(err as Error).message}`);
          process.exit(1);
        }
      });
    }
  }
}
