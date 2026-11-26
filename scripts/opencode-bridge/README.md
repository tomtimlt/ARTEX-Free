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

Endpoints: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions`.

What ARTEX gets, like from any OpenAI-compatible provider:

- streaming or not (`stream:true` is replayed as regular SSE chunks, with the usage
  frame when `stream_options.include_usage` is set), so the profile keeps its defaults;
- one or several tool calls per reply (`tool_calls` with indexes, optional text next
  to them), `finish_reason` `tool_calls` / `stop`, `tool_choice` honoured
  (`none`, `required`, a named function);
- arguments checked and coerced to the tool schema (`"443"` → `443`);
- plain-text replies for turns without tools (summaries, goal decomposition);
- real token counts when OpenCode reports them (cached tokens included), else an estimate.

## Recommended: OpenCode inside Docker (no admin rights needed)

`docker-compose.opencode.yml` runs OpenCode and the bridge next to ARTEX on the
Compose network. Nothing is published on your machine.

1. Add to `.env` at the root of the project (next to `docker-compose.yml`):

```
OPENCODE_ZEN_API_KEY=your-opencode-zen-api-key
OPENCODE_SERVER_PASSWORD=a-long-random-string
OPENCODE_BRIDGE_TOKEN=another-long-random-string
COMPOSE_FILE=docker-compose.yml;docker-compose.windows.yml;docker-compose.opencode.yml
```

   `COMPOSE_FILE` makes every `docker compose` command load the three files; without
   it Compose answers `no such service: opencode`. Windows uses `;` as separator; on
   Linux/macOS use `:` and drop the windows file. The Zen key stays inside the
   OpenCode container: ARTEX only ever sees `OPENCODE_BRIDGE_TOKEN`.

2. From the project root: `docker compose up -d --build`, then
   `docker compose ps` should list `opencode` and `opencode-bridge` as running.

3. Which credential? Zen serves its free models to an OpenCode **account login**.
   Older Zen API keys show up as "Legacy" in the Zen usage page and get
   `429 RateLimit.Free` on free models, even through OpenCode. If yours is one of
   them, leave `OPENCODE_ZEN_API_KEY` empty and log the container in to your
   account once (device code: it prints a link and a code to enter in your browser):

```
docker compose exec -it opencode opencode console login
docker compose exec opencode rm -f /home/node/.local/share/opencode/auth.json
docker compose restart opencode opencode-bridge
```

   The login is kept in the `opencode-data` volume (OpenCode's database). Removing
   `auth.json` makes sure no stored API key takes precedence over the account.
   Restarting the bridge also clears the cooldowns it keeps for refused models.

4. ARTEX → System → LLM → Create:

| Field | Value |
|---|---|
| Format | OpenAI (Chat Completions) |
| Base URL | `http://opencode-bridge:8789/v1` |
| API Key | the `OPENCODE_BRIDGE_TOKEN` value |
| Model | load the list, pick e.g. `opencode/deepseek-v4.1-flash-free` |
| Streaming output | on or off (both work) |
| Context window (K) | 160 |

   Test connection, Create, then "Set as active". Add a second profile and enable the
   pool: when every free model is refused, the bridge answers `402 quota exceeded`
   and ARTEX fails over.

Check: `docker compose logs opencode-bridge` shows which model served each call and
which ones are cooling down.

## Use the OpenCode desktop app as the upstream

OpenCode 1.19.x (the container) signs Zen calls with an API key only; without one it
calls anonymously, and the anonymous free tier is limited per IP (shared office IPs
run out fast). The desktop app signs them with your account. To use the app, keep
the bridge in Docker and point it at the app's local server:

1. Check the container can reach the app (replace 28894 by the app's port):

```
docker compose exec opencode-bridge node -e "fetch('http://host.docker.internal:28894/api/model?types=chat').then(r=>console.log('HTTP',r.status)).catch(e=>console.log('KO',e.cause?.code||e.message))"
```

   `HTTP 200` or `HTTP 401` means reachable; `KO ECONNREFUSED` means it is not.

2. In `.env` (user/password: the app's server credentials, e.g. from
   `~/.config/opencode/service.json`):

```
OPENCODE_BRIDGE_UPSTREAM=http://host.docker.internal:28894
OPENCODE_BRIDGE_UPSTREAM_USER=...
OPENCODE_BRIDGE_UPSTREAM_PASSWORD=...
OPENCODE_BRIDGE_AGENT=
```

3. `docker compose up -d`, then test the ARTEX profile again. The app must be running.

The bridge detects the app's OpenCode 2.x API (`/api/session`) and, for each request,
creates a session with a deny-all permission ruleset, asks for text with
`/api/session/{id}/generate` (no agent loop, no tool), and only if Zen refuses that
path runs a regular prompt turn while rejecting every permission the agent asks for
(shell, files, web). The session is deleted afterwards. The bridge logs which path
answered and every rejected permission request.

## Bridge on the host instead

If you can open a port on your machine:

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

Limits: tool calling is emulated through a JSON protocol (up to 4 parallel calls,
`BRIDGE_MAX_PARALLEL_CALLS`); the stream is replayed once the reply is complete, so
there is no token-by-token progress. No prompt is logged.
