import type {
  OpenAPISpec,
  OperationGroup,
  Operation,
  Param,
  OperationObject,
  ParameterLike,
  ParameterObject,
  SchemaObject,
  SecurityRequirement,
} from "./types.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export function extractOperations(spec: OpenAPISpec): OperationGroup[] {
  const groupMap = new Map<string, Operation[]>();

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    // Path-level parameters apply to all methods
    const pathParams = pathItem.parameters ?? [];

    for (const method of HTTP_METHODS) {
      const op = pathItem[method] as OperationObject | undefined;
      if (!op) continue;

      const tag = op.tags?.[0] ?? "default";
      const id = resolveOperationId(op.operationId, method, path);
      const params = extractParams(op, pathParams, spec);
      const security = op.security ?? spec.security ?? [];

      const operation: Operation = {
        id,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? "",
        description: op.description ?? op.summary ?? "",
        params,
        bodyRequired: op.requestBody?.required ?? false,
        security,
      };

      if (!groupMap.has(tag)) {
        groupMap.set(tag, []);
      }
      groupMap.get(tag)!.push(operation);
    }
  }

  const tagDescriptions = new Map<string, string>();
  for (const tag of spec.tags ?? []) {
    tagDescriptions.set(tag.name, tag.description ?? "");
  }

  const groups: OperationGroup[] = [];
  for (const [tag, operations] of groupMap) {
    groups.push({
      tag,
      description: tagDescriptions.get(tag) ?? `Manage ${tag}`,
      operations,
    });
  }

  return groups;
}

function resolveOperationId(operationId: string | undefined, method: string, path: string): string {
  if (!operationId || operationId.includes("/") || operationId.includes("{")) {
    return generateOperationId(method, path);
  }
  return operationId;
}

function generateOperationId(method: string, path: string): string {
  // /pets/{petId}/toys → getPetToy (for GET)
  const segments = path
    .split("/")
    .filter((s) => s && !s.startsWith("{"))
    .map((s) => s.replace(/[^a-zA-Z0-9]/g, ""));

  if (segments.length === 0) return method;

  const resource = segments[segments.length - 1];
  // Singularize: crude but works for common cases
  const singular = resource.endsWith("s") ? resource.slice(0, -1) : resource;

  switch (method) {
    case "get":
      // If path ends with a param like /pets/{id}, it's a get-one
      if (path.endsWith("}")) return `get${capitalize(singular)}`;
      return `list${capitalize(resource)}`;
    case "post":
      return `create${capitalize(singular)}`;
    case "put":
    case "patch":
      return `update${capitalize(singular)}`;
    case "delete":
      return `delete${capitalize(singular)}`;
    default:
      return `${method}${capitalize(resource)}`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractParams(
  op: OperationObject,
  pathLevelParams: ParameterLike[],
  spec: OpenAPISpec
): Param[] {
  const params: Param[] = [];
  const seenLocations = new Set<string>();
  const seenNames = new Set<string>();

  // Operation-level params override path-level
  for (const rawParam of op.parameters ?? []) {
    const p = resolveParameter(rawParam, spec);
    if (!p) continue;
    const key = `${p.in}:${p.name}`;
    if (seenLocations.has(key) || seenNames.has(p.name)) continue;
    seenLocations.add(key);
    seenNames.add(p.name);
    params.push(paramFromSpec(p));
  }

  // Add path-level params not overridden
  for (const rawParam of pathLevelParams) {
    const p = resolveParameter(rawParam, spec);
    if (!p) continue;
    if (!seenLocations.has(`${p.in}:${p.name}`) && !seenNames.has(p.name)) {
      params.push(paramFromSpec(p));
      seenLocations.add(`${p.in}:${p.name}`);
      seenNames.add(p.name);
    }
  }

  // Extract body params
  if (op.requestBody?.content) {
    const jsonContent = op.requestBody.content["application/json"];
    if (jsonContent?.schema) {
      const schema = resolveSchema(jsonContent.schema, spec);
      if (schema.properties) {
        const requiredFields = schema.required ?? [];
        for (const [name, prop] of Object.entries(schema.properties)) {
          if (seenNames.has(name)) continue;
          seenLocations.add(`body:${name}`);
          seenNames.add(name);
          const resolved = resolveSchema(prop, spec);
          params.push({
            name,
            in: "body",
            type: schemaToType(resolved),
            required: requiredFields.includes(name),
            description: resolved.description ?? "",
            enum: resolved.enum,
            default: resolved.default,
          });
        }
      }
    }
  }

  return params;
}

function resolveParameter(param: ParameterLike, spec: OpenAPISpec): ParameterObject | undefined {
  if ("$ref" in param) {
    const resolved = resolveRef<ParameterObject>(param.$ref, spec);
    return isParameterObject(resolved) ? resolved : undefined;
  }

  return isParameterObject(param) ? param : undefined;
}

function isParameterObject(value: unknown): value is ParameterObject {
  const param = value as Partial<ParameterObject> | undefined;
  return typeof param?.name === "string" && typeof param?.in === "string";
}

function paramFromSpec(p: ParameterObject): Param {
  const schema = p.schema ?? {};
  return {
    name: p.name,
    in: p.in as Param["in"],
    type: schemaToType(schema),
    required: p.required ?? p.in === "path",
    description: p.description ?? schema.description ?? "",
    enum: schema.enum,
    default: schema.default,
  };
}

function schemaToType(schema: SchemaObject): string {
  if (schema.enum) return "enum";
  if (schema.type === "array") {
    const itemType = schema.items ? schemaToType(schema.items) : "string";
    return `${itemType}[]`;
  }
  return schema.type ?? "string";
}

function resolveSchema(schema: SchemaObject, spec: OpenAPISpec): SchemaObject {
  if (schema.$ref) {
    return resolveRef<SchemaObject>(schema.$ref, spec) ?? schema;
  }
  return schema;
}

function resolveRef<T>(ref: string, spec: OpenAPISpec): T | undefined {
  if (!ref.startsWith("#/")) return undefined;

  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let resolved: unknown = spec;
  for (const part of parts) {
    if (resolved === null || typeof resolved !== "object") return undefined;
    resolved = (resolved as Record<string, unknown>)[part];
  }
  return resolved as T | undefined;
}
