# Cast no reflection

A candlelit vampire mirror. Open your palm and you dissolve into bats; make a fist and they bring you back.
Webcam + MediaPipe (hand, face, person segmentation) + canvas. Fully client-side: no backend, no paid APIs.

    npm install     # also copies MediaPipe WASM into public/wasm
    npm run dev     # http://localhost:5173 (localhost counts as a secure context for the camera)
    npm run build   # static output in dist/ -> deploy to Vercel (framework: Vite)

## How to use
1. Press "Step before the glass" and allow the camera.
2. "Capture the empty room", then step out of the frame for 5 seconds. The mirror memorises the empty room.
3. Step back in. **Open palm, hold ~0.5 s: vanish.** **Fist, hold ~0.5 s: return.**
4. Eyes glow red while you charge a gesture. Open your mouth wide and fangs appear.

## Tips for a clean vanish
- Keep the camera still (tripod or a fixed laptop) and the room lit evenly.
- Avoid moving things behind you (people, curtains, screens).
- If the lighting changes, use "Recapture room".

## Tuning
- Gesture hold time, vanish/return speed: top of `src/lib/scene.js` (`HOLD`, `VANISH_S`, `APPEAR_S`).
- Fang/hiss sensitivity: `drawFace` in `src/lib/scene.js` (mouth-open ratio thresholds 0.26 / 0.3).
- Gesture rules: `readHand` in `src/lib/tracker.js`.
- Bat count: `burst` / `swarmIn` in `src/lib/bats.js`.
