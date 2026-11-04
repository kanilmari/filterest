// solid-png.ts
// Builds a small solid-colour PNG in memory for article image fixtures.
// Shared by specs that upload a real raster image (the upload path refuses SVG).
// Keeps the PNG encoder in one place instead of one copy per spec.
import { deflateSync } from 'node:zlib';

function crc32(data: Buffer) {
  let crc = ~0;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid 8-bit RGB PNG. The upload path refuses SVG (d260: "unsupported file extension: svg"). */
export function solidPng(width: number, height: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header), pngChunk('IDAT', pixels), pngChunk('IEND', Buffer.alloc(0))]);
}
