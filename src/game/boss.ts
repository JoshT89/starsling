import { normalizeAngle } from '../core/math';
import { BossState } from './types';

const BOSS_ROSTER = [
  { name: 'OCULON', title: 'Watcher of the Veil', hp: 5, locks: 3, shieldArc: Math.PI * 0.65 },
  { name: 'HEXA-PRIME', title: 'Astral Clockwork Core', hp: 7, locks: 4, shieldArc: Math.PI * 0.8 },
  { name: 'SOLARIS', title: 'Seraph of the Corona', hp: 9, locks: 4, shieldArc: Math.PI * 0.9 },
];

export function createBoss(tier: number, playerY: number, worldWidth: number): BossState {
  const tpl = BOSS_ROSTER[tier % BOSS_ROSTER.length];
  const extraCycles = Math.floor(tier / BOSS_ROSTER.length);
  const maxHp = tpl.hp + extraCycles * 3;
  const bossY = playerY - 270;

  const locks = Array.from({ length: tpl.locks }, (_, i) => ({
    angleOffset: (i / tpl.locks) * Math.PI * 2,
    dist: 76,
    alive: true,
    respawnTimer: 0,
  }));

  return {
    active: true,
    tier,
    name: tpl.name,
    title: tpl.title,
    x: worldWidth * 0.5,
    y: bossY,
    baseY: bossY,
    radius: 40,
    hp: maxHp,
    maxHp,
    shieldAngle: Math.PI * 0.5,
    shieldArc: tpl.shieldArc,
    shieldSpeed: (1.05 + tier * 0.22) * (tier % 2 === 0 ? 1 : -1),
    locks,
    invulnTimer: 0,
    flashTimer: 0,
    attackTimer: 3.2,
    phaseTime: 0,
    arenaFloorY: bossY + 340,
  };
}

export function updateBoss(
  boss: BossState,
  dt: number,
  worldWidth: number
): { spawnPulse: boolean } {
  if (!boss.active) return { spawnPulse: false };

  boss.phaseTime += dt;
  const patrolSpan = Math.min(220, worldWidth * 0.24);
  boss.x = worldWidth * 0.5 + Math.sin(boss.phaseTime * 1.15) * patrolSpan;
  boss.y = boss.baseY + Math.cos(boss.phaseTime * 1.7) * 22;
  boss.shieldAngle = normalizeAngle(boss.shieldAngle + boss.shieldSpeed * dt);

  if (boss.invulnTimer > 0) boss.invulnTimer = Math.max(0, boss.invulnTimer - dt);
  if (boss.flashTimer > 0) boss.flashTimer = Math.max(0, boss.flashTimer - dt);

  for (const lock of boss.locks) {
    lock.angleOffset = normalizeAngle(lock.angleOffset - boss.shieldSpeed * 0.75 * dt);
    if (!lock.alive) {
      lock.respawnTimer -= dt;
      if (lock.respawnTimer <= 0) {
        lock.alive = true;
      }
    }
  }

  boss.attackTimer -= dt;
  if (boss.attackTimer <= 0) {
    boss.attackTimer = Math.max(2.2, 3.8 - boss.tier * 0.25);
    return { spawnPulse: true };
  }

  return { spawnPulse: false };
}

export function isAngleBlockedByBossShield(
  boss: BossState,
  incomingAngleFromBossToPlayer: number
): boolean {
  const diff = Math.abs(normalizeAngle(incomingAngleFromBossToPlayer - boss.shieldAngle));
  return diff <= boss.shieldArc * 0.5;
}
