// Starts `opencode serve` for docker-compose.opencode.yml with a locked-down
// config: no project config, no sharing or updates, every permission denied, a
// tool-less "bridge" agent, and the background title/summary/compaction agents
// disabled so OpenCode never calls a paid helper model on its own. When
// OPENCODE_ZEN_API_KEY is set, the opencode provider uses that key (the config
// references the variable; the key itself is never written anywhere).
import { spawn } from 'node:child_process';

const FREE_SMALL = process.env.OPENCODE_SMALL_MODEL || 'opencode/deepseek-v4.1-flash-free';
const deny = Object.fromEntries(
  ['*', 'bash', 'edit', 'read', 'glob', 'grep', 'webfetch', 'websearch', 'task', 'skill', 'external_directory', 'todowrite', 'question'].map((k) => [k, 'deny']),
);
const config = {
  share: 'disabled',
  autoupdate: false,
  snapshot: false,
  lsp: false,
  formatter: false,
  small_model: FREE_SMALL,
  permission: deny,
  agent: {
    bridge: {
      mode: 'primary',
      description: 'JSON-only model endpoint for the ARTEX bridge',
      prompt: 'You are a language model reached through an API bridge. Follow the instructions in the conversation exactly. You have no tools.',
      permission: { '*': 'deny' },
    },
    title: { disable: true },
    summary: { disable: true },
    compaction: { disable: true },
  },
};
if ((process.env.OPENCODE_ZEN_API_KEY || '').trim()) {
  config.provider = { opencode: { options: { apiKey: '{env:OPENCODE_ZEN_API_KEY}' } } };
}

const child = spawn('opencode', ['serve', '--hostname', '0.0.0.0', '--port', process.env.OPENCODE_PORT || '4096'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_PURE: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_SHARE: '1',
  },
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
