import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const REGISTRY_URL = "https://api.github.com/repos/lucianfialho/spec2cli-registry/contents/apis";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export interface Template {
  name: string;
  description: string;
  categories: string[];
  specUrl: string;
  baseUrl: string;
  authType: "bearer" | "apiKey" | "none";
  authHeader?: string;
  authEnvVar: string;
  docs?: string;
}

function getCacheDir(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  return join(xdg ?? join(homedir(), ".cache"), "spec2cli");
}

function getCachePath(): string {
  return join(getCacheDir(), "registry.json");
}

async function readCache(): Promise<{ templates: Template[]; timestamp: number } | null> {
  try {
    const raw = await readFile(getCachePath(), "utf-8");
    const cached = JSON.parse(raw);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached;
    }
  } catch {
    // no cache
  }
  return null;
}

async function writeCache(templates: Template[]): Promise<void> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getCachePath(), JSON.stringify({ templates, timestamp: Date.now() }), "utf-8");
}

export async function fetchRegistry(): Promise<Template[]> {
  // Check cache first
  const cached = await readCache();
  if (cached) return cached.templates;

  try {
    // Fetch file listing from GitHub API
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch registry: ${res.status}`);
    }

    const files = (await res.json()) as Array<{ name: string; download_url: string }>;
    const jsonFiles = files.filter((f) => f.name.endsWith(".json"));

    // Fetch each template
    const templates: Template[] = [];
    for (const file of jsonFiles) {
      try {
        const templateRes = await fetch(file.download_url);
        if (templateRes.ok) {
          templates.push(await templateRes.json() as Template);
        }
      } catch {
        // skip broken entries
      }
    }

    await writeCache(templates);
    return templates;
  } catch (err) {
    // Fallback: return cached even if stale
    const stale = await readStaleCache();
    if (stale) return stale;

    console.error(`Warning: could not fetch registry (${(err as Error).message}). Using built-in defaults.`);
    return getBuiltinDefaults();
  }
}

async function readStaleCache(): Promise<Template[] | null> {
  try {
    const raw = await readFile(getCachePath(), "utf-8");
    return JSON.parse(raw).templates;
  } catch {
    return null;
  }
}

function getBuiltinDefaults(): Template[] {
  return [
    { name: "petstore", description: "Swagger Petstore — demo API", categories: ["demo"], specUrl: "https://petstore3.swagger.io/api/v3/openapi.json", baseUrl: "https://petstore3.swagger.io/api/v3", authType: "none", authEnvVar: "" },
  ];
}

export async function getAllTemplates(): Promise<Template[]> {
  const { loadLocalApis } = await import("./local.js");
  const [remote, local] = await Promise.all([fetchRegistry(), loadLocalApis()]);

  // Local overrides remote if same name
  const merged = new Map<string, Template>();
  for (const t of remote) merged.set(t.name, t);
  for (const t of local) merged.set(t.name, { ...t, _local: true } as Template & { _local: boolean });
  return [...merged.values()];
}

export async function getTemplate(name: string): Promise<Template | undefined> {
  const templates = await getAllTemplates();
  return templates.find((t) => t.name === name);
}

export async function searchTemplates(query: string): Promise<Template[]> {
  const templates = await getAllTemplates();
  const q = query.toLowerCase();
  return templates.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.categories.some((c) => c.toLowerCase().includes(q))
  );
}
