import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { hostContract, rpcContract, type CallResult, type MachineView } from './contract';
import { scriptTargets } from './automation-applet';
import { appAllowed, bindOrphan, caption, collectPids, decide, decideScript, normName, parsePolicy, rebindOrphans, type BindCandidate, type HostTraits, policyFor, policyFileSchema, type MachinePolicy } from './policy';
export type { rpcContract } from './contract';

/** Developer ID team of Cua AI, Inc.: an install with another signer is refused. */
const CUA_TEAM_ID = 'YCK386LBJ7';
/** Driver tools agents may not call through this plugin: privacy, process kill, driver reconfiguration. */
const DEFAULT_DENY = 'kill_app,clipboard_read,set_config,install_extension,check_for_update,replay_trajectory,browser_download,browser_set_input_files';

/** The owner's rule: command line first, GUI only when nothing else works. */
const LADDER = 'Порядок для Mac: 1) командная строка через `bb terminal run --machine <mac>` (shell, open, defaults, CLI приложений) — без osascript к другим приложениям: иначе macOS спросит пользователя про «node»; 2) действия Accessibility без мыши (mac_action по element_token, set_value, invoke_menu) — новых запросов нет; 3) AppleScript только через mac_applescript (помощник «BB Automation», первое обращение к приложению — системный запрос, предупреди пользователя); 4) только если этого недостаточно — экран, мышь и клавиатура через mac_*. Перед GUI коротко объясни пользователю, почему не хватило ступеней 1–3.';
const whyParam = z.string().trim().min(8).max(300).describe('Обязательно: коротко, почему командной строки и скриптовых интерфейсов недостаточно (например: «нет AppleScript-словаря, нужна кнопка в окне»).');

const stepParam = z.string().trim().min(2).max(80).optional().describe('Подпись шага на экране Mac для человека, 2–6 слов: «печатает ответ в TextEdit». Без неё — подпись по умолчанию по инструменту.');

const goalParam = z.string().trim().min(3).max(100).optional().describe('Общая цель работы на Mac для человека у экрана: «проверить работу плагина». Задай один раз в начале — она запоминается для треда; по умолчанию — название треда.');

const machineParam = z.string().min(1).max(200).describe('Целевой Mac: ID машины BB (host_…) или её точное имя из `bb machine list`. Указывай явно.');

type ToolResult = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    accessPolicy: {
      type: 'string',
      label: 'Доступ по компьютерам (JSON; удобнее менять на экране ниже)',
      experimental_multiline: true,
      experimental_schema: z.string().refine(v => { try { policyFileSchema.parse(JSON.parse(v || '{}')); return true; } catch { return false; } }, 'Неверный JSON политики доступа'),
      default: '{"machines":{}}',
    },
    deniedTools: { type: 'string', label: 'Запрещённые инструменты Cua Driver (через запятую)', default: DEFAULT_DENY },
    maxImageWidth: { type: 'number', label: 'Максимальная ширина снимка экрана для агента, px', experimental_schema: z.number().int().min(480).max(4096), default: 1568 },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function policyOf(hostId: string): Promise<MachinePolicy> {
    let file = parsePolicy((await settings.get()).accessPolicy);
    // A missing entry may be one left from an earlier BB install: try a safe rebind first.
    if (!file.machines[hostId]) file = (await syncPolicy()).file;
    return policyFor(file, hostId);
  }

  const hwCache = new Map<string, string | null>();
  /** Current machines with their stable traits; the hardware hash comes from each connected Mac. */
  async function hostTraits(): Promise<HostTraits[]> {
    const list = await bb.sdk.hosts.list();
    return Promise.all(list.map(async h => {
      if (!hwCache.has(h.id) && h.status === 'connected') {
        const id = await host.call('identity', null, { hostId: h.id }).catch(() => null);
        if (id) hwCache.set(h.id, id.hw);
      }
      return { id: h.id, name: h.name, hw: hwCache.get(h.id) ?? null };
    }));
  }

  /**
   * Records traits on live entries, then moves entries left from an earlier BB
   * install to their computer on an unambiguous hardware match. Every move is
   * journaled; anything uncertain is only offered as a one-click bind.
   */
  async function syncPolicy(): Promise<{ file: ReturnType<typeof parsePolicy>; candidates: BindCandidate[] }> {
    const raw = (await settings.get()).accessPolicy;
    const file = parsePolicy(raw);
    const hosts = await hostTraits();
    for (const h of hosts) {
      const e = file.machines[h.id];
      if (!e) continue;
      const fp = { name: h.name, ...(h.hw ? { hw: h.hw } : e.fingerprint?.hw ? { hw: e.fingerprint.hw } : {}) };
      if (e.fingerprint?.name !== fp.name || e.fingerprint?.hw !== fp.hw) e.fingerprint = fp;
    }
    const r = rebindOrphans(file, hosts);
    const next = JSON.stringify(r.file);
    if (next !== JSON.stringify(parsePolicy(raw))) await settings.experimental_set({ accessPolicy: next });
    for (const x of r.rebound) {
      bb.log.info(`mac-computer-use: access entry ${x.from} → ${x.to}: ${x.reason}`);
      await journal({ machine: hosts.find(h => h.id === x.to)?.name ?? x.to, threadId: '—', tool: 'перепривязка доступа', why: `после переустановки BB: ${x.reason}`, result: `запись ${x.from} → ${x.to}` });
    }
    return { file: r.file, candidates: r.candidates };
  }

  /** Resolves an explicit machine reference to a connected macOS host with the driver. */
  async function resolveMac(ref: string): Promise<{ id: string; name: string }> {
    const machines = await bb.sdk.hosts.list();
    const needle = normName(ref);
    let match = machines.filter(h => h.id === ref.trim() || normName(h.name) === needle);
    // A unique partial name ("macbook") is unambiguous enough.
    if (!match.length && needle.length >= 3) match = machines.filter(h => normName(h.name).includes(needle));
    if (match.length !== 1) {
      const list = machines.map(h => `${h.name} (${h.id}, ${h.status})`).join('; ');
      throw new Error(`Машина «${ref}» не найдена однозначно. Доступные: ${list}`);
    }
    const m = match[0]!;
    if (m.status !== 'connected') throw new Error(`Машина ${m.name} (${m.id}) сейчас не подключена (${m.status}).`);
    const info = await host.call('info', null, { hostId: m.id });
    if (info.platform !== 'darwin') throw new Error(`${m.name} — не Mac (${info.platform}).`);
    if (!info.driver) throw new Error(`На ${m.name} не установлен Cua Driver: его ставят в настройках плагина Mac Computer Use.`);
    return { id: m.id, name: m.name };
  }

  function toResult(target: { name: string }, tool: string, r: CallResult): ToolResult {
    const notes = [`[${target.name}] ${tool} → ${r.ok ? 'ok' : `ошибка (код ${r.exitCode})`}`];
    if (r.image) {
      const k = r.image.originalWidth / r.image.width;
      notes.push(`Картинка ${r.image.width}×${r.image.height}` + (k > 1.001
        ? ` (уменьшена из ${r.image.originalWidth}×${r.image.originalHeight}: координаты x,y с картинки умножай на ${k.toFixed(4)})`
        : '; координаты x,y для click/drag — в пикселях этой картинки'));
    }
    if (/"snapshot_id"/.test(r.text))
      notes.push('element_token = <snapshot_id>:<номер в квадратных скобках>, например s00000006:1. Снимок и токены живут в сессии этого треда до следующего снимка окна. Если click по токену даёт AXPress/-25206 (текстовые поля), используй type_text/set_value с этим токеном или click по x,y.');
    if (/permissions?_pending|"accessibility": false|"screen_recording": false/i.test(r.text))
      notes.push('На Mac не выданы разрешения CuaDriver (Универсальный доступ / Запись экрана). Попроси пользователя включить их в настройках плагина Mac Computer Use.');
    const content: ToolResult['content'] = [{ type: 'text', text: `${notes.join('\n')}\n\n${r.text || '(пустой ответ)'}` }];
    if (r.image) content.push({ type: 'image', data: r.image.data, mimeType: r.image.mimeType });
    return r.ok ? { content } : { content, isError: true };
  }

  async function denied(tool: string): Promise<boolean> {
    const { deniedTools } = await settings.get();
    return String(deniedTools).split(',').map(s => s.trim()).filter(Boolean).includes(tool);
  }

  /** Policy check + app allowlist + driver call, all in one place for both agent tools. */
  async function guardedCall(machine: string, threadId: string, tool: string, args: Record<string, unknown>, why: string, step?: string, goal?: string): Promise<ToolResult> {
    if (await denied(tool)) return fail(`Инструмент ${tool} запрещён настройкой плагина Mac Computer Use (deniedTools).`);
    const target = await resolveMac(machine);
    const policy = await policyOf(target.id);
    const decision = decide(policy, tool, args);
    if (!decision.ok) { await journal({ machine: target.name, threadId, tool, why, result: `отказ: ${decision.reason}` }); return fail(`[${target.name}] ${decision.reason}`); }
    const pidsForName = decision.pids.length ? decision.pids : collectPids(args).slice(0, 1);
    const { apps } = pidsForName.length ? await host.call('apps', { pids: pidsForName }, { hostId: target.id }) : { apps: [] };
    if (decision.pids.length) {
      const blocked = apps.filter(a => !appAllowed(policy, a));
      if (blocked.length) { await journal({ machine: target.name, threadId, tool, why, result: 'отказ: приложение не разрешено' }); return fail(`[${target.name}] Приложение ${blocked.map(a => a.bundleId ?? a.name ?? a.pid).join(', ')} не входит в список разрешённых (${policy.apps.join(', ')}).`); }
    }
    const { maxImageWidth } = await settings.get();
    const session = `bb-${threadId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
    const appName = apps[0]?.name ?? (typeof args.app === 'string' ? args.app : null) ?? (decision.launchTarget ?? null);
    if (goal) await bb.storage.kv.set(`goal:${threadId}`, goal).catch(() => undefined);
    const lines = caption(await agentName(threadId), await goalOf(threadId), tool, step, appName);
    const display = { show: policy.showActions, foreground: policy.foreground, ...lines };
    const r = await host.call('call', { tool, args: JSON.stringify(args), session, wantImage: policy.screen, maxImageWidth: Number(maxImageWidth) || 1568, display }, { hostId: target.id, timeoutMs: 180_000 });
    if (r.text.startsWith('STOPPED_BY_USER')) {
      await journal({ machine: target.name, threadId, tool, why, result: 'остановлено пользователем' });
      return fail(`[${target.name}] Пользователь нажал «Остановить агента» на Mac: GUI-доступ для этого треда отозван. Не повторяй GUI-действия и не обходи остановку; сообщи пользователю и жди его решения (снять остановку можно в настройках плагина).`);
    }
    await journal({ machine: target.name, threadId, tool, why, result: r.ok ? 'ok' : `ошибка ${r.exitCode}` });
    const res = toResult(target, tool, r);
    res.content[0] = { type: 'text', text: `Причина GUI: ${why}\n${(res.content[0] as { text: string }).text}` };
    return res;
  }

  /** Goal line for the caption: set once per thread by the agent, else the thread title. */
  async function goalOf(threadId: string): Promise<string> {
    const saved = await bb.storage.kv.get<string>(`goal:${threadId}`).catch(() => null);
    if (saved) return saved;
    try { return ((await bb.sdk.threads.get({ threadId }) as { title?: string | null }).title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100); } catch { return ''; }
  }

  const names = new Map<string, string>();
  /** Human name for the caption: the thread's project, else the thread title. */
  async function agentName(threadId: string): Promise<string> {
    if (names.has(threadId)) return names.get(threadId)!;
    let name = '';
    try {
      const thread = await bb.sdk.threads.get({ threadId }) as { title?: string | null; projectId?: string | null };
      if (thread.projectId) {
        const list = await bb.sdk.projects.list({ includePersonal: true }).catch(() => []) as { id: string; name?: string }[];
        name = list.find(p => p.id === thread.projectId)?.name ?? '';
      }
      if (!name) name = thread.title ?? '';
    } catch { name = ''; }
    name = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    names.set(threadId, name);
    return name;
  }

  type JournalEntry = { at: number; machine: string; threadId: string; tool: string; why: string; result: string };
  /** Last GUI actions with the agent's reason, shown on the settings screen. */
  async function journal(e: Omit<JournalEntry, 'at'>): Promise<void> {
    try {
      const list = (await bb.storage.kv.get<JournalEntry[]>('journal')) ?? [];
      list.unshift({ at: Date.now(), ...e, why: e.why.slice(0, 300), result: e.result.slice(0, 200) });
      await bb.storage.kv.set('journal', list.slice(0, 100));
    } catch { /* the journal never blocks an action */ }
  }

  bb.agents.registerTool({
    name: 'mac_screenshot',
    description: 'GUI-уровень (последняя ступень после командной строки и скриптовых интерфейсов). Снимок экрана подключённого Mac. Без pid — весь основной дисплей (get_desktop_state). С pid и window_id — одно окно: дерево доступности (element_token = snapshot_id:номер) + скриншот (get_window_state). Возвращает картинку.',
    instructions: `${LADDER} Подробности — навык mac-computer-use. Действия, которые отправляют сообщения, покупают, удаляют или публикуют, — только после явного подтверждения пользователя.`,
    presentation: { label: { pending: 'Смотрю экран Mac', completed: 'Снимок экрана Mac' }, icon: { glyph: 'Monitor' } },
    parameters: z.object({
      machine: machineParam,
      pid: z.number().int().positive().optional().describe('PID приложения (из mac_action list_apps / list_windows).'),
      window_id: z.number().int().positive().optional().describe('ID окна (из list_windows); вместе с pid.'),
      why_gui: whyParam,
      step: stepParam,
      goal: goalParam,
    }),
    async execute({ machine, pid, window_id, why_gui, step, goal }, { threadId }) {
      const tool = pid !== undefined ? 'get_window_state' : 'get_desktop_state';
      const args = pid !== undefined ? { pid, ...(window_id !== undefined ? { window_id } : {}) } : {};
      return guardedCall(machine, threadId, tool, args, why_gui, step, goal);
    },
  });

  bb.agents.registerTool({
    name: 'mac_action',
    description: 'GUI-уровень (последняя ступень: сначала bb terminal — shell/osascript/CLI, затем AppleScript/Shortcuts/API). Вызвать инструмент Cua Driver на Mac: list_apps, list_windows, launch_app, bring_to_front, click, double_click, right_click, type_text, press_key, hotkey, scroll, drag, move_cursor, set_value, invoke_menu, zoom, run_steps и др. args — JSON-объект по схеме инструмента (mac_tool_info). Сессия драйвера на тред подставляется сама. Скриншот из ответа возвращается картинкой.',
    presentation: { label: { pending: 'Действие на Mac', completed: 'Действие на Mac выполнено' }, icon: { glyph: 'MousePointerClick' } },
    parameters: z.object({
      machine: machineParam,
      tool: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).describe('Имя инструмента Cua Driver, например click или type_text.'),
      args: z.record(z.string(), z.unknown()).default({}).describe('Аргументы инструмента (JSON-объект).'),
      why_gui: whyParam,
      step: stepParam,
      goal: goalParam,
    }),
    async execute({ machine, tool, args, why_gui, step, goal }, { threadId }) {
      return guardedCall(machine, threadId, tool, args ?? {}, why_gui, step, goal);
    },
  });

  bb.agents.registerTool({
    name: 'mac_applescript',
    description: 'AppleScript на Mac через помощника «BB Automation» (ступень 3 после командной строки и действий Accessibility). Только когда нужно то, чего нет в командной строке и в mac_action по element_token, — например словарь приложения. Первое обращение к каждому приложению вызывает системный запрос macOS «"BB Automation" хочет управлять …» — заранее предупреди пользователя. Не запускай osascript к приложениям через bb terminal: запрос тогда придёт от «node».',
    presentation: { label: { pending: 'AppleScript на Mac', completed: 'AppleScript на Mac выполнен' }, icon: { glyph: 'Code' } },
    parameters: z.object({
      machine: machineParam,
      script: z.string().min(1).max(50_000).describe('Текст AppleScript (tell application "…" …). Результат возвращается как текст.'),
      why: z.string().trim().min(8).max(300).describe('Обязательно: почему не хватило командной строки и действий Accessibility.'),
      timeout_s: z.number().int().min(1).max(300).default(60).describe('Ожидание результата, с. Если на Mac открыт системный запрос, ждём ответа пользователя.'),
      step: stepParam,
      goal: goalParam,
    }),
    async execute({ machine, script, why, timeout_s, step, goal }, { threadId }) {
      const target = await resolveMac(machine);
      const policy = await policyOf(target.id);
      const targets = scriptTargets(script);
      const d = decideScript(policy, targets);
      if (!d.ok) { await journal({ machine: target.name, threadId, tool: 'applescript', why, result: `отказ: ${d.reason}` }); return fail(`[${target.name}] ${d.reason}`); }
      if (goal) await bb.storage.kv.set(`goal:${threadId}`, goal).catch(() => undefined);
      const session = `bb-${threadId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
      const lines = caption(await agentName(threadId), await goalOf(threadId), 'applescript', step ?? `управляет ${targets.join(', ') || 'приложением'} через AppleScript`, null);
      const timeoutMs = (timeout_s ?? 60) * 1000;
      const r = await host.call('applescript', { script, timeoutMs, display: policy.showActions ? { ...lines, session } : null }, { hostId: target.id, timeoutMs: timeoutMs + 30_000 });
      if (r.text.startsWith('STOPPED_BY_USER')) {
        await journal({ machine: target.name, threadId, tool: 'applescript', why, result: 'остановлено пользователем' });
        return fail(`[${target.name}] Пользователь нажал «Остановить агента» на Mac: доступ этого треда отозван. Не повторяй и не обходи остановку.`);
      }
      await journal({ machine: target.name, threadId, tool: 'applescript', why, result: r.ok ? 'ok' : r.timedOut ? 'нет ответа (ждёт системного запроса?)' : 'ошибка' });
      const text = `[${target.name}] AppleScript → ${r.ok ? 'ok' : 'ошибка'} (приложения: ${targets.join(', ') || '—'})\n\n${r.text}`;
      return r.ok ? text : fail(text);
    },
  });

  bb.agents.registerTool({
    name: 'mac_tool_info',
    description: 'Справка Cua Driver на Mac: без tool — короткий список инструментов; с tool — описание и аргументы; tool="status" — служба, разрешения macOS и доступ, выданный в настройках плагина.',
    presentation: { label: { pending: 'Читаю справку Cua Driver', completed: 'Справка Cua Driver' }, icon: { glyph: 'BookOpen' }, suppress: true },
    parameters: z.object({
      machine: machineParam,
      tool: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
    }),
    async execute({ machine, tool }) {
      const target = await resolveMac(machine);
      if (tool === 'status') {
        const p = await policyOf(target.id);
        const access = `Доступ в BB: ${p.enabled ? 'включён' : 'ВЫКЛЮЧЕН'}; экран: ${p.screen ? 'да' : 'нет'}; управление: ${p.input ? 'да' : 'нет'}; мышь по координатам: ${p.pointer ? 'да' : 'нет'}; показ действий на экране: ${p.showActions ? 'да' : 'нет'}; вывод окна вперёд: ${p.foreground ? 'да' : 'нет'}; приложения: ${p.apps.length ? p.apps.join(', ') : 'все'}`;
        return `[${target.name}] ${access}\n${LADDER}\n${(await host.call('status', null, { hostId: target.id })).text}`;
      }
      return `[${target.name}]\n${(await host.call('describe', { tool: tool ?? null }, { hostId: target.id })).text}`;
    },
  });

  // ---- Settings screen ----

  let latestCache: { at: number; version: string | null } | null = null;
  /** Latest cua-driver-rs X.Y.Z release on GitHub (upstream marks them all pre-release; nightlies have a longer tag), cached for an hour. */
  async function latestDriver(): Promise<string | null> {
    if (latestCache && Date.now() - latestCache.at < 3_600_000) return latestCache.version;
    let version: string | null = null;
    try {
      const res = await fetch('https://api.github.com/repos/trycua/cua/releases?per_page=100', { headers: { accept: 'application/vnd.github+json', 'user-agent': 'bb-plugin-mac-computer-use' }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const list = await res.json() as { tag_name: string; prerelease: boolean; draft: boolean }[];
        version = list.map(r => (!r.draft ? /^cua-driver-rs-v(\d+\.\d+\.\d+)$/.exec(r.tag_name)?.[1] : undefined)).find(Boolean) ?? null;
      }
    } catch { version = null; }
    latestCache = { at: Date.now(), version };
    return version;
  }

  async function describeMachine(h: { id: string; name: string; status: string }): Promise<MachineView> {
    const policy = await policyOf(h.id);
    const view: MachineView = { id: h.id, name: h.name, connected: h.status === 'connected', platform: null, driverVersion: null, permissions: null, error: null, policy };
    if (!view.connected) return view;
    try {
      const info = await host.call('info', null, { hostId: h.id });
      view.platform = info.platform;
      view.driverVersion = info.version;
      if (info.platform === 'darwin' && info.driver) view.permissions = await host.call('permissions', null, { hostId: h.id });
    } catch (e) { view.error = e instanceof Error ? e.message : String(e); }
    return view;
  }

  bb.rpc.register(rpcContract, {
    overview: async () => {
      const synced = await syncPolicy();
      const machines = await bb.sdk.hosts.list();
      const known = new Set(machines.map(m => m.id));
      const [views, latest] = await Promise.all([Promise.all(machines.map(describeMachine)), latestDriver()]);
      const candidates = synced.candidates.map(c => ({ ...c, entryName: synced.file.machines[c.orphan]?.fingerprint?.name ?? c.orphan }));
      return { machines: views, latestDriver: latest, candidates, orphans: Object.keys(synced.file.machines).filter(k => !known.has(k)).length };
    },
    setPolicy: async ({ hostId, policy }) => {
      const file = parsePolicy((await settings.get()).accessPolicy);
      const traits = (await hostTraits()).find(h => h.id === hostId);
      file.machines[hostId] = { ...policy, fingerprint: traits ? { name: traits.name, ...(traits.hw ? { hw: traits.hw } : {}) } : policy.fingerprint };
      await settings.experimental_set({ accessPolicy: JSON.stringify(file) });
      return { ok: true };
    },
    bindOrphan: async ({ orphan, hostId }) => {
      const file = parsePolicy((await settings.get()).accessPolicy);
      const traits = (await hostTraits()).find(h => h.id === hostId);
      if (!traits) throw new Error('Компьютер не найден.');
      await settings.experimental_set({ accessPolicy: JSON.stringify(bindOrphan(file, orphan, traits)) });
      bb.log.info(`mac-computer-use: access entry ${orphan} bound to ${hostId} by the user`);
      await journal({ machine: traits.name, threadId: '—', tool: 'привязка доступа', why: 'нажата «Привязать к этому компьютеру»', result: `запись ${orphan} → ${hostId}` });
      return { ok: true };
    },
    check: async ({ hostId }) => {
      const [h] = (await bb.sdk.hosts.list()).filter(m => m.id === hostId);
      if (!h) return { ok: false, message: 'Компьютер не найден.', image: null };
      const v = await describeMachine(h);
      if (!v.connected) return { ok: false, message: 'Компьютер не на связи с BB.', image: null };
      if (v.platform !== 'darwin') return { ok: false, message: 'Это не Mac.', image: null };
      if (!v.driverVersion) return { ok: false, message: 'Cua Driver не установлен.', image: null };
      if (!v.permissions?.accessibility || !v.permissions.screenRecording) return { ok: false, message: 'Не выданы разрешения macOS для CuaDriver.', image: null };
      const r = await host.call('call', { tool: 'get_desktop_state', args: '{}', session: 'bb-settings-check', wantImage: true, maxImageWidth: 480 }, { hostId });
      return { ok: r.ok && !!r.image, message: r.ok ? 'Связь есть: снимок экрана получен.' : r.text.slice(0, 500), image: r.image ? { data: r.image.data, mimeType: r.image.mimeType } : null };
    },
    install: async ({ hostId }) => {
      const version = await latestDriver();
      if (!version) return { ok: false, log: 'Не удалось узнать последнюю версию Cua Driver на GitHub.' };
      return host.call('install', { version, teamId: CUA_TEAM_ID }, { hostId, timeoutMs: 600_000 });
    },
    grant: async ({ hostId }) => host.call('grant', null, { hostId }),
    stopped: async () => {
      const entries: { hostId: string; machine: string; session: string; threadId: string; title: string; at: number }[] = [];
      for (const h of (await bb.sdk.hosts.list()).filter(m => m.status === 'connected')) {
        const info = await host.call('info', null, { hostId: h.id }).catch(() => null);
        if (info?.platform !== 'darwin' || !info.driver) continue;
        const { sessions } = await host.call('stopped', null, { hostId: h.id }).catch(() => ({ sessions: [] as { session: string; at: number }[] }));
        for (const s of sessions) {
          const threadId = s.session.replace(/^bb-/, '');
          let title = '';
          try { title = (await bb.sdk.threads.get({ threadId }) as { title?: string | null }).title ?? ''; } catch { title = ''; }
          entries.push({ hostId: h.id, machine: h.name, session: s.session, threadId, title, at: s.at });
        }
      }
      return { entries };
    },
    unstop: async ({ hostId, session }) => host.call('unstop', { session }, { hostId }),
    journal: async () => ({ entries: ((await bb.storage.kv.get<JournalEntry[]>('journal')) ?? []).slice(0, 30) }),
  });
}
