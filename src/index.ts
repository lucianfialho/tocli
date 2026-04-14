#!/usr/bin/env node

import { Command } from "commander";
import { loadSpec } from "./parser/loader.js";
import { extractOperations } from "./parser/extractor.js";
import { executeRequest } from "./executor/http.js";
import { formatOutput } from "./output/formatters.js";
import { registerAuthCommands } from "./auth/commands.js";
import { resolveAuth as resolveAuthFromFlags } from "./auth/flags.js";
import { parseHeaderFlag } from "./auth/headers.js";
import { registerInitCommand } from "./config/init.js";
import { registerUseCommand } from "./templates/commands.js";
import { loadConfig, resolveConfig } from "./config/rc.js";
import { validateResponse } from "./validator/schema.js";
import { stringify as toYaml } from "yaml";
import type { RuntimeConfig } from "./executor/types.js";
import type { OperationGroup, OpenAPISpec } from "./parser/types.js";

const program = new Command();

program
  .name("spec2cli")
  .description("Turn any OpenAPI spec into a CLI. No code generation, no build step.")
  .version("0.6.0")
  .addHelpText("after", `
Commands (registry):
  use <api> [args...]     Use an API from the registry
  search <query>          Search APIs by name, description, or category
  add <name> --spec <url> Add a custom API to your local registry
  add --from <url>        Import APIs from a remote registry
  remove <name>           Remove a custom API from local registry

Flags:
  --dry-run                 Preview the HTTP request without executing
  --validate                Validate response against the OpenAPI schema
  --agent-help              Compact YAML with all commands, params, and auth
  --header "Name: Value"    Send a custom auth header (repeatable, for APIs like VTEX)

Examples:
  spec2cli --spec ./api.yaml pets list
  spec2cli --spec ./api.yaml --agent-help
  spec2cli use petstore pet findpetsbystatus --status available
  spec2cli search payments
  spec2cli add myapi --spec ./openapi.yaml --base-url http://localhost:3000`);

// Static commands
registerAuthCommands(program);
registerInitCommand(program);
registerUseCommand(program);

async function main() {
  const rawArgs = process.argv.slice(2);
  const envName = getFlagValue(rawArgs, "--env");

  // Handle static commands directly
  const firstArg = rawArgs[0];
  if (["auth", "init", "use", "search", "add", "remove"].includes(firstArg ?? "")) {
    program.parse(process.argv);
    return;
  }

  // Resolve spec: --spec flag > .toclirc config
  let specPath = getFlagValue(rawArgs, "--spec");
  let configBaseUrl: string | undefined;
  let rcAuthType: string | undefined;
  let rcAuthToken: string | undefined;
  let rcAuthEnvVar: string | undefined;

  if (!specPath) {
    const rc = await loadConfig();
    if (rc) {
      const resolved = resolveConfig(rc, envName);
      specPath = resolved.spec;
      configBaseUrl = resolved.baseUrl;
      rcAuthType = resolved.authType;
      rcAuthToken = resolved.authToken;
      rcAuthEnvVar = resolved.authEnvVar;
    }
  }

  // No spec? Show usage
  if (!specPath) {
    if (rawArgs.length > 0 && !rawArgs[0].startsWith("-") && rawArgs[0] !== "auth" && rawArgs[0] !== "init") {
      console.error("Error: no OpenAPI spec found.\n");
      console.error("  Either pass --spec:");
      console.error("    spec2cli --spec ./openapi.yaml " + rawArgs.join(" ") + "\n");
      console.error("  Or create a .toclirc:");
      console.error("    spec2cli init --spec ./openapi.yaml\n");
      process.exit(1);
    }
    program.parse(process.argv);
    return;
  }

  try {
    const spec = await loadSpec(specPath);
    const groups = extractOperations(spec);

    // --agent-help: compact YAML with everything an AI agent needs
    if (rawArgs.includes("--agent-help")) {
      printAgentHelp(groups, spec);
      return;
    }

    const auth = await resolveAuthFromFlags(
      {
        token: getFlagValue(rawArgs, "--token"),
        apiKey: getFlagValue(rawArgs, "--api-key"),
        headers: parseHeaderArgs(rawArgs),
        profile: getFlagValue(rawArgs, "--profile"),
        rcAuthType,
        rcAuthToken,
        rcAuthEnvVar,
      },
      spec
    );

    const config: RuntimeConfig = {
      specPath,
      baseUrl: getFlagValue(rawArgs, "--base-url") ?? configBaseUrl ?? resolveBaseUrl(spec, specPath),
      auth,
      output: getFlagValue(rawArgs, "--output") ?? (process.stdout.isTTY ? "pretty" : "json"),
      maxItems: getFlagValue(rawArgs, "--max-items") ? parseInt(getFlagValue(rawArgs, "--max-items")!) : undefined,
      verbose: rawArgs.includes("--verbose"),
      quiet: rawArgs.includes("--quiet"),
      dryRun: rawArgs.includes("--dry-run"),
      validate: rawArgs.includes("--validate"),
    };

    buildDynamicCommands(program, groups, config, spec);

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
  config: RuntimeConfig,
  spec?: OpenAPISpec
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
          } else if ((p.type === "object" || p.type === "array") && typeof opts[p.name] === "string") {
            try {
              params[p.name] = JSON.parse(opts[p.name] as string);
            } catch {
              params[p.name] = opts[p.name];
            }
          } else {
            params[p.name] = opts[p.name];
          }
        }

        // --dry-run: show request without executing
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

          const formatted = formatOutput(result.data, {
            format: config.output as "json" | "pretty" | "table" | "yaml" | "quiet",
            maxItems: config.maxItems,
          });
          if (formatted) console.log(formatted);

          // --validate: check response against spec schema
          if (config.validate && spec) {
            const validation = validateResponse(result.data, op.path, op.method, result.status, spec);
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

function printDryRun(op: import("./parser/types.js").Operation, params: Record<string, unknown>, config: RuntimeConfig): void {
  // Build URL
  let path = op.path;
  for (const p of op.params) {
    if (p.in === "path" && params[p.name] !== undefined) {
      path = path.replace(`{${p.name}}`, String(params[p.name]));
    }
  }
  const base = config.baseUrl.endsWith("/") ? config.baseUrl.slice(0, -1) : config.baseUrl;
  const url = new URL(base + path);
  for (const p of op.params) {
    if (p.in === "query" && params[p.name] !== undefined) {
      url.searchParams.set(p.name, String(params[p.name]));
    }
  }

  // Headers
  const headers: string[] = [];
  if (["POST", "PUT", "PATCH"].includes(op.method)) {
    headers.push("Content-Type: application/json");
  }
  headers.push("Accept: application/json");
  if (config.auth.type === "bearer") {
    headers.push(`Authorization: Bearer ${config.auth.value}`);
  } else if (config.auth.type === "apiKey") {
    headers.push(`${config.auth.headerName ?? "X-API-Key"}: ${config.auth.value}`);
  } else if (config.auth.type === "headers" && config.auth.headers) {
    for (const [k, v] of Object.entries(config.auth.headers)) {
      headers.push(`${k}: ${v}`);
    }
  }

  // Body
  const bodyParams = op.params.filter((p) => p.in === "body");
  const body: Record<string, unknown> = {};
  for (const p of bodyParams) {
    if (params[p.name] !== undefined) body[p.name] = params[p.name];
  }

  // Print
  console.log(`${op.method} ${url.toString()}`);
  for (const h of headers) console.log(h);
  if (Object.keys(body).length > 0) {
    console.log("");
    console.log(JSON.stringify(body, null, 2));
  }

  // Also print as curl
  console.log("");
  let curl = `curl -X ${op.method} '${url.toString()}'`;
  for (const h of headers) curl += ` \\\n  -H '${h}'`;
  if (Object.keys(body).length > 0) curl += ` \\\n  -d '${JSON.stringify(body)}'`;
  console.log(curl);
}

function printAgentHelp(groups: OperationGroup[], spec: OpenAPISpec): void {
  const help: Record<string, unknown> = {
    api: spec.info.title,
    base_url: spec.servers?.[0]?.url ?? "http://localhost:3000",
    auth: resolveAuthHint(spec),
    flags: {
      "--output": "json | pretty | table | yaml | quiet",
      "--dry-run": "preview HTTP request without executing (includes curl)",
      "--validate": "validate response against OpenAPI schema",
      "--verbose": "show full HTTP request/response",
      "--max-items": "limit array results",
    },
    commands: {} as Record<string, unknown>,
  };

  const commands = help.commands as Record<string, unknown>;

  for (const group of groups) {
    const groupCmds: Record<string, unknown> = {};

    for (const op of group.operations) {
      const cmdName = simplifyName(op.id, group.tag);
      const cmd: Record<string, unknown> = {
        method: op.method,
        desc: op.summary || op.description,
      };

      const params = op.params.filter((p) => p.required);
      const optionals = op.params.filter((p) => !p.required);

      if (params.length > 0) {
        cmd.required = params.map((p) => {
          const entry: Record<string, unknown> = { name: p.name, type: p.type };
          if (p.enum) entry.enum = p.enum;
          return entry;
        });
      }

      if (optionals.length > 0) {
        cmd.optional = optionals.map((p) => {
          const entry: Record<string, unknown> = { name: p.name, type: p.type };
          if (p.enum) entry.enum = p.enum;
          if (p.default !== undefined) entry.default = p.default;
          return entry;
        });
      }

      groupCmds[cmdName] = cmd;
    }

    commands[group.tag] = groupCmds;
  }

  console.log(toYaml(help));
}

function resolveAuthHint(spec: OpenAPISpec): string {
  const schemes = spec.components?.securitySchemes;
  if (!schemes) return "none";

  // Collect all apiKey headers — if there's more than one, recommend --header flags
  const apiKeyHeaders: string[] = [];
  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.name) {
      apiKeyHeaders.push(scheme.name);
    }
  }

  if (apiKeyHeaders.length > 1) {
    const parts = apiKeyHeaders.map((h) => `--header "${h}: <value>"`).join(" ");
    return `multi-header ${parts}`;
  }

  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "http" && scheme.scheme === "bearer") return "bearer --token <TOKEN>";
    if (scheme.type === "apiKey") return `apiKey --api-key <KEY> (header: ${scheme.name})`;
  }

  return "none";
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

function parseHeaderArgs(args: string[]): Record<string, string> | undefined {
  const raws = getFlagValues(args, "--header").concat(getFlagValues(args, "-H"));
  if (raws.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const raw of raws) {
    const parsed = parseHeaderFlag(raw);
    if (!parsed) {
      console.error(`Error: invalid --header '${raw}'. Expected "Name: Value" with RFC-valid name and no CR/LF.`);
      process.exit(1);
    }
    headers[parsed.name] = parsed.value;
  }
  return headers;
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function getFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
    }
  }
  return values;
}

function filterTocliFlags(argv: string[]): string[] {
  const valueFlags = new Set(["--spec", "--output", "--max-items", "--token", "--api-key", "--base-url", "--profile", "--env", "--header", "-H"]);
  const boolFlags = new Set(["--verbose", "--quiet", "--dry-run", "--validate", "--agent-help"]);
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
