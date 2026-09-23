'use client';

// Renders the report column (hero + cards in their current order + footer)
// to a PNG. Controls marked `.no-export` are dropped from the clone; the dot
// grid is painted onto the clone's root because the page background lives on
// <body>, outside the captured node.

export async function exportReportImage(node, filename) {
  const { domToPng } = await import('modern-screenshot');
  const root = getComputedStyle(document.documentElement);
  const bg = root.getPropertyValue('--bg').trim();
  const dot = root.getPropertyValue('--dot').trim();
  const url = await domToPng(node, {
    scale: Math.max(2, window.devicePixelRatio || 1),
    backgroundColor: bg,
    style: {
      backgroundImage: `radial-gradient(circle, ${dot} 1.1px, transparent 1.6px)`,
      backgroundSize: '28px 28px',
      backgroundPosition: '14px 14px',
    },
    filter: (el) => !(el instanceof Element && el.classList.contains('no-export')),
  });
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
