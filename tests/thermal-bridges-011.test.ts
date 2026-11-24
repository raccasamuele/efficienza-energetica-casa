import { describe, expect, it } from "vitest";
import { bridgeLength, bridgePsi, bridgeTable, defaultThermalBridges, estimatedJunctionLengths, linearBridgeH, THERMAL_JUNCTIONS } from "../src/engine/thermalBridges";
import { exampleProject } from "../src/engine/example";
import { envelopeBreakdown, envelopeUpgrade } from "../src/engine/involucro";
import { simulateThermal } from "../src/engine/thermal";
import { evaluate } from "../src/engine/scenarios";
import { loadMilano } from "./helpers";

describe("ponti termici lineari 0.11.0", () => {
  it("usa la tabella per zona e posizione dell'isolante", () => {
    const p=exampleProject();
    expect(bridgePsi(p.building,p.location,"pilastro")).toBe(.85);
    expect(bridgePsi(p.building,{...p.location,zone:"F"},"pilastro")).toBe(.85);
    p.building.thermalBridges.wallInsulation="esterno";
    expect(bridgePsi(p.building,{...p.location,zone:"F"},"pilastro")).toBe(.02);
  });
  it("stima le lunghezze della geometria d'esempio e usa inserimenti manuali",()=>{
    const p=exampleProject(),g=estimatedJunctionLengths(p.building);
    expect(g.pilastro).toBeGreaterThan(0); expect(g.balcone).toBe(0);
    p.building.thermalBridges.junctions.pilastro.length={value:12,status:"misurato"};
    expect(bridgeLength(p.building,"pilastro")).toBe(12);
    expect(THERMAL_JUNCTIONS).toHaveLength(9);
  });
  it("somma ψ·L e limita a zero una somma negativa",()=>{
    const p=exampleProject(); p.building.thermalBridges.mode="lineari";
    for(const j of Object.values(p.building.thermalBridges.junctions)){j.psi={value:0,status:"misurato"};j.length={value:0,status:"misurato"};}
    p.building.thermalBridges.junctions.pilastro={psi:{value:.5,status:"misurato"},length:{value:10,status:"misurato"}};
    expect(linearBridgeH(p.building,p.location)).toBe(5);
    p.building.thermalBridges.junctions.pilastro.psi.value=-.5;
    expect(linearBridgeH(p.building,p.location)).toBe(0);
  });
  it("il cappotto porta i giunti murari alla colonna esterno con quota piena e media con quota metà",()=>{
    const p=exampleProject(); p.building.thermalBridges.wallInsulation="interno";
    const pilastro=bridgeTable(p.building,p.location,1).find(x=>x.id==="pilastro")!;
    expect(pilastro.after/pilastro.length).toBe(.03);
    const half=bridgeTable(p.building,p.location,.5).find(x=>x.id==="pilastro")!;
    expect(half.after/half.length).toBe(.04);
    const box=bridgeTable(p.building,{...p.location,zone:"F"},1).find(x=>x.id==="pilastro")!;
    expect(box.after/box.length).toBe(.02);
  });
  it("mantiene i ponti senza upgrade e nel contributo dei soli serramenti",()=>{
    const p=exampleProject(),climate=loadMilano(); p.building.thermalBridges.mode="lineari";
    const direct=simulateThermal(p.building,p.service,climate);
    const withBridgeUpgrade=simulateThermal(p.building,p.service,climate,undefined,envelopeUpgrade(p,[]));
    expect(direct.ok).toBe(true); expect(withBridgeUpgrade.ok).toBe(true);
    expect(direct.envelope.H_tbToday).toBeGreaterThan(0);
    expect(direct.envelope.H_tbToday).toBe(withBridgeUpgrade.envelope.H_tbToday);
    expect(direct.heatNeed_kWh).toBe(withBridgeUpgrade.heatNeed_kWh);
    const noZone = { ...climate, manifest: { ...climate.manifest, zone: undefined } };
    const fallback = simulateThermal(p.building,p.service,noZone);
    expect(fallback.envelope.H_tbToday).toBeGreaterThan(0);
    expect(fallback.notes).toContain("Zona climatica del pacchetto assente: ponti lineari stimati con la colonna E.");
    p.envelope.windows=true; p.envelope.walls.enabled=true;
    const ev=evaluate(p,climate), breakdown=ev.ok?envelopeBreakdown(p,climate,ev):null;
    expect(breakdown?.parts.find(x=>x.id==="windows")?.H_tb).toBe(ev.thermal?.base.envelope.H_tbToday);
  });
  it("ha default deltaU compatibile",()=>expect(defaultThermalBridges().mode).toBe("deltaU"));
});
