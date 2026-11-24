export type SpiritShape = 'star' | 'kitsune' | 'phoenix' | 'octa' | 'singularity' | 'seraph';

export interface SpiritDef {
  id: string;
  name: string;
  title: string;
  cost: number;
  shape: SpiritShape;
  coreColor: string;
  glowColor: string;
  trailColorA: string;
  trailColorB: string;
  perkTitle: string;
  perkDesc: string;
  starterRelic?: string;
  bonusCharges?: number;
  stardustMult?: number;
}

export const SPIRITS: SpiritDef[] = [
  {
    id: 'luma',
    name: 'Luma',
    title: 'Radiant Star-Sprite',
    cost: 0,
    shape: 'star',
    coreColor: '#fef08a',
    glowColor: '#38bdf8',
    trailColorA: '#fde047',
    trailColorB: '#38bdf8',
    perkTitle: 'Pure Harmony',
    perkDesc: '+10% Score from Air Combos and balanced cosmic agility.',
  },
  {
    id: 'nyx',
    name: 'Nyx',
    title: 'Nebula Kitsune',
    cost: 220,
    shape: 'kitsune',
    coreColor: '#f5d0fe',
    glowColor: '#c084fc',
    trailColorA: '#f472b6',
    trailColorB: '#818cf8',
    perkTitle: 'Chronos Sight',
    perkDesc: 'Starts every run with Chronos Lens (2-bounce laser sight & deep bullet-time).',
    starterRelic: 'chrono_lens',
  },
  {
    id: 'sol',
    name: 'Sol',
    title: 'Solaris Phoenix',
    cost: 380,
    shape: 'phoenix',
    coreColor: '#fef9c3',
    glowColor: '#fb923c',
    trailColorA: '#fde047',
    trailColorB: '#ef4444',
    perkTitle: 'Heart of Fire',
    perkDesc: 'Starts every run with Solar Core (unleashes radial blasts every 6th air hit).',
    starterRelic: 'supernova_heart',
  },
  {
    id: 'echo',
    name: 'Echo-9',
    title: 'Prism Automaton',
    cost: 520,
    shape: 'octa',
    coreColor: '#cffafe',
    glowColor: '#22d3ee',
    trailColorA: '#34d399',
    trailColorB: '#06b6d4',
    perkTitle: 'Pinball Savant',
    perkDesc: 'Starts every run with Aurora Ricochet (supercharged wall bank-shots).',
    starterRelic: 'pinball_king',
  },
  {
    id: 'cosmo',
    name: 'Cosmo',
    title: 'Singularity Pup',
    cost: 680,
    shape: 'singularity',
    coreColor: '#1e1b4b',
    glowColor: '#fbbf24',
    trailColorA: '#fbbf24',
    trailColorB: '#a855f7',
    perkTitle: 'Event Horizon',
    perkDesc: 'Starts with Gravity Locket magnet & collects +25% bonus Stardust.',
    starterRelic: 'prism_magnet',
    stardustMult: 1.25,
  },
  {
    id: 'astra',
    name: 'Astra',
    title: 'Seraph of Dawn',
    cost: 900,
    shape: 'seraph',
    coreColor: '#ffffff',
    glowColor: '#f472b6',
    trailColorA: '#fde047',
    trailColorB: '#ec4899',
    perkTitle: 'Triple Orbit',
    perkDesc: 'Starts every run with 3 Sling Charges right from launch.',
    bonusCharges: 1,
  },
];

export function getSpiritById(id: string): SpiritDef {
  return SPIRITS.find((s) => s.id === id) || SPIRITS[0];
}
