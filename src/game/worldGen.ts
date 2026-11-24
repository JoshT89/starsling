import { WALL_MARGIN, PIXELS_PER_METER } from '../core/constants';
import { clamp, SeededRNG } from '../core/math';
import { EntityKind, WorldEntity } from './types';

let nextEntityId = 1;

export function makeEntity(
  kind: EntityKind,
  x: number,
  y: number,
  rng: SeededRNG,
  overrides: Partial<WorldEntity> = {}
): WorldEntity {
  const defaultRadius: Record<EntityKind, number> = {
    prism: 14,
    gold_prism: 15,
    supernova: 20,
    bumper: 23,
    cloud_pad: 14,
    pulsar: 26,
    drifter: 18,
    shield_knight: 20,
    plasma_hazard: 15,
  };

  return {
    id: nextEntityId++,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: defaultRadius[kind],
    width: kind === 'cloud_pad' ? 96 : undefined,
    angle: rng.range(0, Math.PI * 2),
    spinSpeed: rng.range(-1.5, 1.5),
    bobPhase: rng.range(0, Math.PI * 2),
    baseX: x,
    patrolAmp: 0,
    patrolSpeed: 1.4,
    hitScale: 1,
    alive: true,
    ...overrides,
  };
}

export class WorldGenerator {
  private rng: SeededRNG;
  public generatedTopY = 0;
  private chunkCounter = 0;

  constructor(seed: number | string) {
    this.rng = new SeededRNG(seed);
  }

  public reset(seed: number | string, startPlayerY: number, worldWidth: number): WorldEntity[] {
    this.rng = new SeededRNG(seed);
    this.chunkCounter = 0;
    const entities: WorldEntity[] = [];

    const introCenter = worldWidth * 0.5;

    // Starting welcoming pedestal cloud + flanking pads on wide screens
    entities.push(
      makeEntity('cloud_pad', introCenter, startPlayerY + 26, this.rng, {
        width: 152,
      })
    );

    if (worldWidth > 680) {
      entities.push(
        makeEntity('cloud_pad', worldWidth * 0.2, startPlayerY - 40, this.rng, { width: 118 }),
        makeEntity('cloud_pad', worldWidth * 0.8, startPlayerY - 40, this.rng, { width: 118 })
      );
    }

    // Introductory juicy arc of prisms right above launch pad
    for (let i = 0; i < 5; i++) {
      const t = (i - 2) / 2;
      const px = introCenter + t * 66;
      const py = startPlayerY - 125 - (1 - t * t) * 75;
      entities.push(makeEntity(i === 2 ? 'gold_prism' : 'prism', px, py, this.rng));
    }

    // Second cluster slightly higher with a welcoming Supernova Core
    entities.push(makeEntity('supernova', introCenter, startPlayerY - 340, this.rng));
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      entities.push(
        makeEntity(
          a % 2 === 0 ? 'gold_prism' : 'prism',
          introCenter + Math.cos(ang) * 60,
          startPlayerY - 340 + Math.sin(ang) * 54,
          this.rng
        )
      );
    }

    // Populate panoramic flanking clusters on wide tablet/desktop screens right from 0m!
    if (worldWidth > 640) {
      const wingOffsets = [-worldWidth * 0.3, worldWidth * 0.3];
      for (const off of wingOffsets) {
        const wx = clamp(introCenter + off, 70, worldWidth - 70);
        entities.push(makeEntity('bumper', wx, startPlayerY - 190, this.rng));
        for (let k = 0; k < 4; k++) {
          entities.push(
            makeEntity(
              k === 1 ? 'gold_prism' : 'prism',
              clamp(wx + (k - 1.5) * 42, 55, worldWidth - 55),
              startPlayerY - 270 - (k % 2) * 38,
              this.rng
            )
          );
        }
      }
    }

    this.generatedTopY = startPlayerY - 450;
    return entities;
  }

  public generateUpTo(
    targetTopY: number,
    startYRef: number,
    worldWidth: number,
    goldChanceBonus: number,
    isZen: boolean
  ): WorldEntity[] {
    const spawned: WorldEntity[] = [];
    while (this.generatedTopY > targetTopY) {
      const currentMeters = Math.max(0, (startYRef - this.generatedTopY) / PIXELS_PER_METER);
      const chunkHeight = this.spawnRowOfSetpieces(
        this.generatedTopY,
        currentMeters,
        worldWidth,
        goldChanceBonus,
        isZen,
        spawned
      );
      this.generatedTopY -= chunkHeight;
      this.chunkCounter++;
    }
    return spawned;
  }

  private pickPrismKind(baseGoldProb: number, bonus: number): 'prism' | 'gold_prism' {
    return this.rng.chance(clamp(baseGoldProb + bonus, 0.05, 0.78)) ? 'gold_prism' : 'prism';
  }

  private spawnRowOfSetpieces(
    bottomY: number,
    meters: number,
    worldWidth: number,
    goldBonus: number,
    isZen: boolean,
    out: WorldEntity[]
  ): number {
    // On portrait phones (~430u), 1 lane; on tablets (~760u), 2 lanes; on 16:9/ultrawide (1200-1900u), 3-4 lanes!
    const lanes = clamp(Math.round(worldWidth / 460), 1, 4);
    const laneWidth = (worldWidth - WALL_MARGIN * 2) / lanes;
    let maxChunkH = 340;

    for (let lane = 0; lane < lanes; lane++) {
      const laneLeft = WALL_MARGIN + lane * laneWidth;
      const laneRight = laneLeft + laneWidth;
      const h = this.spawnSetpieceInLane(
        bottomY,
        meters,
        laneLeft,
        laneRight,
        lane === 0,
        lane === lanes - 1,
        goldBonus,
        isZen,
        out
      );
      if (h > maxChunkH) maxChunkH = h;
    }

    return maxChunkH;
  }

  private safeLaneX(x: number, laneLeft: number, laneRight: number, pad = 34): number {
    return clamp(x, laneLeft + pad, laneRight - pad);
  }

  private spawnSetpieceInLane(
    bottomY: number,
    meters: number,
    laneLeft: number,
    laneRight: number,
    touchesLeftWall: boolean,
    touchesRightWall: boolean,
    goldBonus: number,
    isZen: boolean,
    out: WorldEntity[]
  ): number {
    const laneW = laneRight - laneLeft;
    const laneCenter = (laneLeft + laneRight) * 0.5;
    const difficulty = clamp(meters / 1800, 0, 1);

    const patterns = [
      's_ribbon',
      'bank_vault',
      'supernova_pinata',
      'pinball_alley',
      'pulsar_curve',
      'drifter_patrol',
      'twin_helix',
    ] as const;

    let pattern = this.rng.pick(patterns);
    if (meters < 180 && (pattern === 'drifter_patrol' || pattern === 'pulsar_curve')) {
      pattern = 's_ribbon';
    }
    if (pattern === 'bank_vault' && !touchesLeftWall && !touchesRightWall) {
      pattern = 'supernova_pinata';
    }

    // Periodic safety cloud pads per lane so every region of the screen is smoothly climbable
    if (this.chunkCounter % 3 === 0 || this.rng.chance(0.28)) {
      const padX = this.safeLaneX(
        this.rng.range(laneLeft + 65, laneRight - 65),
        laneLeft,
        laneRight,
        52
      );
      out.push(
        makeEntity('cloud_pad', padX, bottomY - 35, this.rng, {
          width: this.rng.range(92, 118),
          patrolAmp: meters > 500 && this.rng.chance(0.35) ? 40 : 0,
          patrolSpeed: 1.1,
        })
      );
    }

    const swing = Math.min(130, laneW * 0.34);

    switch (pattern) {
      case 's_ribbon': {
        const flip = this.rng.chance(0.5) ? 1 : -1;
        const steps = 7;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const x = laneCenter + Math.sin(t * Math.PI * 1.65) * swing * flip;
          const y = bottomY - 60 - i * 44;
          out.push(
            makeEntity(
              this.pickPrismKind(0.18, goldBonus),
              this.safeLaneX(x, laneLeft, laneRight),
              y,
              this.rng
            )
          );
        }
        out.push(
          makeEntity(
            'bumper',
            this.safeLaneX(laneCenter - swing * 0.9 * flip, laneLeft, laneRight),
            bottomY - 190,
            this.rng
          )
        );
        if (!isZen && meters > 260 && this.rng.chance(0.42 + difficulty * 0.28)) {
          out.push(
            makeEntity(
              'plasma_hazard',
              this.safeLaneX(laneCenter + swing * 0.78 * flip, laneLeft, laneRight),
              bottomY - 230,
              this.rng
            )
          );
        }
        return 360;
      }

      case 'bank_vault': {
        const vaultLeft = touchesLeftWall && (!touchesRightWall || this.rng.chance(0.5));
        const vaultX = vaultLeft ? laneLeft + 78 : laneRight - 78;
        const oppositeX = vaultLeft ? laneRight - 68 : laneLeft + 68;

        for (let i = 0; i < 3; i++) {
          out.push(
            makeEntity(
              'prism',
              this.safeLaneX(
                laneCenter + (vaultLeft ? -1 : 1) * (i * 38),
                laneLeft,
                laneRight
              ),
              bottomY - 55 - i * 38,
              this.rng
            )
          );
        }

        for (let r = 0; r < 5; r++) {
          const ang = (r / 5) * Math.PI * 2;
          out.push(
            makeEntity(
              'gold_prism',
              this.safeLaneX(vaultX + Math.cos(ang) * 34, laneLeft, laneRight),
              bottomY - 235 + Math.sin(ang) * 34,
              this.rng
            )
          );
        }
        out.push(
          makeEntity('supernova', this.safeLaneX(vaultX, laneLeft, laneRight), bottomY - 235, this.rng)
        );

        if (!isZen && meters > 150) {
          out.push(
            makeEntity(
              'plasma_hazard',
              this.safeLaneX(vaultX + (vaultLeft ? 30 : -30), laneLeft, laneRight),
              bottomY - 150,
              this.rng
            )
          );
        } else {
          out.push(
            makeEntity('bumper', this.safeLaneX(oppositeX, laneLeft, laneRight), bottomY - 155, this.rng)
          );
        }
        return 350;
      }

      case 'supernova_pinata': {
        const cx = this.safeLaneX(
          this.rng.range(laneLeft + 95, laneRight - 95),
          laneLeft,
          laneRight,
          65
        );
        const cy = bottomY - 185;
        out.push(makeEntity('supernova', cx, cy, this.rng));

        const ringCount = 8;
        for (let i = 0; i < ringCount; i++) {
          const ang = (i / ringCount) * Math.PI * 2;
          const kind =
            !isZen && meters > 320 && i % 4 === 0
              ? 'drifter'
              : this.pickPrismKind(0.32, goldBonus);
          out.push(
            makeEntity(
              kind,
              this.safeLaneX(cx + Math.cos(ang) * 66, laneLeft, laneRight),
              cy + Math.sin(ang) * 62,
              this.rng
            )
          );
        }
        out.push(makeEntity('prism', this.safeLaneX(cx - 48, laneLeft, laneRight), bottomY - 65, this.rng));
        out.push(makeEntity('prism', this.safeLaneX(cx + 48, laneLeft, laneRight), bottomY - 65, this.rng));
        return 345;
      }

      case 'pinball_alley': {
        const leftFirst = this.rng.chance(0.5);
        for (let i = 0; i < 3; i++) {
          const isLeft = (i % 2 === 0) === leftFirst;
          const bx = isLeft ? laneCenter - swing * 0.78 : laneCenter + swing * 0.78;
          const by = bottomY - 75 - i * 95;
          out.push(makeEntity('bumper', this.safeLaneX(bx, laneLeft, laneRight), by, this.rng));

          const midX = laneCenter + (isLeft ? 26 : -26);
          out.push(
            makeEntity(
              this.pickPrismKind(0.28, goldBonus),
              this.safeLaneX(midX, laneLeft, laneRight),
              by - 44,
              this.rng
            )
          );
        }
        return 355;
      }

      case 'pulsar_curve': {
        const px = this.safeLaneX(laneCenter + this.rng.range(-45, 45), laneLeft, laneRight, 75);
        const py = bottomY - 185;
        out.push(makeEntity('pulsar', px, py, this.rng, { spinSpeed: 2.2 }));

        for (let i = 0; i < 7; i++) {
          const ang = -Math.PI * 0.85 + (i / 6) * Math.PI * 1.7;
          out.push(
            makeEntity(
              this.pickPrismKind(0.35, goldBonus),
              this.safeLaneX(px + Math.cos(ang) * 84, laneLeft, laneRight),
              py + Math.sin(ang) * 82,
              this.rng
            )
          );
        }
        return 350;
      }

      case 'drifter_patrol': {
        const count = meters > 950 ? 3 : 2;
        for (let i = 0; i < count; i++) {
          const y = bottomY - 85 - i * 105;
          const x = this.safeLaneX(
            this.rng.range(laneLeft + 80, laneRight - 80),
            laneLeft,
            laneRight,
            60
          );
          const isKnight = !isZen && meters > 650 && i === count - 1 && this.rng.chance(0.55);
          out.push(
            makeEntity(isKnight ? 'shield_knight' : isZen ? 'bumper' : 'drifter', x, y, this.rng, {
              patrolAmp: isKnight ? 35 : 52,
              patrolSpeed: 1.3 + difficulty * 0.7,
              angle: Math.PI * 0.5,
              spinSpeed: 0,
            })
          );
          out.push(
            makeEntity(
              this.pickPrismKind(0.22, goldBonus),
              this.safeLaneX(x - 62, laneLeft, laneRight),
              y - 35,
              this.rng
            )
          );
          out.push(
            makeEntity(
              this.pickPrismKind(0.22, goldBonus),
              this.safeLaneX(x + 62, laneLeft, laneRight),
              y - 35,
              this.rng
            )
          );
        }
        return count * 112 + 70;
      }

      case 'twin_helix':
      default: {
        const steps = 6;
        for (let i = 0; i < steps; i++) {
          const y = bottomY - 60 - i * 48;
          const offset = Math.sin((i / steps) * Math.PI * 2) * swing * 0.85;
          out.push(
            makeEntity(
              this.pickPrismKind(0.2, goldBonus),
              this.safeLaneX(laneCenter + offset, laneLeft, laneRight),
              y,
              this.rng
            )
          );
          out.push(
            makeEntity(
              'prism',
              this.safeLaneX(laneCenter - offset, laneLeft, laneRight),
              y,
              this.rng
            )
          );
        }
        if (!isZen && meters > 420 && this.rng.chance(0.5)) {
          out.push(
            makeEntity('plasma_hazard', laneCenter, bottomY - 180, this.rng, {
              patrolAmp: 38,
              patrolSpeed: 1.5,
            })
          );
        } else {
          out.push(makeEntity('supernova', laneCenter, bottomY - 180, this.rng));
        }
        return 355;
      }
    }
  }
}
