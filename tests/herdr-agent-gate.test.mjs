import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const gate = join(process.cwd(), 'plugins/pstack/hooks/herdr-agent-gate.sh');
const fixtures = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ herdr = false, bun = false, bunInHome = false, dispatcher = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pstack-herdr-gate-'));
  fixtures.push(root);
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const plugin = join(root, 'plugin');
  mkdirSync(bin);
  mkdirSync(home);
  mkdirSync(join(plugin, 'skills', 'poteto-mode', 'scripts'), { recursive: true });
  if (dispatcher) writeFileSync(join(plugin, 'skills', 'poteto-mode', 'scripts', 'herdr-dispatch.ts'), '');
  const stub = (path) => {
    writeFileSync(path, '#!/bin/sh\nexit 0\n');
    chmodSync(path, 0o755);
  };
  if (herdr) stub(join(bin, 'herdr'));
  if (bun) stub(join(bin, 'bun'));
  if (bunInHome) {
    mkdirSync(join(home, '.bun', 'bin'), { recursive: true });
    stub(join(home, '.bun', 'bin', 'bun'));
  }
  return { bin, home, plugin };
}

function run(env, { bin, home, plugin }) {
  const stdout = execFileSync('/bin/bash', [gate], {
    encoding: 'utf8',
    input: '{"tool_name":"Agent","tool_input":{}}',
    env: { PATH: bin, HOME: home, CLAUDE_PLUGIN_ROOT: plugin, ...env },
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

test('outside Herdr the gate is silent', () => {
  assert.equal(run({}, fixture({ herdr: true, bun: true })), null);
});

test('inside Herdr with herdr and bun on PATH the Agent tool is denied', () => {
  const fx = fixture({ herdr: true, bun: true });
  const out = run({ HERDR_ENV: '1' }, fx);
  const decision = out.hookSpecificOutput;
  assert.equal(decision.hookEventName, 'PreToolUse');
  assert.equal(decision.permissionDecision, 'deny');
  assert.ok(decision.permissionDecisionReason.includes(`${fx.bin}/bun ${fx.plugin}/skills/poteto-mode/scripts/herdr-dispatch.ts`));
  assert.ok(decision.permissionDecisionReason.includes(`${fx.plugin}/skills/poteto-mode/references/herdr-tools.md`));
  assert.match(decision.permissionDecisionReason, /restart Claude Code with PSTACK_HERDR_ALLOW_NATIVE_AGENT=1/);
});

test('a bun that lives only in ~/.bun/bin is named by full path', () => {
  const fx = fixture({ herdr: true, bunInHome: true });
  const out = run({ HERDR_ENV: '1' }, fx);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes(`${fx.home}/.bun/bin/bun ${fx.plugin}/skills/poteto-mode/scripts/herdr-dispatch.ts`));
});

test('a missing dispatcher allows the Agent tool with a note instead of a dead command', () => {
  const out = run({ HERDR_ENV: '1' }, fixture({ herdr: true, bun: true, dispatcher: false }));
  assert.equal(out.hookSpecificOutput, undefined);
  assert.match(out.systemMessage, /dispatcher is not readable/);
});

test('an unset CLAUDE_PLUGIN_ROOT allows the Agent tool with a note', () => {
  const out = run({ HERDR_ENV: '1', CLAUDE_PLUGIN_ROOT: '' }, fixture({ herdr: true, bun: true }));
  assert.equal(out.hookSpecificOutput, undefined);
  assert.match(out.systemMessage, /CLAUDE_PLUGIN_ROOT is unset/);
});

test('control characters in paths cannot break the JSON', () => {
  const fx = fixture({ herdr: true, bun: true });
  const out = run({ HERDR_ENV: '1', HOME: `${fx.home}\n"x` }, fx);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('inside Herdr without the herdr binary the Agent tool is allowed with a note', () => {
  const out = run({ HERDR_ENV: '1' }, fixture({ bun: true }));
  assert.equal(out.hookSpecificOutput, undefined);
  assert.match(out.systemMessage, /herdr.*not on PATH/i);
});

test('inside Herdr without bun the Agent tool is allowed with a note', () => {
  const out = run({ HERDR_ENV: '1' }, fixture({ herdr: true }));
  assert.equal(out.hookSpecificOutput, undefined);
  assert.match(out.systemMessage, /bun/);
  assert.match(out.systemMessage, /bun\.sh/);
});

test('PSTACK_HERDR_ALLOW_NATIVE_AGENT=1 bypasses the gate silently', () => {
  assert.equal(run({ HERDR_ENV: '1', PSTACK_HERDR_ALLOW_NATIVE_AGENT: '1' }, fixture({ herdr: true, bun: true })), null);
});
