import { WorkshopLevels } from '../core/storage';

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  icon: string;
  reward: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_flight', title: 'Starborn', desc: 'Climb past 250m in a single run', icon: '✨', reward: 50 },
  { id: 'combo_15', title: 'Harmonic Cascade', desc: 'Reach a 15x Air Combo', icon: '🎵', reward: 80 },
  { id: 'combo_30', title: 'Symphony of Stars', desc: 'Reach a 30x Air Combo', icon: '🌟', reward: 180 },
  { id: 'bank_5', title: 'Geometry Master', desc: 'Land 5 Wall Bank-Shots in one run', icon: '📐', reward: 100 },
  { id: 'boss_1', title: 'Titan Breaker', desc: 'Defeat a Constellation Boss', icon: '⚔️', reward: 160 },
  { id: 'meters_1000', title: 'Astral Voyager', desc: 'Climb past 1,000m in Odyssey or Daily', icon: '🚀', reward: 150 },
  { id: 'meters_2200', title: 'Beyond the Veil', desc: 'Climb past 2,200m in a single run', icon: '🌌', reward: 300 },
  { id: 'blitz_25k', title: 'Light-Speed Ace', desc: 'Score 25,000+ points in 60s Blitz', icon: '⚡', reward: 140 },
  { id: 'daily_hero', title: 'Daily Cosmic', desc: 'Complete a Daily Cosmos challenge run', icon: '📅', reward: 90 },
  { id: 'collector_3', title: 'Spirit Bond', desc: 'Unlock 3 Star-Spirits', icon: '🦊', reward: 150 },
];

export interface WorkshopUpgradeDef {
  key: keyof WorkshopLevels;
  name: string;
  icon: string;
  maxLevel: number;
  baseCost: number;
  costStep: number;
  desc: (level: number) => string;
}

export const WORKSHOP_UPGRADES: WorkshopUpgradeDef[] = [
  {
    key: 'magnet',
    name: 'Starlight Pull',
    icon: '🧲',
    maxLevel: 5,
    baseCost: 80,
    costStep: 75,
    desc: (lvl) => `+${lvl * 18}px passive gem pickup aura`,
  },
  {
    key: 'feverDuration',
    name: 'Overdrive Core',
    icon: '🌈',
    maxLevel: 5,
    baseCost: 90,
    costStep: 85,
    desc: (lvl) => `+${(lvl * 0.8).toFixed(1)}s Supernova Fever duration`,
  },
  {
    key: 'stardustBoost',
    name: 'Alchemist Prism',
    icon: '💎',
    maxLevel: 5,
    baseCost: 100,
    costStep: 95,
    desc: (lvl) => `+${lvl * 12}% bonus Stardust earned every run`,
  },
  {
    key: 'startingShield',
    name: 'Dawn Barrier',
    icon: '🛡️',
    maxLevel: 1,
    baseCost: 260,
    costStep: 260,
    desc: (lvl) => (lvl > 0 ? 'Start every run with an active Bubble Shield' : 'Unlock a starter Bubble Shield'),
  },
  {
    key: 'headstart',
    name: 'Comet Ignition',
    icon: '☄️',
    maxLevel: 3,
    baseCost: 130,
    costStep: 130,
    desc: (lvl) => (lvl > 0 ? `Launch into runs with ${lvl * 120}m sky-boost` : 'Rocket upward at run start'),
  },
];

export function getWorkshopCost(def: WorkshopUpgradeDef, currentLevel: number): number {
  return def.baseCost + currentLevel * def.costStep;
}
