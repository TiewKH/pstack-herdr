#!/usr/bin/env bash
# PreToolUse gate on the Agent tool. Inside Herdr, delegation goes through
# herdr/dispatch.ts; outside Herdr, or when the dispatcher cannot run, the
# native Agent tool stays available. Herdr's terminal UI marks its panes with
# HERDR_ENV=1; the Herdr app's terminals (herdr-core) carry HC_TERMINAL_ID.
set -u

# MiniMax Code loads this hooks file through its Claude Code reader, as
# session-start.sh notes. The gate is for Claude Code's Agent tool, so it stays
# out of MiniMax's way.
if [ -n "${MINIMAX_PLUGIN_ROOT:-}" ]; then exit 0; fi

if [ "${HERDR_ENV:-}" = "1" ]; then
  runtime="HERDR_ENV=1"
elif [ -n "${HC_TERMINAL_ID:-}" ]; then
  runtime="Herdr app terminal ${HC_TERMINAL_ID}"
else
  exit 0
fi
if [ "${PSTACK_HERDR_ALLOW_NATIVE_AGENT:-}" = "1" ]; then exit 0; fi

plugin_root="${CLAUDE_PLUGIN_ROOT:-}"
dispatcher="${plugin_root}/skills/poteto-mode/scripts/herdr/dispatch.ts"
mapping="${plugin_root}/skills/poteto-mode/references/herdr-tools.md"

json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//[$'\t\n\r']/ }"
  printf '"%s"' "$s"
}

allow_with_note() {
  printf '{"systemMessage":%s}\n' "$(json_string "$1")"
  exit 0
}

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "$(json_string "$1")"
  exit 0
}

if [ "$runtime" = "HERDR_ENV=1" ]; then
  if ! command -v herdr >/dev/null 2>&1; then
    allow_with_note "HERDR_ENV=1 but herdr is not on PATH, so this delegation uses the native Agent tool. Put the herdr binary on PATH to route it through herdr/dispatch.ts."
  fi
elif [ -z "${HC_TERMINAL_SOCKET:-}${HC_SOCKET:-}" ]; then
  allow_with_note "${runtime} but HC_TERMINAL_SOCKET is unset, so this delegation uses the native Agent tool. Start Claude Code in a terminal the Herdr app opened to route it through herdr/dispatch.ts."
fi

bun_bin="$(command -v bun 2>/dev/null || true)"
if [ -z "$bun_bin" ] && [ -x "${HOME:-}/.bun/bin/bun" ]; then
  bun_bin="${HOME:-}/.bun/bin/bun"
fi
if [ -z "$bun_bin" ]; then
  allow_with_note "${runtime} but bun is not installed, so this delegation uses the native Agent tool. Install bun (https://bun.sh) to route it through herdr/dispatch.ts."
fi

if [ ! -r "$dispatcher" ]; then
  allow_with_note "${runtime} but the pstack dispatcher is not readable at ${dispatcher} (CLAUDE_PLUGIN_ROOT is unset or the plugin is incomplete), so this delegation uses the native Agent tool."
fi

deny "Herdr session (${runtime}): delegate through the dispatcher, not the Agent tool. Write the brief to a file, then run: ${bun_bin} ${dispatcher} --role <role> --name <agent-name> --prompt-file <brief.md> --cwd <dir> [--readonly] [--wait]. For background workers, omit --wait and collect them with ${bun_bin} ${dispatcher} --next <agent-name>...; never sleep and re-check. Roles and flags: ${mapping}. To use the Agent tool on purpose, restart Claude Code with PSTACK_HERDR_ALLOW_NATIVE_AGENT=1 in its environment; hooks read the process environment, not the shell."
