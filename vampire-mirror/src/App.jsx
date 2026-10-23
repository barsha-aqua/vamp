import { useEffect, useRef, useState } from 'react';
import MirrorCanvas from './components/MirrorCanvas.jsx';
import Frame from './components/Frame.jsx';
import { startCamera, stopCamera } from './lib/camera.js';
import { createTracker } from './lib/tracker.js';
import { initAudio, setMuted } from './lib/audio.js';

// phase: landing -> requesting (camera + models) -> setup -> countdown -> active   (or error)
export default function App() {
  const [phase, setPhase] = useState('landing');
  const [count, setCount] = useState(5);
  const [vanished, setVanished] = useState(false);
  const [mute, setMute] = useState(false);
  const [error, setError] = useState('');
  const mirrorRef = useRef(null), videoRef = useRef(null), streamRef = useRef(null), trackerRef = useRef(null);

  const teardown = () => {
    trackerRef.current?.stop(); trackerRef.current = null;
    stopCamera(streamRef.current); streamRef.current = null;
    mirrorRef.current?.detach();
  };

  async function start() {
    initAudio(); // must happen inside the click so the browser allows sound
    setPhase('requesting');
    try {
      streamRef.current = await startCamera(videoRef.current);
      mirrorRef.current.attach(videoRef.current); // you see yourself, dimly, while the models load
      // MediaPipe -> scene: the tracker writes hand/face/mask into a plain object the scene reads every frame.
      trackerRef.current = await createTracker(videoRef.current, () => mirrorRef.current?.maskMode() ?? 0);
      mirrorRef.current.setState(trackerRef.current.state);
      setPhase('setup');
    } catch (e) {
      teardown();
      setError(
        e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
          ? 'Camera access is needed for the mirror. Allow it in your browser, then try again.'
          : e?.name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'The camera or hand tracking could not start. Check your connection and try again.'
      );
      setPhase('error');
    }
  }

  // Countdown: the user steps out of frame, then the scene memorises the empty room.
  useEffect(() => {
    if (phase !== 'countdown') return;
    let n = 5; setCount(5);
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(id); mirrorRef.current?.capture(); setPhase('active'); }
      else setCount(n);
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => { mirrorRef.current?.setActive(phase === 'active'); }, [phase]);
  useEffect(() => () => { trackerRef.current?.stop(); stopCamera(streamRef.current); }, []);

  const toggleSound = () => { setMuted(!mute); setMute(!mute); };

  return (
    <main className="stage">
      <video ref={videoRef} className="hidden-video" playsInline muted />
      <MirrorCanvas ref={mirrorRef} onVanishedChange={setVanished} />
      <Frame />

      {(phase === 'landing' || phase === 'requesting' || phase === 'error') && (
        <section className="intro">
          <h1>Cast no reflection</h1>
          {phase === 'landing' && <p>Vampires don't appear in mirrors. Stand before this one, open your palm, and vanish.</p>}
          {phase === 'requesting' && <p>Lighting the candles. Loading hand tracking…</p>}
          {phase === 'error' && <p role="alert">{error}</p>}
          {phase !== 'requesting' && (
            <button className="primary" onClick={start}>{phase === 'error' ? 'Try again' : 'Step before the glass'}</button>
          )}
          <small>Your camera stays on your device.</small>
        </section>
      )}

      {phase === 'setup' && (
        <section className="plaque">
          <h2>Clear the room</h2>
          <p>Step out of the frame so the mirror can memorise the empty room. You'll have five seconds.</p>
          <button className="primary" onClick={() => setPhase('countdown')}>Capture the empty room</button>
        </section>
      )}

      {phase === 'countdown' && (
        <section className="countdown" aria-live="polite">
          <p>Step out of the frame</p>
          <span className="numeral">{count}</span>
        </section>
      )}

      {phase === 'active' && (
        <footer className="bar">
          <p className="hint" aria-live="polite">{vanished ? 'Make a fist to return.' : 'Open your palm to vanish.'}</p>
          <div className="bar-actions">
            <button className="quiet" onClick={() => setPhase('countdown')}>Recapture room</button>
            <button className="quiet" onClick={toggleSound}>{mute ? 'Sound off' : 'Sound on'}</button>
          </div>
        </footer>
      )}
    </main>
  );
}
