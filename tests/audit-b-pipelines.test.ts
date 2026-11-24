import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(__dirname, "..");
// Il Python dell'ambiente .venv del progetto: Scripts/python.exe su Windows, bin/python altrove.
const python = [".venv/Scripts/python.exe", ".venv/bin/python"].map((p) => resolve(root, p)).find((p) => existsSync(p));

// In un clone nuovo .venv non c'è: il test si salta invece di fallire (vedi il README per creare l'ambiente).
it.skipIf(!python)("NF01 / NF02 / NF06 / D4 — regressioni Python delle pipeline offline (saltato se manca il Python di .venv)", () => {
  const result = execFileSync(python!, ["-m", "unittest", "discover", "-s", "tests", "-p", "audit_b_pipelines.py", "-v"], {
    cwd: root, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" }, timeout: 60000, stdio: "pipe",
  });
  expect(result).toContain("tmy");
}, 65000);
