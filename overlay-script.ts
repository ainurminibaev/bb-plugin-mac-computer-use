// Overlay v2 (JXA). Kept as a string so the host bundle can write it to disk.
export const OVERLAY_JXA = String.raw`// BB Mac Computer Use — overlay v2: shows which agent works on this Mac and why.
// osascript -l JavaScript overlay.jxa.js <state.json> <parentPid>
// - glides the REAL mouse cursor to a target (CGWarpMouseCursorPosition, no extra
//   permission) and soft-highlights it;
// - a compact translucent two-line caption next to the cursor (goal, current
//   step) with a small «Stop agent» button; never activates, never takes focus;
// - event-driven: sleeps between state changes, fades out after the step's TTL
//   and EXITS after a short idle, when its parent dies, or when another
//   instance owns the pid file. Respects «Reduce motion».
ObjC.import('Cocoa'); ObjC.import('CoreGraphics'); ObjC.import('unistd'); ObjC.import('signal');

function run(argv) {
  const statePath = argv[0];
  const parentPid = Number(argv[1] || 0);
  const dir = statePath.replace(/[^/]+$/, '');
  const pidPath = dir + 'overlay.pid', ackPath = dir + 'move-ack.json', stopPath = dir + 'stop-request.json';
  const fm = $.NSFileManager.defaultManager;
  const readText = p => { const s = $.NSString.stringWithContentsOfFileEncodingError($(p), 4, null); return s.isNil() ? null : s.js; };
  const writeText = (p, t) => $(t).writeToFileAtomicallyEncodingError($(p), true, 4, null);
  const myPid = $.getpid();

  // Single instance: a live owner of the pid file wins.
  const other = Number(readText(pidPath) || 0);
  if (other && other !== myPid && $.kill(other, 0) === 0) return 'already running';
  writeText(pidPath, String(myPid));

  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(1); // accessory: no Dock icon; panels below are nonactivating
  app.finishLaunching;        // makes the Stop button reachable by Accessibility / VoiceOver
  const reduceMotion = !!$.NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;

  // Contrast: white text on a ≥82% dark fill and dark text on a ≥94% light fill keep ≥4.5:1 over any background.
  const THEMES = {
    dark:   { fill: [0.11, 0.11, 0.12, 0.84], border: [1, 1, 1, 0.14], title: [1, 1, 1, 0.70], step: [1, 1, 1, 0.97], halo: [0.04, 0.52, 1.0] },
    light:  { fill: [0.99, 0.99, 1.0, 0.94], border: [0, 0, 0, 0.12], title: [0, 0, 0, 0.58], step: [0, 0, 0, 0.90], halo: [0.0, 0.45, 0.95] },
    accent: { fill: [0.04, 0.40, 0.92, 0.93], border: [1, 1, 1, 0.20], title: [1, 1, 1, 0.80], step: [1, 1, 1, 1], halo: [0.04, 0.52, 1.0] },
  };
  const color = c => $.NSColor.colorWithCalibratedRedGreenBlueAlpha(c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]);
  // Layers take CGColor; NSColor.CGColor crashes the JXA bridge, so build it directly.
  const cg = c => $.CGColorCreateGenericRGB(c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]);

  function makePanel(w, h, clickThrough) {
    const p = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, w, h), 0 | (1 << 7), 2, false);
    p.setOpaque(false); p.setBackgroundColor($.NSColor.clearColor); p.setHasShadow(false);
    p.setIgnoresMouseEvents(clickThrough); p.setLevel(1000);
    p.setCollectionBehavior(1 | 16 | 256); p.setHidesOnDeactivate(false);
    p.contentView.setWantsLayer(true); p.setAlphaValue(0);
    return p;
  }

  // Soft halo centred on the real cursor (click-through).
  const H = 30;                           // small soft halo around the real pointer
  const halo = makePanel(H, H, true);
  const hl = halo.contentView.layer;
  hl.setCornerRadius(H / 2); hl.setBorderWidth(1.5);

  // Caption: glass pill with two lines and a small Stop button.
  const cap = makePanel(320, 48, false);
  const glass = $.NSVisualEffectView.alloc.initWithFrame($.NSMakeRect(0, 0, 320, 48));
  glass.setBlendingMode(0); glass.setState(1);
  // Rounded corners and a hairline border live on the container layer: setting
  // them on the effect view's own layer crashes the JXA bridge.
  const box = cap.contentView.layer;
  box.setCornerRadius(11); box.setMasksToBounds(true); box.setBorderWidth(0.5);
  box.setBorderColor(cg([1, 1, 1, 0.18]));
  cap.contentView.addSubview(glass);
  function label(weight, size) {
    const t = $.NSTextField.labelWithString('');
    t.setFont($.NSFont.systemFontOfSizeWeight(size, weight)); t.setLineBreakMode(4);
    cap.contentView.addSubview(t); return t;
  }
  const title = label(0.3, 11), step = label(0.23, 12.5);

  let session = '', stopped = false;
  ObjC.registerSubclass({ name: 'BBStopTarget', methods: { 'stop:': { types: ['void', ['id']], implementation: function () {
    writeText(stopPath, JSON.stringify({ session: session, at: Date.now() })); stopped = true;
  } } } });
  const target = $.BBStopTarget.alloc.init;
  const stopBtn = $.NSButton.buttonWithTitleTargetAction('Стоп', target, 'stop:');
  stopBtn.setBezelStyle(1); stopBtn.setControlSize(2); stopBtn.setFont($.NSFont.systemFontOfSize(11));
  stopBtn.setToolTip('Остановить агента: отозвать доступ этого сеанса');
  stopBtn.cell.setAccessibilityLabel($('Остановить агента'));
  stopBtn.sizeToFit; cap.contentView.addSubview(stopBtn);

  let theme = '';
  function applyTheme(name) {
    if (name === theme) return; theme = name;
    const t = THEMES[name] || THEMES.dark;
    glass.setHidden(true);                      // a solid translucent fill reads better than vibrancy over light windows
    glass.setMaterial(13); glass.setAppearance($.NSAppearance.appearanceNamed($('NSAppearanceNameVibrantDark')));
    box.setBackgroundColor(cg(t.fill)); box.setBorderColor(cg(t.border));
    stopBtn.setAppearance($.NSAppearance.appearanceNamed($(name === 'light' ? 'NSAppearanceNameAqua' : 'NSAppearanceNameDarkAqua')));
    title.setTextColor(color(t.title)); step.setTextColor(color(t.step));
    hl.setBorderColor(cg([t.halo[0], t.halo[1], t.halo[2], 0.75]));
    hl.setBackgroundColor(cg([t.halo[0], t.halo[1], t.halo[2], 0.10]));
    hl.setShadowColor(cg([t.halo[0], t.halo[1], t.halo[2], 1])); hl.setShadowRadius(6); hl.setShadowOpacity(0.8); hl.setShadowOffset($.NSMakeSize(0, 0));
  }

  const screenH = () => $.NSScreen.screens.objectAtIndex(0).frame.size.height;
  const cursor = () => { const p = $.CGEventGetLocation($.CGEventCreate(null)); return { x: p.x, y: p.y }; };

  function placeHalo(pt) {
    halo.setFrameOrigin($.NSMakePoint(pt.x - H / 2, screenH() - pt.y - H / 2));
    halo.orderFrontRegardless;
  }
  // Caption next to the pointer but off the action area: try below-right,
  // below-left, above-right, above-left; when the target is too large to dodge
  // (a text area), put it just outside that area; last resort — bottom centre.
  function placeCaption(pt, avoid) {
    const vis = $.NSScreen.mainScreen.visibleFrame, SH = screenH();
    const w = cap.frame.size.width, h = cap.frame.size.height, G = 26;
    const minX = vis.origin.x + 6, maxX = vis.origin.x + vis.size.width - 6;
    const minY = SH - (vis.origin.y + vis.size.height) + 6, maxY = SH - vis.origin.y - 6; // top-left coords
    const fits = r => r.x >= minX && r.x + r.w <= maxX && r.y >= minY && r.y + r.h <= maxY;
    const hits = r => avoid && !(r.x + r.w < avoid.x - 6 || r.x > avoid.x + avoid.w + 6 || r.y + r.h < avoid.y - 6 || r.y > avoid.y + avoid.h + 6);
    const near = [
      { x: pt.x + G, y: pt.y + G }, { x: pt.x - G - w, y: pt.y + G },
      { x: pt.x + G, y: pt.y - G - h }, { x: pt.x - G - w, y: pt.y - G - h },
    ].map(o => ({ x: o.x, y: o.y, w: w, h: h }));
    let r = near.find(c => fits(c) && !hits(c));
    if (!r && avoid) {
      const cx = Math.min(Math.max(pt.x - 24, minX), maxX - w);   // starts just left of the pointer
      const cy = Math.min(Math.max(pt.y - h / 2, minY), maxY - h);
      r = [
        { x: cx, y: avoid.y + avoid.h + 10 }, { x: cx, y: avoid.y - 10 - h },
        { x: avoid.x + avoid.w + 10, y: cy }, { x: avoid.x - 10 - w, y: cy },
      ].map(o => ({ x: o.x, y: o.y, w: w, h: h })).find(fits);
    }
    if (!r) r = near.find(fits) || { x: (minX + maxX - w) / 2, y: maxY - h - 40, w: w, h: h };
    cap.setFrameOrigin($.NSMakePoint(r.x, SH - r.y - h));
    cap.orderFrontRegardless;
  }
  function layout(top, bottom, withStop) {
    title.setStringValue($(top)); step.setStringValue($(bottom));
    title.sizeToFit; step.sizeToFit;
    const bw = withStop ? stopBtn.frame.size.width + 10 : 0;
    const tw = Math.min(Math.max(title.frame.size.width, step.frame.size.width, 120), 300); // compact: long goals end with …
    const w = Math.ceil(tw + 24 + bw), h = bottom ? 46 : 28;
    cap.setContentSize($.NSMakeSize(w, h)); glass.setFrame($.NSMakeRect(0, 0, w, h));
    if (bottom) { title.setFrame($.NSMakeRect(12, 25, tw, 14)); step.setFrame($.NSMakeRect(12, 7, tw, 17)); }
    else { title.setFrame($.NSMakeRect(12, 7, tw, 14)); step.setFrame($.NSMakeRect(0, 0, 0, 0)); }
    stopBtn.setHidden(!withStop);
    if (withStop) stopBtn.setFrameOrigin($.NSMakePoint(w - bw + 2, (h - stopBtn.frame.size.height) / 2));
  }

  function fade(panels, to, ms) {
    if (reduceMotion || ms <= 0) { panels.forEach(p => p.setAlphaValue(to)); return; }
    const from = panels.map(p => p.alphaValue), n = Math.max(2, Math.round(ms / 30));
    for (let i = 1; i <= n; i++) { panels.forEach((p, k) => p.setAlphaValue(from[k] + (to - from[k]) * i / n)); $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.03)); }
  }

  // Glides the real cursor; the halo follows. ~10 steps keep it smooth and fast.
  function glide(to, ms) {
    const from = cursor();
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const n = reduceMotion || dist < 4 ? 1 : Math.min(14, Math.max(6, Math.round(dist / 60)));
    const pause = Math.max(0, (ms || 360) / n / 1000 - 0.02);
    halo.setAlphaValue(1);
    for (let i = 1; i <= n; i++) {
      const t = i / n, e = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const p = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      $.CGWarpMouseCursorPosition($.CGPointMake(p.x, p.y)); $.CGAssociateMouseAndMouseCursorPosition(true);
      placeHalo(p);
      if (pause > 0) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(pause));
    }
  }

  let lastSeq = null, hideAt = 0, visible = false, hiddenSince = Date.now(), lastMtime = 0, haloFollows = true, lastHalo = { x: -1, y: -1 };
  function show(state) {
    applyTheme(state.theme || 'dark');
    session = String(state.session || '');
    if (state.move) { glide(state.move, state.move.ms); writeText(ackPath, JSON.stringify({ seq: state.seq })); }
    const pt = state.move || (typeof state.x === 'number' ? { x: state.x, y: state.y } : cursor());
    haloFollows = state.follow !== false; // track the real pointer while visible
    layout(String(state.title || '').slice(0, 140), state.step ? 'Сейчас: ' + String(state.step).slice(0, 120) : '', !!session && !state.final);
    if (state.halo !== false) placeHalo(pt);
    placeCaption(pt, state.avoid || null);
    cap.setIgnoresMouseEvents(!session || !!state.final);
    if (!visible) fade(state.halo !== false ? [halo, cap] : [cap], 1, 150); else { cap.setAlphaValue(1); if (state.halo !== false) halo.setAlphaValue(1); }
    visible = true; hideAt = Date.now() + (Number(state.ttlMs) || 4000);
  }
  function hide() {
    fade([halo, cap], 0, 220);
    cap.setIgnoresMouseEvents(true); visible = false; hiddenSince = Date.now();
  }

  for (;;) {
    // Event-driven enough: 20 Hz only while something is on screen, 4 Hz while hidden.
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(visible ? 0.05 : 0.25));
    if (parentPid && $.kill(parentPid, 0) !== 0) break;                                   // parent gone
    if (Number(readText(pidPath) || 0) !== myPid) break;                                  // replaced
    const attrs = fm.attributesOfItemAtPathError($(statePath), null);
    const mtime = attrs.isNil() ? 0 : attrs.fileModificationDate.timeIntervalSince1970;
    if (mtime !== lastMtime) {
      lastMtime = mtime;
      let state = null; try { state = JSON.parse(readText(statePath) || 'null'); } catch (e) { state = null; }
      if (state && state.quit) break;
      if (state && state.seq !== lastSeq) { lastSeq = state.seq; show(state); }
    }
    if (stopped) { stopped = false; show({ title: 'Агент остановлен', step: 'Доступ этого сеанса к Mac отозван', final: true, ttlMs: 3500, halo: false, theme: theme }); }
    if (visible && haloFollows) {                       // the halo rides on the real pointer
      const c = cursor();
      if (Math.abs(c.x - lastHalo.x) > 0.5 || Math.abs(c.y - lastHalo.y) > 0.5) { placeHalo(c); lastHalo = c; }
    }
    if (visible && Date.now() > hideAt) hide();
    if (!visible && Date.now() - hiddenSince > 8000) break;                               // idle: exit
  }
  if (Number(readText(pidPath) || 0) === myPid) fm.removeItemAtPathError($(pidPath), null);
  return 'bye';
}
`;
