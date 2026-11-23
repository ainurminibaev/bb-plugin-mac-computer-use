// Overlay v3 (JXA). Kept as a string so the host bundle can write it to disk.
export const OVERLAY_JXA = String.raw`// BB Mac Computer Use — overlay v3 (JXA): shows which agent works on this Mac and why.
// osascript -l JavaScript overlay.jxa.js <state.json> <parentPid>
// - agent pointer: a soft blue glow under the REAL pointer (no second arrow)
//   with a small label; before an action the pointer glides to the target at 60 fps;
// - session HUD: a translucent bar above the Dock (draggable, position kept)
//   with goal, live progress (spinner, step number, current step, elapsed time)
//   and a Stop button; visible for the whole session, hidden on session end,
//   Stop, long inactivity or when the parent host process dies;
// - never activates or takes focus; one instance (pid file); exits when idle.
ObjC.import('Cocoa'); ObjC.import('CoreGraphics'); ObjC.import('unistd'); ObjC.import('signal');

function run(argv) {
  const statePath = argv[0], parentPid = Number(argv[1] || 0);
  const dry = argv[2] === 'dry';                            // test mode: run everything, never put a window on screen
  const front = p => { if (!dry) p.orderFrontRegardless; };
  const dir = statePath.replace(/[^/]+$/, '');
  const pidPath = dir + 'overlay.pid', ackPath = dir + 'move-ack.json', stopPath = dir + 'stop-request.json', posPath = dir + 'hud-position.json';
  const fm = $.NSFileManager.defaultManager;
  const readText = p => { const s = $.NSString.stringWithContentsOfFileEncodingError($(p), 4, null); return s.isNil() ? null : s.js; };
  const writeText = (p, t) => $(t).writeToFileAtomicallyEncodingError($(p), true, 4, null);
  const myPid = $.getpid();
  const other = Number(readText(pidPath) || 0);
  if (other && other !== myPid && $.kill(other, 0) === 0) return 'already running';
  writeText(pidPath, String(myPid));

  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(1); app.finishLaunching;
  const reduceMotion = !!$.NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  const C = c => $.NSColor.colorWithCalibratedRedGreenBlueAlpha(c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]);
  const cg = c => $.CGColorCreateGenericRGB(c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]); // NSColor.CGColor crashes the JXA bridge
  const THEMES = {
    dark:   { fill: [0.09, 0.09, 0.10, 0.72], border: [1, 1, 1, 0.12], title: [1, 1, 1, 0.66], step: [1, 1, 1, 0.96], accent: [0.04, 0.52, 1.0] },
    light:  { fill: [1, 1, 1, 0.80], border: [0, 0, 0, 0.10], title: [0, 0, 0, 0.56], step: [0, 0, 0, 0.88], accent: [0.0, 0.45, 0.95] },
    accent: { fill: [0.04, 0.40, 0.92, 0.82], border: [1, 1, 1, 0.20], title: [1, 1, 1, 0.80], step: [1, 1, 1, 1], accent: [0.04, 0.52, 1.0] },
  };
  let T = THEMES.dark, themeName = '';
  const SH = () => $.NSScreen.screens.objectAtIndex(0).frame.size.height;
  const cursor = () => { const p = $.CGEventGetLocation($.CGEventCreate(null)); return { x: p.x, y: p.y }; };

  function panel(w, h, clickThrough) {
    const p = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, w, h), 0 | (1 << 7), 2, false);
    p.setOpaque(false); p.setBackgroundColor($.NSColor.clearColor); p.setHasShadow(false);
    p.setIgnoresMouseEvents(clickThrough); p.setLevel(1000);
    p.setCollectionBehavior(1 | 16 | 256); p.setHidesOnDeactivate(false);
    p.contentView.setWantsLayer(true); p.setAlphaValue(0);
    return p;
  }

  // ---- Agent pointer: drawn arrow + label, tip on the real pointer tip ----
  const PW = 240, PH = 44, TIP = { x: 4, y: 4 };           // tip offset from the panel's top-left
  const ptr = panel(PW, PH, true);
  const ptrView = $.NSImageView.alloc.initWithFrame($.NSMakeRect(0, 0, PW, PH));
  ptr.contentView.addSubview(ptrView);
  let ptrLabel = '';
  function drawPointer(label) {
    if (label === ptrLabel && themeName) return; ptrLabel = label;
    const img = $.NSImage.alloc.initWithSize($.NSMakeSize(PW, PH));
    img.lockFocus;
    const Y = y => PH - y;
    // One pointer only: no drawn arrow. A soft blue glow sits under the body of
    // the real system pointer (which macOS draws on top) and a label follows it.
    const gx = TIP.x + 7, gy = TIP.y + 11;
    for (let r = 17; r >= 3; r -= 2) {
      C([T.accent[0], T.accent[1], T.accent[2], 0.05]).setFill;
      $.NSBezierPath.bezierPathWithOvalInRect($.NSMakeRect(gx - r, Y(gy) - r, 2 * r, 2 * r)).fill;
    }
    if (label) {
      const f = $.NSFont.systemFontOfSizeWeight(11, 0.4);
      const attrs = $.NSDictionary.dictionaryWithObjectsForKeys($([f, C([1, 1, 1, 1])]), $(['NSFont', 'NSColor']));
      const tw = Math.min($(label).sizeWithAttributes(attrs).width, PW - 40);
      const pill = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(TIP.x + 17, Y(TIP.y + 40), tw + 14, 18), 9, 9);
      C(T.accent).setFill; pill.fill;
      $(label).drawInRectWithAttributes($.NSMakeRect(TIP.x + 24, Y(TIP.y + 38) , tw, 15), attrs);
    }
    img.unlockFocus;
    ptrView.setImage(img);
  }
  function placePointer(p) { ptr.setFrameOrigin($.NSMakePoint(p.x - TIP.x, SH() - p.y - (PH - TIP.y))); }

  // ---- Session HUD above the Dock ----
  const HW = 540, HH = 56;
  const hud = panel(HW, HH, false);
  hud.setMovableByWindowBackground(true);                  // drag anywhere; the position is remembered
  const box = hud.contentView.layer;
  box.setCornerRadius(14); box.setMasksToBounds(true); box.setBorderWidth(0.5);
  function lbl(size, weight) { const t = $.NSTextField.labelWithString(''); t.setFont($.NSFont.systemFontOfSizeWeight(size, weight)); t.setLineBreakMode(4); hud.contentView.addSubview(t); return t; }
  const title = lbl(11, 0.3), step = lbl(12.5, 0.23), clock = lbl(11, 0.2);
  clock.setAlignment(2);
  let session = '', stoppedClick = false;
  ObjC.registerSubclass({ name: 'BBStopTarget3', methods: { 'stop:': { types: ['void', ['id']], implementation: function () {
    writeText(stopPath, JSON.stringify({ session: session, at: Date.now() })); stoppedClick = true;
  } } } });
  const target = $.BBStopTarget3.alloc.init;
  const stopBtn = $.NSButton.buttonWithTitleTargetAction('Стоп', target, 'stop:');
  stopBtn.setBezelStyle(1); stopBtn.setControlSize(2); stopBtn.setFont($.NSFont.systemFontOfSize(11));
  stopBtn.setToolTip('Остановить агента: отозвать доступ этого сеанса'); stopBtn.cell.setAccessibilityLabel($('Остановить агента'));
  stopBtn.sizeToFit; hud.contentView.addSubview(stopBtn);

  function theme(name) {
    if (name === themeName) return; themeName = name; T = THEMES[name] || THEMES.dark;
    box.setBackgroundColor(cg(T.fill)); box.setBorderColor(cg(T.border));
    title.setTextColor(C(T.title)); step.setTextColor(C(T.step)); clock.setTextColor(C(T.title));
    stopBtn.setAppearance($.NSAppearance.appearanceNamed($(name === 'light' ? 'NSAppearanceNameAqua' : 'NSAppearanceNameDarkAqua')));
    ptrLabel = null;
  }
  function layoutHud() {
    const bw = stopBtn.frame.size.width;
    title.setFrame($.NSMakeRect(16, 31, HW - bw - 90, 15));
    step.setFrame($.NSMakeRect(16, 11, HW - bw - 90, 18));
    clock.setFrame($.NSMakeRect(HW - bw - 70, 12, 46, 15));
    stopBtn.setFrameOrigin($.NSMakePoint(HW - bw - 14, (HH - stopBtn.frame.size.height) / 2));
  }
  layoutHud();
  let hudSet = null;                                       // origin we placed; differs after a user drag
  function placeHud() {
    let o = null;
    try { o = JSON.parse(readText(posPath) || 'null'); } catch (e) { o = null; }
    const vis = $.NSScreen.mainScreen.visibleFrame;        // excludes the Dock and the menu bar
    if (!o || typeof o.x !== 'number') o = { x: vis.origin.x + (vis.size.width - HW) / 2, y: vis.origin.y + 14 };
    hud.setFrameOrigin($.NSMakePoint(o.x, o.y)); hudSet = { x: o.x, y: o.y };
  }

  function fade(panels, to, ms) {
    if (reduceMotion || ms <= 0) { panels.forEach(p => p.setAlphaValue(to)); return; }
    const from = panels.map(p => p.alphaValue), n = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= n; i++) { panels.forEach((p, k) => p.setAlphaValue(from[k] + (to - from[k]) * i / n)); $.NSThread.sleepForTimeInterval(0.016); }
  }

  // 60 fps glide of the real pointer (ease-in-out cubic); the agent arrow rides along.
  function glide(to, ms) {
    const from = cursor();
    const dur = reduceMotion ? 0 : Math.min(400, Math.max(200, ms || 300));
    const frames = Math.max(1, Math.round(dur / 16.7));
    const t0 = Date.now();
    for (let i = 1; i <= frames; i++) {
      const t = i / frames, e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const p = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      if (!dry) $.CGWarpMouseCursorPosition({ x: p.x, y: p.y }); placePointer(p);
      const wait = t0 + i * 16.7 - Date.now();
      if (wait > 0) $.NSThread.sleepForTimeInterval(wait / 1000);
    }
    $.CGAssociateMouseAndMouseCursorPosition(true);
    return Date.now() - t0;
  }

  const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let active = false, lastSeq = null, lastMtime = 0, lastAction = 0, startedAt = 0, stepNo = 0, stepText = '', spinI = 0, lastSpin = 0, lastPtr = { x: -1, y: -1 }, hideAt = 0, hiddenSince = Date.now();
  const fmt = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function refresh() {
    step.setStringValue($((active ? SPIN[spinI % SPIN.length] + '  ' : '') + (stepNo ? 'Шаг ' + stepNo + ' · ' : '') + stepText));
    clock.setStringValue($(startedAt ? fmt(Date.now() - startedAt) : ''));
  }
  function startOrUpdate(st) {
    theme(st.theme || 'dark');
    if (!active || session !== String(st.session || '')) {
      session = String(st.session || ''); startedAt = Number(st.startedAt) || Date.now();
      placeHud(); front(hud); front(ptr);
      fade([hud], 1, 160);
    }
    active = true; hideAt = 0; lastAction = Date.now();
    title.setStringValue($(String(st.title || '').slice(0, 160)));
    stepNo = Number(st.n) || stepNo; stepText = String(st.step || '');
    drawPointer(String(st.label || 'BB'));
    if (st.move) { ptr.setAlphaValue(1); const took = glide(st.move, st.move.ms); writeText(ackPath, JSON.stringify({ seq: st.seq, glideMs: took })); }
    ptr.setAlphaValue(1); placePointer(cursor());
    refresh();
  }
  function finish(text, ms) {
    active = false; title.setStringValue($(text)); step.setStringValue($(''));
    clock.setStringValue($(startedAt ? fmt(Date.now() - startedAt) : ''));
    hud.setAlphaValue(1); hideAt = Date.now() + ms;
  }
  function hideAll() { fade([hud, ptr], 0, 220); hideAt = 0; hiddenSince = Date.now(); session = ''; stepNo = 0; startedAt = 0; }

  for (;;) {
    // 20 Hz while a session runs, 4 Hz otherwise. A bare NSRunLoop.runUntilDate never
    // hands mouse events to the windows, so Stop and the HUD drag did nothing:
    // take events from NSApp and dispatch them until the deadline.
    const until = $.NSDate.dateWithTimeIntervalSinceNow(active ? 0.05 : 0.25);
    for (;;) {
      const ev = app.nextEventMatchingMaskUntilDateInModeDequeue($.NSEventMaskAny, until, $.NSDefaultRunLoopMode, true);
      if (ev.isNil()) break;
      app.sendEvent(ev);
    }
    if (parentPid && $.kill(parentPid, 0) !== 0) break;                 // parent host process gone
    if (Number(readText(pidPath) || 0) !== myPid) break;                 // replaced by a newer instance
    const attrs = fm.attributesOfItemAtPathError($(statePath), null);
    const mtime = attrs.isNil() ? 0 : attrs.fileModificationDate.timeIntervalSince1970;
    if (mtime !== lastMtime) {
      lastMtime = mtime;
      let st = null; try { st = JSON.parse(readText(statePath) || 'null'); } catch (e) { st = null; }
      if (st && st.quit) break;
      if (st && st.seq !== lastSeq) {
        lastSeq = st.seq;
        if (st.end) { if (session && (!st.session || st.session === session)) finish('Готово · BB', 1500); }
        else startOrUpdate(st);
      }
    }
    if (stoppedClick) { stoppedClick = false; finish('Агент остановлен · доступ этого сеанса отозван', 3000); }
    if (active) {
      const c = cursor();                                                // the arrow rides on the real pointer
      if (Math.abs(c.x - lastPtr.x) > 0.5 || Math.abs(c.y - lastPtr.y) > 0.5) { placePointer(c); lastPtr = c; }
      if (Date.now() - lastSpin > 110) { spinI++; lastSpin = Date.now(); refresh(); }
      const f = hud.frame.origin;                                        // remember a user drag
      if (hudSet && (Math.abs(f.x - hudSet.x) > 1 || Math.abs(f.y - hudSet.y) > 1)) { hudSet = { x: f.x, y: f.y }; writeText(posPath, JSON.stringify(hudSet)); }
      if (Date.now() - lastAction > 120000) finish('Нет действий 2 минуты · BB', 1500);
    }
    if (hideAt && Date.now() > hideAt) hideAll();
    if (!active && !hideAt && hud.alphaValue === 0 && Date.now() - hiddenSince > 8000) break;  // idle: exit
  }
  if (Number(readText(pidPath) || 0) === myPid) fm.removeItemAtPathError($(pidPath), null);
  return 'bye';
}
`;
