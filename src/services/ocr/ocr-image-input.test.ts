import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudOCREngine } from './CloudOCREngine';
import { LocalOCREngine } from './LocalOCREngine';

const workerMocks = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => workerMocks),
}));

class CanvasContextMock {
  drawImage = vi.fn();
  putImageData = vi.fn();
}

class CanvasMock {
  width = 0;
  height = 0;
  readonly context = new CanvasContextMock();

  getContext() {
    return this.context;
  }

  toDataURL() {
    return 'data:image/jpeg;base64,YmxvYi1pbWFnZQ==';
  }
}

describe('OCR image input conversion', () => {
  const bitmap = {
    width: 640,
    height: 360,
    close: vi.fn(),
  };
  const canvases: CanvasMock[] = [];

  beforeEach(() => {
    canvases.length = 0;
    bitmap.close.mockClear();
    workerMocks.recognize.mockReset();
    workerMocks.terminate.mockReset();

    vi.stubGlobal('HTMLCanvasElement', CanvasMock);
    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
        const canvas = new CanvasMock();
        canvases.push(canvas);
        return canvas;
      }),
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('converts Blob input to a correctly sized canvas for local OCR', async () => {
    workerMocks.recognize.mockResolvedValue({
      data: { text: 'Blob subtitle', confidence: 91 },
    });
    const engine = new LocalOCREngine();

    const result = await engine.recognizeFrame(new Blob(['frame']));

    expect(result[0]?.text).toBe('Blob subtitle');
    expect(canvases[0]).toMatchObject({ width: 640, height: 360 });
    expect(canvases[0]?.context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(workerMocks.recognize).toHaveBeenCalledWith(canvases[0]);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('converts Blob input to JPEG base64 for cloud OCR', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Cloud subtitle' }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const engine = new CloudOCREngine();
    await engine.initialize({ mode: 'cloud', language: 'chi_sim+eng', apiKey: 'test-key' });

    const result = await engine.recognizeFrame(new Blob(['frame']));

    expect(result[0]?.text).toBe('Cloud subtitle');
    expect(canvases[0]).toMatchObject({ width: 640, height: 360 });
    expect(canvases[0]?.context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(bitmap.close).toHaveBeenCalledOnce();

    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body)) as {
      contents: Array<{ parts: Array<{ inline_data?: { data: string } }> }>;
    };
    expect(body.contents[0]?.parts[1]?.inline_data?.data).toBe('YmxvYi1pbWFnZQ==');
  });
});
