# opencode-bridge

OpenAI-compatible adapter in front of an OpenCode server (its session API: one
throwaway session per request, every OpenCode tool switched off), with tool calling
emulated through a strict JSON protocol. Node >= 18, zero dependency, no change to ARTEX.

Why: OpenCode Zen serves its free models only to the OpenCode app. Called directly
with an API key they answer `429 FreeUsageLimitError` ("Free models work in OpenCode").
The bridge sends ARTEX's requests through your running OpenCode app instead.
Check that this use fits OpenCode Zen's terms for your account.

```bash
node --test          # tests against a simulated OpenCode
```

Endpoints: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions` (`stream:false` only).

## Recommended: OpenCode inside Docker (no admin rights needed)

`docker-compose.opencode.yml` runs OpenCode and the bridge next to ARTEX on the
Compose network. Nothing is published on your machine.

1. Add to `.env` (two different long random strings):

```
OPENCODE_SERVER_PASSWORD=...
OPENCODE_BRIDGE_TOKEN=...
COMPOSE_FILE=docker-compose.yml;docker-compose.windows.yml;docker-compose.opencode.yml
```

   `COMPOSE_FILE` makes every `docker compose` command use the three files
   (Windows uses `;` as separator; on Linux/macOS use `:` and drop the windows file).

2. Build and start: `docker compose up -d --build`

3. Log OpenCode in to your account, once (stored in the `opencode-data` volume):

```
docker compose run --rm -it opencode opencode auth login
```

   Pick OpenCode / OpenCode Zen and follow the prompts. If you already use
   OpenCode on this PC, you can copy its login instead:
   `docker compose cp "$env:USERPROFILE\.local\share\opencode\auth.json" opencode:/home/node/.local/share/opencode/auth.json`
   then `docker compose restart opencode`.

4. ARTEX → System → LLM → Create:

| Field | Value |
|---|---|
| Format | OpenAI (Chat Completions) |
| Base URL | `http://opencode-bridge:8789/v1` |
| API Key | the `OPENCODE_BRIDGE_TOKEN` value |
| Model | load the list, pick e.g. `opencode/deepseek-v4.1-flash-free` |
| Streaming output | **off** |
| Context window (K) | 160 |

   Test connection, Create, then "Set as active". Add a second profile and enable the
   pool: when every free model is refused, the bridge answers `402 quota exceeded`
   and ARTEX fails over.

Check: `docker compose logs opencode-bridge` shows which model served each call and
which ones are cooling down.

## OpenCode on the host instead

If OpenCode already runs on your machine and you can open a port:

```powershell
$env:OPENCODE_URL = "http://127.0.0.1:28894"
$env:BRIDGE_HOST  = "0.0.0.0"
$env:BRIDGE_TOKEN = "choose-a-long-random-string"
node bridge.mjs
```

then use `http://host.docker.internal:8789/v1` as base URL and set
`ARTEX_LLM_PRIVATE_ENDPOINTS=host.docker.internal:8789` in `.env`.

ARTEX not in Docker: keep `BRIDGE_HOST` at its default `127.0.0.1`, no token, and use
`http://127.0.0.1:8789/v1` with format "Ollama" (keyless).

## Environment variables
| Variable | Default |
|---|---|
| `BRIDGE_HOST` / `BRIDGE_PORT` | `127.0.0.1` / `8789` |
| `BRIDGE_TOKEN` | empty (required when `BRIDGE_HOST` is not loopback) |
| `OPENCODE_URL` | `http://127.0.0.1:28894` |
| `BRIDGE_AGENT` | empty (OpenCode agent to use; the Docker setup defines `bridge`) |
| `BRIDGE_STATUS_POLL_MS` | `1000` (how often quota/retry status is checked) |
| `BRIDGE_MAX_UPSTREAM_RETRIES` | `2` (OpenCode retries before a model is skipped) |
| `OPENCODE_SERVICE_JSON` | `~/.config/opencode/service.json` (Basic auth to OpenCode) |
| `OPENCODE_USERNAME` / `OPENCODE_PASSWORD` | override service.json |
| `BRIDGE_TIMEOUT_MS` | `180000` |
| `BRIDGE_CONCURRENCY` / `BRIDGE_MAX_QUEUE` | `2` / `8` |

Limits: tool calling is emulated (one tool per turn), no streaming, token usage is
estimated (chars/4). No prompt is logged.
