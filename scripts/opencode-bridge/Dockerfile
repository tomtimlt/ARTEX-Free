# OpenCode server + ARTEX bridge, for docker-compose.opencode.yml.
# Same Node base as the main image. OpenCode is pinned; the bridge needs its
# session API (POST /session, /session/{id}/message, /session/status).
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

ARG OPENCODE_VERSION=1.19.6

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g "opencode-ai@${OPENCODE_VERSION}" \
    && opencode --version

COPY bridge.mjs opencode-entry.mjs /bridge/

# OpenCode keeps its login (auth.json) and sessions under ~/.local/share/opencode,
# which docker-compose.opencode.yml puts in a named volume.
RUN mkdir -p /home/node/.local/share/opencode /home/node/.config/opencode /home/node/work \
    && chown -R node:node /home/node
USER node
ENV HOME=/home/node
WORKDIR /home/node/work
