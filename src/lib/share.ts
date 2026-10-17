/* Handing a file the page has made to the reader: the share sheet where the browser has one that takes the file, a plain download where it
   has not. Nothing here sends the file anywhere; where it goes from the share sheet (Save Image, a calendar, Messages, a cloud drive) is the
   reader's choice, and a download lands in the device's own storage.

   Moved from src/lib/ar/snap.ts (it was deliverSnap there, which still names it) so that the export's one-pass calendar can hand its file over
   the same way without pulling the AR view's chunk in with it. */

type Maker = { createElement(tag: string): HTMLElement };

/** Hands the file to the reader: the share sheet where `nav` has one that takes files, a download otherwise (pass no `nav` for a download
 *  only). A reader who closes the sheet has cancelled, which is not an error. `host` is the node the download's link is put in for its
 *  click: inside an open dialog everything else on the page is inert. */
export async function deliverFile(
  nav: { share?(d: unknown): Promise<void>; canShare?(d: unknown): boolean } | undefined,     // methods, so that the browser's Navigator is one
  doc: Maker,
  host: { appendChild(n: Node): unknown },
  blob: Blob,
  name: string
): Promise<'shared' | 'saved' | 'cancelled'> {
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && typeof File === 'function') {
    try {
      const file = new File([blob], name, { type: blob.type });
      if (nav.canShare({ files: [file] })) {
        try { await nav.share({ files: [file], title: name }); return 'shared'; }
        catch (e) { if (e && (e as { name?: string }).name === 'AbortError') return 'cancelled'; /* refused: save it instead */ }
      }
    } catch { /* no File, or a browser that throws on the question: save it instead */ }
  }
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a') as HTMLAnchorElement;
  a.href = url; a.download = name; a.rel = 'noopener'; a.hidden = true;
  host.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'saved';
}
