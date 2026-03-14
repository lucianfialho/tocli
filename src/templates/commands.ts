import type { Command } from "commander";
import { execSync } from "node:child_process";
import { fetchRegistry, getTemplate, searchTemplates } from "./registry.js";

export function registerUseCommand(program: Command): void {
  const originalParse = program.parse.bind(program);

  program.parse = ((argv?: string[], opts?: { from: "node" | "electron" | "user" }) => {
    const args = (argv ?? process.argv).slice(2);

    if (args[0] === "use") {
      handleUse(args.slice(1));
      return program;
    }

    if (args[0] === "search") {
      handleSearch(args.slice(1));
      return program;
    }

    return originalParse(argv, opts);
  }) as typeof program.parse;
}

async function handleUse(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--list") {
    await printTemplateList();
    return;
  }

  const apiName = args[0];
  const template = await getTemplate(apiName);

  if (!template) {
    console.error(`Unknown API: '${apiName}'.\n`);
    const suggestions = await searchTemplates(apiName);
    if (suggestions.length > 0) {
      console.error("Did you mean:");
      for (const s of suggestions) {
        console.error(`  ${s.name} — ${s.description}`);
      }
      console.error("");
    }
    console.error("Run 'spec2cli use --list' to see all available APIs.");
    console.error("Run 'spec2cli search <query>' to search.\n");
    process.exit(1);
  }

  const tocliArgs = [
    "node", process.argv[1],
    "--spec", `"${template.specUrl}"`,
    "--base-url", template.baseUrl,
  ];

  const token = process.env[template.authEnvVar];
  if (token && template.authType === "bearer") {
    tocliArgs.push("--token", token);
  } else if (token && template.authType === "apiKey") {
    tocliArgs.push("--api-key", token);
  }

  const remaining = args.slice(1);
  if (remaining.length === 0) {
    tocliArgs.push("--help");
  } else {
    tocliArgs.push(...remaining);
  }

  const cmd = tocliArgs.join(" ");

  try {
    const result = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "pipe"],
      timeout: 30000,
    });
    if (result) process.stdout.write(result);
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; status?: number };
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    process.exit(e.status ?? 1);
  }
}

async function handleSearch(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error("Usage: spec2cli search <query>");
    console.error("Example: spec2cli search payments\n");
    process.exit(1);
  }

  const query = args.join(" ");
  const results = await searchTemplates(query);

  if (results.length === 0) {
    console.log(`No APIs found for '${query}'.`);
    console.log("Run 'spec2cli use --list' to see all available APIs.");
    console.log("Or contribute: https://github.com/lucianfialho/spec2cli-registry\n");
    return;
  }

  console.log(`Found ${results.length} API${results.length > 1 ? "s" : ""} matching '${query}':\n`);

  const maxName = Math.max(...results.map((t) => t.name.length));
  for (const t of results) {
    const auth = t.authEnvVar ? `  (${t.authEnvVar})` : "";
    const cats = t.categories.join(", ");
    console.log(`  ${t.name.padEnd(maxName + 2)} ${t.description}${auth}`);
    console.log(`  ${"".padEnd(maxName + 2)} tags: ${cats}`);
  }

  console.log(`\nUsage: spec2cli use <name> <group> <command> [--flags]`);
}

async function printTemplateList(): Promise<void> {
  console.log("Fetching API registry...\n");

  const templates = await fetchRegistry();

  if (templates.length === 0) {
    console.log("No APIs available. Registry may be unreachable.");
    return;
  }

  console.log(`Available APIs (${templates.length}):\n`);

  const maxName = Math.max(...templates.map((t) => t.name.length));
  for (const t of templates) {
    const auth = t.authEnvVar ? `  (${t.authEnvVar})` : "";
    console.log(`  ${t.name.padEnd(maxName + 2)} ${t.description}${auth}`);
  }

  console.log(`\nUsage: spec2cli use <api> <group> <command> [--flags]`);
  console.log(`Search: spec2cli search <query>`);
  console.log(`Contribute: https://github.com/lucianfialho/spec2cli-registry`);
}
