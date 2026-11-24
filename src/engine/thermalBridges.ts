import type { BuildingInput, LocationInput, ThermalBridgeJunction, ThermalJunction, ThermalBridgesInput } from "./types";
import { adjacentWallShare, computeGeometry } from "./geometry";

// Regione Lombardia, Allegato B, Tabelle 18 e 5-bis, colonna esterna (dimensioni esterne):
// https://www.regione.lombardia.it/content/dam/rl/canali-tematici-servizi/06-ambiente-e-territorio/10-energia/01-impianti-termici-edilizia-sostenibile-e-certificazione-energetica/red-disposizioni-per-efficienza-energetica-degli-edifici/allegati/Allegato-B.pdf
export const THERMAL_BRIDGE_PSI: Record<ThermalJunction, Record<ThermalBridgesInput["wallInsulation"], [number, number]>> = {
  pilastro: { esterno: [.03,.02], interno: [.05,.04], intercapedine: [.85,.85] },
  solaioInterpiano: { esterno: [.02,.01], interno: [.49,.49], intercapedine: [.58,.58] },
  balcone: { esterno: [.47,.48], interno: [.52,.53], intercapedine: [.53,.53] },
  angolo: { esterno: [-.08,-.07], interno: [-.24,-.23], intercapedine: [.18,.18] },
  copertura: { esterno: [.28,.29], interno: [-.24,-.23], intercapedine: [-.10,-.10] },
  davanzale: { esterno: [.42,.43], interno: [.32,.32], intercapedine: [.45,.46] },
  spalla: { esterno: [.25,.26], interno: [.09,.09], intercapedine: [.21,.21] },
  architrave: { esterno: [.39,.39], interno: [.16,.14], intercapedine: [.43,.42] },
  cassonetto: { esterno: [.22,.23], interno: [.22,.23], intercapedine: [.22,.23] },
};
export const THERMAL_JUNCTIONS: ThermalJunction[] = ["pilastro","solaioInterpiano","balcone","angolo","copertura","davanzale","spalla","architrave","cassonetto"];
export const defaultThermalBridges = (): ThermalBridgesInput => ({ mode:"deltaU", wallInsulation:"intercapedine", frame:"telaio", junctions:Object.fromEntries(THERMAL_JUNCTIONS.map(id=>[id,{psi:{value:0,status:"sconosciuto"},length:{value:0,status:"sconosciuto"}}])) as Record<ThermalJunction,ThermalBridgeJunction> });
export function estimatedJunctionLengths(b: BuildingInput): Record<ThermalJunction, number> {
  const g=computeGeometry(b), n=Math.max(1,Math.round(b.floors.value)), h=b.netStoreyHeight.value+b.slabThickness.value;
  const perimeter=Number.isFinite(g.perimeter)?g.perimeter:4*Math.sqrt(Math.max(0,g.footprint));
  const pExt=perimeter*(1-adjacentWallShare(b.sides)), aw=Object.values(g.windows).reduce((a,v)=>a+v,0), count=aw/1.68;
  return { pilastro:b.thermalBridges.frame==="muratura"?0:Math.round(pExt/5)*h*n, solaioInterpiano:pExt*(n-1), balcone:0,
    angolo:({quadrata:4,rettangolare:4,L:5,ferroCavallo:6}[b.shape])*(1-adjacentWallShare(b.sides))*h*n,
    copertura:b.upper==="riscaldato"?0:pExt, davanzale:1.2*count, architrave:1.2*count, spalla:2*1.4*count, cassonetto:1.2*count };
}
export function bridgePsi(b: BuildingInput, loc: Pick<LocationInput,"zone">, id: ThermalJunction): number { const j=b.thermalBridges.junctions[id]; return j.psi.status!=="sconosciuto"?j.psi.value:THERMAL_BRIDGE_PSI[id][b.thermalBridges.wallInsulation][loc.zone==="F"?1:0]; }
export function bridgeLength(b: BuildingInput, id: ThermalJunction): number { const j=b.thermalBridges.junctions[id].length; return j.status!=="sconosciuto"?j.value:estimatedJunctionLengths(b)[id]; }
export function linearBridgeH(b: BuildingInput, loc: LocationInput): number { return Math.max(0,THERMAL_JUNCTIONS.reduce((s,id)=>s+bridgePsi(b,loc,id)*bridgeLength(b,id),0)); }
export function bridgeTable(b: BuildingInput, loc: Pick<LocationInput,"zone">, wallShare=0): {id:ThermalJunction;psi:number;length:number;h:number;after:number}[] { return THERMAL_JUNCTIONS.map(id=>{const psi=bridgePsi(b,loc,id),length=bridgeLength(b,id),wall=id!=="cassonetto",ext=THERMAL_BRIDGE_PSI[id].esterno[loc.zone==="F"?1:0],after=wall?wallShare*ext+(1-wallShare)*psi:psi;return{id,psi,length,h:psi*length,after:after*length};}); }
