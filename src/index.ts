#!/usr/bin/env node

import { Command } from "commander";
import { loadSpec } from "./parser/loader.js";
import { extractOperations } from "./parser/extractor.js";
import { registerAuthCommands } from "./auth/commands.js";
import { resolveAuth as resolveAuthFromFlags } from "./auth/flags.js";
import { registerInitCommand } from "./config/init.js";
import { registerUseCommand } from "./templates/commands.js";
import { loadConfig, resolveConfig } from "./config/rc.js";
import { scanSchema } from "@lucianfialho/pii-filter";
import { buildDynamicCommands } from "./cli/dynamic-commands.js";
import { printAgentHelp, resolveBaseUrl } from "./cli/agent-help.js";
import { getFlagValue, parseHeaderArgs, filterTocliFlags } from "./cli/flags.js";
import type { RuntimeConfig } from "./executor/types.js";

const program = new Command();

program
  .name("spec2cli")
  .description("Turn any OpenAPI spec into a CLI. No code generation, no build step.")
  .version("0.7.0")
  .addHelpText("after", `
Commands: use | search | add | remove
Flags:    --dry-run | --validate | --agent-help | --filter-pii | --header "Name: Value"

Examples:
  spec2cli --spec ./api.yaml pets list
  spec2cli --spec ./api.yaml --filter-pii customers list
  spec2cli use petstore pet findpetsbystatus --status available
  spec2cli add myapi --spec ./openapi.yaml --base-url http://localhost:3000`);

registerAuthCommands(program);
registerInitCommand(program);
registerUseCommand(program);

async function main() {
  const rawArgs = process.argv.slice(2);
  const envName = getFlagValue(rawArgs, "--env");

  const firstArg = rawArgs[0];
  if (["auth", "init", "use", "search", "add", "remove"].includes(firstArg ?? "")) {
    program.parse(process.argv);
    return;
  }

  let specPath = getFlagValue(rawArgs, "--spec");
  let configBaseUrl: string | undefined;
  let rcAuthType: string | undefined;
  let rcAuthToken: string | undefined;
  let rcAuthEnvVar: string | undefined;
  let rcPrivacyFilter: boolean | undefined;

  if (!specPath) {
    const rc = await loadConfig();
    if (rc) {
      const resolved = resolveConfig(rc, envName);
      specPath = resolved.spec;
      configBaseUrl = resolved.baseUrl;
      rcAuthType = resolved.authType;
      rcAuthToken = resolved.authToken;
      rcAuthEnvVar = resolved.authEnvVar;
      rcPrivacyFilter = resolved.privacyFilter;
    }
  }

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

    if (rawArgs.includes("--agent-help")) {
      printAgentHelp(groups, spec);
      return;
    }

    const auth = await resolveAuthFromFlags(
      {
        token: getFlagValue(rawArgs, "--token"),
        apiKey: getFlagValue(rawArgs, "--api-key"),
        basic: getFlagValue(rawArgs, "--basic"),
        headers: parseHeaderArgs(rawArgs),
        profile: getFlagValue(rawArgs, "--profile"),
        rcAuthType,
        rcAuthToken,
        rcAuthEnvVar,
      },
      spec
    );

    const filterPiiEnabled = rawArgs.includes("--filter-pii") || rcPrivacyFilter === true;
    const piiFields = filterPiiEnabled && spec.components?.schemas
      ? scanSchema(spec.components.schemas as Record<string, unknown>)
      : [];

    if (filterPiiEnabled && piiFields.length > 0 && rawArgs.includes("--verbose")) {
      console.error(`[pii] detected fields: ${piiFields.join(", ")}`);
    }

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
      filterPii: filterPiiEnabled,
      piiSalt: process.env.SPEC2CLI_PII_SALT ?? "",
      piiFields,
    };

    buildDynamicCommands(program, groups, config, spec);

    const filteredArgv = filterTocliFlags(process.argv);
    program.parse(filteredArgv);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
