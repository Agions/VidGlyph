/**
 * @file IOCREngine.ts
 * @description VidGlyph 系统的核心 OCR 服务抽象接口与数据结构定义。
 * 遵循 依赖倒置原则 (DIP)，解耦核心引擎与具体的离线/云端 OCR 实现。
 */

/** 归一化矩形选区 0.0 ~ 1.0 */
export interface NormalizedROI {
  x: number;      // 左上角 X 轴比例 (0.0 ~ 1.0)
  y: number;      // 左上角 Y 轴比例 (0.0 ~ 1.0)
  width: number;  // 选区宽度比例 (0.0 ~ 1.0)
  height: number; // 选区高度比例 (0.0 ~ 1.0)
}

/** 单次 OCR 识别提取结果项 */
export interface OCRItem {
  id: string;
  startTime: number; // 毫秒
  endTime: number;   // 毫秒
  text: string;
  confidence: number; // 0 ~ 100
  roi?: NormalizedROI;
}

/** OCR 运行配置参数 */
export interface OCRConfig {
  mode: 'local' | 'cloud';
  language: string;       // e.g. 'chi_sim+eng'
  apiKey?: string;
  cloudEndpoint?: string;
  cloudModel?: string;    // e.g. 'gemini-1.5-flash' | 'gpt-4o'
  localModelPath?: string;
  preprocessDenoise?: boolean;
}

/** OCR 引擎统一服务接口 */
export interface IOCREngineProvider {
  readonly engineName: string;
  readonly mode: 'local' | 'cloud';

  /**
   * 初始化/准备 OCR 引擎资源
   */
  initialize(config: OCRConfig): Promise<void>;

  /**
   * 对指定图像 Frame（支持 ImageData / HTMLCanvasElement / Blob）进行 OCR 提取
   */
  recognizeFrame(
    frameData: HTMLCanvasElement | Blob | ImageData,
    roi?: NormalizedROI
  ): Promise<OCRItem[]>;

  /**
   * 释放引擎占用的内存与 WebWorker 资源
   */
  destroy(): Promise<void>;
}
