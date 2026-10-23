// Webcam: the stream feeds a hidden <video>; it is only drawn to a local canvas and
// read by MediaPipe. Nothing is uploaded or stored.
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotFoundError' });
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}
export const stopCamera = (stream) => stream?.getTracks().forEach((t) => t.stop());
