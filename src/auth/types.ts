export interface AuthConfig {
  type: "bearer" | "apiKey" | "basic" | "headers" | "none";
  value: string;
  headerName?: string;
  headers?: Record<string, string>;
}

export interface AuthProfile {
  type: AuthConfig["type"];
  value: string;
  headerName?: string;
  headers?: Record<string, string>;
}

export interface AuthStore {
  profiles: Record<string, AuthProfile>;
}
