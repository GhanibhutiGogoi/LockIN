/**
 * The single camera stream. The UI owns it so there is exactly one camera
 * indicator and one off switch; attention providers borrow it.
 */
export type CameraStatus = 'off' | 'asking' | 'on' | 'paused' | 'blocked' | 'missing' | 'skipped';

let stream: MediaStream | null = null;
let requestId = 0;
let lastCameraError: string | null = null;

export const cameraErrorName = () => lastCameraError;

export function getStream() {
  return stream;
}

export async function requestCamera(): Promise<CameraStatus> {
  lastCameraError = null;
  if (!navigator.mediaDevices?.getUserMedia) {
    lastCameraError = 'MediaDevicesUnavailable';
    return 'missing';
  }
  const id = ++requestId;
  try {
    const opened = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 }, facingMode: 'user' },
      audio: false,
    });
    if (id !== requestId) {
      opened.getTracks().forEach((track) => track.stop());
      return 'off';
    }
    stream = opened;
    return 'on';
  } catch (err) {
    if (id !== requestId) return 'off';
    const name = (err as DOMException).name;
    lastCameraError = typeof name === 'string' && /^[A-Za-z]{1,64}$/.test(name) ? name : 'UnknownError';
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'missing';
    return 'blocked';
  }
}

/** Turn the camera fully off (the hardware light goes out). */
export function releaseCamera() {
  requestId++;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

export async function cameraPermission(): Promise<PermissionState | 'unknown'> {
  try {
    const p = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return p.state;
  } catch {
    return 'unknown';
  }
}
