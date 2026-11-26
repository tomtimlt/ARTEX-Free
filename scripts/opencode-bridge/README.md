# opencode-bridge

OpenAI-compatible adapter in front of the OpenCode app's local server
(`POST /api/experimental/generate/text`), with tool calling emulated through a strict
JSON protocol. Node >= 18, zero dependency, no change to ARTEX.

Why: OpenCode Zen serves its free models only to the OpenCode app. Called directly
with an API key they answer `429 FreeUsageLimitError` ("Free models work in OpenCode").
The bridge sends ARTEX's requests through your running OpenCode app instead.
Check that this use fits OpenCode Zen's terms for your account.

```bash
node --test          # tests against a simulated OpenCode
```

Endpoints: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions` (`stream:false` only).

## Windows + ARTEX in Docker

1. Start the OpenCode app and note its local server port (e.g. `28894`).
2. In PowerShell, from this folder:

```powershell
$env:OPENCODE_URL = "http://127.0.0.1:28894"
$env:BRIDGE_HOST  = "0.0.0.0"
$env:BRIDGE_TOKEN = "choose-a-long-random-string"
node bridge.mjs
```

   Check it: open http://127.0.0.1:8789/health, it should show `"upstream":"ok"`.
   Windows may ask to allow Node on the network: allow private networks only.

3. In ARTEX's `.env`, so the model list can reach the bridge, then recreate the container:

```
ARTEX_LLM_PRIVATE_ENDPOINTS=host.docker.internal:8789
```

4. ARTEX → System → LLM → Create:

| Field | Value |
|---|---|
| Format | OpenAI (Chat Completions) |
| Base URL | `http://host.docker.internal:8789/v1` |
| API Key | the `BRIDGE_TOKEN` value |
| Model | load the list, pick e.g. `opencode/deepseek-v4.1-flash-free` |
| Custom session header | `x-opencode-session` |
| Streaming output | **off** |
| Context window (K) | 160 |

   Test connection, Create, then "Set as active". Add a second profile and enable the
   pool so ARTEX fails over when the free quota runs out (the bridge answers 402
   "quota exceeded" when every free model is cooling down).

ARTEX not in Docker: keep `BRIDGE_HOST` at its default `127.0.0.1`, no token, and use
`http://127.0.0.1:8789/v1` with format "Ollama" (keyless).

## Environment variables
| Variable | Default |
|---|---|
| `BRIDGE_HOST` / `BRIDGE_PORT` | `127.0.0.1` / `8789` |
| `BRIDGE_TOKEN` | empty (required when `BRIDGE_HOST` is not loopback) |
| `OPENCODE_URL` | `http://127.0.0.1:28894` |
| `OPENCODE_SERVICE_JSON` | `~/.config/opencode/service.json` (Basic auth to OpenCode) |
| `OPENCODE_USERNAME` / `OPENCODE_PASSWORD` | override service.json |
| `BRIDGE_TIMEOUT_MS` | `180000` |
| `BRIDGE_CONCURRENCY` / `BRIDGE_MAX_QUEUE` | `2` / `8` |

Limits: tool calling is emulated (one tool per turn), no streaming, token usage is
estimated (chars/4). No prompt is logged.
