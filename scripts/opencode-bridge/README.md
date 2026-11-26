# opencode-bridge

Adaptateur OpenAI-compatible devant OpenCode (`POST /api/experimental/generate/text`),
avec tool calling émulé par protocole JSON strict. Node >= 18, zéro dépendance, aucun
changement du code ARTEX.

```bash
node bridge.mjs              # écoute 127.0.0.1:8789
node --test                  # tests contre un OpenCode simulé
```

Endpoints : `GET /health`, `GET /v1/models`, `POST /v1/chat/completions` (`stream:false` uniquement).

## Variables d'environnement
| Variable | Défaut |
|---|---|
| `BRIDGE_HOST` / `BRIDGE_PORT` | `127.0.0.1` / `8789` |
| `BRIDGE_TOKEN` | vide (Bearer requis si défini ; obligatoire si bind 0.0.0.0) |
| `OPENCODE_URL` | `http://127.0.0.1:28894` |
| `OPENCODE_SERVICE_JSON` | `~/.config/opencode/service.json` (Basic auth) |
| `OPENCODE_USERNAME` / `OPENCODE_PASSWORD` | surcharge du service.json |
| `BRIDGE_TIMEOUT_MS` | `180000` |
| `BRIDGE_CONCURRENCY` / `BRIDGE_MAX_QUEUE` | `2` / `8` |

## Profil ARTEX
`format=ollama`, `base_url=http://127.0.0.1:8789/v1`, `model=opencode/deepseek-v4.1-flash-free`,
`api_key` vide, `streaming=false`, `context_window_k=160`, `session_header_key=x-opencode-session`.

## Codes d'erreur
Quota épuisé sur tous les modèles : `429` + `Retry-After` si < 60 s, sinon `402` « quota exceeded … resets around <ISO> »
(déclenche le failover ARTEX). `401` upstream → 401, 4xx upstream → 400/404, 5xx/injoignable → 502, timeout → 504.

Aucun prompt n'est loggé. Limites : tool calling émulé (un outil par tour), pas de streaming, usage estimé (chars/4).
