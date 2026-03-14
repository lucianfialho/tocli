#!/usr/bin/env node

import { Command } from "commander";
import { loadSpec } from "./parser/loader.js";
import { extractOperations } from "./parser/extractor.js";
import { generateManifest } from "./discovery/manifest.js";
import { generateGroupDetail } from "./discovery/group.js";
import { generateCommandSchema } from "./discovery/command.js";
import { shouldUseFullDiscovery, generateFullDiscovery } from "./discovery/full.js";
import { executeRequest } from "./executor/http.js";
import { formatOutput } from "./output/formatters.js";
import { registerAuthCommands } from "./auth/commands.js";
import { registerInitCommand } from "./config/init.js";
import { loadConfig, resolveConfig } from "./config/rc.js";
import type { RuntimeConfig } from "./executor/types.js";
import type { OperationGroup, OpenAPISpec } from "./parser/types.js";

const program = new Command();

program
  .name("mcp-c")
  .description(
    "Context-efficient CLI protocol for AI agents. Progressive discovery + output envelope."
  )
  .version("0.1.0");

// Register static commands
registerAuthCommands(program);
registerInitCommand(program);

async function main() {
  const rawArgs = process.argv.slice(2);
  const discoverIdx = rawArgs.indexOf("--discover");
  const envName = getFlagValue(rawArgs, "--env");

  // Handle auth and init commands directly
  const firstArg = rawArgs[0];
  if (firstArg === "auth" || firstArg === "init") {
    program.parse(process.argv);
    return;
  }

  // Resolve spec: --spec flag > .mcp-crc config
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

  // Handle --discover
  if (discoverIdx !== -1) {
    if (!specPath) {
      console.error("Error: --spec is required (or create .mcp-crc with 'mcp-c init').");
      process.exit(1);
    }
    const discoverArgs: string[] = [];
    for (let i = discoverIdx + 1; i < rawArgs.length; i++) {
      if (rawArgs[i].startsWith("--")) break;
      discoverArgs.push(rawArgs[i]);
    }
    await handleDiscover(specPath, discoverArgs);
    return;
  }

  // No spec? Show help
  if (!specPath) {
    program.parse(process.argv);
    return;
  }

  // Build dynamic CLI from spec
  try {
    const spec = await loadSpec(specPath);
    const groups = extractOperations(spec);

    const config: RuntimeConfig = {
      specPath,
      baseUrl: getFlagValue(rawArgs, "--base-url") ?? configBaseUrl ?? spec.servers?.[0]?.url ?? "http://localhost:3000",
      auth: resolveAuth(rawArgs),
      output: getFlagValue(rawArgs, "--output") ?? (process.stdout.isTTY ? "pretty" : "json"),
      maxItems: getFlagValue(rawArgs, "--max-items") ? parseInt(getFlagValue(rawArgs, "--max-items")!) : undefined,
      verbose: rawArgs.includes("--verbose"),
      quiet: rawArgs.includes("--quiet"),
    };

    buildDynamicCommands(program, groups, config, spec);

    const filteredArgv = filterMcpcFlags(process.argv);
    program.parse(filteredArgv);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

function buildDynamicCommands(
  prog: Command,
  groups: OperationGroup[],
  config: RuntimeConfig,
  spec: OpenAPISpec
): void {
  for (const group of groups) {
    const groupCmd = prog.command(group.tag).description(group.description);

    for (const op of group.operations) {
      const cmdName = simplifyName(op.id, group.tag);
      const cmd = groupCmd.command(cmdName).description(op.summary || op.description);

      const seenParams = new Set<string>();
      for (const p of op.params) {
        if (seenParams.has(p.name)) continue;
        seenParams.add(p.name);

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
            format: config.output as "json" | "pretty" | "envelope" | "table" | "quiet",
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

async function handleDiscover(specPath: string, args: string[]) {
  const spec = await loadSpec(specPath);
  const groups = extractOperations(spec);

  if (args.length === 0) {
    // Auto-detect: small APIs get full discovery in one call
    if (shouldUseFullDiscovery(groups)) {
      console.log(JSON.stringify(generateFullDiscovery(groups, spec.info, spec)));
    } else {
      console.log(JSON.stringify(generateManifest(groups, spec.info)));
    }
    return;
  }

  const groupName = args[0];
  const group = groups.find((g) => g.tag === groupName);
  if (!group) {
    console.error(`Error: group '${groupName}' not found. Available: ${groups.map((g) => g.tag).join(", ")}`);
    process.exit(1);
  }

  if (args.length === 1) {
    console.log(JSON.stringify(generateGroupDetail(group)));
    return;
  }

  const commandName = args[1];
  const op = group.operations.find((o) => {
    const simplified = simplifyName(o.id, groupName);
    return simplified === commandName || o.id.toLowerCase() === commandName;
  });

  if (!op) {
    const available = group.operations.map((o) => simplifyName(o.id, groupName));
    console.error(`Error: command '${commandName}' not found in '${groupName}'. Available: ${available.join(", ")}`);
    process.exit(1);
  }

  console.log(JSON.stringify(generateCommandSchema(op, groupName, spec)));
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

function filterMcpcFlags(argv: string[]): string[] {
  const mcpcFlags = new Set(["--spec", "--output", "--max-items", "--token", "--api-key", "--base-url", "--profile", "--env"]);
  const boolFlags = new Set(["--verbose", "--quiet", "--discover"]);
  const result: string[] = [];
  let i = 0;
  while (i < argv.length) {
    if (mcpcFlags.has(argv[i])) { i += 2; continue; }
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
