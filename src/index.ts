#!/usr/bin/env node

import { Command } from "commander";
import { loadSpec } from "./parser/loader.js";
import { extractOperations } from "./parser/extractor.js";
import { executeRequest } from "./executor/http.js";
import { formatOutput } from "./output/formatters.js";
import { registerAuthCommands } from "./auth/commands.js";
import { registerInitCommand } from "./config/init.js";
import { registerUseCommand } from "./templates/commands.js";
import { loadConfig, resolveConfig } from "./config/rc.js";
import type { RuntimeConfig } from "./executor/types.js";
import type { OperationGroup, OpenAPISpec } from "./parser/types.js";

const program = new Command();

program
  .name("spec2cli")
  .description("Turn any OpenAPI spec into a CLI. No code generation, no build step.")
  .version("0.1.0");

// Static commands
registerAuthCommands(program);
registerInitCommand(program);
registerUseCommand(program);

async function main() {
  const rawArgs = process.argv.slice(2);
  const envName = getFlagValue(rawArgs, "--env");

  // Handle static commands directly
  const firstArg = rawArgs[0];
  if (firstArg === "auth" || firstArg === "init" || firstArg === "use" || firstArg === "search") {
    program.parse(process.argv);
    return;
  }

  // Resolve spec: --spec flag > .toclirc config
  let specPath = getFlagValue(rawArgs, "--spec");
  let configBaseUrl: string | undefined;

  if (!specPath) {
    const rc = await loadConfig();
    if (rc) {
      const resolved = resolveConfig(rc, envName);
      specPath = resolved.spec;
      configBaseUrl = resolved.baseUrl;
    }
  }

  // No spec? Show usage
  if (!specPath) {
    if (rawArgs.length > 0 && !rawArgs[0].startsWith("-") && rawArgs[0] !== "auth" && rawArgs[0] !== "init") {
      console.error("Error: no OpenAPI spec found.\n");
      console.error("  Either pass --spec:");
      console.error("    tocli --spec ./openapi.yaml " + rawArgs.join(" ") + "\n");
      console.error("  Or create a .toclirc:");
      console.error("    tocli init --spec ./openapi.yaml\n");
      process.exit(1);
    }
    program.parse(process.argv);
    return;
  }

  try {
    const spec = await loadSpec(specPath);
    const groups = extractOperations(spec);

    const config: RuntimeConfig = {
      specPath,
      baseUrl: getFlagValue(rawArgs, "--base-url") ?? configBaseUrl ?? resolveBaseUrl(spec, specPath),
      auth: resolveAuth(rawArgs),
      output: getFlagValue(rawArgs, "--output") ?? (process.stdout.isTTY ? "pretty" : "json"),
      maxItems: getFlagValue(rawArgs, "--max-items") ? parseInt(getFlagValue(rawArgs, "--max-items")!) : undefined,
      verbose: rawArgs.includes("--verbose"),
      quiet: rawArgs.includes("--quiet"),
    };

    buildDynamicCommands(program, groups, config);

    const filteredArgv = filterTocliFlags(process.argv);
    program.parse(filteredArgv);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

function buildDynamicCommands(
  prog: Command,
  groups: OperationGroup[],
  config: RuntimeConfig
): void {
  for (const group of groups) {
    const groupCmd = prog.command(group.tag).description(group.description);

    for (const op of group.operations) {
      const cmdName = simplifyName(op.id, group.tag);
      const cmd = groupCmd.command(cmdName).description(op.summary || op.description);

      for (const p of op.params) {
        const flag = `--${p.name} <${p.name}>`;
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
          if (opts[p.name] === undefined) continue;
          if (p.type === "integer" || p.type === "number") {
            params[p.name] = Number(opts[p.name]);
          } else if (p.type === "boolean") {
            params[p.name] = opts[p.name] === true || opts[p.name] === "true";
          } else {
            params[p.name] = opts[p.name];
          }
        }

        try {
          const result = await executeRequest(op, params, config.auth, config.baseUrl, config.verbose);

          if (config.quiet) process.exit(result.status >= 400 ? 1 : 0);

          if (result.status >= 400) {
            console.error(`Error: ${result.status} ${JSON.stringify(result.data)}`);
            process.exit(1);
          }

          const formatted = formatOutput(result.data, {
            format: config.output as "json" | "pretty" | "table" | "quiet",
            maxItems: config.maxItems,
          });
          if (formatted) console.log(formatted);
        } catch (err) {
          console.error(`Request failed: ${(err as Error).message}`);
          process.exit(1);
        }
      });
    }
  }
}

function resolveBaseUrl(spec: OpenAPISpec, specSource: string): string {
  const serverUrl = spec.servers?.[0]?.url;

  // Absolute URL — use as-is
  if (serverUrl?.startsWith("http://") || serverUrl?.startsWith("https://")) {
    return serverUrl;
  }

  // Relative URL — resolve against spec source origin
  if (serverUrl && specSource.startsWith("http")) {
    try {
      const origin = new URL(specSource).origin;
      return origin + (serverUrl.startsWith("/") ? serverUrl : "/" + serverUrl);
    } catch {
      // fall through
    }
  }

  // Spec loaded from URL but no servers — infer origin
  if (specSource.startsWith("http")) {
    try {
      return new URL(specSource).origin;
    } catch {
      // fall through
    }
  }

  return "http://localhost:3000";
}

function simplifyName(operationId: string, tag: string): string {
  const tagLower = tag.toLowerCase();
  const idLower = operationId.toLowerCase();
  const singular = tagLower.endsWith("s") ? tagLower.slice(0, -1) : tagLower;

  for (const suffix of [tagLower, singular]) {
    if (idLower.endsWith(suffix) && idLower.length > suffix.length) {
      return operationId.slice(0, operationId.length - suffix.length).toLowerCase();
    }
  }
  return operationId.toLowerCase();
}

function resolveAuth(args: string[]): RuntimeConfig["auth"] {
  const token = getFlagValue(args, "--token");
  if (token) return { type: "bearer", value: token };
  const apiKey = getFlagValue(args, "--api-key");
  if (apiKey) return { type: "apiKey", value: apiKey, headerName: "X-API-Key" };
  return { type: "none", value: "" };
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function filterTocliFlags(argv: string[]): string[] {
  const valueFlags = new Set(["--spec", "--output", "--max-items", "--token", "--api-key", "--base-url", "--profile", "--env"]);
  const boolFlags = new Set(["--verbose", "--quiet"]);
  const result: string[] = [];
  let i = 0;
  while (i < argv.length) {
    if (valueFlags.has(argv[i])) { i += 2; continue; }
    if (boolFlags.has(argv[i])) { i++; continue; }
    result.push(argv[i]);
    i++;
  }
  return result;
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
