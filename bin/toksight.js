#!/usr/bin/env node
import zlib from 'node:zlib';

if (typeof zlib.createZstdDecompress !== 'function') {
  console.error('toksight requires Node.js 22.15+ (22.x) or 23.8+ for Zstandard support. Please upgrade Node.js.');
  process.exitCode = 1;
} else {
  try {
    const { main } = await import('../src/cli.js');
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(err?.stack || err);
    process.exitCode = 1;
  }
}
