// Printing an HTML document through a hidden frame: the browser's print dialog -> "Save as PDF" (no PDF library; Polish
// letters and pictures work as they are). The document's <title> is the default file name. Used by the offer and the
// parts' label sheet.

export function printHtml(html) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}
