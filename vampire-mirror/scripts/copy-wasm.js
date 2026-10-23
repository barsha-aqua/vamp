// Copies MediaPipe's WASM runtime from node_modules into public/wasm so it is
// served from your own origin (no CDN needed for the runtime).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm';
if (existsSync(src)) {
  mkdirSync('public/wasm', { recursive: true });
  cpSync(src, 'public/wasm', { recursive: true });
}
