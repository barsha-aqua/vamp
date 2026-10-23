// The mirror. One canvas, layers bottom to top:
//   1. live webcam (mirrored, "cover" fit)
//   2. the empty-room PLATE, drawn only where the dissolve has removed the person
//   3. glowing ember edge along the dissolve front
//   4. grade: candle glow, dark tint, vignette
//   5. mist, red eyes + fangs, bats, gesture ring, flash
import { Bats } from './bats.js';
import { boxBlur, paintDissolve, paintWide } from './mask.js';
import { makeNoise } from './noise.js';
import { whoosh } from './audio.js';

const HOLD = 0.55;      // seconds a gesture must be held
const VANISH_S = 2.2, APPEAR_S = 1.8, COOLDOWN = 1.2;
const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const FACE_KEYS = ['eyeA', 'eyeB', 'l', 'r', 'up', 'lo', 'fl', 'fr'];

// What the mirror shows before the camera starts: a dark room with out-of-focus candle flames.
function buildBackdrop(W, H) {
  const c = mk(W, H), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0c0709'); bg.addColorStop(1, '#1d1213');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const m = Math.min(W, H);
  for (const [rgb, x, y, r, a] of [['255,170,90', 0.1, 0.8, 0.2, 0.5], ['255,140,70', 0.9, 0.74, 0.16, 0.45], ['200,60,60', 0.5, 0.2, 0.22, 0.2], ['255,190,120', 0.74, 0.9, 0.08, 0.5], ['255,160,90', 0.26, 0.92, 0.07, 0.45]]) {
    const rad = r * m * 1.6, gr = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, rad);
    gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  return c;
}

export class Scene {
  constructor(canvas, { onVanishedChange } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.onVanishedChange = onVanishedChange;
    this.video = null; this.state = null;
    this.noise = makeNoise(); this.bats = new Bats();
    this.v = 1; this.target = 1;                 // visibility: 1 = solid, 0 = gone
    this.hold = 0; this.want = null; this.cooldown = 0; this.pulse = 0; this.active = false;
    this.plateReady = false; this.maskVersion = -1; this.plateVersion = -1; this.paintKey = '';
    this.time = 0; this.last = 0; this.flashV = 0; this.gain = 1;
    this.fs = null; this.faceA = 0; this.ringP = null; this.ringA = 0;
    this.W = 0; this.H = 0; this.vw = 0; this.vh = 0;
    this.render = this.render.bind(this);
  }

  start() { this.resize(); this.raf = requestAnimationFrame(this.render); }
  stop() { cancelAnimationFrame(this.raf); }
  attach(video) { this.video = video; }
  setState(state) { this.state = state; }
  detach() { this.video = null; this.state = null; this.plateReady = false; this.fs = null; this.dil = null; this.reset(); }
  setActive(a) { this.active = a; if (!a) { this.hold = 0; this.want = null; } }
  reset() { this.v = 1; this.target = 1; this.hold = 0; this.bats.bats = []; this.bats.puffs = []; this.paintKey = ''; }
  /** 0 = no segmentation needed, 1 = occasionally (keep the room fresh), 2 = every frame (vanished / transitioning). */
  maskMode() { if (!this.active || !this.plateReady) return 0; return this.v < 1 || this.target < 1 ? 2 : 1; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const k = Math.min(1, Math.sqrt(2.4e6 / (r.width * r.height * dpr * dpr))); // cap at ~2.4 megapixels
    dpr *= k;
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (!W || !H || (W === this.W && H === this.H)) return;
    Object.assign(this, { W, H, dpr });
    this.canvas.width = W; this.canvas.height = H;
    this.layer = mk(W, H); this.lx = this.layer.getContext('2d');
    this.backdrop = buildBackdrop(W, H);
  }

  videoReady() { const v = this.video; return !!(v && v.readyState >= 2 && v.videoWidth); }

  // ---------- coordinate mapping ----------
  // The webcam is drawn mirrored and "cover"-fitted. Everything tied to the frame (landmarks,
  // masks, the plate) goes through the same transform, so effects land exactly on your face.
  cover() {
    const s = Math.max(this.W / this.vw, this.H / this.vh), dw = this.vw * s, dh = this.vh * s;
    return { dw, dh, ox: (this.W - dw) / 2, oy: (this.H - dh) / 2 };
  }
  drawMirrored(g, src) {
    const { dw, dh, ox, oy } = this.cover();
    g.save(); g.translate(this.W, 0); g.scale(-1, 1); g.drawImage(src, ox, oy, dw, dh); g.restore();
  }
  /** MediaPipe landmark (0..1 in the video frame) -> canvas pixels. */
  toCanvas(nx, ny) { const { dw, dh, ox, oy } = this.cover(); return { x: ox + (1 - nx) * dw, y: oy + ny * dh }; }

  // ---------- the empty-room plate ----------
  /** Memorise the room. The user has stepped out of frame; this frame is what they'll be replaced with. */
  capture() {
    if (!this.videoReady()) return;
    const { videoWidth: w, videoHeight: h } = this.video;
    this.plate = mk(w, h); this.plateX = this.plate.getContext('2d'); this.plateX.drawImage(this.video, 0, 0, w, h);
    this.tmp = mk(w, h); this.tx = this.tmp.getContext('2d');
    this.plateReady = true; this.flashV = 1; this.gain = 1; this.plateVersion = -1;
    this.reset(); this.onVanishedChange?.(false);
  }

  /** While you stand there, quietly refresh the plate wherever you are clearly NOT (light drifts, doors open). */
  maintainPlate() {
    if (!this.plateReady || !this.dil || this.maskVersion === this.plateVersion) return;
    this.plateVersion = this.maskVersion;
    paintWide(this.dil, this.mw, this.mh, this.rhoImg.data);
    this.rhoX.putImageData(this.rhoImg, 0, 0); this.paintKey = '';
    const t = this.tx, { vw, vh } = this;
    t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, vw, vh); t.drawImage(this.video, 0, 0, vw, vh);
    t.globalCompositeOperation = 'destination-out'; t.drawImage(this.rhoC, 0, 0, vw, vh); // cut the person out
    this.plateX.globalAlpha = 0.025; this.plateX.drawImage(this.tmp, 0, 0); this.plateX.globalAlpha = 1;
  }

  /** The webcam's auto-exposure shifts when you leave the frame. Match the plate's brightness to the live room. */
  matchExposure() {
    const live = this.state?.liveSmall, w = this.mw, h = this.mh;
    if (!live || live.width !== w || live.height !== h) return;
    this.plateSmallX.drawImage(this.plate, 0, 0, w, h);
    const a = live.getContext('2d').getImageData(0, 0, w, h).data, b = this.plateSmallX.getImageData(0, 0, w, h).data;
    let sa = 0, sb = 0, c = 0;
    for (let i = 0; i < w * h; i += 2) {
      if (this.dil[i] > 0.01) continue; // background pixels only
      const o = i * 4; sa += a[o] + a[o + 1] + a[o + 2]; sb += b[o] + b[o + 1] + b[o + 2]; c++;
    }
    if (c < 300 || sb < 1) return;
    const target = Math.min(1.6, Math.max(0.6, sa / sb));
    this.gain += (target - this.gain) * 0.15;
  }

  // ---------- silhouette ----------
  updateMask() {
    const m = this.state?.mask;
    if (!m || m.version === this.maskVersion) return;
    if (!this.dil || this.mw !== m.w || this.mh !== m.h) {
      const { w, h } = m;
      Object.assign(this, { mw: w, mh: h, dil: new Float32Array(w * h), tmpA: new Float32Array(w * h), tmpB: new Float32Array(w * h) });
      this.rhoC = mk(w, h); this.rhoX = this.rhoC.getContext('2d'); this.rhoImg = this.rhoX.createImageData(w, h);
      this.edgeC = mk(w, h); this.edgeX = this.edgeC.getContext('2d'); this.edgeImg = this.edgeX.createImageData(w, h);
      this.plateSmall = mk(w, h); this.plateSmallX = this.plateSmall.getContext('2d', { willReadFrequently: true });
      this.paintKey = '';
    }
    this.maskVersion = m.version;
    // Two blur passes push the mask outward a little, so hair and fuzzy edges are covered too.
    boxBlur(m.data, this.tmpA, this.tmpB, m.w, m.h, 2);
    boxBlur(this.tmpA, this.dil, this.tmpB, m.w, m.h, 2);
    if (this.plateReady && m.version % 5 === 0) this.matchExposure();
  }

  /** Points inside the silhouette plus its centre: where bats spawn / converge. */
  silhouette(n) {
    const pts = []; let cx = this.W / 2, cy = this.H / 2;
    if (this.dil) {
      const { mw: w, mh: h, dil } = this; let sx = 0, sy = 0, c = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (dil[y * w + x] > 0.6) { sx += x; sy += y; c++; }
      if (c > 20) {
        const p = this.toCanvas((sx / c + 0.5) / w, (sy / c + 0.5) / h); cx = p.x; cy = p.y;
        for (let k = 0; k < 500 && pts.length < n; k++) {
          const gx = (Math.random() * w) | 0, gy = (Math.random() * h) | 0;
          if (dil[gy * w + gx] > 0.7) pts.push(this.toCanvas((gx + 0.5) / w, (gy + 0.5) / h));
        }
      }
    }
    if (!pts.length) for (let k = 0; k < n; k++) pts.push({ x: cx + (Math.random() - 0.5) * this.W * 0.25, y: cy + (Math.random() - 0.5) * this.H * 0.5 });
    return { pts, cx, cy };
  }

  // ---------- gestures ----------
  /** Hold an open palm to vanish, a fist to return. Holding fills a ring and charges the eyes. */
  updateGesture(dt) {
    const h = this.state?.hand;
    this.cooldown = Math.max(0, this.cooldown - dt);
    let want = null;
    if (this.active && this.plateReady && h && this.cooldown === 0) {
      if (h.gesture === 'palm' && this.target === 1) want = 'vanish';
      else if (h.gesture === 'fist' && this.target === 0) want = 'appear';
    }
    if (want && want !== this.want) this.hold = 0;
    this.want = want;
    this.hold = want ? this.hold + dt : Math.max(0, this.hold - dt * 2); // brief tracking flicker only slows the charge
    if (want && this.hold >= HOLD) this.trigger(want);
  }

  trigger(kind) {
    const sil = this.silhouette(60);
    if (kind === 'vanish') { this.target = 0; this.bats.burst(sil.pts, sil.cx, sil.cy, this.W, this.H); whoosh('out'); }
    else { this.target = 1; this.bats.swarmIn(sil.pts, this.W, this.H); whoosh('in'); }
    this.pulse = 1; this.hold = 0; this.want = null; this.cooldown = COOLDOWN;
    this.onVanishedChange?.(kind === 'vanish');
  }

  updateVisibility(dt) {
    if (this.v !== this.target) {
      const dur = this.target === 0 ? VANISH_S : APPEAR_S;
      this.v += Math.sign(this.target - this.v) * (dt / dur);
      if ((this.target === 0 && this.v < 0) || (this.target === 1 && this.v > 1)) this.v = this.target;
      if (this.dil) for (let i = 0, n = Math.random() < 0.7 ? 2 : 1; i < n; i++) {
        const p = this.silhouette(1).pts[0]; this.bats.mist(p.x, p.y, Math.min(this.W, this.H));
      }
    }
    this.pulse = Math.max(0, this.pulse - dt * 0.9);
  }

  updateFace(dt) {
    const f = this.state?.face;
    if (!f) { this.faceA = Math.max(0, this.faceA - dt * 5); return; }
    this.faceA = Math.min(1, this.faceA + dt * 8);
    const k = 1 - Math.exp(-dt * 18); // ease between the ~15 Hz face samples
    if (!this.fs) { this.fs = { open: f.open }; for (const key of FACE_KEYS) this.fs[key] = { x: f[key].x, y: f[key].y }; return; }
    for (const key of FACE_KEYS) { this.fs[key].x += (f[key].x - this.fs[key].x) * k; this.fs[key].y += (f[key].y - this.fs[key].y) * k; }
    this.fs.open += (f.open - this.fs.open) * k;
  }

  // ---------- drawing ----------
  render(now) {
    this.raf = requestAnimationFrame(this.render);
    if (!this.W) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now; this.time += dt;
    const ready = this.videoReady();
    if (ready) { this.vw = this.video.videoWidth; this.vh = this.video.videoHeight; this.updateMask(); }
    this.updateGesture(dt); this.updateVisibility(dt); this.updateFace(dt);
    this.bats.update(dt, this.W, this.H);
    this.draw(ready, dt);
  }

  draw(ready, dt) {
    const { ctx } = this;
    if (!ready) ctx.drawImage(this.backdrop, 0, 0);
    else {
      this.drawMirrored(ctx, this.video);
      const vv = smooth(this.v);
      if (this.v < 1 && this.plateReady && this.dil) this.compositePlate(vv);
      else if (this.v >= 1 && this.active) this.maintainPlate();
    }
    this.grade();
    this.bats.drawMist(ctx);
    if (ready) { this.drawFace(smooth(this.v)); }
    this.bats.drawBats(ctx);
    if (ready) this.drawRing(dt);
    if (this.flashV > 0) { ctx.fillStyle = `rgba(255,240,230,${this.flashV * 0.8})`; ctx.fillRect(0, 0, this.W, this.H); this.flashV = Math.max(0, this.flashV - dt * 1.8); }
  }

  /** Replace the person with the plate wherever the dissolve says so, then add the ember edge. */
  compositePlate(vv) {
    if (!(vv === 0 && this.paintKey === `0:${this.maskVersion}`)) {
      paintDissolve(this.dil, this.noise, this.mw, this.mh, vv, this.time, this.rhoImg.data, this.edgeImg.data);
      this.rhoX.putImageData(this.rhoImg, 0, 0); this.edgeX.putImageData(this.edgeImg, 0, 0);
      this.paintKey = vv === 0 ? `0:${this.maskVersion}` : '';
    }
    const L = this.lx, c = this.ctx, { W, H } = this;
    L.globalCompositeOperation = 'source-over'; L.clearRect(0, 0, W, H);
    L.filter = Math.abs(this.gain - 1) > 0.02 ? `brightness(${this.gain.toFixed(3)})` : 'none';
    this.drawMirrored(L, this.plate);          // the empty room...
    L.filter = 'none';
    L.globalCompositeOperation = 'destination-in';
    this.drawMirrored(L, this.rhoC);           // ...kept only where the person is dissolving
    L.globalCompositeOperation = 'source-over';
    c.drawImage(this.layer, 0, 0);
    c.save(); c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.9; this.drawMirrored(c, this.edgeC);
    c.filter = 'blur(10px)'; c.globalAlpha = 0.7; this.drawMirrored(c, this.edgeC);
    c.restore();
  }

  /** Dark tint, flickering candlelight from the lower corners, heavy vignette. */
  grade() {
    const { ctx, W, H, time: t } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(176,148,150)'; ctx.fillRect(0, 0, W, H);
    const flick = 0.82 + 0.09 * Math.sin(t * 9.7) + 0.05 * Math.sin(t * 23.1 + 2) + 0.04 * Math.sin(t * 37.3 + 5);
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, r, a] of [[0.06, 0.96, 0.55, 0.2], [0.95, 0.92, 0.45, 0.15]]) {
      const f = a * flick * (x < 0.5 ? 1 : 0.9 + 0.1 * Math.sin(t * 11));
      const gr = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * Math.max(W, H));
      gr.addColorStop(0, `rgba(255,150,70,${f})`); gr.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    const vg = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(4,0,3,0)'); vg.addColorStop(1, 'rgba(4,0,3,.88)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /** Red glowing eyes (while charging a gesture, on each vanish/return, or when you hiss) and fangs when the mouth opens. */
  drawFace(vv) {
    const f = this.fs;
    if (!f || this.faceA < 0.02 || vv < 0.04) return;
    const P = (p) => this.toCanvas(p.x, p.y), c = this.ctx;
    const eA = P(f.eyeA), eB = P(f.eyeB), eyeD = Math.hypot(eA.x - eB.x, eA.y - eB.y);
    const hiss = clamp01((f.open - 0.3) / 0.3);
    const glow = Math.max(this.hold / HOLD, hiss, this.pulse) * vv * this.faceA;
    if (glow > 0.02) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const e of [eA, eB]) {
        const r = eyeD * (0.16 + 0.16 * glow), g = c.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        g.addColorStop(0, `rgba(255,95,75,${0.95 * glow})`); g.addColorStop(0.25, `rgba(230,20,40,${0.65 * glow})`); g.addColorStop(1, 'rgba(160,0,20,0)');
        c.fillStyle = g; c.beginPath(); c.arc(e.x, e.y, r, 0, TAU); c.fill();
      }
      c.restore();
    }
    const open = clamp01((f.open - 0.26) / 0.2);
    if (open > 0.02) {
      const l = P(f.l), r = P(f.r), up = P(f.up), lo = P(f.lo), mw = Math.hypot(r.x - l.x, r.y - l.y) || 1;
      let dx = -(r.y - l.y) / mw, dy = (r.x - l.x) / mw; // perpendicular to the mouth line...
      if (dx * (lo.x - up.x) + dy * (lo.y - up.y) < 0) { dx = -dx; dy = -dy; } // ...pointing toward the lower lip
      const len = mw * 0.17 * open, wid = mw * 0.038;
      c.save(); c.globalAlpha = vv * this.faceA;
      for (const p of [P(f.fl), P(f.fr)]) {
        const px = -dy, py = dx, tipx = p.x + dx * len, tipy = p.y + dy * len;
        const g = c.createLinearGradient(p.x, p.y, tipx, tipy);
        g.addColorStop(0, '#d8cdb8'); g.addColorStop(1, '#fbf6ec');
        c.fillStyle = g; c.strokeStyle = 'rgba(60,15,20,.55)'; c.lineWidth = Math.max(1, mw * 0.006);
        c.beginPath();
        c.moveTo(p.x + px * wid, p.y + py * wid);
        c.quadraticCurveTo(p.x + px * wid * 0.9 + dx * len * 0.55, p.y + py * wid * 0.9 + dy * len * 0.55, tipx, tipy);
        c.quadraticCurveTo(p.x - px * wid * 0.9 + dx * len * 0.55, p.y - py * wid * 0.9 + dy * len * 0.55, p.x - px * wid, p.y - py * wid);
        c.closePath(); c.fill(); c.stroke();
      }
      c.restore();
    }
  }

  /** A ring on your palm that fills while you hold a gesture. It stays visible when you've vanished, so you can see the mirror is listening. */
  drawRing(dt) {
    const h = this.state?.hand, c = this.ctx;
    if (!this.active || !h) this.ringA = Math.max(0, this.ringA - dt * 4);
    else {
      const p = this.toCanvas(h.x, h.y);
      if (!this.ringP) this.ringP = { ...p }; else { this.ringP.x += (p.x - this.ringP.x) * 0.5; this.ringP.y += (p.y - this.ringP.y) * 0.5; }
      this.ringA = Math.min(1, this.ringA + dt * 6);
    }
    if (this.ringA < 0.01 || !this.ringP) return;
    const r = 34 * this.dpr, prog = clamp01(this.hold / HOLD);
    c.save(); c.lineCap = 'round';
    c.lineWidth = 2 * this.dpr; c.strokeStyle = `rgba(232,223,208,${0.28 * this.ringA})`;
    c.beginPath(); c.arc(this.ringP.x, this.ringP.y, r, 0, TAU); c.stroke();
    if (prog > 0.01) {
      c.lineWidth = 3.5 * this.dpr; c.strokeStyle = `rgba(224,40,64,${this.ringA})`;
      c.beginPath(); c.arc(this.ringP.x, this.ringP.y, r, -Math.PI / 2, -Math.PI / 2 + TAU * prog); c.stroke();
    }
    c.restore();
  }
}
