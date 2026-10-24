// @vitest-environment node
// visual_image_structure.test.mjs
// Proves the fixture corruption independently of browser decoding tolerance.
// Connects G15's former valid PNG bytes and malformed containers with structural diagnoses.
// Keeps all synthetic images in memory and creates no persistent test media.
import { deflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { validateImageBytes } from './visual_image_structure.mjs';

// A valid 32 x 32 PNG with a 161-byte IDAT (G15's fixture until 562), kept here so G15 changes cannot move it.
const valid = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAoUlEQVR4nO3RvQmAMBCG4cxm4RIOYmUjuIVDuYKVY6gQCOa83E+8swp81UHep0hYt8N1oQG/Aec+x7kAqf42DABQB0YD7P+gHyfaAHcdcNfj5E8UQKqrDCkA6nJDBKB1ocEDRF1iMABbZw0KENZpowio6oSBAxX1koEA1XXUgMDHely3DGnBqv6M4oBhFAFsoxAwj2aAR7QIWEUzwCPaANUuQRtBWxLcjQcAAAAASUVORK5CYII=', 'base64');
const corrupt = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAoUlEQVR4nO3RvQmAMBCG4cxm4RIOYmUjuIVDuYKVY6gQCOa83E+8swp81UHep0hYt8N1oQG/Aec+x7kAqf42DABQB0YD7P+gHyfaAHcdcNfj5E8UQKqrDCkA6nJDBQBUBQBQBQBQBQBQBQBQBQBQBQBQBQBQBQBQ/ScAqgrW7AM/KKEoMHHcWAAAAABJRU5ErkJggg==', 'base64');

function chunk(type, body) {
  const bytes = Buffer.concat([Buffer.from(type), body]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(body.length + 12);
  result.writeUInt32BE(body.length); bytes.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function replaceIdat(body) {
  return Buffer.concat([valid.subarray(0, 33), chunk('IDAT', body), chunk('IEND', Buffer.alloc(0))]);
}

describe('bounded image container validation', () => {
  test('the former G15 PNG has a 161-byte IDAT and validates', () => {
    expect(valid.readUInt32BE(33)).toBe(161);
    expect(validateImageBytes(valid, 'image/png')).toEqual({ ok: true, format: 'png', problem: null });
  });
  test('the WO88 partly decoded fixture names its broken chunk or stream', () => {
    expect(validateImageBytes(corrupt, 'image/png')).toMatchObject({ ok: false, format: 'png', problem: expect.stringMatching(/chunk|stream/) });
  });
  test('checks every CRC', () => {
    const broken = Buffer.from(valid); broken[30] ^= 1;
    expect(validateImageBytes(broken, 'image/png').problem).toContain('IHDR chunk CRC');
  });
  test('rejects incomplete zlib even with correct chunk CRC', () => {
    expect(validateImageBytes(replaceIdat(valid.subarray(41, 80)), 'image/png').problem).toContain('IDAT zlib stream');
  });
  test('rejects a complete but short inflated stream', () => {
    expect(validateImageBytes(replaceIdat(deflateSync(Buffer.alloc(20))), 'image/png').problem).toContain('inflated stream size');
  });
  test('rejects bytes after IEND', () => {
    expect(validateImageBytes(Buffer.concat([valid, Buffer.from([0])]), 'image/png').problem).toContain('IEND');
  });
  test('requires JPEG SOI, SOS and EOI', () => {
    expect(validateImageBytes(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 1]), 'image/jpeg').ok).toBe(false);
    expect(validateImageBytes(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0xff, 0xd9]), 'image/jpeg').ok).toBe(true);
  });
  test('checks GIF header and trailer', () => {
    expect(validateImageBytes(Buffer.from('GIF89a;'), 'image/gif').ok).toBe(true);
    expect(validateImageBytes(Buffer.from('GIF89a'), 'image/gif').problem).toContain('trailer');
  });
  test('checks WebP RIFF size and supported chunks', () => {
    const bytes = Buffer.alloc(20); bytes.write('RIFF'); bytes.writeUInt32LE(12, 4); bytes.write('WEBPVP8 ', 8);
    expect(validateImageBytes(bytes, 'image/webp').ok).toBe(true);
    bytes.writeUInt32LE(13, 4);
    expect(validateImageBytes(bytes, 'image/webp').ok).toBe(false);
  });
});
