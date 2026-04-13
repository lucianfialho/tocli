import type { Command } from "commander";
import { saveProfile, removeProfile, loadAuthStore, maskToken } from "./config.js";
import { parseHeaderFlag } from "./headers.js";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Save auth credentials")
    .option("--token <token>", "Bearer token")
    .option("--api-key <key>", "API key")
    .option("--header-name <name>", "Custom header name for API key", "X-API-Key")
    .option(
      "-H, --header <header>",
      'Custom header "Name: Value" (repeatable, for multi-header auth like VTEX)',
      collect,
      [] as string[]
    )
    .option("--profile <name>", "Profile name", "default")
    .action(async (opts: Record<string, unknown>) => {
      const profileName = (opts["profile"] as string) ?? "default";
      const headerArgs = (opts["header"] as string[]) ?? [];

      if (headerArgs.length > 0) {
        const headers: Record<string, string> = {};
        for (const raw of headerArgs) {
          const parsed = parseHeaderFlag(raw);
          if (!parsed) {
            console.error(`Error: invalid --header '${raw}'. Expected "Name: Value".`);
            process.exit(1);
          }
          headers[parsed.name] = parsed.value;
        }
        await saveProfile(profileName, { type: "headers", value: "", headers });
        const names = Object.keys(headers).join(", ");
        console.log(`Saved ${Object.keys(headers).length} header(s) [${names}] to profile '${profileName}'.`);
        return;
      }

      if (opts["token"]) {
        await saveProfile(profileName, { type: "bearer", value: opts["token"] as string });
        console.log(`Saved bearer token to profile '${profileName}'.`);
      } else if (opts["apiKey"]) {
        await saveProfile(profileName, {
          type: "apiKey",
          value: opts["apiKey"] as string,
          headerName: (opts["headerName"] as string) ?? "X-API-Key",
        });
        console.log(`Saved API key to profile '${profileName}'.`);
      } else {
        console.error("Error: provide --token, --api-key, or one or more --header flags");
        process.exit(1);
      }
    });

  auth
    .command("logout")
    .description("Remove saved credentials")
    .option("--profile <name>", "Profile name", "default")
    .action(async (opts: Record<string, string>) => {
      const profileName = opts["profile"] ?? "default";
      const removed = await removeProfile(profileName);
      if (removed) {
        console.log(`Removed credentials for profile '${profileName}'.`);
      } else {
        console.log(`No credentials found for profile '${profileName}'.`);
      }
    });

  auth
    .command("status")
    .description("Show current auth info")
    .option("--profile <name>", "Profile name")
    .action(async (opts: Record<string, string>) => {
      const store = await loadAuthStore();
      const profiles = Object.keys(store.profiles);

      if (profiles.length === 0) {
        console.log("No saved credentials.");
        return;
      }

      if (opts["profile"]) {
        const profile = store.profiles[opts["profile"]];
        if (!profile) {
          console.log(`No credentials for profile '${opts["profile"]}'.`);
          return;
        }
        printProfile(opts["profile"], profile);
      } else {
        for (const name of profiles) {
          printProfile(name, store.profiles[name]);
        }
      }
    });
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function printProfile(
  name: string,
  profile: { type: string; value: string; headerName?: string; headers?: Record<string, string> }
): void {
  console.log(`Profile: ${name}`);
  console.log(`  Type:   ${profile.type}`);
  if (profile.type === "headers" && profile.headers) {
    for (const [k, v] of Object.entries(profile.headers)) {
      console.log(`  ${k}: ${maskToken(v)}`);
    }
  } else {
    console.log(`  Value:  ${maskToken(profile.value)}`);
    if (profile.headerName) {
      console.log(`  Header: ${profile.headerName}`);
    }
  }
}
