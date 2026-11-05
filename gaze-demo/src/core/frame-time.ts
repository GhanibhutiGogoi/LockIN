export function usableFrame(capturedAt: number, receivedAt: number, previousCapture: number): boolean {
  return Number.isFinite(capturedAt) && Number.isFinite(receivedAt) && capturedAt > previousCapture && capturedAt <= receivedAt && receivedAt - capturedAt <= 1500;
}
