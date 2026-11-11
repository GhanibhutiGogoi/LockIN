import { FaceLandmarker, FilesetResolver, DrawingUtils, FaceLandmarkerResult } from "@mediapipe/tasks-vision";

// References
// https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js#video
export default class FaceLandmarkerClient {
  private faceLandmarker: any;

  constructor() {
  }

  async initialize() {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      new URL('mediapipe', self.location.href).href
    );
    const options = {
      baseOptions: {
        modelAssetPath: new URL('face_landmarker.task', self.location.href).href,
        delegate: "GPU" as const,
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "IMAGE" as const,
      numFaces: 1,
    };
    try {
      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, options);
    } catch {
      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      });
    }
  }

  async processFrame(frame: ImageData): Promise<FaceLandmarkerResult | null> {
    if (!this.faceLandmarker) {
      console.error("FaceLandmarker is not loaded yet.");
      return null;
    }

    let result: FaceLandmarkerResult;
    result = await this.faceLandmarker.detect(frame);
    return result;
  }
}
