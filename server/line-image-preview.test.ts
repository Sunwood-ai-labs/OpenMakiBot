import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { createLineImagePreview, LineImagePreviewError } from "./line-image-preview.ts";

const JPEG_SPLIT_RED_BLUE = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAgAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9UwooooA8Cooor/cY/x0CiiigD32iiiv8OT/AGLCiiigDwKiiiv9xj/HQKKKKAP/2Q==",
  "base64",
);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}

function pngHeader(width: number, height: number, colorType = 2): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  return header;
}

function makeRgbPng(width: number, height: number, fill: (row: Buffer, y: number) => void): Buffer {
  const rowBytes = width * 3;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const start = y * (rowBytes + 1);
    raw[start] = 0;
    fill(raw.subarray(start + 1, start + rowBytes + 1), y);
  }
  const compressed = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", pngHeader(width, height)),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function splitColorPng(width: number, height: number): Buffer {
  return makeRgbPng(width, height, (row) => {
    for (let x = 0; x < width; x += 1) {
      const offset = x * 3;
      if (x < width / 2) {
        row[offset] = 255;
        row[offset + 1] = 0;
        row[offset + 2] = 0;
      } else {
        row[offset] = 0;
        row[offset + 1] = 0;
        row[offset + 2] = 255;
      }
    }
  });
}

function transparentPng(): Buffer {
  const raw = Buffer.from([0, 0, 0, 0, 0]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", pngHeader(1, 1, 6)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function noisyPng(width: number, height: number): Buffer {
  let state = 0x12345678;
  return makeRgbPng(width, height, (row) => {
    for (let index = 0; index < row.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      row[index] = state & 0xff;
    }
  });
}

function pixelAt(bytes: Buffer, x: number, y: number): number[] {
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image href="data:image/png;base64,${bytes.toString("base64")}" width="${width}" height="${height}"/></svg>`;
  const rendered = new Resvg(svg).render();
  const offset = (y * rendered.width + x) * 4;
  return [...rendered.pixels.subarray(offset, offset + 4)];
}

function corruptJpegScan(): Buffer {
  const bytes = Buffer.from(JPEG_SPLIT_RED_BLUE);
  let offset = 2;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) throw new Error("Invalid synthetic JPEG marker stream.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xda) {
      const scanStart = offset + bytes.readUInt16BE(offset);
      bytes.fill(0xff, scanStart, bytes.length - 2);
      return bytes;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    offset += bytes.readUInt16BE(offset);
  }
  throw new Error("Synthetic JPEG scan data was not found.");
}

function jpegWithSofAndEoiOnly(): Buffer {
  const bytes = Buffer.from(JPEG_SPLIT_RED_BLUE);
  let offset = 2;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) throw new Error("Invalid synthetic JPEG marker stream.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    const segmentLength = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return Buffer.concat([bytes.subarray(0, offset + segmentLength), Buffer.from([0xff, 0xd9])]);
    }
    offset += segmentLength;
  }
  throw new Error("Synthetic JPEG frame header was not found.");
}

function jpegWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.from(JPEG_SPLIT_RED_BLUE);
  let offset = 2;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) throw new Error("Invalid synthetic JPEG marker stream.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    const segmentLength = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      bytes.writeUInt16BE(height, offset + 3);
      bytes.writeUInt16BE(width, offset + 5);
      return bytes;
    }
    offset += segmentLength;
  }
  throw new Error("Synthetic JPEG frame header was not found.");
}

function expectError(operation: () => unknown, code: LineImagePreviewError["code"]): void {
  try {
    operation();
    throw new Error(`Expected a ${code} error.`);
  } catch (error) {
    if (!(error instanceof LineImagePreviewError)) throw error;
    expect(error.code).toBe(code);
  }
}

describe("createLineImagePreview", () => {
  it("decodes a synthetic JPEG and preserves its colors and aspect ratio", () => {
    const preview = createLineImagePreview(JPEG_SPLIT_RED_BLUE, "image/jpeg");

    expect(preview).toMatchObject({ mime: "image/png", width: 32, height: 16, sourceWidth: 64, sourceHeight: 32 });
    expect(preview.bytes.byteLength).toBeGreaterThan(0);
    expect(pixelAt(preview.bytes, 4, 8)[0]).toBeGreaterThan(200);
    expect(pixelAt(preview.bytes, 4, 8)[2]).toBeLessThan(80);
    expect(pixelAt(preview.bytes, 28, 8)[2]).toBeGreaterThan(200);
    expect(pixelAt(preview.bytes, 28, 8)[0]).toBeLessThan(80);
  });

  it("resizes a synthetic PNG uniformly and reports the source dimensions", () => {
    const source = splitColorPng(64, 32);
    const preview = createLineImagePreview(source, "image/png");

    expect(preview).toMatchObject({ mime: "image/png", width: 32, height: 16, sourceWidth: 64, sourceHeight: 32 });
    expect(pixelAt(preview.bytes, 4, 8)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(preview.bytes, 28, 8)).toEqual([0, 0, 255, 255]);
  });

  it("keeps a valid fully transparent PNG as a real image preview", () => {
    const preview = createLineImagePreview(transparentPng(), "image/png");

    expect(preview).toMatchObject({ mime: "image/png", width: 1, height: 1, sourceWidth: 1, sourceHeight: 1 });
    expect(preview.bytes.byteLength).toBeGreaterThan(0);
    expect(pixelAt(preview.bytes, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("reduces a high-entropy preview until the PNG is within the 1 MB cap", () => {
    const source = noisyPng(1400, 1400);
    expect(source.byteLength).toBeLessThan(10_000_000);
    const preview = createLineImagePreview(source, "image/png");

    expect(preview.bytes.byteLength).toBeLessThanOrEqual(1_000_000);
    expect(preview.width).toBeLessThan(640);
    expect(preview.height).toBeLessThan(640);
  });

  it("rejects oversized source bytes and unsupported MIME types before decoding", () => {
    expectError(() => createLineImagePreview(Buffer.alloc(10_000_001), "image/jpeg"), "input");
    expectError(() => createLineImagePreview(JPEG_SPLIT_RED_BLUE, "image/webp" as "image/jpeg"), "mime");
  });

  it("rejects malformed, truncated, mismatched, and over-dimension images", () => {
    const validPng = splitColorPng(64, 32);
    const tooWidePng = makeRgbPng(16_385, 1, (row) => row.fill(0));
    const tooManyPixelsPng = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk("IHDR", pngHeader(10_000, 5_000)),
      pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0]))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);

    expectError(() => createLineImagePreview(validPng.subarray(0, validPng.length - 12), "image/png"), "format");
    expectError(() => createLineImagePreview(validPng, "image/jpeg"), "format");
    expectError(() => createLineImagePreview(tooWidePng, "image/png"), "dimensions");
    expectError(() => createLineImagePreview(tooManyPixelsPng, "image/png"), "dimensions");
    expectError(() => createLineImagePreview(jpegWithDimensions(16_385, 32), "image/jpeg"), "dimensions");
    expectError(() => createLineImagePreview(JPEG_SPLIT_RED_BLUE.subarray(0, -2), "image/jpeg"), "format");
  });

  it("fails closed when a structurally sized PNG cannot be decoded", () => {
    const malformedData = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk("IHDR", pngHeader(64, 32)),
      pngChunk("IDAT", Buffer.from([0, 1, 2, 3, 4, 5])),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);

    expectError(() => createLineImagePreview(malformedData, "image/png"), "format");
    expectError(() => createLineImagePreview(jpegWithSofAndEoiOnly(), "image/jpeg"), "format");
    expectError(() => createLineImagePreview(corruptJpegScan(), "image/jpeg"), "format");
  });
});
