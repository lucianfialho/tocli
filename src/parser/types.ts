export interface OpenAPISpec {
  openapi: string;
  info: SpecInfo;
  servers?: Server[];
  paths: Record<string, PathItem>;
  tags?: Tag[];
  components?: {
    schemas?: Record<string, SchemaObject>;
    parameters?: Record<string, ParameterObject>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
  security?: SecurityRequirement[];
}

export interface SpecInfo {
  title: string;
  version: string;
  description?: string;
}

export interface Server {
  url: string;
  description?: string;
}

export interface Tag {
  name: string;
  description?: string;
}

export interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  head?: OperationObject;
  options?: OperationObject;
  parameters?: ParameterLike[];
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterLike[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  security?: SecurityRequirement[];
}

export interface ReferenceObject {
  $ref: string;
}

export type ParameterLike = ParameterObject | ReferenceObject;

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

export interface SchemaObject {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  $ref?: string;
}

export interface RequestBodyObject {
  required?: boolean;
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
}

export interface SecurityScheme {
  type: "http" | "apiKey" | "oauth2" | "openIdConnect";
  scheme?: string;
  name?: string;
  in?: "header" | "query" | "cookie";
  description?: string;
}

export type SecurityRequirement = Record<string, string[]>;

// --- Internal Representation ---

export interface Param {
  name: string;
  in: "path" | "query" | "header" | "body";
  type: string;
  required: boolean;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface Operation {
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  params: Param[];
  bodyRequired: boolean;
  security: SecurityRequirement[];
}

export interface OperationGroup {
  tag: string;
  description: string;
  operations: Operation[];
}
