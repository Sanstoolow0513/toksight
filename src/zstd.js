// Node 22.15's native decoder can finish successfully halfway through a
// frame, or consume only the first of two frames in one write. Track framing
// (RFC 8878 section 3.1) and give the decoder at most one frame per chunk.
export async function* zstdFrameChunks(source) {
  let nextHeader = 'frame';
  let checksumBytes = 0;
  let offset = 0;
  let carry = Buffer.alloc(0);
  let sawFrame = false;
  for await (const chunk of source) {
    const bytes = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    while (offset < bytes.length) {
      const remaining = bytes.length - offset;
      if (nextHeader === 'frame') {
        if (offset > start) yield bytes.subarray(start, offset);
        start = offset;
        if (remaining < 5) break;
        const magic = bytes.readUInt32LE(offset);
        if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
          if (remaining < 8) break;
          offset += 8 + bytes.readUInt32LE(offset + 4);
        } else {
          if (magic !== 0xfd2fb528) throw new Error('invalid Zstandard frame header');
          const descriptor = bytes[offset + 4];
          const singleSegment = Boolean(descriptor & 0x20);
          const windowBytes = singleSegment ? 0 : 1;
          const sizeBytes = [singleSegment ? 1 : 0, 2, 4, 8][descriptor >>> 6];
          const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
          checksumBytes = descriptor & 4 ? 4 : 0;
          offset += 5 + windowBytes + dictionaryBytes + sizeBytes;
          nextHeader = 'block';
        }
        sawFrame = true;
      } else {
        if (remaining < 3) break;
        const block = bytes.readUIntLE(offset, 3);
        const type = (block >>> 1) & 3;
        if (type === 3) throw new Error('invalid Zstandard block type');
        const bodyBytes = type === 1 ? 1 : block >>> 3;
        offset += 3 + bodyBytes;
        if (block & 1) {
          offset += checksumBytes;
          nextHeader = 'frame';
        }
      }
    }
    // Keep only a split header (at most seven bytes). An offset beyond the
    // chunk skips the remainder of an already-sized block in future chunks.
    const end = Math.min(offset, bytes.length);
    if (end > start) yield bytes.subarray(start, end);
    carry = bytes.subarray(offset);
    offset = Math.max(0, offset - bytes.length);
  }
  if (!sawFrame || carry.length || offset || nextHeader !== 'frame') {
    throw new Error('incomplete Zstandard frame');
  }
}
