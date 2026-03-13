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

<details>
<summary><strong>Full benchmark output</strong> (click to expand)</summary>

```
═══════════════════════════════════════════════════════════════════════════
  BENCHMARK v3: MCP vs MCP+Deferred vs CLI vs mcp-c
  All 82 GitHub MCP server tools measured (no extrapolation)
═══════════════════════════════════════════════════════════════════════════

  DATA SOURCES:
    MCP tools:              82 definitions from github/github-mcp-server source
    MCP total tokens:       24,207 (measured, not extrapolated)
    MCP avg/tool:           295 tokens
    MCP min:                95 tokens (get_me)
    MCP max:                1413 tokens (actions_list)
    MCP median:             243 tokens (get_discussion_comments)
    MCP+Deferred index:     2552 tokens (real names + 1st sentence)
    CLI:                    gh v2.83.1 (real --help output)
    Tokenizer:              tiktoken gpt-4o (proxy for Claude)

┌─────────────────────────────────────────────────────────────────────────┐
│  BASELINE: Connection cost (tokens loaded before any operation)         │
└─────────────────────────────────────────────────────────────────────────┘

  MCP (all 82 tools):          24,207 tokens
  MCP + Deferred (index):      2,552 tokens
  CLI naive (gh --help):       203 tokens
  CLI expert (knows gh):       0 tokens
  mcp-c (manifest):            558 tokens

  Ratios vs mcp-c:
    MCP:             43x
    MCP+Deferred:    4.6x
    CLI naive:       0.4x
    CLI expert:      0x (no connection cost)

┌─────────────────────────────────────────────────────────────────────────┐
│  S1: "List open issues labeled bug in repo X"                          │
└─────────────────────────────────────────────────────────────────────────┘

  MCP:
    Discovery (82 tools)             24207 tokens
    Invocation                          66 tokens
    ─ INPUT TOTAL                    24273 tokens
    ─ OUTPUT TOTAL                     704 tokens
    ═ COMBINED                       24977 tokens

  MCP + Deferred:
    Index                             2552 tokens
    Schema on demand (1)               469 tokens
    Invocation                          66 tokens
    ─ INPUT TOTAL                     3087 tokens
    ─ OUTPUT TOTAL                     704 tokens
    ═ COMBINED                        3791 tokens

  CLI naive (reads help):
    Root help                          203 tokens
    Group help                         116 tokens
    Command help                       386 tokens
    Invocation                          15 tokens
    ─ INPUT TOTAL                      720 tokens
    ─ OUTPUT TOTAL                     704 tokens
    ═ COMBINED                        1424 tokens

  CLI expert (knows gh):
    Invocation only                     15 tokens
    ─ INPUT TOTAL                       15 tokens
    ─ OUTPUT TOTAL                     704 tokens
    ═ COMBINED                         719 tokens

  mcp-c:
    Manifest (phase 1)                 558 tokens
    Group detail (phase 2)             274 tokens
    Invocation                          17 tokens
    ─ INPUT TOTAL                      849 tokens
    ─ OUTPUT TOTAL                     291 tokens
    ═ COMBINED                        1140 tokens

  Ratios vs mcp-c (combined):
    MCP                       21.9x
    MCP + Deferred            3.3x
    CLI naive (reads help)    1.2x
    CLI expert (knows gh)     0.6x

┌─────────────────────────────────────────────────────────────────────────┐
│  S2: "Create issue with title and label"                               │
└─────────────────────────────────────────────────────────────────────────┘

  MCP:
    Discovery (82 tools)             24207 tokens
    Invocation                          90 tokens
    ─ INPUT TOTAL                    24297 tokens
    ─ OUTPUT TOTAL                      58 tokens
    ═ COMBINED                       24355 tokens

  MCP + Deferred:
    Index                             2552 tokens
    Schema on demand (1)               578 tokens
    Invocation                          90 tokens
    ─ INPUT TOTAL                     3220 tokens
    ─ OUTPUT TOTAL                      58 tokens
    ═ COMBINED                        3278 tokens

  CLI naive (reads help):
    Root + group help                  319 tokens
    Command help                       282 tokens
    Invocation                          31 tokens
    ─ INPUT TOTAL                      632 tokens
    ─ OUTPUT TOTAL                      58 tokens
    ═ COMBINED                         690 tokens

  CLI expert (knows gh):
    Invocation only                     31 tokens
    ─ INPUT TOTAL                       31 tokens
    ─ OUTPUT TOTAL                      58 tokens
    ═ COMBINED                          89 tokens

  mcp-c:
    Manifest (phase 1)                 558 tokens
    Group (phase 2)                    274 tokens
    Schema (phase 3)                   307 tokens
    Invocation                          35 tokens
    ─ INPUT TOTAL                     1174 tokens
    ─ OUTPUT TOTAL                      49 tokens
    ═ COMBINED                        1223 tokens

  Ratios vs mcp-c (combined):
    MCP                       19.9x
    MCP + Deferred            2.7x
    CLI naive (reads help)    0.6x
    CLI expert (knows gh)     0.1x

┌─────────────────────────────────────────────────────────────────────────┐
│  S3: "List bugs, get first, add comment" (3 steps)                     │
└─────────────────────────────────────────────────────────────────────────┘

  MCP:
    Discovery (82 tools)             24207 tokens
    3 invocations                      196 tokens
    ─ INPUT TOTAL                    24403 tokens
    ─ OUTPUT TOTAL                    1192 tokens
    ═ COMBINED                       25595 tokens

  MCP + Deferred:
    Index                             2552 tokens
    3 schemas on demand               1067 tokens
    3 invocations                      196 tokens
    ─ INPUT TOTAL                     3815 tokens
    ─ OUTPUT TOTAL                    1192 tokens
    ═ COMBINED                        5007 tokens

  CLI naive (reads help):
    Root + group help                  319 tokens
    3 command helps                    789 tokens
    3 invocations                       47 tokens
    ─ INPUT TOTAL                     1155 tokens
    ─ OUTPUT TOTAL                    1192 tokens
    ═ COMBINED                        2347 tokens

  CLI expert (knows gh):
    3 invocations only                  47 tokens
    ─ INPUT TOTAL                       47 tokens
    ─ OUTPUT TOTAL                    1192 tokens
    ═ COMBINED                        1239 tokens

  mcp-c:
    Manifest + group                   832 tokens
    3 schemas on demand                829 tokens
    3 invocations                       61 tokens
    ─ INPUT TOTAL                     1722 tokens
    ─ OUTPUT TOTAL                     502 tokens
    ═ COMBINED                        2224 tokens

  Ratios vs mcp-c (combined):
    MCP                       11.5x
    MCP + Deferred            2.3x
    CLI naive (reads help)    1.1x
    CLI expert (knows gh)     0.6x

┌─────────────────────────────────────────────────────────────────────────┐
│  S4: 5 APIs connected, use only 1 command                              │
└─────────────────────────────────────────────────────────────────────────┘

  MCP:
    Idle (5 × 82 tools)             121035 tokens
    1 invocation                        66 tokens
    ─ INPUT TOTAL                   121101 tokens
    ─ OUTPUT TOTAL                     704 tokens
    ═ COMBINED                      121805 tokens

  MCP + Deferred:
    Idle (5 × index)                 12760 tokens
    1 schema on demand                 469 tokens
    1 invocation                        66 tokens
    ─ INPUT TOTAL                    13295 tokens
    ─ OUTPUT TOTAL                     704 tokens
    ═ COMBINED                       13999 tokens

  CLI naive (reads help):
    Root + group + cmd help            705 tokens
    1 invocation                        15 tokens
    ─ INPUT TOTAL                      720 tokens
    ─ OUTPUT TOTAL                     704 tokens
    ═ COMBINED                        1424 tokens

  CLI expert (knows gh):
    1 invocation only                   15 tokens
    ─ INPUT TOTAL                       15 tokens
    ─ OUTPUT TOTAL                     704 tokens
    ═ COMBINED                         719 tokens

  mcp-c:
    Idle (5 manifests)                2790 tokens
    Group + invocation                 291 tokens
    ─ INPUT TOTAL                     3081 tokens
    ─ OUTPUT TOTAL                     291 tokens
    ═ COMBINED                        3372 tokens

  Ratios vs mcp-c (combined):
    MCP                       36.1x
    MCP + Deferred            4.2x
    CLI naive (reads help)    0.4x
    CLI expert (knows gh)     0.2x

┌─────────────────────────────────────────────────────────────────────────┐
│  COST: Monthly estimate (10,000 operations, S1 as baseline)            │
└─────────────────────────────────────────────────────────────────────────┘

  Pricing: $3/M input, $15/M output (Claude Sonnet 4)

  MCP:              $833.79/month
  MCP + Deferred:   $198.21/month
  CLI naive:        $127.20/month
  CLI expert:       $106.05/month
  mcp-c:            $69.12/month

═══════════════════════════════════════════════════════════════════════════
  SUMMARY
═══════════════════════════════════════════════════════════════════════════

  (combined: input + output tokens)

  Scenario              │     MCP    │  MCP+Def  │ CLI naive │ CLI expert│   mcp-c   │ MCP/mcp-c │ Def/mcp-c
  ──────────────────────┼────────────┼───────────┼───────────┼───────────┼───────────┼───────────┼──────────
  Connection             │    24207   │    2552   │     203   │       0   │     558   │    43.4x  │     4.6x
  S1: List issues        │    24977   │    3791   │    1424   │     719   │    1140   │    21.9x  │     3.3x
  S3: 3-step workflow    │    25595   │    5007   │    2347   │    1239   │    2224   │    11.5x  │     2.3x
  S4: 5 APIs, use 1      │   121805   │   13999   │    1424   │     719   │    3372   │    36.1x  │     4.2x

  KEY CAVEATS:
  1. MCP tokens are MEASURED (82 real tools), not extrapolated
  2. MCP+Deferred index uses REAL tool names + first-sentence descriptions
  3. CLI expert = agent knows gh from training (0 discovery cost) — best case for CLI
  4. CLI naive = agent reads help like any unknown CLI — realistic for new CLIs
  5. mcp-c output uses envelope format (summary + truncated data) — designed by us
  6. MCP/CLI output is same raw JSON — mcp-c envelope saves output tokens
  7. Tokenizer is gpt-4o (Claude may differ in absolute counts, ratios should hold)
  8. Does NOT measure accuracy (whether agent picks the right command)

  APPENDIX: Token distribution across 82 MCP tools

    Smallest:  get_me (95 tokens)
    25th pct:  manage_notification_subscription (173 tokens)
    Median:    get_discussion_comments (243 tokens)
    75th pct:  update_pull_request (371 tokens)
    Largest:   actions_list (1413 tokens)
    Total:     24,207 tokens across 82 tools
```

</details>

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
