// Canvas renderer for the bike overlay.
// Draws up to two fits (A and B) plus a ghost bike for the empty state,
// animates between selections, and annotates the hovered measurement.

import {
  DEFAULT_GEOMETRY, METRICS, computePoints, metricValue, formatNumber,
  pt, add, sub, mul, len, unit, dist,
} from './geometry.js';

const MORPH_MS = 460;
const ALIGN_MS = 520;
const STACK_GAP = 22; // px between A's and B's dimension lines
const PAD = { top: 58, right: 28, bottom: 18, left: 28 };
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL_FONT = `600 11px ${MONO}`;
const SMALL_FONT = `500 10px ${MONO}`;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPt = (a, b, t) => pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));

function lerpPoints(a, b, t) {
  const out = {};
  for (const k in b) {
    const va = a[k];
    const vb = b[k];
    if (typeof vb === 'number') out[k] = typeof va === 'number' ? lerp(va, vb, t) : vb;
    else if (vb && typeof vb === 'object') out[k] = va && typeof va === 'object' ? lerpPt(va, vb, t) : vb;
  }
  return out;
}

/** World-space bounding box of a bike, with room for annotations. */
function extents(p) {
  return {
    minX: Math.min(p.rHub.x - p.wheelR, p.saddleBack.x) - 10,
    maxX: Math.max(p.fHub.x + p.wheelR, p.hoods.x + 40) + 10,
    minY: p.ground - 84,
    maxY: Math.max(p.saddleBack.y, p.saddleNose.y, p.hoods.y, p.barBack.y, p.spacerTop.y, p.fHub.y + p.wheelR) + 62,
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const blankSlot = () => ({ key: null, fit: null, fromPts: null, toPts: null, fromAlpha: 0, toAlpha: 0, t0: 0, dur: 0 });

export class BikeScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.slots = [blankSlot(), blankSlot()];
    this.ghostPts = computePoints(DEFAULT_GEOMETRY);
    this.ghost = { from: 1, to: 1, t0: 0, dur: 0 };
    this.alignMode = 'bb';
    this.alignAnim = { from: 0, to: 0, t0: 0, dur: 0 };
    this.library = [this.ghostPts];
    this.highlight = null;
    this.raf = 0;
    this.refreshColors();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  refreshColors() {
    const cs = getComputedStyle(this.canvas);
    const v = (name) => cs.getPropertyValue(name).trim();
    this.colors = {
      a: v('--a'), b: v('--b'), ghost: v('--ghost'), canvas: v('--canvas'),
      grid: v('--grid'), gridStrong: v('--grid-strong'), label: v('--text-3'),
    };
    this.requestDraw();
  }

  /** Points of every known fit; used for a stable view across selections. */
  setLibrary(pointsList) {
    this.library = pointsList.length ? pointsList : [this.ghostPts];
    this.requestDraw();
  }

  /** bikes: [A, B], each { key, data, pts } or null. */
  setBikes(bikes, { animate = true } = {}) {
    const now = performance.now();
    const dur = animate && !reducedMotion.matches ? MORPH_MS : 0;
    bikes.forEach((bike, i) => {
      const s = this.slots[i];
      const key = bike ? bike.key : null;
      if (key === s.key) {
        s.fit = bike || null;
        return;
      }
      const cur = this.sampleSlot(s, now);
      Object.assign(s, {
        key,
        fit: bike || null,
        fromPts: cur.alpha > 0.02 ? cur.pts : null,
        fromAlpha: cur.alpha,
        toPts: bike ? bike.pts : null,
        toAlpha: bike ? 1 : 0,
        t0: now,
        dur,
      });
    });
    const ghostTarget = bikes.some(Boolean) ? 0 : 1;
    if (ghostTarget !== this.ghost.to) {
      this.ghost = { from: this.sampleGhost(now).alpha, to: ghostTarget, t0: now, dur };
    }
    this.requestDraw();
  }

  setAlign(mode, { animate = true } = {}) {
    if (mode === this.alignMode) return;
    const now = performance.now();
    this.alignMode = mode;
    this.alignAnim = {
      from: this.sampleAlign(now).value,
      to: mode === 'axle' ? 1 : 0,
      t0: now,
      dur: animate && !reducedMotion.matches ? ALIGN_MS : 0,
    };
    this.requestDraw();
  }

  setHighlight(key) {
    if (key === this.highlight) return;
    this.highlight = key;
    this.requestDraw();
  }

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0;
      if (this.draw(now)) this.requestDraw();
    });
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = r.width;
    this.h = r.height;
    this.dpr = dpr;
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.draw(performance.now());
  }

  // ── Animation sampling ────────────────────────────────────────────────────

  sampleSlot(s, now) {
    const t = s.dur ? clamp01((now - s.t0) / s.dur) : 1;
    const e = ease(t);
    let pts = s.toPts || s.fromPts;
    if (s.fromPts && s.toPts && e < 1) pts = lerpPoints(s.fromPts, s.toPts, e);
    return { pts, alpha: lerp(s.fromAlpha, s.toAlpha, e), done: t >= 1 };
  }

  sampleGhost(now) {
    const g = this.ghost;
    const t = g.dur ? clamp01((now - g.t0) / g.dur) : 1;
    return { alpha: lerp(g.from, g.to, ease(t)), done: t >= 1 };
  }

  sampleAlign(now) {
    const a = this.alignAnim;
    const t = a.dur ? clamp01((now - a.t0) / a.dur) : 1;
    return { value: lerp(a.from, a.to, ease(t)), done: t >= 1 };
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  draw(now) {
    const { ctx, w, h, colors } = this;
    if (!w || !h) return false;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const align = this.sampleAlign(now);
    const ghost = this.sampleGhost(now);
    const samples = this.slots.map((s) => this.sampleSlot(s, now));
    const view = this.computeView(align.value);

    this.drawGrid(view);
    if (ghost.alpha > 0.01) this.drawBike(view, this.ghostPts, colors.ghost, ghost.alpha, align.value, true);
    samples.forEach((smp, i) => {
      if (smp.pts && smp.alpha > 0.01) this.drawBike(view, smp.pts, i ? colors.b : colors.a, smp.alpha, align.value);
    });

    const metric = this.highlight && METRICS[this.highlight];
    if (metric?.dims) {
      const shown = samples
        .map((smp, i) => ({ smp, i }))
        .filter(({ smp, i }) => smp.pts && smp.alpha > 0.5 && this.slots[i].fit);
      shown.forEach(({ smp, i }, order) => {
        this.drawDims(view, smp.pts, metric, this.slots[i].fit, i ? colors.b : colors.a, order, shown.length, align.value);
      });
    }
    this.drawScaleBar(view);
    return !(align.done && ghost.done && samples.every((s) => s.done));
  }

  computeView(alignT) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.library) {
      const o = lerpPt(p.bb, p.rHub, alignT);
      const e = extents(p);
      minX = Math.min(minX, e.minX - o.x);
      maxX = Math.max(maxX, e.maxX - o.x);
      minY = Math.min(minY, e.minY - o.y);
      maxY = Math.max(maxY, e.maxY - o.y);
    }
    const availW = Math.max(10, this.w - PAD.left - PAD.right);
    const availH = Math.max(10, this.h - PAD.top - PAD.bottom);
    const s = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    return {
      s,
      ox: PAD.left + (availW - (maxX - minX) * s) / 2 - minX * s,
      oy: PAD.top + (availH - (maxY - minY) * s) / 2 + maxY * s,
    };
  }

  mapper(view, p, alignT) {
    const o = lerpPt(p.bb, p.rHub, alignT);
    const { s, ox, oy } = view;
    const X = (x) => ox + (x - o.x) * s;
    const Y = (y) => oy - (y - o.y) * s;
    return { X, Y, C: (q) => pt(X(q.x), Y(q.y)), s };
  }

  drawGrid(view) {
    const { ctx, w, h, colors } = this;
    const { s, ox, oy } = view;
    let step = 100;
    while (step * s < 22) step *= 2;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    for (let x = Math.ceil(-ox / s / step) * step; ox + x * s <= w; x += step) {
      if (Math.abs(x) < 1e-6) continue;
      const px = Math.round(ox + x * s) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let y = Math.ceil((oy - h) / s / step) * step; oy - y * s >= 0; y += step) {
      if (Math.abs(y) < 1e-6) continue;
      const py = Math.round(oy - y * s) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();

    // Reference axes through the alignment point (BB plumb line by default).
    const px0 = Math.round(ox) + 0.5;
    const py0 = Math.round(oy) + 0.5;
    ctx.strokeStyle = colors.gridStrong;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(px0, 0);
    ctx.lineTo(px0, h);
    ctx.moveTo(0, py0);
    ctx.lineTo(w, py0);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = SMALL_FONT;
    ctx.fillStyle = colors.label;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(this.alignMode === 'axle' ? 'REAR AXLE' : 'BB', px0 + 6, h - 10);
    ctx.restore();
  }

  drawScaleBar(view) {
    const { ctx, w, h, colors } = this;
    const len100 = 100 * view.s;
    const x1 = w - 16;
    const x0 = x1 - len100;
    const y = h - 14;
    ctx.save();
    ctx.strokeStyle = colors.label;
    ctx.fillStyle = colors.label;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y - 4);
    ctx.lineTo(x0 + 0.5, y + 0.5);
    ctx.lineTo(x1 - 0.5, y + 0.5);
    ctx.lineTo(x1 - 0.5, y - 4);
    ctx.stroke();
    ctx.font = SMALL_FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('100 MM', x0 - 6, y + 3);
    ctx.restore();
  }

  drawBike(view, p, color, alpha, alignT, isGhost = false) {
    const { ctx } = this;
    const { C, s } = this.mapper(view, p, alignT);
    const band = isGhost ? 0.1 : 0.13;
    const lw = isGhost ? 1.2 : Math.min(2, Math.max(1.35, s * 3.4));
    const mm = (v, min = 1) => Math.max(min, v * s);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    const path = (build, width, a, dash) => {
      ctx.globalAlpha = alpha * a;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      build();
      ctx.stroke();
    };
    const poly = (pts) => () => pts.forEach((q, i) => {
      const c = C(q);
      if (i) ctx.lineTo(c.x, c.y);
      else ctx.moveTo(c.x, c.y);
    });
    const ring = (center, rPx) => () => {
      const c = C(center);
      ctx.moveTo(c.x + rPx, c.y);
      ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
    };
    const dot = (q, r, a = 1) => {
      const c = C(q);
      ctx.globalAlpha = alpha * a;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    // Ground
    path(poly([pt(p.rHub.x - p.wheelR - 50, p.ground), pt(p.fHub.x + p.wheelR + 50, p.ground)]), 1, 0.4);

    // Wheels: tyre band, tyre edge, rim, hub
    for (const hub of [p.rHub, p.fHub]) {
      path(ring(hub, (p.wheelR - 12) * s), mm(24, 2), band * 0.8);
      path(ring(hub, p.wheelR * s), 1.2, 0.8);
      path(ring(hub, (p.wheelR - 32) * s), 1, 0.32);
      dot(hub, 2.2);
    }

    // Drivetrain hints: chainring and pedal circle
    path(ring(p.bb, 100 * s), 1, 0.2);
    path(ring(p.bb, p.crank * s), 1, 0.3, [2, 3]);

    // Frame: translucent tube bodies, then crisp centrelines
    const forkCtrl = sub(p.crown, mul(p.uHT, dist(p.crown, p.fHub) * 0.62));
    const fork = () => {
      const a = C(p.crown);
      const c = C(forkCtrl);
      const b = C(p.fHub);
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    };
    const tubes = [
      [[p.rHub, p.bb], 20],
      [[p.rHub, p.ttRear], 16],
      [[p.bb, p.stTop], 30],
      [[p.ttRear, p.ttFront], 30],
      [[p.bb, p.dtFront], 38],
      [[p.htBot, p.htTop], 40],
      [[p.stTop, p.seatClamp], 27],
    ];
    tubes.forEach(([seg, d]) => path(poly(seg), mm(d, 2), band));
    path(fork, mm(26, 2), band);

    // Steerer, spacers and stem clamp
    const stemTop = add(p.stemCenter, mul(p.uHT, 20));
    path(poly([p.htTop, stemTop]), mm(32, 2), band * 0.8);
    path(poly([p.stemCenter, p.barCenter]), mm(30, 2), band);

    tubes.forEach(([seg]) => path(poly(seg), lw, 1));
    path(fork, lw, 1);
    path(poly([p.htTop, p.stemCenter]), Math.max(1, lw * 0.7), 0.6);
    path(poly([p.stemCenter, p.barCenter]), lw, 1);

    // Drop bar (measured: bar centre and hood top; the drop is illustrative)
    const Cb = p.barCenter;
    const Hd = p.hoods;
    const reachBar = Math.max(45, Hd.x - Cb.x - 38);
    const T = pt(Cb.x + reachBar, Cb.y + 2);
    const R = 58;
    const F = pt(T.x + R * 0.9, T.y - R * 0.95);
    const D = pt(T.x + 6, T.y - 128);
    const E = pt(D.x - 78, D.y + 5);
    const bar = () => {
      const c0 = C(Cb), t = C(T), f = C(F), d = C(D), e = C(E);
      const c1 = C(pt(T.x + R * 0.6, T.y));
      const c2 = C(pt(F.x, F.y + R * 0.5));
      const c3 = C(pt(F.x, F.y - R * 0.62));
      const c4 = C(pt(D.x + R * 0.7, D.y));
      ctx.moveTo(c0.x, c0.y);
      ctx.lineTo(t.x, t.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, f.x, f.y);
      ctx.bezierCurveTo(c3.x, c3.y, c4.x, c4.y, d.x, d.y);
      ctx.lineTo(e.x, e.y);
    };
    path(bar, mm(24, 2), band);
    path(bar, Math.max(1.1, lw * 0.85), 0.9);
    const hood = () => {
      const base = C(pt(T.x - 4, T.y + 3));
      const ctl = C(pt(Hd.x - 30, Hd.y + 4));
      const top = C(Hd);
      const nose = C(pt(Hd.x + 8, Hd.y - 16));
      const lever = C(pt(F.x + 6, F.y - 70));
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(ctl.x, ctl.y, top.x, top.y);
      ctx.lineTo(nose.x, nose.y);
      ctx.lineTo(lever.x, lever.y);
    };
    path(hood, mm(16, 2), band * 1.2);
    path(hood, lw, 1);

    // Saddle shell and rails
    const sB = p.saddleBack;
    const sN = p.saddleNose;
    const sLen = dist(sB, sN);
    const sDir = unit(sub(sN, sB));
    const down = pt(sDir.y, -sDir.x);
    const S = (along, depth) => add(add(sB, mul(sDir, along)), mul(down, depth));
    const shell = () => {
      const q = (a, d) => C(S(a, d));
      const p0 = q(4, 0), p1 = q(sLen - 8, 0), c1 = q(sLen + 3, 0.5), p2 = q(sLen - 2, 6);
      const p3 = q(sLen * 0.42, 15), c2 = q(8, 19), p4 = q(-1, 8), c3 = q(-2, 1);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.quadraticCurveTo(c1.x, c1.y, p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.quadraticCurveTo(c2.x, c2.y, p4.x, p4.y);
      ctx.quadraticCurveTo(c3.x, c3.y, p0.x, p0.y);
      ctx.closePath();
    };
    ctx.globalAlpha = alpha * (isGhost ? 0.14 : 0.22);
    ctx.beginPath();
    shell();
    ctx.fill();
    path(shell, Math.max(1.1, lw * 0.9), 1);
    const railY = p.saddleRail.y;
    path(poly([S(sLen * 0.16, 16), pt(p.seatClamp.x - 32, railY), pt(p.seatClamp.x + 34, railY), S(sLen * 0.8, 6)]), 1, 0.65);

    // Crank arm at 3 o'clock
    path(poly([p.bb, p.pedal]), lw, 0.9);

    if (!isGhost) {
      // Contact points
      dot(p.pedal, 2.4);
      dot(p.saddleCenter, 2.6);
      dot(Hd, 2.6);
      const bc = C(Cb);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(bc.x, bc.y, Math.max(2.5, p.barR * s), 0, Math.PI * 2);
      ctx.fillStyle = this.colors.canvas;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      const bbc = C(p.bb);
      ctx.beginPath();
      ctx.arc(bbc.x, bbc.y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = this.colors.canvas;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bbc.x, bbc.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Dimension annotations ─────────────────────────────────────────────────

  drawDims(view, p, metric, fit, color, order, count, alignT) {
    const { ctx } = this;
    const { C, X, Y, s } = this.mapper(view, p, alignT);
    const v = metricValue(metric, fit);
    const text = v === undefined ? '' : `${formatNumber(v)}${metric.unit === '°' ? '°' : ''}`;
    const off = order * STACK_GAP;
    // With two bikes, A's short labels go on the inner side and B's on the
    // outer side so they never collide.
    const inner = count > 1 && order === 0;
    let labelled = false;
    const nextLabel = () => {
      if (labelled) return '';
      labelled = true;
      return text;
    };

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    for (const d of metric.dims(p)) {
      if (d.type === 'guide') {
        this.dashed(C(d.a), C(d.b), color, 0.6);
      } else if (d.type === 'h') {
        const a = C(d.a);
        const b = C(d.b);
        const base = Y(d.y);
        const dir = d.stack || Math.sign(base - (a.y + b.y) / 2) || -1;
        const y = base + dir * off;
        this.extension(a, pt(a.x, y), color);
        this.extension(b, pt(b.x, y), color);
        this.dimension(pt(a.x, y), pt(b.x, y), color, nextLabel(), pt(0, dir), inner);
        this.markers([a, b], color);
      } else if (d.type === 'v') {
        const a = C(d.a);
        const b = C(d.b);
        const base = X(d.x);
        const dir = Math.sign(base - (a.x + b.x) / 2) || 1;
        const x = base + dir * off;
        this.extension(a, pt(x, a.y), color);
        this.extension(b, pt(x, b.y), color);
        this.dimension(pt(x, a.y), pt(x, b.y), color, nextLabel(), pt(dir, 0), inner);
        this.markers([a, b], color);
      } else if (d.type === 'line') {
        const a = C(d.a);
        const b = C(d.b);
        const uw = unit(sub(d.b, d.a)); // world direction
        const n = pt(-uw.y * d.side, -uw.x * d.side); // world normal → canvas (y flipped)
        const k = 12 + off;
        const a2 = add(a, mul(n, k));
        const b2 = add(b, mul(n, k));
        this.extension(a, a2, color);
        this.extension(b, b2, color);
        this.dimension(a2, b2, color, nextLabel(), n, inner);
        this.markers([a, b], color);
      } else if (d.type === 'angle') {
        this.angleDim(C(d.at), d.from, d.to, d.r * s + off, color, nextLabel(), inner);
      } else if (d.type === 'point') {
        const c = C(d.p);
        ctx.globalAlpha = 0.6;
        if (d.axis === 'x') this.dashed(pt(c.x, c.y - 34), pt(c.x, c.y + 34), color, 0.6);
        else this.dashed(pt(c.x - 34, c.y), pt(c.x + 34, c.y), color, 0.6);
        this.markers([c], color, 5);
        this.label(nextLabel(), c.x + 30 + off * 1.6, c.y - 16 - off, color);
      }
    }
    ctx.restore();
  }

  dashed(a, b, color, alpha = 0.55) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Extension line from a measured point to its dimension line (+ overshoot). */
  extension(from, to, color) {
    const d = sub(to, from);
    const l = len(d);
    if (l < 3) return;
    this.dashed(from, add(to, mul(d, 4 / l)), color, 0.5);
  }

  markers(points, color, r = 3.4) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = color;
    ctx.fillStyle = this.colors.canvas;
    for (const q of points) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Dimension line with arrowheads and an inline label.
   * `outward` points away from the measured points; short dimensions put the
   * label beside the line — outward, or inward when `inner` is set.
   */
  dimension(a, b, color, text, outward = null, inner = false) {
    const { ctx } = this;
    const d = sub(b, a);
    const l = len(d);
    if (l < 0.5) return;
    const u = mul(d, 1 / l);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (l > 16) {
      this.arrow(a, mul(u, -1));
      this.arrow(b, u);
    }
    ctx.restore();
    if (!text) return;
    ctx.font = LABEL_FONT;
    const w = ctx.measureText(text).width + 12;
    const hgt = 18;
    const mid = pt((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (l > w + 18) {
      this.label(text, mid.x, mid.y, color, Math.atan2(d.y, d.x));
      return;
    }
    // Too short for an inline label: sit it beside the line, clear of it.
    let side = outward ? unit(outward) : pt(-u.y, u.x);
    if (!outward && side.y > 0) side = mul(side, -1); // default: above
    if (inner) side = mul(side, -1);
    const clear = Math.abs(side.x) * (w / 2) + Math.abs(side.y) * (hgt / 2) + 6;
    this.label(text, mid.x + side.x * clear, mid.y + side.y * clear, color);
  }

  angleDim(c, fromW, toW, r, color, text, inner = false) {
    const { ctx } = this;
    const a0 = Math.atan2(-fromW.y, fromW.x);
    const a1 = Math.atan2(-toW.y, toW.x);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const ref = pt(c.x + Math.cos(a0) * (r + 14), c.y + Math.sin(a0) * (r + 14));
    this.dashed(c, ref, color, 0.6);
    this.dashed(c, pt(c.x + Math.cos(a1) * (r + 14), c.y + Math.sin(a1) * (r + 14)), color, 0.6);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, a0, a0 + delta, delta < 0);
    ctx.stroke();
    const sgn = Math.sign(delta);
    const tangent = (ang, dir) => pt(-Math.sin(ang) * dir, Math.cos(ang) * dir);
    this.arrow(pt(c.x + Math.cos(a0) * r, c.y + Math.sin(a0) * r), tangent(a0, -sgn));
    this.arrow(pt(c.x + Math.cos(a1) * r, c.y + Math.sin(a1) * r), tangent(a1, sgn));
    ctx.restore();
    const mid = a0 + delta / 2;
    const lr = inner ? r - 16 : r + 17; // A inside its arc, B outside
    this.label(text, c.x + Math.cos(mid) * lr, c.y + Math.sin(mid) * lr, color);
    this.markers([c], color, 3);
  }

  arrow(tip, dir) {
    const { ctx } = this;
    const l = 6.5;
    const w = 2.7;
    const bx = tip.x - dir.x * l;
    const by = tip.y - dir.y * l;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(bx - dir.y * w, by + dir.x * w);
    ctx.lineTo(bx + dir.y * w, by - dir.x * w);
    ctx.closePath();
    ctx.fill();
  }

  label(text, x, y, color, angle = 0) {
    if (!text) return;
    const { ctx } = this;
    let a = angle;
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.font = LABEL_FONT;
    const w = ctx.measureText(text).width + 12;
    const h = 18;
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.colors.canvas;
    roundRect(ctx, -w / 2, -h / 2, w, h, 5);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0.5);
    ctx.restore();
  }
}
