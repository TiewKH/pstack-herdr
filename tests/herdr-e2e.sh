#!/usr/bin/env bash
set -euo pipefail

HERDR_VERSION="0.9.0"
HERDR_SHA256="4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f"
HERDR_URL="https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/herdr-linux-x86_64"
ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
TMP="$(mktemp -d)"
FAKE_BIN="$TMP/bin"
RESULT="$TMP/dispatch.json"
SERVER_LOG="$TMP/herdr-server.log"

cleanup() {
  if command -v herdr >/dev/null 2>&1; then
    herdr server stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$TMP/home"

curl -fsSL "$HERDR_URL" -o "$FAKE_BIN/herdr"
echo "$HERDR_SHA256  $FAKE_BIN/herdr" | sha256sum -c -
chmod +x "$FAKE_BIN/herdr"

cat > "$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
export HERDR_AGENT=claude
herdr pane report-agent "$HERDR_PANE_ID" \
  --source custom:pstack-herdr-ci --agent claude --state idle >/dev/null

# herdr-dispatch.ts believes a done/idle verdict only once a transcript under
# $CLAUDE_CONFIG_DIR/projects records the prompt (turnEvidence), so this stand-in
# writes one after each prompt, the same shape a real Claude Code session writes.
transcript_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/pstack-herdr-e2e"
mkdir -p "$transcript_dir"

while IFS= read -r prompt; do
  herdr pane report-agent "$HERDR_PANE_ID" \
    --source custom:pstack-herdr-ci --agent claude --state working >/dev/null
  printf '{"type":"user","message":{"role":"user","content":%s}}\n' \
    "$(printf '%s' "$prompt" | jq -Rs .)" >> "$transcript_dir/session.jsonl"
  printf 'FAKE_CLAUDE_RESULT:%s\n' "$prompt"
  herdr pane report-agent "$HERDR_PANE_ID" \
    --source custom:pstack-herdr-ci --agent claude --state idle >/dev/null
done
EOF
chmod +x "$FAKE_BIN/claude"

export PATH="$FAKE_BIN:$PATH"
export HOME="$TMP/home"
export XDG_CONFIG_HOME="$TMP/home/.config"
export XDG_STATE_HOME="$TMP/home/.local/state"
export XDG_CACHE_HOME="$TMP/home/.cache"
export XDG_RUNTIME_DIR="$TMP/runtime"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

herdr server >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 100); do
  if herdr workspace list >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$SERVER_LOG" >&2
    exit 1
  fi
  sleep 0.1
done

created="$(herdr workspace create --cwd "$ROOT")"
pane="$(printf '%s\n' "$created" | jq -r '.result.root_pane.pane_id')"
if [[ -z "$pane" || "$pane" == "null" ]]; then
  echo "failed to resolve root pane from Herdr workspace create" >&2
  printf '%s\n' "$created" >&2
  exit 1
fi

command="HERDR_ENV=1 PSTACK_HERDR_PARENT_KIND=claude PATH='$PATH' bun '$ROOT/plugins/pstack/skills/poteto-mode/scripts/herdr-dispatch.ts' --role explorer --name ci-explorer --kind claude --cwd '$ROOT' --prompt 'pstack-herdr-e2e' --wait --timeout 15000 > '$RESULT' 2>&1; code=\$?; echo PSTACK_HERDR_E2E_EXIT:\$code"
herdr pane run "$pane" "$command" >/dev/null
herdr pane wait-output "$pane" --regex 'PSTACK_HERDR_E2E_EXIT:[0-9]+' --timeout 30000 >/dev/null

cat "$RESULT"

jq -e '.kind == "claude"' "$RESULT" >/dev/null
jq -e '.status == "idle" or .status == "done"' "$RESULT" >/dev/null
jq -e '.blocked == false' "$RESULT" >/dev/null
jq -e '.paneClosed == true' "$RESULT" >/dev/null
grep -q 'FAKE_CLAUDE_RESULT:pstack-herdr-e2e' "$RESULT"

if agent="$(herdr agent get ci-explorer 2>&1)"; then
  echo "completed worker still exists after dispatch" >&2
  exit 1
fi
printf '%s\n' "$agent" | jq -e '.error.code == "agent_not_found"' >/dev/null

printf 'Real Herdr end-to-end dispatch passed with Herdr v%s\n' "$HERDR_VERSION"
