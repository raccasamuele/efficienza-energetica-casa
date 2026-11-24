import { linesFromItems, type PdfTextItem } from "../engine/bolletta";

const MAX_PAGES = 30;

/**
 * Il testo di un PDF, letto nel browser con pdf.js: libreria e worker sono file del sito, caricati solo quando
 * si sceglie una bolletta. Nessun servizio esterno: niente caratteri o mappe scaricati da fuori, niente script.
 */
export async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const task = pdfjs.getDocument({ data, enableXfa: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false });
  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PAGES) throw new Error(`Il PDF ha ${doc.numPages} pagine: non sembra una bolletta.`);
    const items: PdfTextItem[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      for (const it of content.items) if ("str" in it) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], page: n });
    }
    return linesFromItems(items);
  } finally {
    await task.destroy();
  }
}
