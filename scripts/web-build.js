import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNode } from './lib/process.js';

async function main() {
  const web = fileURLToPath(new URL('../web/', import.meta.url));
  const cli = path.join(web, 'node_modules', 'next', 'dist', 'bin', 'next');
  await access(cli).catch(() => {
    throw new Error('Dashboard dependencies missing. Run `npm run web:ci` first (Node >=20.9).');
  });
  const { code, signal } = await startNode([cli, 'build', ...process.argv.slice(2)], { cwd: web }).done;
  if (code !== 0) throw new Error(`Dashboard build failed (${signal || code})`);
  for (const file of ['index.html', '_next/static']) {
    await access(path.join(web, 'out', file)).catch(() => {
      throw new Error(`Static export missing web/out/${file}. Check web/next.config.mjs.`);
    });
  }
  console.log('Dashboard built: web/out/\nPreview: node bin/toksight.js web');
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
