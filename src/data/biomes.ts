export interface BiomeTheme {
  id: string;
  name: string;
  subtitle: string;
  minMeters: number;
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  auroraLeft: string;
  auroraRight: string;
  nebulaA: string;
  nebulaB: string;
  accent: string;
}

export const BIOMES: BiomeTheme[] = [
  {
    id: 'twilight',
    name: 'Velvet Twilight',
    subtitle: 'Where newborn stars learn to leap',
    minMeters: 0,
    skyTop: '#080d26',
    skyMid: '#181546',
    skyBottom: '#341c5c',
    auroraLeft: '#38bdf8',
    auroraRight: '#a855f7',
    nebulaA: '#3b82f6',
    nebulaB: '#9333ea',
    accent: '#38bdf8',
  },
  {
    id: 'aurora',
    name: 'Boreal Canopy',
    subtitle: 'Curtains of singing emerald light',
    minMeters: 380,
    skyTop: '#061826',
    skyMid: '#0d3142',
    skyBottom: '#1a4c5c',
    auroraLeft: '#34d399',
    auroraRight: '#38bdf8',
    nebulaA: '#10b981',
    nebulaB: '#0ea5e9',
    accent: '#34d399',
  },
  {
    id: 'nebula',
    name: 'Crimson Rose Nebula',
    subtitle: 'Warm stardust clouds of ancient suns',
    minMeters: 840,
    skyTop: '#1a0926',
    skyMid: '#3c114a',
    skyBottom: '#6e1f58',
    auroraLeft: '#f472b6',
    auroraRight: '#fbbf24',
    nebulaA: '#ec4899',
    nebulaB: '#f59e0b',
    accent: '#f472b6',
  },
  {
    id: 'solar',
    name: 'Solaris Forge',
    subtitle: 'Radiant corona of golden fire',
    minMeters: 1400,
    skyTop: '#1c0c07',
    skyMid: '#45180c',
    skyBottom: '#7c3012',
    auroraLeft: '#fb923c',
    auroraRight: '#fde047',
    nebulaA: '#f97316',
    nebulaB: '#eab308',
    accent: '#fb923c',
  },
  {
    id: 'cyber',
    name: 'Astral Clockwork',
    subtitle: 'Crystalline geometry beyond time',
    minMeters: 2000,
    skyTop: '#060a29',
    skyMid: '#121f63',
    skyBottom: '#291e85',
    auroraLeft: '#22d3ee',
    auroraRight: '#818cf8',
    nebulaA: '#06b6d4',
    nebulaB: '#6366f1',
    accent: '#22d3ee',
  },
  {
    id: 'singularity',
    name: 'Crown of Eternity',
    subtitle: 'The shimmering edge of the cosmos',
    minMeters: 2780,
    skyTop: '#09061a',
    skyMid: '#24104a',
    skyBottom: '#4b2375',
    auroraLeft: '#fde047',
    auroraRight: '#c084fc',
    nebulaA: '#eab308',
    nebulaB: '#a855f7',
    accent: '#fde047',
  },
];

export function getBiomeForMeters(meters: number): { biome: BiomeTheme; index: number } {
  let idx = 0;
  for (let i = BIOMES.length - 1; i >= 0; i--) {
    if (meters >= BIOMES[i].minMeters) {
      idx = i;
      break;
    }
  }
  return { biome: BIOMES[idx], index: idx };
}
