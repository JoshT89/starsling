import { getTodaySeedString } from './math';

export type GameMode = 'odyssey' | 'daily' | 'blitz' | 'zen';

export interface WorkshopLevels {
  magnet: number;        // 0..5
  feverDuration: number; // 0..5
  stardustBoost: number; // 0..5
  startingShield: number;// 0..1
  headstart: number;     // 0..3
}

export interface ActiveMission {
  id: string;
  type: 'prisms' | 'bankShots' | 'maxCombo' | 'altitude' | 'supernovas' | 'enemies';
  title: string;
  target: number;
  progress: number;
  reward: number;
  singleRun: boolean;
}

export interface SaveData {
  version: number;
  stardust: number;
  bestScore: Record<GameMode, number>;
  bestAltitude: Record<GameMode, number>;
  dailyDate: string;
  dailyBestScore: number;
  dailyBestAltitude: number;
  dailyPlaysToday: number;
  unlockedSpirits: string[];
  selectedSpirit: string;
  workshop: WorkshopLevels;
  missions: ActiveMission[];
  missionsCompletedCount: number;
  achievements: string[];
  stats: {
    totalRuns: number;
    totalSlings: number;
    totalPrisms: number;
    highestCombo: number;
    totalBankShots: number;
    bossesDefeated: number;
    totalMeters: number;
  };
  settings: {
    sfx: boolean;
    music: boolean;
    haptics: boolean;
    invertAim: boolean;
    reducedShake: boolean;
  };
}

const SAVE_KEY = 'starsling_save_v1';

const MISSION_TEMPLATES: Omit<ActiveMission, 'id' | 'progress'>[] = [
  { type: 'prisms', title: 'Shatter 60 Star-Prisms', target: 60, reward: 90, singleRun: false },
  { type: 'bankShots', title: 'Land 4 Wall Bank-Shots in 1 run', target: 4, reward: 110, singleRun: true },
  { type: 'maxCombo', title: 'Reach a 14x Air Streak', target: 14, reward: 120, singleRun: true },
  { type: 'altitude', title: 'Climb past 600m in 1 run', target: 600, reward: 100, singleRun: true },
  { type: 'supernovas', title: 'Detonate 4 Supernova Cores', target: 4, reward: 105, singleRun: false },
  { type: 'enemies', title: 'Smash 12 Void Drifters', target: 12, reward: 115, singleRun: false },
  { type: 'prisms', title: 'Shatter 120 Star-Prisms', target: 120, reward: 160, singleRun: false },
  { type: 'maxCombo', title: 'Reach a 22x Air Streak', target: 22, reward: 180, singleRun: true },
  { type: 'altitude', title: 'Reach 1,200m in 1 run', target: 1200, reward: 190, singleRun: true },
  { type: 'bankShots', title: 'Land 10 Wall Bank-Shots total', target: 10, reward: 140, singleRun: false },
];

export function createMission(indexSeed: number, excludeTypes: string[] = []): ActiveMission {
  const candidates = MISSION_TEMPLATES.filter((m) => !excludeTypes.includes(m.type));
  const pool = candidates.length > 0 ? candidates : MISSION_TEMPLATES;
  const tpl = pool[indexSeed % pool.length];
  return {
    ...tpl,
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    progress: 0,
  };
}

function createDefaultSave(): SaveData {
  const today = getTodaySeedString();
  return {
    version: 1,
    stardust: 100,
    bestScore: { odyssey: 0, daily: 0, blitz: 0, zen: 0 },
    bestAltitude: { odyssey: 0, daily: 0, blitz: 0, zen: 0 },
    dailyDate: today,
    dailyBestScore: 0,
    dailyBestAltitude: 0,
    dailyPlaysToday: 0,
    unlockedSpirits: ['luma'],
    selectedSpirit: 'luma',
    workshop: {
      magnet: 0,
      feverDuration: 0,
      stardustBoost: 0,
      startingShield: 0,
      headstart: 0,
    },
    missions: [
      createMission(0, []),
      createMission(1, ['prisms']),
      createMission(2, ['prisms', 'bankShots']),
    ],
    missionsCompletedCount: 0,
    achievements: [],
    stats: {
      totalRuns: 0,
      totalSlings: 0,
      totalPrisms: 0,
      highestCombo: 0,
      totalBankShots: 0,
      bossesDefeated: 0,
      totalMeters: 0,
    },
    settings: {
      sfx: true,
      music: true,
      haptics: true,
      invertAim: false,
      reducedShake: false,
    },
  };
}

class StorageManager {
  public data: SaveData;

  constructor() {
    this.data = this.load();
    this.refreshDailyIfNeeded();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return createDefaultSave();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const def = createDefaultSave();
      return {
        ...def,
        ...parsed,
        bestScore: { ...def.bestScore, ...(parsed.bestScore || {}) },
        bestAltitude: { ...def.bestAltitude, ...(parsed.bestAltitude || {}) },
        workshop: { ...def.workshop, ...(parsed.workshop || {}) },
        stats: { ...def.stats, ...(parsed.stats || {}) },
        settings: { ...def.settings, ...(parsed.settings || {}) },
        missions:
          Array.isArray(parsed.missions) && parsed.missions.length === 3
            ? parsed.missions
            : def.missions,
      };
    } catch {
      return createDefaultSave();
    }
  }

  public save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Ignore storage quota issues
    }
  }

  public refreshDailyIfNeeded(): void {
    const today = getTodaySeedString();
    if (this.data.dailyDate !== today) {
      this.data.dailyDate = today;
      this.data.dailyBestScore = 0;
      this.data.dailyBestAltitude = 0;
      this.data.dailyPlaysToday = 0;
      this.save();
    }
  }
}

export const storage = new StorageManager();
