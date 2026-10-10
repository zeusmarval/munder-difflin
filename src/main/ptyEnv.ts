/**
 * Environment construction for agent PTYs, as a pure function so the layering
 * is testable off-process (the same trick `buildMissingCliScript` uses for its
 * `platform` parameter).
 *
 * The layering rule, bottom to top:
 *   1. the inherited environment, minus the parent Claude session's identity
 *   2. the app's own defaults (PATH, terminal identity, locale)
 *   3. per-agent values (`opts.env`) — always win, even over the strip below
 */

/**
 * The app is often launched from INSIDE a Claude Code session (`npm run dev`
 * typed into a claude terminal), so that session's identity markers arrive via
 * `process.env` and would flow into every agent CLI. CLAUDE_CODE_CHILD_SESSION
 * makes the agent believe it is a child session and silently DISABLES
 * transcript saving ("Transcript saving is off — inherited
 * CLAUDE_CODE_CHILD_SESSION marker"), which breaks --resume for every agent of
 * that run: their sessions never reach disk (bit us live 2026-08-16/17 — no
 * worker transcript ever existed). The session id, pid, messaging socket+token,
 * effort, execpath and entrypoint likewise all describe the PARENT session,
 * never a fresh agent.
 *
 * Stripped by PREFIX rather than by name: the CLI grows new markers faster
 * than a hardcoded list keeps up (a five-name list was already seven short of
 * a live session's dump when review caught it). Agents are top-level sessions
 * regardless of how the app was launched, so they inherit NONE of the parent's
 * Claude identity.
 */
const CLAUDE_MARKER_RE = /^CLAUDE(CODE|_)/;

/**
 * Configuration, not identity: these share the prefix but are the OPERATOR's
 * own choices — where the CLI keeps its config, how it authenticates, which
 * backend serves it. An operator who exported them wants agents to see them,
 * and stripping them breaks agents in exactly the quiet way the strip above
 * exists to prevent. Everything session-scoped stays out of this list.
 */
const CLAUDE_CONFIG_KEEP = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX'
]);

/**
 * The DEV launcher's own variables. `npm run dev` runs electron-vite, which sets
 * these on its process.env before starting Electron, so a dev build handed them
 * to every agent — NODE_ENV=development above all: an agent that ran `vite build`
 * shipped development bundles (bigger, React StrictMode double-render) without
 * knowing (seen live 2026-10, three deploys). A packaged app never sets them.
 *
 * An explicit list, read from electron-vite's source, not a prefix: these names
 * describe the launcher and nothing else, so dropping them can't take an
 * operator's choice with it.
 */
const DEV_LAUNCHER_KEYS = new Set([
  'ELECTRON_CLI_ARGS',
  'ELECTRON_ENTRY',
  'ELECTRON_EXEC_PATH',
  'ELECTRON_MAJOR_VER',
  'ELECTRON_RENDERER_URL',
  'NODE_ENV_ELECTRON_VITE',
  'REMOTE_DEBUGGING_PORT',
  'VITE_USER_NODE_ENV'
]);

/**
 * Generic names electron-vite ALSO sets, but that an operator may export on
 * purpose. Stripped only when the launcher's marker NODE_ENV_ELECTRON_VITE is
 * present — then the value is the launcher's, not the operator's. Without the
 * marker (packaged app, or a shell that exported them) they pass through.
 * Left alone on purpose: DEBUG and BROWSER (vite sets them only when asked to,
 * and both are legitimate operator settings).
 */
const DEV_LAUNCHER_GENERIC_KEYS = new Set(['NODE_ENV', 'NO_SANDBOX']);

export function buildPtyEnv(
  parentEnv: NodeJS.ProcessEnv,
  userPath: string,
  agentEnv?: Record<string, string>,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  // Layer 1 — inherit, minus the parent session's Claude identity. Only this
  // layer is stripped: a marker set deliberately via `agentEnv` below survives,
  // so per-agent environment overrides (and future per-agent env features)
  // cannot be silently wiped by the strip.
  const inherited: Record<string, string> = {};
  const devLaunched = parentEnv.NODE_ENV_ELECTRON_VITE !== undefined;
  for (const [k, v] of Object.entries(parentEnv)) {
    if (v === undefined) continue;
    if (CLAUDE_MARKER_RE.test(k) && !CLAUDE_CONFIG_KEEP.has(k)) continue;
    if (DEV_LAUNCHER_KEYS.has(k)) continue;
    if (devLaunched && DEV_LAUNCHER_GENERIC_KEYS.has(k)) continue;
    inherited[k] = v;
  }
  return {
    ...inherited,
    PATH: userPath,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    // Help apps that look for a real interactive shell
    FORCE_COLOR: '1',
    // A Finder/Dock-launched Electron app inherits NO locale from launchd
    // (`launchctl getenv LANG` is empty), so without this every child runs in
    // the C/POSIX locale — where macOS's CoreFoundation default text encoding
    // is Mac OS Roman (__CF_USER_TEXT_ENCODING=<uid>:0:0). Any locale-sensitive
    // tool an agent runs then decodes UTF-8 as MacRoman and paints mojibake
    // into the grid ("—" → "‚Äî"), which copy faithfully reproduces. This
    // terminal IS UTF-8 (xterm.js + Unicode11), so say so.
    //
    // LC_CTYPE only, deliberately: it is the character-encoding category. Using
    // LC_ALL would also override collation and date formatting for every user
    // who never exported a locale. A locale the user really did export wins.
    ...(platform === 'win32'
      ? {}
      : {
          LANG: parentEnv.LANG ?? 'en_US.UTF-8',
          LC_CTYPE:
            parentEnv.LC_ALL ?? parentEnv.LC_CTYPE ?? parentEnv.LANG ?? 'en_US.UTF-8'
        }),
    // Per-agent hive identity (AGENT_ID, HIVE_ROOT, …) when provided.
    ...(agentEnv ?? {})
  };
}
