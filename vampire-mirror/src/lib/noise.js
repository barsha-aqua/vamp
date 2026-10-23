// Periodic value noise (tiles seamlessly). Drives the dissolve so the figure
// breaks up like drifting mist instead of fading evenly. Values are 0..1.
export function makeNoise(size = 256, seed = 11) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out = new Float32Array(size * size);
  for (const [cells, amp] of [[8, 0.55], [16, 0.3], [32, 0.15]]) {
    const grid = Float32Array.from({ length: cells * cells }, rnd);
    const cs = size / cells;
    for (let y = 0; y < size; y++) {
      const gy = y / cs, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const gx = x / cs, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
        const a = x0 % cells, b = (x0 + 1) % cells;
        const top = grid[r0 + a] + (grid[r0 + b] - grid[r0 + a]) * sx;
        const bot = grid[r1 + a] + (grid[r1 + b] - grid[r1 + a]) * sx;
        out[y * size + x] += amp * (top + (bot - top) * sy);
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}
