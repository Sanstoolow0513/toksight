'use client';

// Capture the visible Today or Calendar report, including day details.
// Navigation and actions stay outside this node; inline controls are filtered.

export async function exportReportImage(node, filename) {
  const { domToPng } = await import('modern-screenshot');
  const root = getComputedStyle(document.documentElement);
  const bg = root.getPropertyValue('--bg').trim();
  const dot = root.getPropertyValue('--dot').trim();
  node.classList.add('is-exporting');
  let url;
  try {
    url = await domToPng(node, {
      scale: Math.max(2, window.devicePixelRatio || 1),
      backgroundColor: bg,
      style: {
        backgroundImage: `radial-gradient(circle, ${dot} .8px, transparent 1.1px)`,
        backgroundSize: '28px 28px',
        backgroundPosition: '14px 14px',
      },
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
