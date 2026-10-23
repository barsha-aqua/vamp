// Pure array maths for the silhouette (no DOM), so it is cheap and easy to test.

/** Separable box blur: spreads the person mask outward so no hair/edge halo survives. */
export function boxBlur(src, dst, tmp, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * k;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * k;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/**
 * The dissolve. For every pixel of the silhouette we compare the visibility vv (1 = solid,
 * 0 = gone) with a drifting noise value n. Where the noise says "not yet", the figure is still
 * there (a = 1); where it says "already", the figure has turned to mist (a = 0).
 *   rho  alpha = how much of the empty-room plate replaces the person here
 *   edge colour/alpha = a glowing crimson ember line along the boundary of the dissolve (a ~ 0.5)
 * Pixels vanish from the feet upward (the gy term), so the head is the last thing to go.
 */
export function paintDissolve(dil, noise, w, h, vv, time, rho, edge) {
  const ox = (time * 16) | 0, oy = (-time * 26) | 0, S = 0.42;
  for (let y = 0; y < h; y++) {
    const row = ((y + oy) & 255) << 8, gy = y / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      let d = (dil[i] - 0.05) / 0.45;
      if (d <= 0.002) { rho[o + 3] = 0; edge[o + 3] = 0; continue; }
      if (d > 1) d = 1;
      d = d * d * (3 - 2 * d);
      const n = 0.72 * noise[row + ((x + ox) & 255)] + 0.28 * gy;
      let a = (vv * (1 + S) - n) / S;
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      a = a * a * (3 - 2 * a);
      rho[o + 3] = d * (1 - a) * 255;
      const band = 4 * a * (1 - a);
      edge[o] = 150 + 105 * a; edge[o + 1] = 12 + 105 * a * a; edge[o + 2] = 28 + 10 * a;
      edge[o + 3] = d * band * 235;
    }
  }
}

/** A generous "person is near here" alpha, used to keep the person out of the room plate. */
export function paintWide(dil, w, h, rho) {
  for (let i = 0; i < w * h; i++) {
    const d = dil[i] / 0.12;
    rho[i * 4 + 3] = (d > 1 ? 1 : d) * 255;
  }
}
