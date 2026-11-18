// Generated from the JXA overlay source; kept as a string so the host bundle can write it to disk.
// eslint-disable-next-line
export const OVERLAY_JXA = String.raw`// BB Mac Computer Use — on-screen overlay that shows what an agent is doing.
// Run: osascript -l JavaScript overlay.jxa.js <state.json>
// A click-through, non-activating panel above all windows: a blue ring at the
// agent's action point and a caption «BB · <agent>: <step>». It never takes
// focus. It re-reads the state file, fades out after the step's TTL and exits
// after a long idle period.
ObjC.import('Cocoa');

function run(argv) {
  const statePath = argv[0];
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(2); // NSApplicationActivationPolicyProhibited: no Dock icon, never active

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

  const cap = makePanel(420, 30);
  const capLayer = cap.contentView.layer;
  capLayer.setCornerRadius(9);
  capLayer.setBackgroundColor(blue.CGColor);
  const text = $.NSTextField.labelWithString('');
  text.setTextColor($.NSColor.whiteColor);
  text.setFont($.NSFont.boldSystemFontOfSize(13));
  text.setFrame($.NSMakeRect(12, 6, 396, 18));
  text.setLineBreakMode(4); // truncate tail
  cap.contentView.addSubview(text);

  let lastSeq = -1, shownAt = 0, ttl = 0, lastChange = Date.now();

  function screenFrame() { return $.NSScreen.mainScreen.frame; }

  function place(state) {
    const sf = screenFrame();
    const H = sf.size.height, W = sf.size.width;
    text.setStringValue($(String(state.label || '').slice(0, 120)));
    text.sizeToFit;
    const tw = Math.min(Math.max(text.frame.size.width + 28, 120), 620);
    cap.setContentSize($.NSMakeSize(tw, 30));
    text.setFrame($.NSMakeRect(12, 6, tw - 24, 18));
    const hasPoint = typeof state.x === 'number' && typeof state.y === 'number';
    if (hasPoint) {
      const cx = state.x, cy = H - state.y; // top-left screen points → Cocoa bottom-left
      ring.setFrameOrigin($.NSMakePoint(cx - RING / 2, cy - RING / 2));
      ring.orderFrontRegardless;
      ring.setAlphaValue(1);
      let x = cx + RING / 2 + 6, y = cy - 15;
      if (x + tw > W - 8) x = cx - RING / 2 - 6 - tw;
      cap.setFrameOrigin($.NSMakePoint(Math.max(8, x), Math.min(Math.max(8, y), H - 38)));
    } else {
      ring.setAlphaValue(0);
      cap.setFrameOrigin($.NSMakePoint((W - tw) / 2, H - 70)); // banner under the menu bar
    }
    cap.orderFrontRegardless;
    cap.setAlphaValue(1);
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
        place(state);
      }
    }
    const age = Date.now() - shownAt;
    if (shownAt && age > ttl) {
      const a = Math.max(0, 1 - (age - ttl) / 600); // 0.6 s fade
      ring.setAlphaValue(Math.min(ring.alphaValue, a));
      cap.setAlphaValue(a);
      if (a === 0) shownAt = 0;
    }
    if (Date.now() - lastChange > 30 * 60 * 1000) break; // idle: exit, restarted on demand
  }
}
`;
