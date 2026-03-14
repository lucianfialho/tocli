import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Template } from "./registry.js";

function getLocalRegistryDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  return join(xdg ?? join(homedir(), ".config"), "spec2cli");
}

function getLocalRegistryPath(): string {
  return join(getLocalRegistryDir(), "apis.json");
}

export async function loadLocalApis(): Promise<Template[]> {
  try {
    const raw = await readFile(getLocalRegistryPath(), "utf-8");
    return JSON.parse(raw) as Template[];
  } catch {
    return [];
  }
}

async function saveLocalApis(apis: Template[]): Promise<void> {
  const dir = getLocalRegistryDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getLocalRegistryPath(), JSON.stringify(apis, null, 2), "utf-8");
}

export async function addLocalApi(template: Template): Promise<void> {
  const apis = await loadLocalApis();
  const existing = apis.findIndex((a) => a.name === template.name);
  if (existing !== -1) {
    apis[existing] = template;
  } else {
    apis.push(template);
  }
  await saveLocalApis(apis);
}

export async function removeLocalApi(name: string): Promise<boolean> {
  const apis = await loadLocalApis();
  const idx = apis.findIndex((a) => a.name === name);
  if (idx === -1) return false;
  apis.splice(idx, 1);
  await saveLocalApis(apis);
  return true;
}
