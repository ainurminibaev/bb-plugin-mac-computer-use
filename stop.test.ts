import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inflight, StopRegistry, addStop, holdDispatch, isStoppedText, readMap, removeStop, resumeRefusal, sessionOf, STOPPED_TEXT, threadOf } from './stop.ts';
import { OVERLAY_JXA } from './overlay-script.ts';

async function registry() {
  const dir = await mkdtemp(join(tmpdir(), 'mcu-stop-'));
  const files = { sessions: join(dir, 'own', 'stopped-sessions.json'), shared: join(dir, 'shared', 'stopped-threads.json'), request: join(dir, 'stop-request.json') };
  return { dir, files, reg: new StopRegistry(files), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('overlay passes a numeric event mask: the JXA constant bridges to 0 and Stop never gets clicks', () => {
  assert.ok(!OVERLAY_JXA.includes('$.NSEventMaskAny'), 'JXA $.NSEventMaskAny must not be used');
  assert.match(OVERLAY_JXA, /ANY_EVENT = 4294967295/);
  assert.match(OVERLAY_JXA, /nextEventMatchingMaskUntilDateInModeDequeue\(ANY_EVENT,/);
});

test('overlay shows a stopped session as stopped, not as done', () => {
  assert.match(OVERLAY_JXA, /st\.stopped \? 'Агент остановлен/);
});

test('session label and thread id map both ways', () => {
  assert.equal(sessionOf('thr_abc123'), 'bb-thr_abc123');
  assert.equal(threadOf('bb-thr_abc123'), 'thr_abc123');
  assert.equal(threadOf('bb-settings-check'), null);
});

test('a stop lasts until an explicit resume and is mirrored to the shared list', async () => {
  const { reg, files, cleanup } = await registry();
  try {
    await reg.stop('bb-thr_aaaa1', 1000);
    assert.equal(await reg.isStopped('bb-thr_aaaa1'), true);
    assert.deepEqual(await readMap(files.shared), { thr_aaaa1: 1000 });
    // No expiry: a stop from long ago still blocks.
    await writeFile(files.sessions, JSON.stringify({ 'bb-thr_aaaa1': 1 }));
    assert.equal(await reg.isStopped('bb-thr_aaaa1'), true);
    await reg.resume('bb-thr_aaaa1');
    assert.equal(await reg.isStopped('bb-thr_aaaa1'), false);
    assert.deepEqual(await readMap(files.shared), {});
  } finally { await cleanup(); }
});

test('a stop written by another plugin (shared list) blocks this one', async () => {
  const { reg, files, cleanup } = await registry();
  try {
    await import('node:fs/promises').then(fs => fs.mkdir(join(files.shared, '..'), { recursive: true }));
    await writeFile(files.shared, JSON.stringify({ thr_bbbb2: 5 }));
    assert.equal(await reg.isStopped('bb-thr_bbbb2'), true);
    await reg.resume('bb-thr_bbbb2');
    assert.equal(await reg.isStopped('bb-thr_bbbb2'), false);
  } finally { await cleanup(); }
});

test('a HUD Stop click is consumed once and becomes a stop', async () => {
  const { reg, files, cleanup } = await registry();
  try {
    await writeFile(files.request, JSON.stringify({ session: 'bb-thr_cccc3', at: 42 }));
    assert.equal(await reg.pendingClick(), 'bb-thr_cccc3');
    assert.deepEqual(await reg.stopped(), { 'bb-thr_cccc3': 42 });
    assert.equal(await reg.pendingClick(), null);
    await assert.rejects(readFile(files.request, 'utf8'));
  } finally { await cleanup(); }
});

test('a broken click request does not block anything', async () => {
  const { reg, files, cleanup } = await registry();
  try {
    await writeFile(files.request, '{not json');
    assert.deepEqual(await reg.stopped(), {});
  } finally { await cleanup(); }
});

test('Stop kills a running process in flight (as the host does with the driver and AppleScript)', async () => {
  const inflight = new Inflight();
  const { ac, done } = inflight.begin('bb-thr_dddd4');
  const t0 = Date.now();
  const ended = new Promise<string>(resolve => execFile('/bin/sleep', ['30'], { signal: ac.signal }, e => resolve(String((e as { name?: string } | null)?.name))));
  assert.equal(inflight.count('bb-thr_dddd4'), 1);
  setTimeout(() => inflight.abort('bb-thr_dddd4', 'user'), 100);
  assert.equal(await ended, 'AbortError');
  assert.ok(Date.now() - t0 < 3000);
  done();
  assert.equal(inflight.count(), 0);
});

test('BB thread stop (the call signal) aborts the call in flight', () => {
  const inflight = new Inflight();
  const bb = new AbortController();
  const { ac, done } = inflight.begin('bb-thr_eeee5', bb.signal);
  bb.abort('thread-stopped');
  assert.equal(ac.signal.aborted, true);
  done();
  const pre = inflight.begin('bb-thr_eeee5', bb.signal);
  assert.equal(pre.ac.signal.aborted, true, 'an already cancelled call starts aborted');
  pre.done();
});

test('abort of one session leaves the others running', () => {
  const inflight = new Inflight();
  const a = inflight.begin('bb-thr_a1111');
  const b = inflight.begin('bb-thr_b2222');
  assert.equal(inflight.abort('bb-thr_a1111', 'user'), 1);
  assert.equal(a.ac.signal.aborted, true);
  assert.equal(b.ac.signal.aborted, false);
  assert.equal(inflight.abort('bb-thr_none1', 'user'), 0);
});

test('stopped threads: per Mac, free only when every Mac is resumed', () => {
  let all = addStop({}, 'thr_x1234', 'host_a', 10);
  all = addStop(all, 'thr_x1234', 'host_b', 20);
  assert.deepEqual(all.thr_x1234, { at: 10, hosts: ['host_a', 'host_b'] });
  all = removeStop(all, 'thr_x1234', ['host_a']);
  assert.deepEqual(all.thr_x1234?.hosts, ['host_b']);
  assert.deepEqual(removeStop(all, 'thr_x1234', null), {});
});

test('queue: agent and system messages to a stopped thread wait, the user still gets through', () => {
  const all = addStop({}, 'thr_q1234', 'host_a');
  assert.equal(holdDispatch(all, 'thr_q1234', 'agent', 0).action, 'wait');
  assert.equal(holdDispatch(all, 'thr_q1234', 'system', 0).action, 'wait');
  assert.equal(holdDispatch(all, 'thr_q1234', 'mixed', 0).action, 'wait');
  assert.equal(holdDispatch(all, 'thr_q1234', 'user', 0).action, 'proceed');
  assert.equal(holdDispatch(all, 'thr_other', 'agent', 0).action, 'proceed');
  const w = holdDispatch(all, 'thr_q1234', 'agent', 1000);
  assert.ok(w.action === 'wait' && w.sendAt > 1000);
});

test('a thread cannot lift its own stop', () => {
  assert.ok(resumeRefusal('thr_self1', 'thr_self1'));
  assert.equal(resumeRefusal('thr_other', 'thr_self1'), null);
  assert.equal(resumeRefusal(undefined, 'thr_self1'), null);
});

test('stopped text is recognised by the server', () => {
  assert.equal(isStoppedText(STOPPED_TEXT), true);
  assert.equal(isStoppedText('ok'), false);
});

test('only a stop that happened during the call is fresh (it stops the BB turn)', async () => {
  const { isFreshStop, freshStoppedText } = await import('./stop.ts');
  assert.equal(isFreshStop(freshStoppedText()), true);
  assert.equal(isFreshStop(STOPPED_TEXT), false);
  assert.equal(isStoppedText(freshStoppedText()), true);
});
