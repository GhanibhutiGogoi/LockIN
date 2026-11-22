export interface CalibrationGeometry {
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  windowX: number;
  windowY: number;
  pixelRatio: number;
  fullscreen: boolean;
  screenLeft?: number | null;
  screenTop?: number | null;
}
export function readCalibrationGeometry(): CalibrationGeometry;
export function coversScreen(geometry: CalibrationGeometry): boolean;
export function changedGeometry(a: CalibrationGeometry, b: CalibrationGeometry, space?: 'screen' | 'viewport'): (keyof CalibrationGeometry)[];
