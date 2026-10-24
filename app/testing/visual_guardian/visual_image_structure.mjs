// visual_image_structure.mjs
// Validates image containers independently of a browser's permissive decoder.
// Connects captured image responses to deterministic image-load observations.
// Uses only Node zlib; bytes are inspected in memory and never included in reports.
import { inflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'PNG signature';
  let offset = 8;
  let header;
  let ended = false;
  const data = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) return 'PNG truncated chunk header';
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return 'PNG invalid chunk type';
    if (offset + 12 + length > buffer.length) return `PNG ${type} chunk length out of bounds`;
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== buffer.readUInt32BE(offset + 8 + length)) {
      return `PNG ${type} chunk CRC mismatch`;
    }
    if (!header && type !== 'IHDR') return 'PNG IHDR must be first';
    if (type === 'IHDR') {
      if (header || length !== 13) return 'PNG invalid IHDR chunk';
      header = buffer.subarray(offset + 8, offset + 8 + length);
    }
    if (type === 'IDAT') data.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') {
      if (length || offset !== buffer.length) return 'PNG IEND must be last';
      ended = true;
    }
  }
  if (!header) return 'PNG missing IHDR';
  if (!data.length) return 'PNG missing IDAT';
  if (!ended) return 'PNG missing IEND';
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  const depth = header[8], colour = header[9], interlace = header[12];
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!width || !height || !depths[colour]?.includes(depth) || header[10] || header[11] || interlace > 1) {
    return 'PNG invalid IHDR dimensions or encoding';
  }
  const rowBytes = Math.ceil(width * channels * depth / 8);
  const expected = height * (1 + rowBytes);
  // Bound hostile decompression even for interlaced inputs; oversize means unknown/invalid, never an allocation storm.
  if (!Number.isSafeInteger(expected) || expected > 64 * 1024 * 1024) return 'PNG IDAT inflated size exceeds 64 MB limit';
  try {
    const compressed = Buffer.concat(data);
    const result = inflateSync(compressed, { info: true, maxOutputLength: 64 * 1024 * 1024 });
    if (result.engine.bytesWritten !== compressed.length) return 'PNG IDAT zlib stream has trailing bytes';
    if (!interlace && result.buffer.length !== expected) return 'PNG IDAT inflated stream size mismatch';
  } catch {
    return 'PNG IDAT zlib stream incomplete or invalid';
  }
  return null;
}

/** Inspect a supported image container; return a short structural diagnosis without exporting bytes. */
export function validateImageBytes(buffer, contentType = '') {
  const type = contentType.toLowerCase().split(';')[0].trim();
  let format = ({ 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp' })[type];
  format ||= buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png'
    : buffer[0] === 0xff && buffer[1] === 0xd8 ? 'jpeg'
      : buffer.toString('ascii', 0, 3) === 'GIF' ? 'gif'
        : buffer.toString('ascii', 0, 4) === 'RIFF' ? 'webp' : 'unknown';
  let problem = null;
  if (format === 'png') problem = png(buffer);
  else if (format === 'jpeg') {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) problem = 'JPEG missing SOI';
    else if (buffer.indexOf(Buffer.from([0xff, 0xda]), 2) < 0) problem = 'JPEG missing SOS';
    else if (buffer.length < 4 || buffer.readUInt16BE(buffer.length - 2) !== 0xffd9) problem = 'JPEG missing EOI';
  } else if (format === 'gif') {
    if (!['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) problem = 'GIF invalid header';
    else if (buffer.at(-1) !== 0x3b) problem = 'GIF missing trailer';
  } else if (format === 'webp') {
    if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF'
      || buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) {
      problem = 'WebP RIFF size or signature mismatch';
    } else {
      let offset = 12, found = false;
      while (offset < buffer.length) {
        if (offset + 8 > buffer.length) { problem = 'WebP truncated chunk'; break; }
        const size = buffer.readUInt32LE(offset + 4);
        if (offset + 8 + size + (size % 2) > buffer.length) { problem = 'WebP chunk out of bounds'; break; }
        found ||= ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', offset, offset + 4));
        offset += 8 + size + (size % 2);
      }
      if (!problem && !found) problem = 'WebP missing VP8/VP8L/VP8X chunk';
    }
  } else problem = 'Unsupported image format (not structurally checked)';
  return { ok: problem === null, format, problem };
}
