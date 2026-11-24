// Acquisisce fonti versionate senza modificare data/raw o sovrascrivere copie diverse.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../../data/sources/", import.meta.url);
const revision = "125c2ef6c3fc38043368daac1352557fd2a90106";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
async function acquire(path, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (path.endsWith(".pdf") && body.subarray(0, 5).toString() !== "%PDF-") throw new Error(`PDF non valido: ${url}`);
  const target = new URL(path, root);
  await mkdir(new URL(".", target), { recursive: true });
  let old;
  try { old = await readFile(target); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (old && !old.equals(body)) throw new Error(`Fonte diversa già presente: ${fileURLToPath(target)}. Conservare una nuova versione.`);
  if (!old) await writeFile(target, body);
  return { path, url, acquiredAt: new Date().toISOString(), sha256: sha256(body), bytes: body.length };
}

const hplib = [];
for (const path of ["LICENSE", "README.md", "hplib/hplib.py", "hplib/hplib_database.csv", "hplib/hplib_database.py", "output/relative_error.csv",
  ...["_Acond_a.s.Acond_PRO-N", "_Acond_a.s.Acond_PRO-R", "_Bosch_Thermotechnik_GmbH_Bosch_Compress_CS3400iAWS_10,12,14_OR-T", "_KRONOTERM_d.o.o.ADAPT_0724", "_KRONOTERM_d.o.o.VERSI_0209", "_ait-deutschland_GmbHHybrox_8"].map((p) => `input/csv/${p}.csv`)]) {
  const name = path === "LICENSE" ? "LICENSE-hplib" : path === "README.md" ? "README-hplib.md" : path.split("/").pop();
  hplib.push(await acquire(`keymark/${name}`, `https://raw.githubusercontent.com/FZJ-IEK3-VSA/hplib/${revision}/${encodeURI(path)}`));
}
await writeFile(new URL("keymark/hplib-source.json", root), JSON.stringify({ revision, files: hplib }, null, 2));
const istat = [];
for (const [path, url] of [
  ["istat-2026-02-21.xlsx", "https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.xlsx"],
  ["istat-novita-2026.pdf", "https://www.istat.it/wp-content/uploads/2026/02/Novita-2026-2017-26febbraio2026.pdf"],
]) istat.push(await acquire(path, url));
await writeFile(new URL("istat-source.json", root), JSON.stringify({ date: "2026-02-21", boundariesDate: "2025-01-01", files: istat }, null, 2));

const certificates = [];
let previousCertificates = [];
try { previousCertificates = JSON.parse(await readFile(new URL("keymark/certificates-source.json", root), "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
for (const [name, subtype, hash] of [
  ["acond-n", 2951, "426ff6625b20dbbbf60dcb1fd6a432e5"],
  ["acond-r", 5667, "26eaf8bf61ef5ae837e562db57c7e92e"],
  ["versi", 2833, "7a2ede4eb514b04f7ccd8d5639a891ad"],
  ["hybrox", 4195, "acc8d0512678bf0a53fee2e2bb0eb153"],
  ["bosch", 2923, "838e0762d3468c10bb1e66ea44e96fd1"],
  ["adapt", 2832, "2fa94ff7c44a2cdf01434f3c4d3c987b"],
]) {
  const page = `https://www.heatpumpkeymark.com/en/nc/ps-keymark/certificate-holders/?cHash=${hash}&tx_pskeymark_frontend%5Baction%5D=showSubtype&tx_pskeymark_frontend%5Bcontroller%5D=Frontend&tx_pskeymark_frontend%5Bsubtype%5D=${subtype}`;
  try {
    const previous = previousCertificates.find((e) => e.name === name && e.sha256);
    if (previous && sha256(await readFile(new URL(previous.path, root))) === previous.sha256) { certificates.push(previous); continue; }
    const sourcePage = ["versi", "adapt"].includes(name) ? page.replace("/en/nc/ps-keymark/certificate-holders/", "/en/") + "&type=109126" : page;
    const response = await fetch(sourcePage, { signal: AbortSignal.timeout(30000) });
    const html = await response.text();
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
    const link = links.find((l) => /action(?:%5D|\])=generatePdf/i.test(l)) ?? links.find((l) => /action(?:%5D|\])=downloadPdf/i.test(l));
    if (!link) throw new Error("Link al report non trovato");
    const url = new URL(link, sourcePage).href;
    certificates.push({ name, subtype, page: sourcePage, ...await acquire(`keymark/${name}-2026-10-28.pdf`, url) });
    console.log("certificato", name);
  } catch (e) {
    certificates.push({ name, subtype, page, error: e.message });
    console.log("certificato non acquisito", name, e.message);
  }
}
await writeFile(new URL("keymark/certificates-source.json", root), JSON.stringify(certificates, null, 2));
console.log("Fonti ISTAT e hplib acquisite; certificati:", certificates.filter((e) => e.sha256).length);
