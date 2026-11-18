// Generated from the JXA overlay source; kept as a string so the host bundle can write it to disk.
// eslint-disable-next-line
export const OVERLAY_JXA = String.raw`// BB Mac Computer Use — on-screen overlay that shows what an agent is doing.
// Run: osascript -l JavaScript overlay.jxa.js <state.json>
// A click-through, non-activating panel above all windows: a blue ring at the
// agent's action point and a two-line caption (goal, current step). It never takes
// focus; its «Stop agent» button writes stop-request.json next to the state
// file. It re-reads the state file, fades out after the step's TTL and exits
// after a long idle period.
ObjC.import('Cocoa');

function run(argv) {
  const statePath = argv[0];
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(1); // accessory: no Dock icon or menu bar; panels are nonactivating
  app.finishLaunching; // registers the process with the window server and Accessibility (VoiceOver, AX press)

  const RING = 44;
  const blue = $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.13, 0.47, 1.0, 1.0);
  const panelMask = 0 | (1 << 7); // borderless | nonactivating panel

  function makePanel(w, h) {
    const p = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, w, h), panelMask, 2, false);
    p.setOpaque(false);
    p.setBackgroundColor($.NSColor.clearColor);
    p.setIgnoresMouseEvents(true);
    p.setHasShadow(false);
    p.setLevel(1000); // above normal, floating and status windows
    p.setCollectionBehavior(1 | 16 | 256); // all Spaces, stationary, full-screen auxiliary
    p.setHidesOnDeactivate(false);
    p.contentView.setWantsLayer(true);
    p.setAlphaValue(0);
    return p;
  }

  const ring = makePanel(RING, RING);
  const ringLayer = ring.contentView.layer;
  ringLayer.setCornerRadius(RING / 2);
  ringLayer.setBorderWidth(4);
  ringLayer.setBorderColor(blue.CGColor);
  ringLayer.setBackgroundColor($.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.13, 0.47, 1.0, 0.18).CGColor);

  const cap = makePanel(460, 50);
  const capLayer = cap.contentView.layer;
  capLayer.setCornerRadius(10);
  capLayer.setBackgroundColor(blue.CGColor);
  function label(bold, size) {
    const t = $.NSTextField.labelWithString('');
    t.setTextColor($.NSColor.whiteColor);
    t.setFont(bold ? $.NSFont.boldSystemFontOfSize(size) : $.NSFont.systemFontOfSize(size));
    t.setLineBreakMode(4); // truncate tail
    cap.contentView.addSubview(t);
    return t;
  }
  const title = label(true, 12);
  const step = label(false, 13);

  // «Stop agent»: the caption takes clicks only while visible. A nonactivating
  // panel receives the click without activating this process or taking focus.
  const stopPath = statePath.replace(/[^/]+$/, 'stop-request.json');
  let session = '';
  let stoppedNote = false;
  ObjC.registerSubclass({
    name: 'BBStopTarget',
    methods: {
      'stop:': {
        types: ['void', ['id']],
        implementation: function () {
          const body = JSON.stringify({ session: session, at: Date.now() });
          $(body).writeToFileAtomicallyEncodingError($(stopPath), true, 4, null);
          stoppedNote = true;
        },
      },
    },
  });
  const target = $.BBStopTarget.alloc.init;
  const stopBtn = $.NSButton.buttonWithTitleTargetAction('Остановить агента', target, 'stop:');
  stopBtn.setBezelStyle(1);
  stopBtn.setControlSize(1);
  stopBtn.setFont($.NSFont.systemFontOfSize(12));
  stopBtn.sizeToFit;
  cap.contentView.addSubview(stopBtn);

  let lastSeq = -1, shownAt = 0, ttl = 0, lastChange = Date.now();

  function screenFrame() { return $.NSScreen.mainScreen.frame; }

  function layoutCaption(top, bottom, withButton) {
    title.setStringValue($(String(top || '').slice(0, 140)));
    step.setStringValue($(String(bottom || '').slice(0, 140)));
    title.sizeToFit; step.sizeToFit;
    const bw = withButton ? stopBtn.frame.size.width + 12 : 0;
    const textW = Math.min(Math.max(title.frame.size.width, step.frame.size.width, 140), 560);
    const w = textW + 28 + bw;
    const h = bottom ? 50 : 30;
    cap.setContentSize($.NSMakeSize(w, h));
    if (bottom) {
      title.setFrame($.NSMakeRect(14, 27, textW, 16));
      step.setFrame($.NSMakeRect(14, 8, textW, 18));
    } else {
      title.setFrame($.NSMakeRect(14, 7, textW, 16));
      step.setFrame($.NSMakeRect(0, 0, 0, 0));
    }
    stopBtn.setHidden(!withButton);
    if (withButton) stopBtn.setFrameOrigin($.NSMakePoint(w - bw - 4, (h - stopBtn.frame.size.height) / 2));
    return { w: w, h: h };
  }

  function show(state) {
    const sf = screenFrame();
    const H = sf.size.height, W = sf.size.width;
    session = String(state.session || '');
    const top = state.title || state.label || '';
    const bottom = state.step ? 'Сейчас: ' + state.step : '';
    const size = layoutCaption(top, bottom, !!session && !state.final);
    const hasPoint = typeof state.x === 'number' && typeof state.y === 'number';
    if (hasPoint) {
      const cx = state.x, cy = H - state.y; // top-left screen points → Cocoa bottom-left
      ring.setFrameOrigin($.NSMakePoint(cx - RING / 2, cy - RING / 2));
      ring.orderFrontRegardless;
      ring.setAlphaValue(1);
      let x = cx + RING / 2 + 6, y = cy - size.h / 2;
      if (x + size.w > W - 8) x = cx - RING / 2 - 6 - size.w;
      cap.setFrameOrigin($.NSMakePoint(Math.max(8, x), Math.min(Math.max(8, y), H - size.h - 8)));
    } else {
      ring.setAlphaValue(0);
      cap.setFrameOrigin($.NSMakePoint((W - size.w) / 2, H - 90)); // banner under the menu bar
    }
    cap.setIgnoresMouseEvents(!session || !!state.final);
    cap.orderFrontRegardless;
    cap.setAlphaValue(1);
  }

  function hide() {
    ring.setAlphaValue(0);
    cap.setAlphaValue(0);
    cap.setIgnoresMouseEvents(true);
  }

  for (;;) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
    const raw = $.NSString.stringWithContentsOfFileEncodingError($(statePath), 4, null);
    if (!raw.isNil()) {
      let state = null;
      try { state = JSON.parse(raw.js); } catch (e) { state = null; }
      if (state && state.quit) break;
      if (state && state.seq !== lastSeq) {
        lastSeq = state.seq; shownAt = Date.now(); ttl = Number(state.ttlMs) || 6000; lastChange = Date.now();
        show(state);
      }
    }
    if (stoppedNote) {
      stoppedNote = false;
      show({ title: 'Агент остановлен', step: 'GUI-доступ для этого сеанса отозван', final: true });
      shownAt = Date.now(); ttl = 4000;
    }
    const age = Date.now() - shownAt;
    if (shownAt && age > ttl) {
      const a = Math.max(0, 1 - (age - ttl) / 600); // 0.6 s fade
      ring.setAlphaValue(Math.min(ring.alphaValue, a));
      cap.setAlphaValue(a);
      if (a === 0) { shownAt = 0; hide(); }
    }
    if (Date.now() - lastChange > 30 * 60 * 1000) break; // idle: exit, restarted on demand
  }
}
`;
