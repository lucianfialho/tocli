export interface AuthConfig {
  type: "bearer" | "apiKey" | "basic" | "headers" | "none";
  value: string;
  headerName?: string;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

export interface RuntimeConfig {
  specPath: string;
  baseUrl: string;
  auth: AuthConfig;
  output: string;
  maxItems?: number;
  verbose: boolean;
  quiet: boolean;
  dryRun: boolean;
  validate: boolean;
}
