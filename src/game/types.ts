import { Vec2 } from '../core/math';

export type EntityKind =
  | 'prism'         // Standard Cyan Star-Prism (+charge, +combo, +score)
  | 'gold_prism'    // High-value Gold Crown-Gem (+charge, +stardust, +fever)
  | 'supernova'     // Explosive Solar Core (chain-detonates everything nearby!)
  | 'bumper'        // Bouncy Pink Pinball Moon (high bounce + full charge refill)
  | 'cloud_pad'     // Safe bouncy horizontal Star-Cloud platform
  | 'pulsar'        // Swirling Gravity Well (curves trajectory + slingshot boost)
  | 'drifter'       // Purple Void Creature (shatterable while blazing/fever; bounces/hurts if passive)
  | 'shield_knight' // Void Knight with directional shield arc (bank behind or blast!)
  | 'plasma_hazard';// Unmistakable Crimson Electric Hazard (avoid unless Fever/Supernova!)

export interface WorldEntity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  width?: number;       // For cloud_pad or plasma bar
  angle: number;        // Rotation or shield facing angle
  spinSpeed: number;
  bobPhase: number;
  baseX: number;
  patrolAmp: number;
  patrolSpeed: number;
  hitScale: number;     // Pop animation for bumpers/pads
  alive: boolean;
  magnetized?: boolean;
}

export interface EchoProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
  trail: Vec2[];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  drag: number;
  gravity: number;
  sparkle?: boolean;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  lineWidth: number;
  life: number;
  maxLife: number;
}

export interface LightningArc {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  subtext?: string;
  color: string;
  scale: number;
  life: number;
  maxLife: number;
}

export interface WallRipple {
  side: 'left' | 'right';
  y: number;
  amp: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface BossOrbLock {
  angleOffset: number;
  dist: number;
  alive: boolean;
  respawnTimer: number;
}

export interface BossState {
  active: boolean;
  tier: number;
  name: string;
  title: string;
  x: number;
  y: number;
  baseY: number;
  radius: number;
  hp: number;
  maxHp: number;
  shieldAngle: number;
  shieldArc: number; // radians covered by directional shield
  shieldSpeed: number;
  locks: BossOrbLock[];
  invulnTimer: number;
  flashTimer: number;
  attackTimer: number;
  phaseTime: number;
  arenaFloorY: number;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  charges: number;
  maxCharges: number;
  blazeTimer: number;
  maxBlaze: number;
  feverTimer: number;
  maxFever: number;
  hasShield: boolean;
  invulnTimer: number;
  bankWindowTimer: number;
  lastWallSide: 'left' | 'right' | null;
  squashX: number;
  squashY: number;
  visualAngle: number;
  lookX: number;
  lookY: number;
  trail: { x: number; y: number; r: number; fever: boolean }[];
}

export interface AimState {
  active: boolean;
  pointerId: number;
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
  pullRatio: number;
  canceled: boolean;
  dirX: number;
  dirY: number;
  holdTimer: number;
}

export interface RunSummary {
  mode: 'odyssey' | 'daily' | 'blitz' | 'zen';
  score: number;
  bestScore: number;
  isNewBestScore: boolean;
  altitude: number;
  bestAltitude: number;
  isNewBestAltitude: boolean;
  maxCombo: number;
  prismsShattered: number;
  bankShots: number;
  supernovas: number;
  enemiesSmashed: number;
  bossesDefeated: number;
  stardustEarned: number;
  relicsCollected: string[];
  completedMissions: { title: string; reward: number }[];
  unlockedAchievements: { title: string; icon: string; reward: number }[];
}
