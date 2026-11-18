import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}

export function opaqueIcon(width, height, rgba) {
  assert(Number.isInteger(width) && width > 0 && width <= 4096 && Number.isInteger(height) && height > 0 && height <= 4096);
  assert.equal(rgba.length, width * height * 4);
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    rows[row] = 1;
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      assert.equal(rgba[pixel + 3], 255, 'App Store icon must already be fully opaque');
      for (let channel = 0; channel < 3; channel += 1) {
        rows[row + x * 3 + channel + 1] = (rgba[pixel + channel] - (x ? rgba[pixel + channel - 4] : 0)) & 255;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
