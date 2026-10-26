'use client';

// Capture the visible Today or Calendar report, including day details.
// Navigation and actions stay outside this node; inline controls are filtered.
// `.is-exporting` paints an opaque page background under the panels.

export async function exportReportImage(node, filename) {
  const { domToPng } = await import('modern-screenshot');
  const root = getComputedStyle(document.documentElement);
  const bg = root.getPropertyValue('--bg').trim();
  node.classList.add('is-exporting');
  let url;
  try {
    url = await domToPng(node, {
      scale: Math.max(2, window.devicePixelRatio || 1),
      backgroundColor: bg,
      filter: (el) => !(el instanceof Element && el.classList.contains('no-export')),
    });
  } finally {
    node.classList.remove('is-exporting');
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
