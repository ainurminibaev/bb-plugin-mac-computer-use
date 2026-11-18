// Settings screen: which computers agents may control and how, driver install,
// macOS permission status and a live connection check.
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { definePluginApp, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract, MachineView } from './contract';
import type { MachinePolicy } from './policy';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Flag({ ok, label }: { ok: boolean | null; label: string }) {
  return <span className="inline-flex items-center gap-1.5 text-sm">
    <span aria-hidden className={`size-2 rounded-full ${ok === null ? 'bg-slate-400' : ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
    {label}: <span className="text-muted-foreground">{ok === null ? 'нет данных' : ok ? 'включено' : 'выключено'}</span>
  </span>;
}

function Toggle({ checked, disabled, label, hint, onChange }: { checked: boolean; disabled?: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return <label className={`flex items-start gap-2.5 py-1 text-sm ${disabled ? 'opacity-50' : ''}`}>
    <Checkbox className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={v => onChange(v === true)} />
    <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
  </label>;
}

function MacCard({ m, latest, rpc, reload }: { m: MachineView; latest: string | null; rpc: Rpc; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [apps, setApps] = useState(m.policy.apps.join(', '));
  useEffect(() => setApps(m.policy.apps.join(', ')), [m.policy.apps.join('|')]);

  const act = useCallback(async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name); setNote(null);
    try { const msg = await fn(); if (msg) setNote(msg); } catch (e) { setNote(errText(e)); } finally { setBusy(null); reload(); }
  }, [reload]);
  const save = (patch: Partial<MachinePolicy>) => act('policy', async () => { await rpc.call('setPolicy', { hostId: m.id, policy: { ...m.policy, ...patch } }); });
  const p = m.permissions;
  const outdated = !!(m.driverVersion && latest && m.driverVersion !== latest);

  return <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
    <div className="flex items-center gap-2">
      <Icon name="Laptop" className="size-4 text-muted-foreground" />
      <span className="flex-1 truncate font-semibold" title={m.id}>{m.name}</span>
      <span className="text-xs text-muted-foreground">{m.connected ? 'на связи' : 'офлайн'}</span>
      <span aria-hidden className={`size-1.5 rounded-full ${m.connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
    </div>
    {m.error && <p role="alert" className="text-xs text-destructive">{m.error}</p>}

    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Cua Driver: <span className="text-muted-foreground">{m.driverVersion ?? 'не установлен'}{outdated ? ` (есть ${latest})` : ''}</span></span>
        {m.connected && (!m.driverVersion || outdated) && <Button size="sm" variant="outline" disabled={!!busy || !latest}
          onClick={() => act('install', async () => { const r = await rpc.call('install', { hostId: m.id }); return r.log; })}>
          {busy === 'install' ? 'Устанавливаю…' : m.driverVersion ? `Обновить до ${latest}` : `Установить ${latest ?? ''}`}
        </Button>}
      </div>
      {m.driverVersion && <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Flag ok={p ? p.accessibility : null} label="Универсальный доступ" />
        <Flag ok={p ? p.screenRecording : null} label="Запись экрана" />
        {p && (!p.accessibility || !p.screenRecording) && <Button size="sm" variant="outline" disabled={!!busy}
          onClick={() => act('grant', async () => { await rpc.call('grant', { hostId: m.id }); return 'На Mac открылся мастер Cua Driver. Включите CuaDriver в «Системные настройки → Конфиденциальность и безопасность → Универсальный доступ» и «Запись экрана и системного звука», затем нажмите «Обновить».'; })}>
          Открыть мастер разрешений
        </Button>}
      </div>}
    </div>

    <div className="border-t border-border/60 pt-2">
      <p className="pb-1 text-xs text-muted-foreground">Кому: агентам всех тредов BB. Что (GUI): {[m.policy.screen && 'экран', m.policy.input && 'действия в приложениях', m.policy.input && m.policy.pointer && 'мышь по координатам'].filter(Boolean).join(', ') || 'ничего'}; приложения: {m.policy.apps.length ? m.policy.apps.join(', ') : 'все'}.</p>
      <div>
        <Toggle checked={m.policy.screen} disabled={!!busy || !m.policy.enabled} label="Видеть экран" hint="Снимки экрана и окон, дерево элементов." onChange={v => save({ screen: v })} />
        <Toggle checked={m.policy.input} disabled={!!busy || !m.policy.enabled} label="Действия в приложениях" hint="Нажатия кнопок и меню, ввод текста, клавиши, запуск приложений — через Accessibility." onChange={v => save({ input: v })} />
        <div className="ml-6"><Toggle checked={m.policy.pointer} disabled={!!busy || !m.policy.enabled || !m.policy.input} label="Мышь по координатам" hint="Клики и перетаскивание по точке экрана, движение курсора, вывод окна на передний план. Выключите, чтобы агенты работали только через элементы интерфейса." onChange={v => save({ pointer: v })} /></div>
        <Toggle checked={m.policy.showActions} disabled={!!busy || !m.policy.enabled} label="Показывать действия агента на экране" hint="Подсвеченный курсор агента и плашка: цель («BB · агент — Цель: …») и текущий шаг, с кнопкой «Остановить агента». Поверх всех окон, гаснет через несколько секунд, фокус не забирает." onChange={v => save({ showActions: v })} />
        <Toggle checked={m.policy.foreground} disabled={!!busy || !m.policy.enabled || !m.policy.input} label="Выводить окно на передний план" hint="Перед действием активировать окно приложения. По умолчанию выключено: агент работает в фоне и не мешает." onChange={v => save({ foreground: v })} />
        <div className="py-1 text-sm">
          <span className="font-medium">Только эти приложения</span>
          <span className="block text-xs text-muted-foreground">Bundle ID или имя через запятую, например com.apple.TextEdit, Notes. Пусто — все приложения. Со списком снимок всего экрана недоступен.</span>
          <div className="mt-1 flex gap-2">
            <Input value={apps} disabled={!!busy || !m.policy.enabled} placeholder="все приложения" onChange={e => setApps(e.target.value)} className="h-8" />
            <Button size="sm" variant="outline" disabled={!!busy || !m.policy.enabled || apps === m.policy.apps.join(', ')}
              onClick={() => save({ apps: apps.split(',').map(s => s.trim()).filter(Boolean) })}>Сохранить</Button>
          </div>
        </div>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={!!busy || !m.connected} onClick={() => act('check', async () => { const r = await rpc.call('check', { hostId: m.id }); setShot(r.image ? `data:${r.image.mimeType};base64,${r.image.data}` : null); return r.message; })}>
        {busy === 'check' ? 'Проверяю…' : 'Проверить связь'}
      </Button>
      {m.policy.enabled && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => save({ enabled: false })}>Забрать доступ</Button>}
      {busy === 'policy' && <span className="text-xs text-muted-foreground">Сохраняю…</span>}
    </div>
    {note && <pre className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">{note}</pre>}
    {shot && <img src={shot} alt={`Снимок экрана ${m.name}`} className="max-w-full rounded border border-border" />}
  </div>;
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }) {
  return <li className={`flex gap-3 ${!done && !active ? 'opacity-50' : ''}`}>
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-emerald-500 text-white' : 'bg-muted text-foreground'}`}>{done ? '✓' : n}</span>
    <div className="min-w-0 flex-1 space-y-1.5 pb-2"><p className="text-sm font-medium">{title}</p>{active && children}</div>
  </li>;
}

/** Step-by-step connection of one Mac that agents cannot use yet. */
function Wizard({ m, latest, rpc, reload, onClose }: { m: MachineView; latest: string | null; rpc: Rpc; reload: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [screen, setScreen] = useState(true);
  const [input, setInput] = useState(true);
  const [pointer, setPointer] = useState(true);
  const [apps, setApps] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const run = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name); setNote(null);
    try { const msg = await fn(); if (msg) setNote(msg); } catch (e) { setNote(errText(e)); } finally { setBusy(null); reload(); }
  };
  const driver = !!m.driverVersion;
  const perms = !!(m.permissions?.accessibility && m.permissions.screenRecording);
  const granted = m.policy.enabled;
  return <div className="space-y-3 rounded-lg border border-primary/40 p-3">
    <div className="flex items-center gap-2"><Icon name="Wand2" className="size-4" /><span className="flex-1 font-semibold">Подключение: {m.name}</span>
      <Button size="sm" variant="ghost" onClick={onClose}>Закрыть</Button></div>
    <ol className="space-y-1">
      <Step n={1} title="Компьютер на связи с BB" done={m.connected} active={!m.connected}>
        <p className="text-xs text-muted-foreground">Запустите BB на этом Mac и дождитесь статуса «на связи».</p>
      </Step>
      <Step n={2} title="Установить Cua Driver" done={driver} active={m.connected && !driver}>
        <p className="text-xs text-muted-foreground">Архив релиза проверяется по SHA-256, подписи Developer ID (Cua AI, Inc.) и Gatekeeper. Телеметрия выключается.</p>
        <Button size="sm" disabled={!!busy || !latest} onClick={() => run('install', async () => (await rpc.call('install', { hostId: m.id })).log)}>{busy === 'install' ? 'Устанавливаю…' : `Установить ${latest ?? ''}`}</Button>
      </Step>
      <Step n={3} title="Разрешения macOS" done={perms} active={driver && !perms}>
        <p className="text-xs text-muted-foreground">На самом Mac: «Системные настройки → Конфиденциальность и безопасность» → «Универсальный доступ» и «Запись экрана и системного звука» → включите CuaDriver. Если macOS предложит перезапуск — согласитесь.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!busy} onClick={() => run('grant', async () => { await rpc.call('grant', { hostId: m.id }); return 'Мастер открыт на Mac. Включите переключатели и нажмите «Проверить снова».'; })}>Открыть мастер на Mac</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={reload}>Проверить снова</Button>
        </div>
      </Step>
      <Step n={4} title="Выдать GUI-доступ агентам" done={granted} active={perms && !granted}>
        <Toggle checked={screen} label="Видеть экран" onChange={setScreen} />
        <Toggle checked={input} label="Действия в приложениях (Accessibility)" onChange={setInput} />
        <Toggle checked={pointer && input} disabled={!input} label="Мышь по координатам" onChange={setPointer} />
        <Input value={apps} placeholder="Только эти приложения (через запятую), пусто — все" onChange={e => setApps(e.target.value)} className="h-8" />
        <Button size="sm" disabled={!!busy} onClick={() => run('policy', async () => { await rpc.call('setPolicy', { hostId: m.id, policy: { enabled: true, screen, input, pointer: pointer && input, showActions: true, foreground: false, apps: apps.split(',').map(x => x.trim()).filter(Boolean) } }); })}>Выдать доступ</Button>
      </Step>
      <Step n={5} title="Проверить связь" done={!!shot} active={granted}>
        <Button size="sm" disabled={!!busy} onClick={() => run('check', async () => { const r = await rpc.call('check', { hostId: m.id }); setShot(r.image ? `data:${r.image.mimeType};base64,${r.image.data}` : null); return r.message; })}>{busy === 'check' ? 'Проверяю…' : 'Проверить'}</Button>
      </Step>
    </ol>
    {note && <pre className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">{note}</pre>}
    {shot && <img src={shot} alt={`Снимок экрана ${m.name}`} className="max-w-full rounded border border-border" />}
  </div>;
}

type Stopped = { hostId: string; machine: string; session: string; threadId: string; title: string; at: number };
function StoppedAgents({ rpc }: { rpc: Rpc }) {
  const [list, setList] = useState<Stopped[] | null>(null);
  const load = useCallback(() => { rpc.call('stopped', null).then(r => setList(r.entries), () => setList([])); }, [rpc]);
  useEffect(load, [load]);
  if (!list?.length) return null;
  return <section className="space-y-2 rounded-lg border border-amber-500/50 p-3 text-sm">
    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Остановлены кнопкой на Mac · {list.length}</h3>
    {list.map(e => <div key={e.hostId + e.session} className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{e.title || e.threadId} <span className="text-xs text-muted-foreground">· {e.machine} · {new Date(e.at).toLocaleString()}</span></span>
      <Button size="sm" variant="outline" onClick={() => rpc.call('unstop', { hostId: e.hostId, session: e.session }).then(load)}>Разрешить снова</Button>
    </div>)}
    <p className="text-xs text-muted-foreground">Остановка действует 12 часов или до «Разрешить снова». Другие треды продолжают работать по настройкам компьютера.</p>
  </section>;
}

type Entry = { at: number; machine: string; threadId: string; tool: string; why: string; result: string };
function Journal({ rpc }: { rpc: Rpc }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const load = useCallback(() => { rpc.call('journal', null).then(r => setEntries(r.entries), () => setEntries([])); }, [rpc]);
  useEffect(load, [load]);
  return <details className="rounded-lg border border-border p-3 text-sm" onToggle={load}>
    <summary className="cursor-pointer font-medium">Журнал GUI-действий и их причины</summary>
    {!entries?.length ? <p className="mt-2 text-muted-foreground">Пока пусто.</p> : <ul className="mt-2 space-y-1.5">{entries.map((e, i) => <li key={i} className="text-xs">
      <span className="text-muted-foreground">{new Date(e.at).toLocaleString()} · {e.machine} · {e.threadId}</span><br />
      <span className="font-mono">{e.tool}</span> → {e.result}. <span className="text-muted-foreground">Почему GUI: {e.why}</span>
    </li>)}</ul>}
  </details>;
}

function Screen() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<{ machines: MachineView[]; latestDriver: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<string | null>(null);
  const reload = useCallback(() => { rpc.call('overview', null).then(d => { setData(d); setError(null); }, e => setError(errText(e))); }, [rpc]);
  useEffect(reload, [reload]);
  const all = data?.machines ?? [];
  const granted = all.filter(m => m.policy.enabled);
  const candidates = all.filter(m => !m.policy.enabled && m.platform === 'darwin');
  const others = all.filter(m => !m.policy.enabled && m.platform !== 'darwin');
  const wizardMachine = all.find(m => m.id === wizard) ?? null;
  const latest = data?.latestDriver ?? null;

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-2">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Здесь выдаётся GUI-доступ — экран, действия в приложениях, мышь — агентам всех тредов BB (инструменты mac_screenshot, mac_action). Компьютер без доступа закрыт.</p>
        <p>Правило для агентов: сначала командная строка (bb terminal: shell, open, osascript), затем скриптовые интерфейсы (AppleScript, Shortcuts, API), и только потом GUI — с объяснением причины. Командный доступ через bb terminal этой настройкой не управляется.</p>
      </div>
      <Button size="sm" variant="ghost" aria-label="Обновить" onClick={reload}><Icon name="RefreshCw" className="size-3.5" /></Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!data && !error && <p className="text-sm text-muted-foreground">Загрузка…</p>}

    {wizardMachine && <Wizard m={wizardMachine} latest={latest} rpc={rpc} reload={reload} onClose={() => setWizard(null)} />}

    {data && <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">С GUI-доступом агентов · {granted.length}</h3>
      {!granted.length && <p className="text-sm text-muted-foreground">Пока ни одного компьютера.</p>}
      {granted.map(m => <MacCard key={m.id} m={m} latest={latest} rpc={rpc} reload={reload} />)}
    </section>}

    {data && <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Без GUI-доступа</h3>
      {candidates.map(m => <div key={m.id} className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
        <Icon name="Laptop" className="size-4 text-muted-foreground" />
        <span className="flex-1 truncate">{m.name}</span>
        <span className="text-xs text-muted-foreground">{!m.connected ? 'офлайн' : !m.driverVersion ? 'драйвер не установлен' : m.permissions?.accessibility && m.permissions.screenRecording ? 'готов к подключению' : 'нужны разрешения macOS'}</span>
        <Button size="sm" variant="outline" onClick={() => setWizard(m.id)}>Подключить</Button>
      </div>)}
      {!candidates.length && <p className="text-sm text-muted-foreground">Нет других Mac. Подключите Mac к BB (Settings → Machines) — он появится здесь.</p>}
      {others.length > 0 && <p className="text-xs text-muted-foreground">Не Mac или офлайн: {others.map(m => m.name).join(', ')}.</p>}
    </section>}
    {data && <StoppedAgents rpc={rpc} />}
    {data && <Journal rpc={rpc} />}
  </div>;
}

export default definePluginApp(app => {
  app.slots.settingsSection({ id: 'machines', title: 'Компьютеры и доступ', component: Screen });
});
