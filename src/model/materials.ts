// Material presets: how a part looks (physically based shading) and what it weighs.

export interface MaterialDef {
  label: string;
  group: 'Plastic' | 'Metal' | 'Other';
  color: string;
  metalness: number;
  roughness: number;
  /** Below 1 the part is see-through (glass, clear resin). */
  opacity?: number;
  /** Clear-coat shine on top of the base color (car paint, glazed ceramic). */
  clearcoat?: number;
  /** g/cm³, for the mass readout. */
  density: number;
}

export const MATERIALS: Record<string, MaterialDef> = {
  pla: { label: 'PLA', group: 'Plastic', color: '#6f9cff', metalness: 0, roughness: 0.55, density: 1.24 },
  petg: { label: 'PETG', group: 'Plastic', color: '#5fc28d', metalness: 0, roughness: 0.35, clearcoat: 0.3, density: 1.27 },
  abs: { label: 'ABS', group: 'Plastic', color: '#e8e8e8', metalness: 0, roughness: 0.6, density: 1.04 },
  nylon: { label: 'Nylon', group: 'Plastic', color: '#f1ede4', metalness: 0, roughness: 0.75, density: 1.14 },
  resin: { label: 'Clear resin', group: 'Plastic', color: '#d9ecff', metalness: 0, roughness: 0.08, opacity: 0.45, clearcoat: 1, density: 1.15 },
  rubber: { label: 'Rubber', group: 'Plastic', color: '#2b2b2b', metalness: 0, roughness: 0.95, density: 1.1 },
  aluminium: { label: 'Aluminium', group: 'Metal', color: '#c9ced6', metalness: 1, roughness: 0.32, density: 2.7 },
  steel: { label: 'Steel', group: 'Metal', color: '#9aa1aa', metalness: 1, roughness: 0.38, density: 7.85 },
  stainless: { label: 'Stainless steel', group: 'Metal', color: '#c4c8cc', metalness: 1, roughness: 0.18, density: 8.0 },
  titanium: { label: 'Titanium', group: 'Metal', color: '#a8a39a', metalness: 1, roughness: 0.4, density: 4.5 },
  brass: { label: 'Brass', group: 'Metal', color: '#d9b65c', metalness: 1, roughness: 0.28, density: 8.5 },
  copper: { label: 'Copper', group: 'Metal', color: '#d8875a', metalness: 1, roughness: 0.3, density: 8.96 },
  gold: { label: 'Gold', group: 'Metal', color: '#f2c94c', metalness: 1, roughness: 0.18, density: 19.3 },
  wood: { label: 'Wood (oak)', group: 'Other', color: '#b98a57', metalness: 0, roughness: 0.8, density: 0.75 },
  glass: { label: 'Glass', group: 'Other', color: '#e6f4ff', metalness: 0, roughness: 0.03, opacity: 0.3, clearcoat: 1, density: 2.5 },
  ceramic: { label: 'Ceramic', group: 'Other', color: '#f4f1ea', metalness: 0, roughness: 0.25, clearcoat: 0.8, density: 2.4 },
  concrete: { label: 'Concrete', group: 'Other', color: '#a3a19c', metalness: 0, roughness: 0.95, density: 2.4 },
  carbon: { label: 'Carbon fiber', group: 'Other', color: '#262a30', metalness: 0.3, roughness: 0.3, clearcoat: 1, density: 1.6 },
};

export const DEFAULT_MATERIAL = 'pla';

export const materialDef = (id: string | undefined): MaterialDef => MATERIALS[id ?? DEFAULT_MATERIAL] ?? MATERIALS[DEFAULT_MATERIAL];
