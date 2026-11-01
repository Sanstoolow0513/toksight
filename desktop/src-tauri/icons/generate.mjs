// Deterministic rasterization of frontend/app/icon.svg's existing 3×3 mark.
// No third-party assets or image libraries are needed for application icons.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const opacities = [.55, .7, 1, .7, 1, .85, .35, .85, 1];
  function rounded(x, y, left, top, width, radius) {
    if (x < left || y < top || x >= left + width || y >= top + width) return false;
    const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
    const dy = Math.max(top + radius - y, 0, y - (top + width - radius));
    return dx * dx + dy * dy <= radius * radius;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) * 32 / size, py = (y + .5) * 32 / size;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const color = [255, 105, 0];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      if (rounded(px, py, 7 + 6.5 * col, 7 + 6.5 * row, 5, 1)) {
        const alpha = opacities[row * 3 + col];
        for (let channel = 0; channel < 3; channel++) color[channel] = Math.round(color[channel] * (1 - alpha) + 255 * alpha);
      }
    }
    raw.set([...color, rounded(px, py, 0, 0, 32, 8) ? 255 : 0], offset);
  }
  function chunk(name, data) {
    const content = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const value of content) { crc ^= value; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
    prefix.writeUInt32BE(data.length); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([prefix, content, suffix]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [32, 128]) writeFileSync(new URL(`${size}x${size}.png`, import.meta.url), png(size));
const bitmap = png(256), directory = Buffer.alloc(22);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(1, 4);
directory.writeUInt16LE(1, 10); directory.writeUInt16LE(32, 12);
directory.writeUInt32LE(bitmap.length, 14); directory.writeUInt32LE(22, 18);
writeFileSync(new URL('icon.ico', import.meta.url), Buffer.concat([directory, bitmap]));
