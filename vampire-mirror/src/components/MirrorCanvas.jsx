import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Scene } from '../lib/scene.js';

// Thin React wrapper. The Scene owns its own requestAnimationFrame loop, so tracking and
// drawing never cause React re-renders. React only hears about vanish/return changes.
const MirrorCanvas = forwardRef(function MirrorCanvas({ onVanishedChange }, ref) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cbRef = useRef(onVanishedChange);
  cbRef.current = onVanishedChange;

  useEffect(() => {
    const scene = new Scene(canvasRef.current, { onVanishedChange: (v) => cbRef.current?.(v) });
    sceneRef.current = scene;
    scene.start();
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(canvasRef.current);
    return () => { scene.stop(); ro.disconnect(); };
  }, []);

  useImperativeHandle(ref, () => ({
    attach: (video) => sceneRef.current?.attach(video),
    setState: (s) => sceneRef.current?.setState(s),
    detach: () => sceneRef.current?.detach(),
    capture: () => sceneRef.current?.capture(),
    setActive: (a) => sceneRef.current?.setActive(a),
    maskMode: () => sceneRef.current?.maskMode() ?? 0,
  }));

  return <canvas ref={canvasRef} className="mirror-canvas" />;
});

export default MirrorCanvas;
