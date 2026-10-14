/**
 * @file LocalOCREngine.ts
 * @description 基于 Tesseract.js 与 Canvas 离线提取的本地 OCR 引擎实现。
 * 支持图像裁剪、预处理降噪与高准确度硬字幕中英文文字检测。
 */

import type { IOCREngineProvider, OCRConfig, OCRItem, NormalizedROI } from './IOCREngine';
import { logger } from '@/utils/logger';
import { preprocessImage, type PreprocessorConfig } from '@/utils/image-preprocessor';

type TesseractModule = typeof import('tesseract.js');
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>;

/**
 * 逐帧预处理参数：面向「已裁切的字幕条」，
 * 关闭去倾斜与多遍处理（字幕为水平排版，收益低但开销成倍），保证抽帧节奏可控。
 */
const FRAME_PREPROCESS_CONFIG: Partial<PreprocessorConfig> = {
  scaleFactor: 1.5,
  enhanceContrast: true,
  contrastLevel: 1.6,
  adaptiveThreshold: true,
  adaptiveBlockSize: 11,
  denoise: true,
  morphCleanup: false,
  deskew: false,
  multiPass: false,
};

export class LocalOCREngine implements IOCREngineProvider {
  readonly engineName = 'Local Tesseract Engine';
  readonly mode = 'local' as const;

  private worker: TesseractWorker | null = null;
  public isInitialized = false;
  public currentLanguage = 'chi_sim+eng';
  /** 是否对每一帧做降噪 / 二值化预处理（由提取配置决定） */
  public preprocessDenoise = true;

  async initialize(config: OCRConfig): Promise<void> {
    if (config.language) {
      this.currentLanguage = config.language;
    }
    if (typeof config.preprocessDenoise === 'boolean') {
      this.preprocessDenoise = config.preprocessDenoise;
    }

    if (!this.worker) {
      try {
        const tesseractMod = await import('tesseract.js');
        this.worker = await tesseractMod.createWorker(['chi_sim', 'eng'], 1, { logger: () => {} });
      } catch (err) {
        console.warn('LocalOCREngine: Tesseract Worker chi_sim+eng 初始化重试:', err);
        try {
          const tesseractMod = await import('tesseract.js');
          this.worker = await tesseractMod.createWorker('chi_sim+eng');
        } catch (e) {
          console.warn('LocalOCREngine: Tesseract 加载跳过:', e);
        }
      }
    }
    this.isInitialized = true;
  }

  async recognizeFrame(
    frameData: HTMLCanvasElement | Blob | ImageData,
    roi?: NormalizedROI
  ): Promise<OCRItem[]> {
    if (!this.isInitialized && !this.worker) {
      await this.initialize({ mode: 'local', language: this.currentLanguage });
    }

    // 处理 ROI 选区裁剪
    let processedCanvas = await this.toCanvas(frameData);

    if (roi && frameData instanceof HTMLCanvasElement) {
      processedCanvas = this.cropCanvasROI(frameData, roi);
    }

    if (this.preprocessDenoise) {
      processedCanvas = this.applyPreprocess(processedCanvas);
    }

    if (this.worker) {
      try {
        const { data } = await this.worker.recognize(processedCanvas);
        const cleanText = data.text ? data.text.trim().replace(/\n+/g, ' ') : '';
        if (cleanText && cleanText.length > 0) {
          return [
            {
              id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              startTime: 0,
              endTime: 0,
              text: cleanText,
              confidence: Math.round(data.confidence || 88),
              roi,
            },
          ];
        }
      } catch (err) {
        logger.warn('LocalOCREngine', 'Tesseract 识别跳过', err);
      }
    }

    // 仅在完全没有提取出文字时返回空数组，绝不吐出 [字幕文本帧] 占位词
    return [];
  }

  /**
   * 对字幕条做对比度增强 / 二值化 / 降噪。
   * 预处理失败时回退原图，保证「质量增强」不会变成「功能中断」。
   */
  private applyPreprocess(source: HTMLCanvasElement): HTMLCanvasElement {
    try {
      const ctx = source.getContext('2d');
      if (!ctx) return source;

      const imageData = ctx.getImageData(0, 0, source.width, source.height);
      const { canvas } = preprocessImage(imageData, FRAME_PREPROCESS_CONFIG);
      return canvas ?? source;
    } catch (error) {
      logger.warn('LocalOCREngine', '帧预处理失败，已回退原图', error);
      return source;
    }
  }

  /**
   * 根据归一化坐标 (0~1) 从源 Canvas 截取字幕区域
   */
  private cropCanvasROI(sourceCanvas: HTMLCanvasElement, roi: NormalizedROI): HTMLCanvasElement {
    const cropCanvas = document.createElement('canvas');
    const ctx = cropCanvas.getContext('2d');

    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;

    const cropX = Math.round(roi.x * srcW);
    const cropY = Math.round(roi.y * srcH);
    const cropW = Math.max(1, Math.round(roi.width * srcW));
    const cropH = Math.max(1, Math.round(roi.height * srcH));

    cropCanvas.width = cropW;
    cropCanvas.height = cropH;

    if (ctx) {
      ctx.drawImage(
        sourceCanvas,
        cropX, cropY, cropW, cropH,
        0, 0, cropW, cropH
      );
    }

    return cropCanvas;
  }

  private async toCanvas(frameData: HTMLCanvasElement | Blob | ImageData): Promise<HTMLCanvasElement> {
    if (frameData instanceof HTMLCanvasElement) return frameData;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建本地 OCR 画布');
    if (frameData instanceof ImageData) {
      canvas.width = frameData.width;
      canvas.height = frameData.height;
      ctx.putImageData(frameData, 0, 0);
      return canvas;
    }
    const bitmap = await createImageBitmap(frameData);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch {
        // Safe disposal
      }
      this.worker = null;
    }
    this.isInitialized = false;
  }
}
