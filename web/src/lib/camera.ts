/**
 * The single camera stream. The UI owns it so there is exactly one camera
 * indicator and one off switch; attention providers borrow it.
 */
export type CameraStatus = 'off' | 'asking' | 'on' | 'paused' | 'blocked' | 'missing' | 'skipped';

let stream: MediaStream | null = null;

export function getStream() {
  return stream;
}

export async function requestCamera(): Promise<CameraStatus> {
  if (!navigator.mediaDevices?.getUserMedia) return 'missing';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 }, facingMode: 'user' },
      audio: false,
    });
    return 'on';
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'missing';
    return 'blocked';
  }
}

/** Turn the camera fully off (the hardware light goes out). */
export function releaseCamera() {
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
