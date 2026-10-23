// Bats and mist. Bats are drawn procedurally into 8 pre-baked wing-flap frames, so
// animating dozens of them is just drawImage (no per-frame path or shadow cost).
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const FRAMES = 8, SW = 128, SH = 96, CX = 64, CY = 52, U = 48; // sprite size, origin, unit scale

/** One bat in unit space (wingspan ~2.4). f: -1 wings down ... +1 wings up. Exported for testing. */
export function drawBatShape(g, f) {
  g.beginPath();
  g.ellipse(0, 0.05, 0.14, 0.26, 0, 0, TAU);
  g.fill();
  g.beginPath(); // head with two pointed ears
  g.moveTo(-0.11, -0.14); g.lineTo(-0.16, -0.44); g.lineTo(-0.04, -0.27);
  g.lineTo(0.04, -0.27); g.lineTo(0.16, -0.44); g.lineTo(0.11, -0.14);
  g.closePath(); g.fill();
  for (const s of [1, -1]) { // wings: arm and wrist, then a scalloped trailing edge
    g.save(); g.scale(s, 1); g.beginPath();
    g.moveTo(0.1, -0.12);
    g.quadraticCurveTo(0.45, -0.38 - 0.35 * f, 0.72, -0.3 - 0.55 * f);
    g.quadraticCurveTo(1.0, -0.28 - 0.75 * f, 1.2, -0.05 - 0.9 * f);
    g.quadraticCurveTo(1.0, 0.0 - 0.5 * f, 0.92, 0.22 - 0.35 * f);
    g.quadraticCurveTo(0.8, 0.08 - 0.3 * f, 0.66, 0.3 - 0.22 * f);
    g.quadraticCurveTo(0.52, 0.14 - 0.15 * f, 0.36, 0.36 - 0.1 * f);
    g.quadraticCurveTo(0.24, 0.2, 0.1, 0.34);
    g.closePath(); g.fill(); g.restore();
  }
}

let sprites = null, puff = null;
function bake() {
  if (sprites) return;
  sprites = Array.from({ length: FRAMES }, (_, i) => {
    const solid = document.createElement('canvas'); solid.width = SW; solid.height = SH;
    const s = solid.getContext('2d');
    s.translate(CX, CY); s.scale(U, U); s.fillStyle = '#0b0409';
    drawBatShape(s, Math.cos((i / FRAMES) * TAU)); // solid silhouette first...
    const c = document.createElement('canvas'); c.width = SW; c.height = SH;
    const g = c.getContext('2d');
    g.shadowColor = 'rgba(190,20,50,.7)'; g.shadowBlur = 9;
    g.drawImage(solid, 0, 0); // ...then one pass for the red glow, so it never paints over the body
    return c;
  });
  puff = document.createElement('canvas'); puff.width = puff.height = 64;
  const g = puff.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(215,205,215,.55)'); gr.addColorStop(0.5, 'rgba(190,180,195,.2)'); gr.addColorStop(1, 'rgba(180,170,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
}

export class Bats {
  constructor() { bake(); this.bats = []; this.puffs = []; }

  /** Vanish: bats tear out of the silhouette and scatter away from its centre. */
  burst(pts, cx, cy, W, H, n = 64) {
    const m = Math.min(W, H);
    for (let i = 0; i < n; i++) {
      const p = pts[i % pts.length];
      const ang = Math.atan2(p.y - cy, p.x - cx) + rand(-0.6, 0.6), sp = rand(0.2, 0.55) * m;
      this.bats.push({ kind: 'out', x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.12 * m,
        span: rand(0.035, 0.085) * m, hz: rand(7, 11), ph: rand(0, TAU), turn: rand(0.8, 2), life: 0, max: rand(2.2, 3.2) });
    }
  }

  /** Return: bats swoop in from outside the screen and converge on the silhouette. */
  swarmIn(pts, W, H, n = 64) {
    const m = Math.min(W, H);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = Math.max(W, H) * 0.75, t = pts[i % pts.length];
      this.bats.push({ kind: 'in', sx: W / 2 + Math.cos(a) * r, sy: H / 2 + Math.sin(a) * r, tx: t.x, ty: t.y, x: 0, y: 0, vx: 0,
        span: rand(0.035, 0.085) * m, hz: rand(10, 14), ph: rand(0, TAU), curve: rand(-1, 1), delay: rand(0, 0.45), dur: rand(0.85, 1.3), life: 0, max: 3 });
    }
  }

  mist(x, y, m) {
    if (this.puffs.length > 140) return;
    this.puffs.push({ x, y, vx: rand(-0.02, 0.02) * m, vy: -rand(0.02, 0.07) * m, s0: rand(0.05, 0.09) * m, s1: rand(0.16, 0.26) * m, life: 0, max: rand(1.4, 2.2) });
  }

  update(dt, W, H) {
    for (const p of this.puffs) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.puffs = this.puffs.filter((p) => p.life < p.max);
    for (const b of this.bats) {
      b.life += dt;
      if (b.kind === 'out') {
        const w = b.turn * Math.sin(b.life * 2.3 + b.ph) * dt, c = Math.cos(w), s = Math.sin(w);
        const vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c; // gentle curving flight
        b.vx = vx * (1 + dt * 0.45); b.vy = vy * (1 + dt * 0.45);
        b.x += b.vx * dt; b.y += b.vy * dt;
      } else {
        const u = clamp((b.life - b.delay) / b.dur, 0, 1), e = 1 - Math.pow(1 - u, 3);
        const dx = b.tx - b.sx, dy = b.ty - b.sy, len = Math.hypot(dx, dy) || 1;
        const off = Math.sin(u * Math.PI) * b.curve * len * 0.2;
        const nx = b.x, ny = b.y;
        b.x = b.sx + dx * e - (dy / len) * off; b.y = b.sy + dy * e + (dx / len) * off;
        b.vx = (b.x - nx) / Math.max(dt, 1e-3);
        b.u = u;
      }
    }
    this.bats = this.bats.filter((b) => (b.kind === 'in' ? (b.u ?? 0) < 1 : b.life < b.max && b.x > -150 && b.x < W + 150 && b.y > -150 && b.y < H + 150));
  }

  drawMist(ctx) {
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (const p of this.puffs) {
      const t = p.life / p.max, s = p.s0 + (p.s1 - p.s0) * t;
      ctx.globalAlpha = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.9;
      ctx.drawImage(puff, p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  drawBats(ctx) {
    for (const b of this.bats) {
      let alpha = 1, k = b.span / (2.44 * U), started = true;
      if (b.kind === 'out') alpha = Math.min(1, b.life / 0.15, (b.max - b.life) / 0.5);
      else { const u = b.u ?? 0; started = b.life >= b.delay; alpha = Math.min(1, u * 5) * (u > 0.88 ? (1 - u) / 0.12 : 1); k *= u > 0.88 ? 0.6 + 0.4 * ((1 - u) / 0.12) : 1; }
      if (!started || alpha <= 0.01) continue;
      const frame = Math.floor(b.life * b.hz * FRAMES + b.ph * 3) % FRAMES;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.translate(b.x, b.y);
      ctx.rotate(clamp(b.vx / (Math.abs(b.vx) + 300), -1, 1) * 0.5); // lean into the direction of travel
      ctx.drawImage(sprites[frame], -CX * k, -CY * k, SW * k, SH * k);
      ctx.restore();
    }
  }
}
