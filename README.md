# MCP-C

**Context-efficient CLI protocol for AI agents.**

MCP-C sits in the same family as [MCP](https://modelcontextprotocol.io/) (AI ↔ Tools) and [MCP-B](https://github.com/nichochar/mcp-b) (AI ↔ Browser):

- **MCP** — AI ↔ Tools
- **MCP-B** — AI ↔ Browser
- **MCP-C** — AI ↔ CLI

## The problem

MCP has a structural scaling issue: **the more tools you connect, the worse the AI gets.**

The GitHub MCP server loads **24,207 tokens** (82 tool definitions) into context before the agent does anything. Connect 5 servers and you burn **121,000+ tokens** — up to 30% of the working memory — just on tool descriptions.

Research shows that with 50+ tools loaded, task completion drops to **60% accuracy**. With 5-7 focused tools, it rises to **92%** ([Jenova AI](https://www.jenova.ai/en/resources/mcp-tool-scalability-problem)).

The alternatives today:

| Approach | Structured | Token-efficient |
|---|---|---|
| MCP | Yes | No (24K+ tokens idle) |
| CLI (`--help`) | No (free text) | Yes (~200 tokens) |
| **MCP-C** | **Yes** | **Yes (~558 tokens)** |

## How it works

MCP-C uses **progressive discovery** — the agent only loads what it needs, when it needs it.

### Phase 1: Manifest (~558 tokens)

```bash
$ mcp-c --spec api.yaml --discover
```
```json
{
  "name": "petstore",
  "version": "1.0.0",
  "description": "A sample API that uses a petstore as an example",
  "groups": [
    { "name": "pets", "description": "Manage pets", "commands": 5 },
    { "name": "store", "description": "Store operations", "commands": 3 }
  ],
  "_meta": { "protocol": "mcp-c/1", "total_commands": 8 }
}
```

### Phase 2: Group detail (~274 tokens, on demand)

```bash
$ mcp-c --spec api.yaml --discover pets
```
```json
{
  "group": "pets",
  "commands": [
    { "name": "list", "description": "List all pets", "method": "GET", "hint": "read-only" },
    { "name": "create", "description": "Create a pet", "method": "POST", "hint": "write" },
    { "name": "get", "description": "Get a pet by ID", "method": "GET", "hint": "read-only", "args": ["petId"] },
    { "name": "update", "description": "Update a pet", "method": "PUT", "hint": "write", "args": ["petId"] },
    { "name": "delete", "description": "Delete a pet", "method": "DELETE", "hint": "destructive", "args": ["petId"] }
  ]
}
```

### Phase 3: Command schema (only when needed)

```bash
$ mcp-c --spec api.yaml --discover pets create
```
```json
{
  "command": "pets.create",
  "description": "Create a pet",
  "params": [
    { "name": "name", "type": "string", "required": true, "description": "Pet name" },
    { "name": "tag", "type": "string", "required": false, "description": "Pet tag" },
    { "name": "status", "type": "enum", "required": false, "enum": ["available", "pending", "sold"], "default": "available" }
  ],
  "auth": { "required": true, "scheme": "bearer" }
}
```

The agent never loads all schemas at once. Total cost for a single operation: **~1,140 tokens** (manifest + group + invocation + response).

## Benchmark

All 82 tool definitions from the [GitHub MCP server](https://github.com/github/github-mcp-server) measured with tiktoken. No extrapolation.

| Scenario | MCP | MCP + Deferred | CLI | MCP-C | MCP / MCP-C |
|---|---|---|---|---|---|
| Connection (idle) | 24,207 | 2,552 | 203 | **558** | 43x |
| Single operation | 24,977 | 3,791 | 1,424 | **1,140** | 22x |
| 3-step workflow | 25,595 | 5,007 | 2,347 | **2,224** | 12x |
| 5 APIs connected | 121,805 | 13,999 | 1,424 | **3,372** | 36x |

**Monthly cost** (10K operations, Claude Sonnet 4 pricing):

| MCP | MCP + Deferred | CLI | MCP-C |
|---|---|---|---|
| $834 | $198 | $127 | **$69** |

MCP-C's output envelope format (`summary` + truncated `data` + `_meta`) saves 2.5x on output tokens compared to raw API JSON.

> Run `npm run test:bench` to reproduce these numbers.

## Quick start

```bash
# Try it without installing
npx mcp-c --spec https://petstore3.swagger.io/api/v3/openapi.json --discover

# Or install globally
npm install -g mcp-c
```

### Run commands from any OpenAPI spec

```bash
# Discovery
mcp-c --spec api.yaml --discover              # manifest
mcp-c --spec api.yaml --discover pets          # group detail
mcp-c --spec api.yaml --discover pets create   # command schema

# Execution
mcp-c --spec api.yaml pets list --limit 10
mcp-c --spec api.yaml pets create --name Rex --token sk-123

# Output formats
mcp-c --spec api.yaml pets list --output json       # compact JSON
mcp-c --spec api.yaml pets list --output envelope   # summary + data + _meta
mcp-c --spec api.yaml pets list --output table      # aligned columns
mcp-c --spec api.yaml pets list --output envelope --max-items 3  # truncated
```

### Authentication

```bash
# Inline flags
mcp-c --spec api.yaml --token sk-123 pets list
mcp-c --spec api.yaml --api-key my-key store inventory

# Persistent profiles
mcp-c auth login --token sk-prod-key
mcp-c auth login --api-key staging-key --profile staging
mcp-c auth status
mcp-c auth logout
```

### Project config

```bash
# Initialize config in your project
mcp-c init --spec ./openapi.yaml --base-url https://api.example.com

# Now you can skip --spec
mcp-c pets list
mcp-c --env staging pets list   # use staging environment
```

The `.mcp-crc` file:

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

## Architecture

```
OpenAPI 3.x spec
       │
       ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Parser     │────▶│  Discovery   │────▶│  JSON to stdout │
│ (loader +    │     │ (manifest,   │     │  (progressive)  │
│  extractor)  │     │  group,      │     │                 │
│              │     │  schema)     │     └─────────────────┘
└─────────────┘     └──────────────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Commander   │────▶│  HTTP        │────▶│  Output         │
│  (dynamic    │     │  Executor    │     │  (json, pretty, │
│   commands)  │     │              │     │   envelope,     │
│              │     │              │     │   table, quiet) │
└─────────────┘     └──────────────┘     └─────────────────┘
```

## Development

```bash
git clone https://github.com/lucianfialho/mcp-c
cd mcp-c
npm install
npm run build
npm test          # 74 unit tests + benchmark
npm run test:unit # just vitest
npm run test:bench # just benchmark
```

## What MCP-C is NOT

- **Not a replacement for MCP.** MCP is better for resources, prompts, and sampling. MCP-C is specifically for CLI interactions.
- **Not a code generator.** It reads specs at runtime and builds commands dynamically.
- **Not limited to REST.** The protocol (progressive discovery + output envelope) can wrap any CLI. The OpenAPI runtime is the first implementation.

## Roadmap

- [ ] Bridge: wrap existing CLIs (`mcp-c bridge gh`) without rewriting them
- [ ] Shell completions (bash/zsh/fish) from discovery schema
- [ ] MCP server mode (dual protocol: speak MCP-C natively, expose as MCP for compatibility)
- [ ] Formal protocol spec (TypeScript-first, like MCP)
- [ ] Pagination detection and `--all` flag

## License

MIT
