/**
 * «Porta nella CER»: il profilo energetico della casa va al simulatore della comunità energetica nel frammento
 * dell'indirizzo, `https://cer.raccasamuele.it/#profilo-casa=z.<dati>` (JSON compresso con deflate-raw, in base64url),
 * oppure `j.<dati>` non compresso nei browser senza CompressionStream. Il frammento non arriva mai al server.
 * Specifica e lettura dall'altra parte: docs/formato_profilo_energetico.md e web/src/ponte.ts nel simulatore CER.
 */
export const INDIRIZZO_CER = "https://cer.raccasamuele.it/";
export const CHIAVE_PONTE = "profilo-casa";

function base64url(byte: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < byte.length; i += 0x8000) binario += String.fromCharCode(...byte.subarray(i, i + 0x8000));
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function comprimi(byte: Uint8Array): Promise<Uint8Array> {
  const flusso = new Blob([byte]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flusso).arrayBuffer());
}

/** L'indirizzo del simulatore CER con il profilo della casa già dentro. */
export async function indirizzoPerLaCer(profilo: unknown, base = INDIRIZZO_CER): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(profilo));
  const compresso = typeof CompressionStream === "function";
  const dati = compresso ? await comprimi(json) : json;
  return `${base}#${CHIAVE_PONTE}=${compresso ? "z" : "j"}.${base64url(dati)}`;
}
