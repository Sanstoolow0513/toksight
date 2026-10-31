// Refresh the checked-in native design assets from the locked Web dependencies.
// Desktop builds consume the checked-in files and never need npm web dependencies.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'desktop/Toksight.Desktop/Assets');
const fonts = path.join(root, 'frontend/node_modules/geist');
const lucide = path.join(root, 'frontend/node_modules/lucide-react');
await mkdir(path.join(destination, 'Fonts'), { recursive: true });
await mkdir(path.join(destination, 'Icons'), { recursive: true });
await copyFile(path.join(fonts, 'dist/fonts/geist-sans/Geist-Variable.ttf'), path.join(destination, 'Fonts/Geist-Variable.ttf'));
await copyFile(path.join(fonts, 'dist/fonts/geist-mono/GeistMono-Variable.ttf'), path.join(destination, 'Fonts/GeistMono-Variable.ttf'));
await copyFile(path.join(fonts, 'LICENSE.txt'), path.join(destination, 'Fonts/LICENSE.txt'));
await copyFile(path.join(lucide, 'LICENSE'), path.join(destination, 'Icons/LICENSE.txt'));
const names = ['Activity', 'Layers3', 'ChartColumn', 'Coins', 'Clock', 'Calendar', 'ChevronDown', 'ChevronRight', 'ChevronLeft',
  'ArrowUpRight', 'ArrowDownRight', 'ArrowDown', 'ArrowUp', 'Database', 'Shield', 'ShieldCheck', 'RefreshCw', 'ImageDown', 'Sun', 'Moon', 'Monitor',
  'Languages', 'Settings2', 'Search', 'Globe2', 'Upload', 'Download', 'ExternalLink', 'ZoomIn', 'ZoomOut', 'Zap', 'MessagesSquare',
  'ChartPie', 'Info', 'PanelLeftClose', 'PanelLeftOpen', 'RotateCcw', 'X', 'Check', 'Plus', 'Minus'];
async function iconData(file) {
  const module = await import(pathToFileURL(file));
  if (module.__iconData) return module.__iconData.node;
  const source = await readFile(file, 'utf8');
  const target = source.match(/export \{ default \} from ['"](.+?)['"]/);
  if (!target) throw new Error(`Unsupported Lucide icon module: ${file}`);
  return iconData(path.resolve(path.dirname(file), target[1]));
}
const icons = {};
for (const name of names) {
  const filename = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-z])([0-9])/g, '$1-$2').toLowerCase();
  icons[name] = (await iconData(path.join(lucide, `dist/esm/icons/${filename}.mjs`))).map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'key'))]);
}
Object.assign(icons, { Refresh: icons.RefreshCw, Settings: icons.Settings2, Globe: icons.Globe2 });
await writeFile(path.join(destination, 'Icons/lucide.json'), JSON.stringify(icons, null, 2) + '\n');
console.log(`Native design assets refreshed: Geist fonts and ${Object.keys(icons).length} Lucide vectors.`);
