import { FaceLandmarker, FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

// Small model files, downloaded once from Google's public bucket. Video frames never leave the device.
const BASE = 'https://storage.googleapis.com/mediapipe-models';
const HAND_URL = `${BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
const FACE_URL = `${BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;
const SEG_URL = `${BASE}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`;

const withFallback = async (make) => { try { return await make('GPU'); } catch { return make('CPU'); } };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// ---- Hand: classify the gesture from landmark geometry (works at any hand rotation) ----
// A finger is "extended" when its tip is farther from the wrist than its middle joint.
//   open palm = all four fingers extended   -> vanish
//   fist      = all four fingers curled     -> return
function readHand(lm) {
  const wrist = lm[0];
  const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [tip, pip]
  const extended = fingers.filter(([t, p]) => dist(lm[t], wrist) > dist(lm[p], wrist) * 1.15).length;
  const curled = fingers.filter(([t, p]) => dist(lm[t], wrist) < dist(lm[p], wrist) * 1.02).length;
  const gesture = extended === 4 ? 'palm' : curled === 4 ? 'fist' : 'other';
  const c = [0, 5, 9, 13, 17].map((i) => lm[i]); // palm centre, used for the progress ring
  return { gesture, x: c.reduce((s, p) => s + p.x, 0) / 5, y: c.reduce((s, p) => s + p.y, 0) / 5 };
}

// ---- Face: only the points the effects need ----
function readFace(lm) {
  const iris = lm.length >= 478; // refined landmarks include the irises (468 / 473)
  return {
    eyeA: iris ? lm[468] : mid(lm[33], lm[133]),
    eyeB: iris ? lm[473] : mid(lm[362], lm[263]),
    nose: lm[1],
    l: lm[78], r: lm[308],   // mouth corners
    up: lm[13], lo: lm[14],  // inner lips
    fl: lm[81], fr: lm[311], // where the canine teeth sit
    open: dist(lm[13], lm[14]) / dist(lm[78], lm[308]), // mouth-open ratio
  };
}

/**
 * One loop runs three models on the webcam and publishes the latest results into a plain
 * object (no React): state.hand, state.face, state.mask, state.liveSmall.
 *   state.mask = { w, h, data: Float32Array(0..1 "this pixel is the person"), version }
 * getMaskMode(): 0 = skip segmentation, 1 = occasionally (keeps the room fresh), 2 = every frame.
 */
export async function createTracker(video, getMaskMode) {
  const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
  const hands = await withFallback((delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_URL, delegate },
      runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    }));
  const seg = await withFallback((delegate) =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEG_URL, delegate },
      runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
    }));
  let face = null; // optional: without it you just lose glowing eyes and fangs
  try {
    face = await withFallback((delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_URL, delegate },
        runningMode: 'VIDEO', numFaces: 1,
      }));
  } catch { /* no face effects */ }

  // The segmenter sees a small copy of the frame (256 px wide): fast, and a small mask is all we need.
  const sc = document.createElement('canvas');
  const sx = sc.getContext('2d', { willReadFrequently: true });
  const state = { hand: null, face: null, mask: null, liveSmall: sc };

  // The model's mask can mean "person" or "background" depending on the model build, so we
  // calibrate once: with a face visible, the nose must be inside the person and the top
  // corners outside. Whichever mask/orientation scores best after a few votes wins.
  let pick = null, nVotes = 0; const votes = {};
  function calibrate(arrs, w, h) {
    const f = state.face;
    if (pick || !f) return;
    const at = (a, cx, cy, r) => {
      let s = 0, c = 0;
      for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) { s += a[y * w + x]; c++; }
      return c ? s / c : 0;
    };
    const nx = Math.round(f.nose.x * (w - 1)), ny = Math.round(f.nose.y * (h - 1));
    const cands = arrs.map((_, k) => ({ k, inv: false }));
    if (arrs.length === 1) cands.push({ k: 0, inv: true });
    let best = null, bestScore = -9;
    for (const c of cands) {
      const a = arrs[c.k];
      let s = at(a, nx, ny, 3) - (at(a, 6, 6, 5) + at(a, w - 7, 6, 5)) / 2;
      if (c.inv) s = -s;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (bestScore < 0.3) return; // not a clear separation yet (e.g. face at the frame edge)
    const key = `${best.k}${best.inv ? 'i' : ''}`;
    votes[key] = (votes[key] || 0) + 1;
    if (++nVotes >= 6) {
      const win = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
      pick = cands.find((c) => `${c.k}${c.inv ? 'i' : ''}` === win);
    }
  }

  function runSeg(now) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    const SW = 256, SH = Math.max(1, Math.round((SW * vh) / vw));
    if (sc.width !== SW || sc.height !== SH) { sc.width = SW; sc.height = SH; }
    sx.drawImage(video, 0, 0, SW, SH);
    try {
      seg.segmentForVideo(sc, now, (res) => {
        const ms = res.confidenceMasks;
        if (!ms?.length) return;
        const w = ms[0].width, h = ms[0].height;
        const arrs = ms.map((m) => m.getAsFloat32Array());
        calibrate(arrs, w, h);
        const pk = pick || (arrs.length > 1 ? { k: 1, inv: false } : { k: 0, inv: false });
        const a = arrs[Math.min(pk.k, arrs.length - 1)];
        let m = state.mask;
        if (!m || m.w !== w || m.h !== h) {
          m = state.mask = { w, h, data: new Float32Array(w * h), version: 0 };
          for (let i = 0; i < a.length; i++) m.data[i] = pk.inv ? 1 - a[i] : a[i];
        } else {
          // Temporal smoothing: calms flicker along the silhouette edge.
          for (let i = 0; i < a.length; i++) m.data[i] += ((pk.inv ? 1 - a[i] : a[i]) - m.data[i]) * 0.65;
        }
        m.version++;
      });
    } catch { /* skip this frame */ }
  }

  let raf, lastTime = -1, n = 0, handMiss = 0, stopped = false;
  const tick = () => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (video.readyState < 2 || video.currentTime === lastTime) return; // only on new webcam frames
    lastTime = video.currentTime;
    const now = performance.now();
    n++;

    const hr = hands.detectForVideo(video, now).landmarks?.[0];
    if (hr) { handMiss = 0; state.hand = readHand(hr); }
    else if (++handMiss >= 3) state.hand = null; // ride out brief dropouts

    if (face && n % 2 === 0) {
      const fr = face.detectForVideo(video, now).faceLandmarks?.[0];
      state.face = fr ? readFace(fr) : null;
    }

    const mode = Math.max(getMaskMode?.() ?? 0, pick ? 0 : 1);
    if (mode === 2 || (mode === 1 && n % 4 === 0)) runSeg(now);
  };
  tick();

  return { state, stop() { stopped = true; cancelAnimationFrame(raf); hands.close(); seg.close(); face?.close(); } };
}
