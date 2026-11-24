/**
 * Stop agent: what is stopped and what is running right now, on one Mac.
 *
 * Two lists on disk, both read by every check:
 * - this plugin's own `stopped-sessions.json` (driver session labels, `bb-<threadId>`);
 * - the shared `~/Library/Application Support/bb-agent-stop/stopped-threads.json`
 *   (BB thread ids), read and written by every BB plugin that acts on this Mac
 *   for an agent (Mac Computer Use, Browser Relay), so one Stop blocks all of them.
 *
 * A stop lasts until an explicit resume: there is no expiry.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type StopMap = Record<string, number>;

/** Driver session label of a BB thread: the same rule the server uses. */
export const sessionOf = (threadId: string) => `bb-${threadId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
/** BB thread id behind a session label, or null for non-thread sessions (the settings check). */
export const threadOf = (session: string): string | null => /^bb-(thr_[A-Za-z0-9]{4,64})$/.exec(session)?.[1] ?? null;

export async function readMap(file: string): Promise<StopMap> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'number')) as StopMap;
  } catch { return {}; }
}

export async function writeMap(file: string, map: StopMap): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(map));
  await rename(tmp, file);
}

export type StopFiles = { sessions: string; shared: string; request: string };

export class StopRegistry {
  private readonly files: StopFiles;
  constructor(files: StopFiles) { this.files = files; }

  /** Sessions stopped here or through the shared list (thread ids become `bb-<id>`). */
  async stopped(): Promise<StopMap> {
    await this.collectClick();
    const [own, shared] = await Promise.all([readMap(this.files.sessions), readMap(this.files.shared)]);
    const all: StopMap = { ...own };
    for (const [threadId, at] of Object.entries(shared)) {
      const s = sessionOf(threadId);
      all[s] = Math.min(all[s] ?? at, at);
    }
    return all;
  }

  async isStopped(session: string): Promise<boolean> {
    return (await this.stopped())[session] !== undefined;
  }

  /** A pending «Stop» click on the HUD, if any, without consuming it. */
  async pendingClick(): Promise<string | null> {
    try {
      const req = JSON.parse(await readFile(this.files.request, 'utf8')) as { session?: unknown };
      return typeof req.session === 'string' && req.session ? req.session : null;
    } catch { return null; }
  }

  /** Moves a «Stop» click from the HUD into the lists. */
  async collectClick(): Promise<void> {
    let req: { session?: unknown; at?: unknown };
    try { req = JSON.parse(await readFile(this.files.request, 'utf8')); } catch { return; }
    // Consume first, so a broken request cannot block every later check.
    await rename(this.files.request, `${this.files.request}.done`).catch(() => undefined);
    if (typeof req.session === 'string' && req.session) await this.stop(req.session, typeof req.at === 'number' ? req.at : Date.now());
  }

  async stop(session: string, at = Date.now()): Promise<void> {
    const own = await readMap(this.files.sessions);
    if (own[session] === undefined) { own[session] = at; await writeMap(this.files.sessions, own); }
    const threadId = threadOf(session);
    if (threadId) {
      const shared = await readMap(this.files.shared);
      if (shared[threadId] === undefined) { shared[threadId] = at; await writeMap(this.files.shared, shared); }
    }
  }

  async resume(session: string): Promise<void> {
    await this.collectClick();
    const own = await readMap(this.files.sessions);
    if (own[session] !== undefined) { delete own[session]; await writeMap(this.files.sessions, own); }
    const threadId = threadOf(session);
    if (threadId) {
      const shared = await readMap(this.files.shared);
      if (shared[threadId] !== undefined) { delete shared[threadId]; await writeMap(this.files.shared, shared); }
    }
  }
}

/** Calls in flight per session: each one can be aborted from outside (Stop, BB thread stop). */
export class Inflight {
  private readonly bySession = new Map<string, Set<AbortController>>();

  /** Registers a call; the returned controller aborts when `parent` aborts. Call `done` when it ends. */
  begin(session: string, parent?: AbortSignal): { ac: AbortController; done: () => void } {
    const ac = new AbortController();
    const onParent = () => ac.abort(parent?.reason ?? 'cancelled');
    if (parent?.aborted) ac.abort(parent.reason ?? 'cancelled');
    else parent?.addEventListener('abort', onParent, { once: true });
    let set = this.bySession.get(session);
    if (!set) { set = new Set(); this.bySession.set(session, set); }
    set.add(ac);
    return {
      ac,
      done: () => {
        parent?.removeEventListener('abort', onParent);
        const s = this.bySession.get(session);
        s?.delete(ac);
        if (s && !s.size) this.bySession.delete(session);
      },
    };
  }

  count(session?: string): number {
    if (session !== undefined) return this.bySession.get(session)?.size ?? 0;
    let n = 0;
    for (const s of this.bySession.values()) n += s.size;
    return n;
  }

  /** Aborts every call of the session; returns how many were running. */
  abort(session: string, reason: string): number {
    const set = this.bySession.get(session);
    if (!set) return 0;
    for (const ac of set) ac.abort(reason);
    return set.size;
  }
}

export const STOPPED_TEXT = 'STOPPED_BY_USER: агент остановлен на этом Mac; GUI-доступ этого треда отозван до явного «Разрешить снова».';
export const isStoppedText = (text: string) => text.startsWith('STOPPED_BY_USER');
/** Marks a stop that happened during this call (HUD click, abort in flight), not an earlier one. */
export const FRESH_MARK = ' [остановлено сейчас]';
export const freshStoppedText = () => STOPPED_TEXT + FRESH_MARK;
export const isFreshStop = (text: string) => isStoppedText(text) && text.includes(FRESH_MARK);

// ---- BB server side: threads stopped on a Mac, and their queued messages ----

/** threadId → when it was stopped and on which Macs (host ids). */
export type StoppedThreads = Record<string, { at: number; hosts: string[] }>;

export function addStop(all: StoppedThreads, threadId: string, hostId: string, at = Date.now()): StoppedThreads {
  const cur = all[threadId];
  return { ...all, [threadId]: { at: cur?.at ?? at, hosts: [...new Set([...(cur?.hosts ?? []), hostId])] } };
}

/** Removes the stop on the given Macs (all when null); the thread is free when no Mac is left. */
export function removeStop(all: StoppedThreads, threadId: string, hostIds: string[] | null): StoppedThreads {
  const cur = all[threadId];
  if (!cur) return all;
  const hosts = hostIds ? cur.hosts.filter(h => !hostIds.includes(h)) : [];
  const next = { ...all };
  if (hosts.length) next[threadId] = { ...cur, hosts }; else delete next[threadId];
  return next;
}

export type DispatchDecision = { action: 'proceed' } | { action: 'wait'; reason: string; sendAt: number };

/**
 * Queue hold for a stopped thread: messages from agents, automations and the
 * system wait until the user resumes; a message the user typed goes through
 * (the Mac stays blocked for it until an explicit resume).
 */
export function holdDispatch(all: StoppedThreads, threadId: string, initiator: string, now = Date.now()): DispatchDecision {
  if (!all[threadId] || initiator === 'user') return { action: 'proceed' };
  return { action: 'wait', reason: 'Агент остановлен на Mac: очередь ждёт «Разрешить снова» (bb mac-computer-use resume или настройки плагина).', sendAt: now + 10 * 60_000 };
}

/** An agent may not lift its own stop. */
export function resumeRefusal(callerThreadId: string | undefined, threadId: string): string | null {
  return callerThreadId && callerThreadId === threadId ? 'Тред не может сам снять свою остановку: это делает пользователь (настройки плагина) или другой тред по его слову.' : null;
}
