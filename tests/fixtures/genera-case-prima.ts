import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, exampleProject, type Goal, type ProjectInput } from "../../src/engine";
import { goalChange, switchGoal } from "../../src/ui/casa";
import { goalPackages } from "../../src/ui/goals";
import { startProject } from "../../src/ui/journey";
import { loadMilano } from "../helpers";

const target = resolve(__dirname, "case-prima.json");
if (existsSync(target)) throw new Error("La fixture originale esiste già: non sovrascriverla.");
const climate = loadMilano();
const cases: { name: string; input: ProjectInput; questions: Goal[] }[] = [];
cases.push({ name: "esempio-pdc", input: exampleProject(), questions: ["fv", "pdc", "completo"] });
const pv = exampleProject();
pv.existingPv.present = true;
pv.goal = "batteria";
cases.push({ name: "esempio-fv-esistente", input: pv, questions: ["pdc", "completo"] });
const auto = startProject("rapida", true, "auto");
cases.push({ name: "esempio-auto", input: auto, questions: ["fv", "pdc", "completo"] });

const output = cases.map(({ name, input }, index) => ({
  name,
  questions: cases[index]!.questions.flatMap((goal) => {
    if (goalChange(input, goal).kind !== "ok") return [];
    const project = switchGoal(input, goal, input.mode);
    const evaluation = evaluate(project, climate);
    const ids = (goalPackages(project) ?? evaluation.packages.map((r) => r.id)).filter((id) => id !== "base");
    return [{
      goal,
      ok: evaluation.ok,
      packages: evaluation.packages.filter((r) => r.id === "base" || ids.includes(r.id)).map((r) => ({
        id: r.id,
        annualCost: r.costs.total,
        investment: r.investment,
        npv: r.cash?.npv ?? null,
        payback: r.cash?.simpleFlows ? r.cash.simplePayback : r.cash?.discountedPayback ?? null,
      })),
    }];
  }),
}));
const data = JSON.stringify(output, null, 2) + "\n";
writeFileSync(target, data, { encoding: "utf8", flag: "wx" });
console.log(`Fixture: ${target}`);
console.log(`Bytes: ${Buffer.byteLength(data, "utf8")}`);
console.log(`SHA-256: ${createHash("sha256").update(data).digest("hex")}`);
