export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Screen geometry learned from window snapshots: element frames (screen points)
 * by element token, and window frame + screenshot size to map window-local
 * screenshot pixels to screen points. Used to glide the real pointer to the
 * action target before acting.
 */
export class Geometry {
  readonly frames = new Map<string, Rect>();
  readonly windows = new Map<string, Rect & { sw: number; sh: number }>();

  remember(out: Record<string, unknown>): void {
    const els = Array.isArray(out.elements) ? out.elements as { element_token?: string; frame?: Rect; role?: string }[] : [];
    if (this.frames.size > 5000) this.frames.clear();
    for (const e of els) if (e.element_token && e.frame) this.frames.set(e.element_token, e.frame);
    const win = els.find(e => e.role === 'AXWindow')?.frame;
    const key = `${out.pid}:${out.window_id}`;
    const prev = this.windows.get(key);
    const sw = Number(out.screenshot_width ?? prev?.sw ?? 0), sh = Number(out.screenshot_height ?? prev?.sh ?? 0);
    if (win) this.windows.set(key, { ...win, sw, sh });
  }

  /** Screen point of the action target, when it can be known before acting. */
  target(tool: string, input: Record<string, unknown>): Point | null {
    if (tool === 'move_cursor' && typeof input.x === 'number' && typeof input.y === 'number') return { x: input.x, y: input.y };
    const token = typeof input.element_token === 'string' ? input.element_token : null;
    if (token) { const f = this.frames.get(token); return f ? { x: f.x + f.w / 2, y: f.y + f.h / 2 } : null; }
    const x = typeof input.x === 'number' ? input.x : typeof input.from_x === 'number' ? input.from_x : null;
    const y = typeof input.y === 'number' ? input.y : typeof input.from_y === 'number' ? input.from_y : null;
    if (x === null || y === null || input.from_zoom) return null;
    const g = this.windows.get(`${input.pid}:${input.window_id}`);
    if (!g || !g.sw) return null;
    const k = g.w / g.sw;
    return { x: g.x + x * k, y: g.y + y * k };
  }
}
