import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import type { Resvg as ResvgClass } from "@resvg/resvg-js";

export type LineImageMime = "image/jpeg" | "image/png";

export type LineImagePreview = Readonly<{
  bytes: Buffer;
  mime: "image/png";
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}>;

export type LineImagePreviewErrorCode = "input" | "mime" | "format" | "dimensions" | "decode" | "output";

export class LineImagePreviewError extends Error {
  readonly code: LineImagePreviewErrorCode;

  constructor(code: LineImagePreviewErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = "LineImagePreviewError";
  }
}

const MAX_SOURCE_BYTES = 10_000_000;
const MAX_SOURCE_EDGE = 16_384;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_DECODED_IMAGE_BYTES = 161_000_000;
const MAX_PREVIEW_EDGE = 640;
const MAX_PREVIEW_BYTES = 1_000_000;
const MAX_RENDER_ATTEMPTS = 24;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const PNG_CHANNELS = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
const PNG_BIT_DEPTHS = new Map([[0, new Set([1, 2, 4, 8, 16])], [2, new Set([8, 16])], [3, new Set([1, 2, 4, 8])], [4, new Set([8, 16])], [6, new Set([8, 16])]]);
const PNG_ADAM7_PASSES = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const requireFromRelay = createRequire(import.meta.url);

type ImageDimensions = Readonly<{ width: number; height: number }>;

let resvgClass: typeof ResvgClass | null = null;

function loadResvg(): typeof ResvgClass {
  resvgClass ??= (requireFromRelay("@resvg/resvg-js") as { Resvg: typeof ResvgClass }).Resvg;
  return resvgClass;
}

function validateDimensions(dimensions: ImageDimensions): void {
  if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_SOURCE_EDGE ||
      dimensions.height > MAX_SOURCE_EDGE || dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) {
    throw new LineImagePreviewError("dimensions", "LINE image dimensions exceed the safe decode limits.");
  }
}

function pngCrc32(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) crc = PNG_CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngScanlineBytes(width: number, height: number, bitsPerPixel: number, interlace: number): number {
  const passes = interlace === 0 ? [[0, 0, 1, 1] as const] : PNG_ADAM7_PASSES;
  let total = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    if (width <= startX || height <= startY) continue;
    const passWidth = Math.ceil((width - startX) / stepX);
    const passHeight = Math.ceil((height - startY) / stepY);
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8);
    total += passHeight * (rowBytes + 1);
    if (!Number.isSafeInteger(total) || total > MAX_DECODED_IMAGE_BYTES) {
      throw new LineImagePreviewError("dimensions", "LINE image decoded data exceeds the safe memory limit.");
    }
  }
  return total;
}

function validPngFilters(raw: Buffer, width: number, height: number, bitsPerPixel: number, interlace: number): boolean {
  const passes = interlace === 0 ? [[0, 0, 1, 1] as const] : PNG_ADAM7_PASSES;
  let offset = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    if (width <= startX || height <= startY) continue;
    const passWidth = Math.ceil((width - startX) / stepX);
    const passHeight = Math.ceil((height - startY) / stepY);
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8);
    for (let row = 0; row < passHeight; row += 1) {
      if (raw[offset]! > 4) return false;
      offset += rowBytes + 1;
    }
  }
  return offset === raw.byteLength;
}

function parsePngDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  let offset = PNG_SIGNATURE.length;
  let header: { width: number; height: number; bitsPerPixel: number; interlace: number } | null = null;
  let sawImageData = false;
  let imageDataEnded = false;
  const imageData: Buffer[] = [];
  let chunkIndex = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return null;
    const dataLength = bytes.readUInt32BE(offset);
    if (dataLength > bytes.length - offset - 12) return null;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    const dataStart = offset + 8;
    const crcOffset = dataStart + dataLength;
    const chunkEnd = crcOffset + 4;
    if (pngCrc32(bytes, offset + 4, crcOffset) !== bytes.readUInt32BE(crcOffset)) return null;

    if (chunkIndex === 0) {
      if (type !== "IHDR" || dataLength !== 13) return null;
      const width = bytes.readUInt32BE(dataStart);
      const height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8]!;
      const colorType = bytes[dataStart + 9]!;
      const compression = bytes[dataStart + 10]!;
      const filter = bytes[dataStart + 11]!;
      const interlace = bytes[dataStart + 12]!;
      const channels = PNG_CHANNELS.get(colorType);
      if (!channels || !PNG_BIT_DEPTHS.get(colorType)?.has(bitDepth) || compression !== 0 || filter !== 0 || interlace > 1) return null;
      const dimensions = { width, height };
      validateDimensions(dimensions);
      const bitsPerPixel = channels * bitDepth;
      pngScanlineBytes(width, height, bitsPerPixel, interlace);
      header = { width, height, bitsPerPixel, interlace };
    } else if (type === "IHDR") {
      return null;
    }

    if (type === "IDAT") {
      if (imageDataEnded) return null;
      if (dataLength > 0) {
        sawImageData = true;
        imageData.push(bytes.subarray(dataStart, crcOffset));
      }
    } else if (sawImageData && type !== "IEND") {
      imageDataEnded = true;
    }
    offset = chunkEnd;
    chunkIndex += 1;

    if (type === "IEND") {
      if (dataLength !== 0 || !sawImageData || offset !== bytes.length || !header) return null;
      const expectedBytes = pngScanlineBytes(header.width, header.height, header.bitsPerPixel, header.interlace);
      let decoded: Buffer;
      try {
        decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedBytes });
      } catch {
        return null;
      }
      if (decoded.byteLength !== expectedBytes || !validPngFilters(decoded, header.width, header.height, header.bitsPerPixel, header.interlace)) return null;
      return { width: header.width, height: header.height };
    }
  }

  return null;
}

function parseJpegDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;

  let dimensions: ImageDimensions | null = null;
  let sawScan = false;
  let offset = 2;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00 || marker === 0xd8) return null;
    if (marker === 0xd9) return dimensions && sawScan && offset === bytes.length ? dimensions : null;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > bytes.length - 2) return null;

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length - 2) return null;
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (dimensions || segmentLength < 8) return null;
      const components = bytes[offset + 7]!;
      if (components < 1 || segmentLength !== 8 + 3 * components) return null;
      dimensions = {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    } else if (marker === 0xda) {
      if (!dimensions || segmentLength < 6 || offset + segmentLength >= bytes.length - 2) return null;
      sawScan = true;
      let scanOffset = offset + segmentLength;
      let hasEntropyData = false;
      let foundFollowingMarker = false;
      while (scanOffset < bytes.length) {
        if (bytes[scanOffset] !== 0xff) {
          hasEntropyData = true;
          scanOffset += 1;
          continue;
        }
        const markerOffset = scanOffset;
        while (bytes[scanOffset] === 0xff) scanOffset += 1;
        const scanMarker = bytes[scanOffset];
        if (scanMarker === undefined) return null;
        if (scanMarker === 0x00) {
          hasEntropyData = true;
          scanOffset += 1;
          continue;
        }
        if (scanMarker >= 0xd0 && scanMarker <= 0xd7) {
          scanOffset += 1;
          continue;
        }
        if (scanMarker === 0xd9) return hasEntropyData && scanOffset === bytes.length - 1 ? dimensions : null;
        if (!hasEntropyData) return null;
        offset = markerOffset;
        foundFollowingMarker = true;
        break;
      }
      if (!foundFollowingMarker) return null;
      continue;
    }
    offset += segmentLength;
  }

  return null;
}

function imageDimensions(bytes: Buffer, mime: LineImageMime): ImageDimensions | null {
  return mime === "image/png" ? parsePngDimensions(bytes) : parseJpegDimensions(bytes);
}

function validateInput(bytes: Uint8Array, mime: LineImageMime): { bytes: Buffer; dimensions: ImageDimensions } {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new LineImagePreviewError("input", "LINE image source is empty or exceeds the 10 MB limit.");
  }
  if (mime !== "image/jpeg" && mime !== "image/png") {
    throw new LineImagePreviewError("mime", "LINE image source must be JPEG or PNG.");
  }

  const source = Buffer.from(bytes);
  const dimensions = imageDimensions(source, mime);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new LineImagePreviewError("format", "LINE image source is malformed or does not match its MIME type.");
  }
  validateDimensions(dimensions);
  return { bytes: source, dimensions };
}

function imageSvg(bytes: Buffer, mime: LineImageMime, dimensions: ImageDimensions): string {
  const data = bytes.toString("base64");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}"><image href="data:${mime};base64,${data}" width="${dimensions.width}" height="${dimensions.height}"/></svg>`;
}

function isAspectScaleWithinPixel(width: number, height: number, dimensions: ImageDimensions, scale: number): boolean {
  return Math.abs(width - dimensions.width * scale) <= 1 && Math.abs(height - dimensions.height * scale) <= 1;
}

/**
 * Creates a bounded PNG preview from a request-owned JPEG or PNG attachment.
 * Input is capped at 10 MB, 40 megapixels, and 16,384 pixels per edge; output
 * is uniformly scaled to at most 640 pixels per edge and 1 MB.
 */
export function createLineImagePreview(bytes: Uint8Array, mime: LineImageMime): LineImagePreview {
  const input = validateInput(bytes, mime);
  const maxInputEdge = Math.max(input.dimensions.width, input.dimensions.height);
  let scale = Math.min(0.5, MAX_PREVIEW_EDGE / maxInputEdge);
  const svg = imageSvg(input.bytes, mime, input.dimensions);

  try {
    const Resvg = loadResvg();
    for (let attempt = 0; attempt < MAX_RENDER_ATTEMPTS; attempt += 1) {
      const renderer = new Resvg(svg, { fitTo: { mode: "zoom", value: scale }, imageRendering: 0, logLevel: "off" });
      if (!/<image\b/.test(renderer.toString()) || renderer.imagesToResolve().length > 0 || !renderer.innerBBox()) {
        throw new LineImagePreviewError("decode", "LINE image source did not produce a decodable image.");
      }
      const rendered = renderer.render();
      const preview = rendered.asPng();
      const renderedDimensions = { width: rendered.width, height: rendered.height };
      const parsedOutput = parsePngDimensions(preview);
      if (rendered.width < 1 || rendered.height < 1 || rendered.width > MAX_PREVIEW_EDGE || rendered.height > MAX_PREVIEW_EDGE ||
          !parsedOutput || parsedOutput.width !== rendered.width || parsedOutput.height !== rendered.height ||
          !isAspectScaleWithinPixel(rendered.width, rendered.height, input.dimensions, scale)) {
        throw new LineImagePreviewError("output", "LINE image preview renderer returned invalid dimensions.");
      }
      if (preview.byteLength <= MAX_PREVIEW_BYTES) {
        return {
          bytes: preview,
          mime: "image/png",
          ...renderedDimensions,
          sourceWidth: input.dimensions.width,
          sourceHeight: input.dimensions.height,
        };
      }
      const nextScale = scale * 0.75;
      if (nextScale === scale) break;
      scale = nextScale;
    }
  } catch (error) {
    if (error instanceof LineImagePreviewError) throw error;
    throw new LineImagePreviewError("decode", "LINE image source could not be decoded into a preview.", { cause: error });
  }

  throw new LineImagePreviewError("output", "LINE image preview could not be reduced below the 1 MB limit.");
}
