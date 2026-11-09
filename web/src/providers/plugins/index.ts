/**
 * In-browser attention plugins.
 *
 * Gaze-tracking team: if your model runs in the browser (MediaPipe Tasks +
 * WebEyeTrack in a Web Worker, as the proposal plans), implement
 * AttentionProvider in this folder and register it here. It then shows up as a
 * mode in the Integrations panel. See ./attentionTemplate.ts for a skeleton.
 *
 * If your model runs as a separate process instead, use the "ws" mode and
 * stream samples over WebSocket — no code needed here.
 */
import { registerAttentionPlugin } from '../registry';
import { CameraTemplateProvider } from './attentionTemplate';

registerAttentionPlugin('camera-template', 'Camera template (face present only)', () => new CameraTemplateProvider());
