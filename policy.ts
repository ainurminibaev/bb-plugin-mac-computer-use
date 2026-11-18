import { z } from 'zod';

/** What agents may do on one machine. A machine without an entry is not accessible. */
export const machinePolicySchema = z.object({
  enabled: z.boolean().default(false),
  /** See the screen: screenshots, window trees. */
  screen: z.boolean().default(true),
  /** Mouse, keyboard, launching and switching apps. */
  input: z.boolean().default(true),
  /** Synthetic pointer: clicks/drags by x,y, cursor moves, foreground delivery. Off — only accessibility actions on elements. */
  pointer: z.boolean().default(true),
  /** Visible mode: highlighted agent cursor and a caption «BB · agent: step» on the Mac screen. */
  showActions: z.boolean().default(true),
  /** Visible mode moves the REAL mouse pointer to each action point (off: «don't touch my mouse», background delivery). */
  realMouse: z.boolean().default(true),
  /** Bring the target app to the front before acting (off: background work without stealing focus). */
  foreground: z.boolean().default(false),
  /** Allowed apps (bundle id or app name). Empty — every app. */
  apps: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  /** Stable machine traits that survive a BB reinstall (new host IDs): BB machine name and a salted hash of the Mac's hardware UUID. */
  fingerprint: z.object({ name: z.string().max(200).optional(), hw: z.string().regex(/^[a-f0-9]{16,64}$/).optional() }).optional(),
});
export type MachinePolicy = z.infer<typeof machinePolicySchema>;

export const policyFileSchema = z.object({
  machines: z.record(z.string(), machinePolicySchema).default({}),
});
export type PolicyFile = z.infer<typeof policyFileSchema>;

export const DISABLED: MachinePolicy = { enabled: false, screen: true, input: true, pointer: true, showActions: true, realMouse: true, foreground: false, apps: [] };

export function parsePolicy(raw: string): PolicyFile {
  try { return policyFileSchema.parse(JSON.parse(raw || '{}')); } catch { return { machines: {} }; }
}

export function policyFor(file: PolicyFile, hostId: string): MachinePolicy {
  return file.machines[hostId] ?? DISABLED;
}

/** Read-only driver tools: they never send input to an app. */
const OBSERVE = new Set([
  'list_apps', 'list_windows', 'get_window_state', 'get_desktop_state', 'zoom', 'get_screen_size',
  'get_cursor_position', 'get_guide', 'check_permissions', 'health_report', 'get_config',
  'get_agent_cursor_state', 'get_recording_state', 'list_sessions', 'get_session', 'parse_visual_regions',
  'verify_state', 'get_browser_state', 'page', 'get_accessibility_tree', 'debug_window_info',
]);
/** Tools whose output is screen content. */
const SCREEN = new Set(['get_window_state', 'get_desktop_state', 'zoom', 'parse_visual_regions', 'get_accessibility_tree', 'verify_state', 'get_browser_state', 'page']);
/** Discovery tools that do not target one app and stay available under an app allowlist. */
const UNTARGETED = new Set(['list_apps', 'get_screen_size', 'get_cursor_position', 'get_guide', 'check_permissions', 'health_report', 'get_agent_cursor_state', 'list_sessions', 'get_session', 'get_recording_state']);

export type Decision =
  | { ok: true; pids: number[]; launchTarget: string | null }
  | { ok: false; reason: string };

/** Every numeric `pid` anywhere in the arguments (run_steps nests them). */
export function collectPids(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) value.forEach(v => collectPids(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'pid' && typeof v === 'number') out.push(v);
      else collectPids(v, out);
    }
  }
  return out;
}

/** First decision step: can this tool run at all on this machine? App membership is checked afterwards by pid. */
export function decide(policy: MachinePolicy, tool: string, args: Record<string, unknown>): Decision {
  if (!policy.enabled) return { ok: false, reason: 'Доступ агентов к этому компьютеру выключен в настройках плагина Mac Computer Use.' };
  const observe = OBSERVE.has(tool);
  if (!observe && !policy.input) return { ok: false, reason: `Управление (мышь/клавиатура/приложения) на этом компьютере выключено: ${tool} недоступен.` };
  if (!policy.pointer && usesPointer(tool, args)) return { ok: false, reason: `Мышь по координатам на этом компьютере выключена: ${tool} с x,y/курсором/foreground недоступен. Используй действия по element_token (click/type_text/set_value/invoke_menu) или командную строку.` };
  if (SCREEN.has(tool) && !policy.screen) return { ok: false, reason: 'Просмотр экрана на этом компьютере выключен в настройках плагина.' };
  if (policy.apps.length === 0 || UNTARGETED.has(tool)) return { ok: true, pids: [], launchTarget: null };
  // Allowlist mode: everything must name an allowed app.
  if (tool === 'list_windows' && typeof args.app === 'string' && args.pid === undefined)
    return appAllowed(policy, { bundleId: args.app, name: args.app }) ? { ok: true, pids: [], launchTarget: null } : { ok: false, reason: `Приложение ${args.app} не входит в список разрешённых.` };
  if (tool === 'get_desktop_state') return { ok: false, reason: 'Разрешены только отдельные приложения: снимок всего экрана недоступен, снимай окно (pid + window_id).' };
  if (tool === 'run_script') return { ok: false, reason: 'Разрешены только отдельные приложения: run_script недоступен, используй run_steps.' };
  if (tool === 'launch_app') {
    const target = [args.bundle_id, args.name, args.app_name, args.path].find(v => typeof v === 'string');
    if (typeof target !== 'string') return { ok: false, reason: 'launch_app: укажи bundle_id разрешённого приложения.' };
    return appAllowed(policy, { bundleId: target, name: target }) ? { ok: true, pids: [], launchTarget: target } : { ok: false, reason: `Приложение ${target} не входит в список разрешённых.` };
  }
  const pids = collectPids(args);
  if (!pids.length) return { ok: false, reason: `Разрешены только отдельные приложения: в ${tool} нужно указать pid разрешённого приложения.` };
  return { ok: true, pids: [...new Set(pids)], launchTarget: null };
}

export function appAllowed(policy: MachinePolicy, app: { bundleId: string | null; name: string | null }): boolean {
  if (!policy.apps.length) return true;
  const keys = [app.bundleId, app.name, app.name?.replace(/\.app$/i, '')].filter((v): v is string => !!v).map(v => v.toLowerCase());
  return policy.apps.some(a => keys.includes(a.toLowerCase()) || keys.includes(a.toLowerCase().replace(/\.app$/i, '')));
}

/** Machine names carry NBSP, em dashes and mixed Unicode forms: compare a canonical form. */
export const normName = (s: string) => s.normalize('NFKC').replace(/[\s\u00a0\u2007\u202f]+/g, ' ').replace(/[\u2010-\u2015\u2212]/g, '-').trim().toLowerCase();

/** Pointer-only tools, and coordinate or foreground use of element tools (run_steps nests them). */
const POINTER_TOOLS = new Set(['move_cursor', 'drag', 'set_agent_cursor_motion']);
export function usesPointer(tool: string, args: unknown): boolean {
  if (POINTER_TOOLS.has(tool)) return true;
  const walk = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(walk);
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    if (typeof o.x === 'number' || typeof o.y === 'number' || o.delivery_mode === 'foreground') return true;
    if (typeof o.tool === 'string' && POINTER_TOOLS.has(o.tool)) return true;
    if (Object.keys(o).some(k => POINTER_TOOLS.has(k))) return true;
    return Object.values(o).some(walk);
  };
  return walk(args);
}

const VERBS: Record<string, string> = {
  click: 'нажимает', double_click: 'дважды нажимает', right_click: 'открывает контекстное меню',
  type_text: 'печатает', set_value: 'вводит значение', press_key: 'нажимает клавишу', hotkey: 'нажимает сочетание клавиш',
  scroll: 'прокручивает', drag: 'перетаскивает', move_cursor: 'двигает курсор', launch_app: 'запускает приложение',
  bring_to_front: 'переключает окно', invoke_menu: 'выбирает пункт меню', get_window_state: 'смотрит на окно',
  get_desktop_state: 'смотрит на экран', zoom: 'рассматривает фрагмент', list_windows: 'ищет окно', list_apps: 'ищет приложение',
  run_steps: 'выполняет несколько шагов', run_script: 'выполняет сценарий',
};

/** Two-line caption on the Mac: «BB · <agent> — Цель: <goal>» and the current step (readable default by tool and app). */
export function caption(agent: string, goal: string, tool: string, step: string | undefined, app: string | null): { title: string; step: string } {
  const who = `BB · ${agent.trim() || 'агент'}`;
  const g = goal.trim();
  return {
    title: (g ? `${who} — Цель: ${g}` : who).slice(0, 160),
    step: (step?.trim() || `${VERBS[tool] ?? 'работает'}${app ? ` в ${app}` : ''}`).slice(0, 120),
  };
}

/** AppleScript through the helper: needs in-app actions; with an allowlist every addressed app must be allowed. */
export function decideScript(policy: MachinePolicy, targets: string[]): { ok: true } | { ok: false; reason: string } {
  if (!policy.enabled) return { ok: false, reason: 'Доступ агентов к этому компьютеру выключен в настройках плагина Mac Computer Use.' };
  if (!policy.input) return { ok: false, reason: 'Действия в приложениях на этом компьютере выключены: AppleScript недоступен.' };
  if (!policy.apps.length) return { ok: true };
  if (!targets.length) return { ok: false, reason: 'Разрешены только отдельные приложения: в скрипте укажи tell application "<разрешённое>".' };
  const bad = targets.filter(t => !appAllowed(policy, { bundleId: t, name: t }));
  return bad.length ? { ok: false, reason: `Приложения не входят в список разрешённых: ${bad.join(', ')}.` } : { ok: true };
}

export type HostTraits = { id: string; name: string; hw: string | null };
export type Rebind = { from: string; to: string; reason: string };
export type BindCandidate = { orphan: string; hostId: string; reason: string };

/**
 * After a BB reinstall host IDs change. An entry whose host ID no longer exists
 * («orphan») moves to a current host only on an unambiguous hardware match:
 * exactly one orphan and exactly one current host without an entry share the
 * same hardware hash. A name-only match or any ambiguity never grants access —
 * it becomes a candidate for an explicit «Bind to this computer» click.
 */
export function rebindOrphans(file: PolicyFile, hosts: HostTraits[]): { file: PolicyFile; rebound: Rebind[]; candidates: BindCandidate[] } {
  const machines = { ...file.machines };
  const known = new Set(hosts.map(h => h.id));
  const free = hosts.filter(h => !machines[h.id]);
  const orphans = Object.keys(machines).filter(k => !known.has(k));
  const rebound: Rebind[] = [];
  const candidates: BindCandidate[] = [];
  for (const key of orphans) {
    const fp = machines[key]!.fingerprint ?? {};
    const hwHosts = fp.hw ? free.filter(h => h.hw === fp.hw) : [];
    const sameHw = fp.hw ? orphans.filter(k => machines[k]?.fingerprint?.hw === fp.hw) : [];
    if (hwHosts.length === 1 && sameHw.length === 1 && !machines[hwHosts[0]!.id]) {
      const h = hwHosts[0]!;
      machines[h.id] = { ...machines[key]!, fingerprint: { name: h.name, hw: fp.hw } };
      delete machines[key];
      rebound.push({ from: key, to: h.id, reason: `совпал аппаратный признак Mac (${h.name})` });
      continue;
    }
    // Doubt: offer an explicit bind, never apply it.
    const byName = fp.name ? free.filter(h => normName(h.name) === normName(fp.name!)) : [];
    for (const h of hwHosts.length ? hwHosts : byName)
      candidates.push({ orphan: key, hostId: h.id, reason: hwHosts.length ? 'совпал аппаратный признак, но вариантов несколько' : `совпало имя «${h.name}», аппаратный признак не подтверждён` });
  }
  return { file: { machines }, rebound, candidates };
}

/** Explicit user bind: moves one orphan entry to a host that has no entry yet. */
export function bindOrphan(file: PolicyFile, orphan: string, host: HostTraits): PolicyFile {
  const entry = file.machines[orphan];
  if (!entry) throw new Error('Запись доступа не найдена.');
  if (file.machines[host.id]) throw new Error('У этого компьютера уже есть своя запись доступа.');
  const machines = { ...file.machines };
  delete machines[orphan];
  machines[host.id] = { ...entry, fingerprint: { name: host.name, ...(host.hw ? { hw: host.hw } : {}) } };
  return { machines };
}
