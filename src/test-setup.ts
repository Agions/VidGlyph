/**
 * ImageData polyfill for Node test environment.
 * Handles both browser-style (data, width, height) and (width, height) signatures.
 */
class ImageDataPolyfill {
  data: Uint8ClampedArray
  width: number
  height: number
  colorSpace: PredefinedColorSpace

  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    maybeHeight?: number,
    maybeSettings?: ImageDataSettings,
  ) {
    // Detect browser-style "new ImageData(width, height)" call
    if (typeof dataOrWidth === 'number' && typeof widthOrHeight === 'number') {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
      this.colorSpace = (maybeSettings as ImageDataSettings)?.colorSpace ?? 'srgb'
      return
    }

    // Standard browser signature: new ImageData(data, width, height?)
    this.width = widthOrHeight as number
    const data = dataOrWidth as Uint8ClampedArray | number[]
    if (typeof maybeHeight === 'number') {
      this.height = maybeHeight
    } else {
      const arr = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data as number[])
      this.height = Math.floor(arr.length / (this.width * 4))
    }
    this.data = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data as number[])
    this.colorSpace = (maybeSettings as ImageDataSettings)?.colorSpace ?? 'srgb'
  }
}

Object.defineProperty(globalThis, 'ImageData', {
  configurable: true,
  value: ImageDataPolyfill as unknown as typeof ImageData,
})
