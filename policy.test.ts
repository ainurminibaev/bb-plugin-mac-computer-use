import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appAllowed, caption, collectPids, normName, decide, parsePolicy, policyFor, type MachinePolicy } from './policy.ts';

const full: MachinePolicy = { enabled: true, screen: true, input: true, pointer: true, showActions: true, foreground: false, apps: [] };

test('unknown machine is disabled', () => {
  const p = policyFor(parsePolicy('{"machines":{}}'), 'host_x');
  assert.equal(p.enabled, false);
  assert.equal(decide(p, 'list_apps', {}).ok, false);
});

test('broken JSON fails closed', () => {
  assert.deepEqual(parsePolicy('{oops'), { machines: {} });
});

test('full access allows input and screen', () => {
  assert.equal(decide(full, 'click', { pid: 1, x: 1, y: 1 }).ok, true);
  assert.equal(decide(full, 'get_desktop_state', {}).ok, true);
});

test('input off allows only observation', () => {
  const p = { ...full, input: false };
  assert.equal(decide(p, 'get_window_state', { pid: 1 }).ok, true);
  assert.equal(decide(p, 'click', { pid: 1 }).ok, false);
  assert.equal(decide(p, 'launch_app', { bundle_id: 'x' }).ok, false);
  assert.equal(decide(p, 'some_new_tool', {}).ok, false);
});

test('screen off blocks screenshots', () => {
  const p = { ...full, screen: false };
  assert.equal(decide(p, 'get_desktop_state', {}).ok, false);
  assert.equal(decide(p, 'zoom', { pid: 1 }).ok, false);
  assert.equal(decide(p, 'click', { pid: 1 }).ok, true);
});

test('allowlist needs pid, blocks desktop and run_script, checks launch target', () => {
  const p = { ...full, apps: ['com.apple.TextEdit'] };
  assert.equal(decide(p, 'get_desktop_state', {}).ok, false);
  assert.equal(decide(p, 'run_script', { pid: 1 }).ok, false);
  assert.equal(decide(p, 'hotkey', { keys: ['cmd', 'n'] }).ok, false);
  assert.equal(decide(p, 'list_apps', {}).ok, true);
  assert.equal(decide(p, 'launch_app', { bundle_id: 'com.apple.TextEdit' }).ok, true);
  assert.equal(decide(p, 'launch_app', { bundle_id: 'com.apple.Safari' }).ok, false);
  const d = decide(p, 'run_steps', { steps: [{ tool: 'click', args: { pid: 5 } }, { tool: 'type_text', args: { pid: 7 } }] });
  assert.deepEqual(d.ok && d.pids, [5, 7]);
});

test('app matching by bundle id or name, case-insensitive', () => {
  const p = { ...full, apps: ['textedit', 'com.apple.Notes'] };
  assert.equal(appAllowed(p, { bundleId: 'com.apple.TextEdit', name: 'TextEdit' }), true);
  assert.equal(appAllowed(p, { bundleId: 'com.apple.notes', name: 'Notes' }), true);
  assert.equal(appAllowed(p, { bundleId: 'com.apple.Safari', name: 'Safari' }), false);
  assert.equal(appAllowed(full, { bundleId: null, name: null }), true);
});

test('collectPids walks nested args', () => {
  assert.deepEqual(collectPids({ a: [{ pid: 1 }, { b: { pid: 2 } }], pid: 3 }), [1, 2, 3]);
});

test('machine names match across NBSP, dashes and case', () => {
  assert.equal(normName('Studio Mac\u00a0— Office (2)'), normName('studio mac - office (2)'));
});

test('allowlist: list_windows only for allowed apps', () => {
  const p = { ...full, apps: ['com.apple.TextEdit'] };
  assert.equal(decide(p, 'list_windows', {}).ok, false);
  assert.equal(decide(p, 'list_windows', { app: 'Finder' }).ok, false);
  assert.equal(decide(p, 'list_windows', { app: 'com.apple.TextEdit' }).ok, true);
  const d = decide(p, 'list_windows', { pid: 9 });
  assert.deepEqual(d.ok && d.pids, [9]);
});

test('pointer off: only element actions', () => {
  const p = { ...full, pointer: false };
  assert.equal(decide(p, 'click', { pid: 1, element_token: 's00000001:2' }).ok, true);
  assert.equal(decide(p, 'click', { pid: 1, x: 5, y: 5 }).ok, false);
  assert.equal(decide(p, 'move_cursor', { x: 1, y: 1 }).ok, false);
  assert.equal(decide(p, 'type_text', { pid: 1, text: 'a', delivery_mode: 'foreground' }).ok, false);
  assert.equal(decide(p, 'run_steps', { steps: [{ drag: { pid: 1 } }] }).ok, false);
  assert.equal(decide(p, 'run_steps', { steps: [{ click: { app: 'TextEdit', role: 'button', name: 'OK' } }] }).ok, true);
  assert.equal(decide(p, 'get_window_state', { pid: 1 }).ok, true);
});

test('caption has agent and a default step', () => {
  assert.equal(caption('Assistant', 'type_text', undefined, 'TextEdit'), 'BB · Assistant: печатает в TextEdit');
  assert.equal(caption('Assistant', 'click', 'нажимает «Сохранить»', 'TextEdit'), 'BB · Assistant: нажимает «Сохранить»');
  assert.equal(caption('', 'something_new', undefined, null), 'BB · агент: работает');
  assert.equal(parsePolicy('{"machines":{"h":{"enabled":true}}}').machines.h!.showActions, true);
  assert.equal(parsePolicy('{"machines":{"h":{"enabled":true}}}').machines.h!.foreground, false);
});
