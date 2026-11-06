// Printing an HTML document through a hidden frame: the browser's print dialog -> "Save as PDF" (no PDF library; Polish
// letters and pictures work as they are). The document's <title> is the default file name. Used by the offer and the
// parts' label sheet.
//
// Before print() it waits for the frame's fonts and pictures (user decision 2026-11-06 — the modern offer's web fonts:
// the first print came out in the fallback face): `document.fonts.ready` and every <img> decoded, each wait capped so a
// missing network (no Google Fonts) only means the fallback fonts, never a print that does not come.

const WAIT_CAP_MS = 4000;
const capped = (promise) => Promise.race([Promise.resolve(promise).catch(() => {}), new Promise((r) => setTimeout(r, WAIT_CAP_MS))]);

export function printHtml(html) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.onload = async () => {
    const doc = frame.contentDocument;
    try {
      if (doc?.fonts?.ready) await capped(doc.fonts.ready);
      await capped(Promise.all([...(doc?.images || [])].map((img) => (img.decode ? img.decode().catch(() => {}) : null))));
    } catch {
      // (print anyway)
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}
