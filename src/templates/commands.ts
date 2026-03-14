import type { Command } from "commander";
import { execSync } from "node:child_process";
import { fetchRegistry, getAllTemplates, getTemplate, searchTemplates } from "./registry.js";
import { addLocalApi, removeLocalApi, loadLocalApis } from "./local.js";

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

    if (args[0] === "add") {
      handleAdd(args.slice(1));
      return program;
    }

    if (args[0] === "remove") {
      handleRemove(args.slice(1));
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

async function handleAdd(args: string[]): Promise<void> {
  const fromUrl = getFlagValue(args, "--from");

  // Mode 1: Import from remote registry URL
  // spec2cli add --from https://mycompany.com/apis.json
  if (fromUrl) {
    await addFromRemoteRegistry(fromUrl);
    return;
  }

  const name = args[0];
  if (!name || name.startsWith("--")) {
    console.error("Usage:");
    console.error("  spec2cli add <name> --spec <path-or-url> [--base-url <url>] [--auth-type bearer] [--auth-env VAR]");
    console.error("  spec2cli add --from <registry-url>    Import APIs from a remote registry JSON\n");
    console.error("Examples:");
    console.error("  spec2cli add myapi --spec https://api.example.com/openapi.json --base-url https://api.example.com");
    console.error("  spec2cli add myapi --spec ./openapi.yaml --base-url http://localhost:3000");
    console.error("  spec2cli add --from https://mycompany.com/apis.json\n");
    process.exit(1);
  }

  const specSource = getFlagValue(args, "--spec");
  if (!specSource) {
    console.error("Error: --spec is required.\n");
    console.error("  spec2cli add <name> --spec <path-or-url> [--base-url <url>]");
    process.exit(1);
  }

  // Resolve local file to absolute path
  const { resolve } = await import("node:path");
  const isUrl = specSource.startsWith("http://") || specSource.startsWith("https://");
  const specValue = isUrl ? specSource : resolve(specSource);

  const baseUrl = getFlagValue(args, "--base-url");

  await addLocalApi({
    name,
    description: getFlagValue(args, "--description") ?? `Custom API: ${name}`,
    categories: ["custom"],
    specUrl: specValue,
    baseUrl: baseUrl ?? (isUrl ? specSource.replace(/\/openapi\.(json|yaml)$/, "") : "http://localhost:3000"),
    authType: (getFlagValue(args, "--auth-type") ?? "none") as "bearer" | "apiKey" | "none",
    authEnvVar: getFlagValue(args, "--auth-env") ?? "",
  });

  console.log(`Added '${name}' to local registry.`);
  console.log(`Use it: spec2cli use ${name} --help\n`);
}

async function addFromRemoteRegistry(url: string): Promise<void> {
  console.log(`Fetching registry from ${url}...`);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch: ${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const data = await res.json();
    const apis = Array.isArray(data) ? data : data.apis ?? [];

    if (apis.length === 0) {
      console.error("No APIs found in the registry.");
      process.exit(1);
    }

    let added = 0;
    for (const api of apis) {
      if (api.name && api.specUrl) {
        await addLocalApi({
          name: api.name,
          description: api.description ?? `Imported: ${api.name}`,
          categories: api.categories ?? ["imported"],
          specUrl: api.specUrl,
          baseUrl: api.baseUrl ?? "",
          authType: api.authType ?? "none",
          authEnvVar: api.authEnvVar ?? "",
          docs: api.docs,
        });
        added++;
        console.log(`  + ${api.name}`);
      }
    }

    console.log(`\nImported ${added} API${added !== 1 ? "s" : ""} from registry.`);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function handleRemove(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error("Usage: spec2cli remove <name>");
    process.exit(1);
  }

  const removed = await removeLocalApi(name);
  if (removed) {
    console.log(`Removed '${name}' from local registry.`);
  } else {
    console.error(`'${name}' not found in local registry. Only custom APIs can be removed.`);
    process.exit(1);
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

async function printTemplateList(): Promise<void> {
  console.log("Fetching API registry...\n");

  const templates = await getAllTemplates();
  const localApis = await loadLocalApis();
  const localNames = new Set(localApis.map((a) => a.name));

  if (templates.length === 0) {
    console.log("No APIs available. Registry may be unreachable.");
    return;
  }

  console.log(`Available APIs (${templates.length}):\n`);

  const maxName = Math.max(...templates.map((t) => t.name.length));
  for (const t of templates) {
    const auth = t.authEnvVar ? `  (${t.authEnvVar})` : "";
    const local = localNames.has(t.name) ? " [local]" : "";
    console.log(`  ${t.name.padEnd(maxName + 2)} ${t.description}${auth}${local}`);
  }

  console.log(`\nUsage: spec2cli use <api> <group> <command> [--flags]`);
  console.log(`Search: spec2cli search <query>`);
  console.log(`Add your own: spec2cli add <name> --spec <url> --base-url <url>`);
  console.log(`Contribute: https://github.com/lucianfialho/spec2cli-registry`);
}
