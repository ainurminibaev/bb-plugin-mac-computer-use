import { experimental_defineHostEntry } from '@get-bb/plugin-sdk/host';
import { execFile, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { arch, homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostContract, type CallResult } from './contract';
import { OVERLAY_JXA } from './overlay-script';

const MAX_TEXT = 60_000;
const APP = '/Applications/CuaDriver.app';
const APP_BIN = `${APP}/Contents/MacOS/cua-driver`;
const ENV = { ...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' };

/** Runs a program without a shell; resolves with exit code and output even on failure. */
function run(file: string, args: string[], timeout = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(file, args, { timeout, maxBuffer: 64 * 1024 * 1024, env: ENV }, (error, stdout, stderr) => {
      const raw = (error as { code?: unknown } | null)?.code;
      const code = error ? (typeof raw === 'number' ? raw : 1) : 0;
      const err = String(stderr ?? '') || (error && !stdout ? String(error.message) : '');
      resolve({ code, stdout: String(stdout ?? ''), stderr: err });
    });
  });
}

/** The CuaDriver CLI. The app-bundle copy keeps the driver's own TCC identity. */
async function driverPath(): Promise<string | null> {
  for (const p of [APP_BIN, join(homedir(), '.local/bin/cua-driver')]) {
    try { await access(p, constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

async function requireDriver(): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('Эта машина не macOS: управление экраном доступно только на Mac.');
  const p = await driverPath();
  if (!p) throw new Error('Cua Driver не установлен на этом Mac: установи его в настройках плагина Mac Computer Use.');
  return p;
}

/** Starts the CuaDriver app (in the background, no focus change) when its daemon is not running. */
async function ensureDaemon(driver: string): Promise<void> {
  // `status` prints "not running" on stderr: test for the positive line instead.
  const running = async () => /daemon is running/i.test((await run(driver, ['status'], 15_000)).stdout);
  if (await running()) return;
  // A just-replaced or just-quit app can swallow the first open: retry a few times.
  for (let attempt = 0; attempt < 3; attempt++) {
    await run('/usr/bin/open', ['-g', '-a', APP], 15_000);
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await running()) return;
    }
  }
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[обрезано ${text.length - MAX_TEXT} символов]` : text;
}

const joinOut = (r: { stdout: string; stderr: string }) => [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n');

/** The first balanced {...} in text, respecting JSON strings. */
function firstJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return '';
}

type Schema = { description: string; props: Record<string, { type?: unknown; description?: string; enum?: unknown[] }>; required: string[] };
const schemaCache = new Map<string, Schema | null>();

/** Parses `cua-driver describe <tool>`: free-text description, then the JSON input schema. */
async function schemaOf(driver: string, tool: string): Promise<Schema | null> {
  if (schemaCache.has(tool)) return schemaCache.get(tool)!;
  const r = await run(driver, ['describe', tool], 30_000);
  let parsed: Schema | null = null;
  const at = r.stdout.indexOf('input_schema:');
  if (r.code === 0 && at >= 0) {
    try {
      const json = JSON.parse(firstJsonObject(r.stdout.slice(at + 'input_schema:'.length)));
      const description = r.stdout.slice(0, at).replace(/^name:.*\n/, '').replace(/^\s*description:\s*/, '').trim();
      parsed = { description, props: json.properties ?? {}, required: json.required ?? [] };
    } catch { parsed = null; }
  }
  schemaCache.set(tool, parsed);
  return parsed;
}

/** Short readable form of a tool's schema: what an agent needs to fill args. */
function compact(tool: string, s: Schema): string {
  const lines = [`${tool}: ${s.description.slice(0, 1500)}`, '', 'args:'];
  for (const [k, v] of Object.entries(s.props)) {
    if (k === 'session') continue;
    const type = Array.isArray(v.enum) ? v.enum.map(String).join('|') : String(v.type ?? 'any');
    lines.push(`- ${k}${s.required.includes(k) ? ' (обязательно)' : ''} [${type}]: ${(v.description ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
  }
  return lines.join('\n');
}

async function size(path: string): Promise<{ w: number; h: number }> {
  const { stdout } = await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], 30_000);
  return { w: Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0), h: Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0) };
}

/** Reads the screenshot, downscaled to maxWidth and re-encoded as JPEG to keep model input small. */
async function loadImage(path: string, dir: string, maxWidth: number): Promise<CallResult['image']> {
  try { await access(path); } catch { return null; }
  const original = await size(path);
  if (!original.w) return null;
  const out = join(dir, 'shot.jpg');
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80'];
  if (original.w > maxWidth) args.push('--resampleWidth', String(maxWidth));
  const r = await run('/usr/bin/sips', [...args, path, '--out', out], 60_000);
  if (r.code !== 0) throw new Error(`Не удалось обработать снимок: ${r.stderr.trim()}`);
  const scaled = await size(out);
  return { data: (await readFile(out)).toString('base64'), mimeType: 'image/jpeg', width: scaled.w, height: scaled.h, originalWidth: original.w, originalHeight: original.h };
}

function parsePermissions(text: string) {
  try {
    const j = JSON.parse(text);
    return { daemon: j.daemon_running === true, accessibility: j.accessibility === true, screenRecording: j.screen_recording === true };
  } catch { return { daemon: false, accessibility: false, screenRecording: false }; }
}

/** Bundle id and name of the app that owns a process, from its executable path. */
async function appOf(pid: number): Promise<{ pid: number; bundleId: string | null; name: string | null }> {
  const exe = (await run('/bin/ps', ['-o', 'comm=', '-p', String(pid)], 10_000)).stdout.trim();
  const m = /^(.*?\/([^/]+)\.app)\//.exec(exe);
  if (!m) return { pid, bundleId: null, name: exe ? exe.split('/').pop() ?? null : null };
  const id = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', `${m[1]}/Contents/Info.plist`], 10_000);
  return { pid, bundleId: id.code === 0 ? id.stdout.trim() : null, name: m[2] ?? null };
}

/** Downloads one release, checks its sha256 and Developer ID team, then installs the app and CLI link. */
async function install(version: string, teamId: string): Promise<{ ok: boolean; log: string }> {
  if (process.platform !== 'darwin') return { ok: false, log: 'Не macOS.' };
  const log: string[] = [];
  const dir = await mkdtemp(join(tmpdir(), 'bb-cua-install-'));
  const target = arch() === 'arm64' ? 'darwin-arm64' : 'darwin-x86_64';
  const asset = `cua-driver-rs-${version}-${target}.tar.gz`;
  const base = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${version}`;
  const step = async (label: string, file: string, args: string[], timeout = 300_000) => {
    const r = await run(file, args, timeout);
    log.push(`${r.code === 0 ? '✓' : '✗'} ${label}`);
    if (r.code !== 0) throw new Error(`${label}: ${joinOut(r).slice(0, 800)}`);
    return r.stdout;
  };
  try {
    await step(`Скачан ${asset}`, '/usr/bin/curl', ['-fsSL', '-o', join(dir, asset), `${base}/${asset}`]);
    await step('Скачан SHA256SUMS', '/usr/bin/curl', ['-fsSL', '-o', join(dir, 'SHA256SUMS'), `${base}/SHA256SUMS`]);
    const sums = await readFile(join(dir, 'SHA256SUMS'), 'utf8');
    const expected = sums.split('\n').map(l => l.trim().split(/\s+/)).find(p => p[1]?.replace(/^\*/, '') === asset)?.[0];
    if (!expected) throw new Error('В SHA256SUMS нет записи для архива.');
    const actual = (await step('Посчитан sha256', '/usr/bin/shasum', ['-a', '256', join(dir, asset)])).split(/\s+/)[0];
    if (actual !== expected) throw new Error(`sha256 не совпал: ${actual} ≠ ${expected}`);
    log.push('✓ sha256 совпал');
    await step('Распакован архив', '/usr/bin/tar', ['xzf', join(dir, asset), '-C', dir]);
    const src = join(dir, `cua-driver-rs-${version}-${target}`, 'CuaDriver.app');
    await step('Подпись цела', '/usr/bin/codesign', ['--verify', '--deep', '--strict', src]);
    const info = await run('/usr/bin/codesign', ['-dv', src], 30_000);
    const team = /TeamIdentifier=(\S+)/.exec(info.stderr + info.stdout)?.[1];
    if (team !== teamId) throw new Error(`Подпись другого разработчика: ${team ?? 'нет'} (ожидался ${teamId}).`);
    log.push(`✓ Developer ID ${teamId}`);
    await step('Gatekeeper принял (нотаризация)', '/usr/sbin/spctl', ['-a', '-vv', src], 60_000);
    // macOS App Management forbids writing inside an existing app bundle, but a
    // new bundle path and whole-bundle renames are allowed: stage, swap, keep the
    // previous copy in the Trash.
    const stamp = Date.now();
    const staged = `/Applications/.CuaDriver.app.new-${stamp}`;
    await step('Подготовлена новая копия', '/usr/bin/ditto', [src, staged]);
    await step('Новая копия проверена', '/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
    let previous: string | null = null;
    try { await access(APP); previous = join(homedir(), '.Trash', `CuaDriver-${stamp}.app`); } catch { previous = null; }
    if (previous) {
      const old = await driverPath();
      if (old) await run(old, ['stop'], 20_000);
      await step('Прежняя версия перемещена в Корзину', '/bin/mv', [APP, previous]);
    }
    const swap = await run('/bin/mv', [staged, APP], 60_000);
    if (swap.code !== 0) {
      if (previous) await run('/bin/mv', [previous, APP], 60_000);
      await run('/bin/rm', ['-rf', staged], 60_000);
      throw new Error(`Не удалось поставить новую версию, прежняя возвращена: ${joinOut(swap)}`);
    }
    log.push('✓ Установлено в /Applications/CuaDriver.app');
    await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', APP], 30_000);
    await mkdir(join(homedir(), '.local/bin'), { recursive: true });
    const link = join(homedir(), '.local/bin/cua-driver');
    await unlink(link).catch(() => undefined);
    await symlink(APP_BIN, link);
    log.push('✓ ~/.local/bin/cua-driver');
    await run(APP_BIN, ['telemetry', 'disable'], 20_000);
    log.push('✓ Телеметрия выключена');
    await ensureDaemon(APP_BIN);
    log.push('✓ Служба Cua Driver запущена');
    schemaCache.clear();
    return { ok: true, log: log.join('\n') };
  } catch (e) {
    log.push(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, log: log.join('\n') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---- Visible mode: driver agent cursor + caption overlay ----

const OVERLAY_DIR = join(homedir(), 'Library/Application Support/bb-mac-computer-use');
const OVERLAY_SCRIPT = join(OVERLAY_DIR, 'overlay.jxa.js');
const OVERLAY_STATE = join(OVERLAY_DIR, 'overlay-state.json');
let overlayPid: number | null = null;
let overlaySeq = Date.now();
const cursorReady = new Set<string>();
const lastPos = new Map<string, { x: number; y: number }>();

const alive = (pid: number | null) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

/** Writes the caption state; the overlay process picks it up within 0.1 s. */
async function showOverlay(label: string, pos: { x: number; y: number } | null, ttlMs = 6000): Promise<void> {
  await mkdir(OVERLAY_DIR, { recursive: true });
  const tmp = `${OVERLAY_STATE}.tmp`;
  await writeFile(tmp, JSON.stringify({ seq: ++overlaySeq, label, x: pos?.x ?? null, y: pos?.y ?? null, ttlMs }));
  await rename(tmp, OVERLAY_STATE);
  if (alive(overlayPid)) return;
  let current = '';
  try { current = await readFile(OVERLAY_SCRIPT, 'utf8'); } catch { /* first run */ }
  if (current !== OVERLAY_JXA) await writeFile(OVERLAY_SCRIPT, OVERLAY_JXA);
  // osascript draws a click-through, non-activating panel; it never takes focus.
  const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', OVERLAY_SCRIPT, OVERLAY_STATE], { detached: true, stdio: 'ignore' });
  child.unref();
  overlayPid = child.pid ?? null;
}

async function driverJson(driver: string, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const r = await run(driver, ['call', tool, JSON.stringify(args)], 15_000);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout) as Record<string, unknown>; } catch { return null; }
}

async function cursorPosition(driver: string, session: string): Promise<{ x: number; y: number } | null> {
  const s = await driverJson(driver, 'get_agent_cursor_state', { session });
  const p = s?.position as { x?: unknown; y?: unknown } | null | undefined;
  return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
}

/** Turns the driver's own agent cursor on (with glow and click ripple) or off for this session. */
async function prepareCursor(driver: string, session: string, show: boolean): Promise<void> {
  const key = `${session}:${show}`;
  if (cursorReady.has(key)) return;
  await driverJson(driver, 'set_agent_cursor_enabled', { session, enabled: show });
  if (show) await driverJson(driver, 'set_agent_cursor_motion', { session, effects: { glow: 'on', ripple: 'on' } });
  cursorReady.delete(`${session}:${!show}`);
  cursorReady.add(key);
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    info: async () => {
      const driver = process.platform === 'darwin' ? await driverPath() : null;
      const version = driver ? (await run(driver, ['--version'], 15_000)).stdout.trim().replace(/^cua-driver\s+/, '') || null : null;
      return { platform: process.platform, arch: arch(), driver, version };
    },
    call: async ({ tool, args, session, wantImage, maxImageWidth, display }) => {
      const driver = await requireDriver();
      // Arguments must be one JSON object; the driver validates the tool's own schema.
      const parsed: unknown = JSON.parse(args || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('args должен быть JSON-объектом.');
      const input = parsed as Record<string, unknown>;
      // Each CLI call is a new transport: without a shared session label a window
      // snapshot (and its element tokens) is gone by the next call.
      if (session && input.session === undefined && (await schemaOf(driver, tool))?.props.session) input.session = session;
      await ensureDaemon(driver);
      const visible = !!(display?.show && session);
      if (session) await prepareCursor(driver, session, visible).catch(() => undefined);
      if (visible) await showOverlay(display!.label, lastPos.get(session!) ?? null, 30_000).catch(() => undefined);
      if (display?.foreground && typeof input.pid === 'number' && !['bring_to_front', 'list_apps', 'list_windows', 'launch_app'].includes(tool))
        await driverJson(driver, 'bring_to_front', { pid: input.pid, ...(session ? { session } : {}) });
      const dir = await mkdtemp(join(tmpdir(), 'bb-mac-cu-'));
      try {
        const png = join(dir, 'shot.png');
        const argv = ['call', tool, JSON.stringify(input)];
        if (wantImage) argv.push('--screenshot-out-file', png);
        let r = await run(driver, argv);
        // The daemon can report itself up a moment before its socket accepts calls.
        if (r.code !== 0 && /daemon is not running/i.test(r.stdout + r.stderr)) {
          await new Promise(res => setTimeout(res, 1500));
          await ensureDaemon(driver);
          r = await run(driver, argv);
        }
        const image = wantImage ? await loadImage(png, dir, maxImageWidth) : null;
        if (visible) {
          const pos = (await cursorPosition(driver, session!).catch(() => null)) ?? lastPos.get(session!) ?? null;
          if (pos) lastPos.set(session!, pos);
          await showOverlay(display!.label, pos, 6000).catch(() => undefined);
        }
        return { ok: r.code === 0, exitCode: r.code, text: clip(joinOut(r)), image };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    describe: async ({ tool }) => {
      const driver = await requireDriver();
      if (!tool) {
        const r = await run(driver, ['list-tools'], 30_000);
        // One line per tool: name and the first sentence of its description.
        return { text: clip(r.stdout.split('\n').filter(l => /^[a-z_]+:/.test(l)).map(l => l.replace(/^([a-z_]+:[^.]*\.?).*/, '$1').slice(0, 200)).join('\n')) };
      }
      const s = await schemaOf(driver, tool);
      return { text: s ? clip(compact(tool, s)) : clip(joinOut(await run(driver, ['describe', tool], 30_000))) };
    },
    status: async () => {
      const driver = await requireDriver();
      const daemon = await run(driver, ['status'], 30_000);
      const perms = await run(driver, ['permissions', 'status', '--json'], 30_000);
      return { text: clip(`${joinOut(daemon)}\n${joinOut(perms)}`.trim()) };
    },
    permissions: async () => {
      const driver = await requireDriver();
      await ensureDaemon(driver);
      return parsePermissions((await run(driver, ['permissions', 'status', '--json'], 30_000)).stdout);
    },
    grant: async () => {
      const driver = await requireDriver();
      const child = spawn(driver, ['permissions', 'grant'], { detached: true, stdio: 'ignore', env: ENV });
      child.unref();
      return { started: true };
    },
    install: ({ version, teamId }) => install(version, teamId),
    apps: async ({ pids }) => ({ apps: await Promise.all(pids.map(appOf)) }),
  },
});
