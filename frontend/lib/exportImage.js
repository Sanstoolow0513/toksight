'use client';

// Capture the visible Today or Calendar report, including day details.
// Navigation and actions stay outside this node; inline controls are filtered.
// `.is-exporting` paints an opaque page background under the panels.
// A scroller marked `data-export-clip="<selector>"` exports only the children
// matching the selector that are at least partly in view; `.is-exporting`
// then lets the scroller grow to show exactly those.

export async function exportReportImage(node, filename) {
  const { domToPng } = await import('modern-screenshot');
  const root = getComputedStyle(document.documentElement);
  const bg = root.getPropertyValue('--bg').trim();
  const hidden = [];
  for (const scroller of node.querySelectorAll('[data-export-clip]')) {
    const box = scroller.getBoundingClientRect();
    for (const child of scroller.querySelectorAll(scroller.dataset.exportClip)) {
      const r = child.getBoundingClientRect();
      if (r.bottom <= box.top || r.top >= box.bottom) { child.classList.add('no-export'); hidden.push(child); }
    }
  }
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
    for (const child of hidden) child.classList.remove('no-export');
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
