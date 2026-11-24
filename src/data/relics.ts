export type RelicRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface RelicDef {
  id: string;
  name: string;
  icon: string;
  rarity: RelicRarity;
  color: string;
  maxStacks: number;
  shortDesc: string;
  detailDesc: string;
}

export const RELICS: RelicDef[] = [
  {
    id: 'extra_orbit',
    name: 'Orbital Moon',
    icon: '🪐',
    rarity: 'epic',
    color: '#38bdf8',
    maxStacks: 3,
    shortDesc: '+1 Max Sling Charge',
    detailDesc: 'Adds an extra orbiting moon charge so you can sling again in mid-air.',
  },
  {
    id: 'twin_comet',
    name: 'Twin Echo',
    icon: '☄️',
    rarity: 'legendary',
    color: '#f472b6',
    maxStacks: 2,
    shortDesc: 'Fires a spectral Echo-Comet',
    detailDesc: 'Every sling launches a phantom twin orb that shatters prisms & detonates bombs.',
  },
  {
    id: 'chain_spark',
    name: 'Arc Conduit',
    icon: '⚡',
    rarity: 'rare',
    color: '#22d3ee',
    maxStacks: 3,
    shortDesc: 'Hits chain lightning to nearby gems',
    detailDesc: 'Smashing a prism or enemy zaps nearby targets with electric starlight.',
  },
  {
    id: 'prism_magnet',
    name: 'Gravity Locket',
    icon: '🧲',
    rarity: 'common',
    color: '#a855f7',
    maxStacks: 3,
    shortDesc: 'Pulls nearby Prisms toward you',
    detailDesc: 'Creates a wide magnetic aura that curves Star-Prisms and Gold Gems into Luma.',
  },
  {
    id: 'pinball_king',
    name: 'Aurora Ricochet',
    icon: '💠',
    rarity: 'rare',
    color: '#34d399',
    maxStacks: 3,
    shortDesc: 'Supercharges Wall Bank-Shots',
    detailDesc: 'Bouncing off walls boosts speed by +20%, fires a shockwave & adds +2x Combo.',
  },
  {
    id: 'supernova_heart',
    name: 'Solar Core',
    icon: '💥',
    rarity: 'epic',
    color: '#fb923c',
    maxStacks: 2,
    shortDesc: 'Every 6th hit unleashes a Nova Blast',
    detailDesc: 'Every 6 consecutive air hits detonates a radial shockwave around you.',
  },
  {
    id: 'chrono_lens',
    name: 'Chronos Lens',
    icon: '⏳',
    rarity: 'common',
    color: '#818cf8',
    maxStacks: 2,
    shortDesc: '2-Bounce Sight & Deeper Slow-Mo',
    detailDesc: 'Extends trajectory preview with wall-ricochet sightlines and longer bullet-time.',
  },
  {
    id: 'phoenix_aegis',
    name: 'Starlight Aegis',
    icon: '🛡️',
    rarity: 'rare',
    color: '#fde047',
    maxStacks: 2,
    shortDesc: 'Regenerating Bubble Shield',
    detailDesc: 'Blocks 1 hazard hit with an explosive knockback and recharges at every Gate.',
  },
  {
    id: 'midas_wake',
    name: 'Golden Wake',
    icon: '👑',
    rarity: 'rare',
    color: '#fbbf24',
    maxStacks: 3,
    shortDesc: 'More Gold Gems & +2x Gold Combo',
    detailDesc: 'Transmutes +25% of prisms into high-value Gold Crown-Gems that boost Fever fast.',
  },
  {
    id: 'fever_catalyst',
    name: 'Overdrive Spark',
    icon: '🌈',
    rarity: 'epic',
    color: '#f43f5e',
    maxStacks: 2,
    shortDesc: 'Faster & Longer Rainbow Fever',
    detailDesc: 'Triggers invincible Supernova Fever 3 hits earlier and extends duration by +2.5s.',
  },
  {
    id: 'cloud_nova',
    name: 'Nimbus Boom',
    icon: '☁️',
    rarity: 'common',
    color: '#67e8f9',
    maxStacks: 2,
    shortDesc: 'Pads & Bumpers fire Sonic Waves',
    detailDesc: 'Bouncing off Cloud-Pads or Bumper Moons blasts an upward shockwave.',
  },
  {
    id: 'thruster_boost',
    name: 'Hyperion Sling',
    icon: '🚀',
    rarity: 'common',
    color: '#fb7185',
    maxStacks: 3,
    shortDesc: '+15% Launch Speed & Blaze Time',
    detailDesc: 'Increases sling launch power and keeps your unstoppable Blaze Aura active longer.',
  },
];

export const RARITY_LABELS: Record<RelicRarity, { label: string; color: string }> = {
  common: { label: 'STAR', color: '#94a3b8' },
  rare: { label: 'RARE', color: '#38bdf8' },
  epic: { label: 'EPIC', color: '#c084fc' },
  legendary: { label: 'MYTHIC', color: '#fbbf24' },
};
