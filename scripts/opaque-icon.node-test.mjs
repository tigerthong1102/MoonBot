import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, inflateSync } from 'node:zlib';
import { opaqueIcon } from './opaque-icon.mjs';

test('opaque App Store PNG preserves every RGB sample without an alpha channel', () => {
  const rgba = Buffer.from([255, 7, 91, 255, 2, 199, 80, 255, 17, 90, 254, 255, 0, 255, 3, 255]);
  const png = opaqueIcon(2, 2, rgba);
  assert.equal(png[25], 2);
  const parts = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    assert.equal(png.readUInt32BE(offset + 8 + length), crc32(png.subarray(offset + 4, offset + 8 + length)));
    assert(['IHDR', 'IDAT', 'IEND'].includes(type));
    if (type === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(parts));
  const rgb = [];
  for (let row = 0; row < 2; row += 1) {
    assert.equal(filtered[row * 7], 1);
    const pixels = [];
    for (let index = 0; index < 6; index += 1) pixels.push((filtered[row * 7 + index + 1] + (index >= 3 ? pixels[index - 3] : 0)) & 255);
    rgb.push(...pixels);
  }
  assert.deepEqual(rgb, [...rgba].filter((_, index) => index % 4 !== 3));
});

test('refuses to discard visible transparency or malformed pixel input', () => {
  assert.throws(() => opaqueIcon(1, 1, Buffer.from([1, 2, 3, 254])));
  assert.throws(() => opaqueIcon(2, 1, Buffer.alloc(4)));
  assert.throws(() => opaqueIcon(0, 1, Buffer.alloc(0)));
});
