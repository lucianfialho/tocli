# tocli

**Turn any OpenAPI spec into a CLI. No code generation, no build step.**

```bash
npx tocli --spec ./api.yaml pets list --status available
npx tocli --spec ./api.yaml pets create --name Rex --token sk-123
```

tocli reads an OpenAPI 3.x spec at runtime and dynamically generates a fully functional CLI with commands, flags, auth, and formatted output.

## Quick start

```bash
# Try it with any OpenAPI spec
npx tocli --spec https://petstore3.swagger.io/api/v3/openapi.json pets --help

# Or install globally
npm install -g tocli
```

## How it works

```
OpenAPI 3.x spec (YAML or JSON)
         │
         ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Parser          │────▶│  Commander   │────▶│  Output         │
│  (reads spec,    │     │  (dynamic    │     │  (json, pretty, │
│   extracts ops)  │     │   commands)  │     │   table, quiet) │
└─────────────────┘     └──────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │  HTTP        │
                        │  Executor    │
                        └──────────────┘
```

- Each **tag** in the spec becomes a command group (`pets`, `store`)
- Each **operation** becomes a subcommand (`list`, `create`, `get`)
- **Path params** become required flags (`--petId 123`)
- **Query params** become optional flags (`--limit 10`)
- **Request body** fields become flags (`--name Rex --tag dog`)
- **Auth** is detected from `securitySchemes`

## Usage

### Commands from spec

```bash
# List
tocli --spec api.yaml pets list
tocli --spec api.yaml pets list --status available --limit 5

# Create
tocli --spec api.yaml --token sk-123 pets create --name Rex --tag dog

# Get by ID
tocli --spec api.yaml pets get --petId 1

# Update
tocli --spec api.yaml --token sk-123 pets update --petId 1 --status sold

# Delete
tocli --spec api.yaml --token sk-123 pets delete --petId 1
```

### Output formats

```bash
tocli --spec api.yaml --output json pets list      # compact JSON (pipe-friendly)
tocli --spec api.yaml --output pretty pets list     # colorized JSON (default in TTY)
tocli --spec api.yaml --output table pets list      # aligned columns
tocli --spec api.yaml --quiet pets create --name X  # no output, just exit code
tocli --spec api.yaml --max-items 3 pets list       # limit results
```

### Authentication

```bash
# Inline flags (auto-detected from spec securitySchemes)
tocli --spec api.yaml --token sk-123 pets create --name Rex
tocli --spec api.yaml --api-key my-key store inventory

# Persistent profiles
tocli auth login --token sk-prod-key
tocli auth login --api-key staging-key --profile staging
tocli auth status
tocli auth logout
```

### Project config

```bash
# Initialize config in your project
tocli init --spec ./openapi.yaml --base-url https://api.example.com
```

Creates a `.toclirc` file:

```yaml
spec: ./openapi.yaml
baseUrl: https://api.example.com
auth:
  type: bearer
  envVar: API_TOKEN
environments:
  staging:
    baseUrl: https://staging.example.com
    auth:
      envVar: STAGING_API_TOKEN
```

Now you can skip `--spec`:

```bash
tocli pets list
tocli --env staging pets list
```

### Dynamic help

tocli generates help automatically from the spec:

```bash
tocli --spec api.yaml --help           # shows all command groups
tocli --spec api.yaml pets --help      # shows subcommands
tocli --spec api.yaml pets create --help  # shows flags with types
```

### Debug

```bash
tocli --spec api.yaml --verbose pets get --petId 1
# → GET https://api.example.com/pets/1
#   Accept: application/json
# ← 200 OK
```

## Features

- Reads OpenAPI 3.x (YAML or JSON) from local files or URLs
- Dynamic CLI generation at runtime (no code-gen, no build step)
- All output formats: json, pretty (colorized), table, quiet
- Auth: Bearer token, API key, with persistent profiles
- Project config (`.toclirc`) with multiple environments
- Verbose mode for debugging requests
- Works with `npx` (zero install)

## Development

```bash
git clone https://github.com/lucianfialho/tocli
cd tocli
npm install
npm run build
npm test
```

## License

MIT
