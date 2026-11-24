import { sound } from '../core/audio';
import {
  AIR_DRAG,
  BANK_SHOT_WINDOW,
  BASE_SLING_SPEED,
  BLAZE_DURATION,
  BLITZ_DURATION_SECONDS,
  BOSS_MILESTONES,
  CHRONO_MAX_HOLD,
  CHRONO_TIME_SCALE,
  DEFAULT_MAX_CHARGES,
  FEVER_COMBO_THRESHOLD,
  FEVER_DURATION,
  FIRST_GATE_METERS,
  GATE_STEP_METERS,
  GRAVITY,
  MAX_FALL_SPEED,
  MAX_PULL_DIST,
  MIN_PULL_DIST,
  MIN_SLING_SPEED,
  PIXELS_PER_METER,
  PLAYER_RADIUS,
  WALL_BOUNCE_RESTITUTION,
  WALL_MARGIN,
} from '../core/constants';
import {
  clamp,
  damp,
  dist,
  distSq,
  getTodaySeedString,
  lerp,
  normalizeAngle,
  SeededRNG,
} from '../core/math';
import { createMission, GameMode, storage } from '../core/storage';
import { ACHIEVEMENTS } from '../data/achievements';
import { getBiomeForMeters } from '../data/biomes';
import { RELICS, RelicDef } from '../data/relics';
import { getSpiritById } from '../data/spirits';
import { createBoss, isAngleBlockedByBossShield, updateBoss } from './boss';
import { GameRenderer, RenderSnapshot } from './renderer';
import {
  AimState,
  BossState,
  EchoProjectile,
  FloatingText,
  LightningArc,
  Particle,
  PlayerState,
  RunSummary,
  Shockwave,
  WallRipple,
  WorldEntity,
} from './types';
import { makeEntity, WorldGenerator } from './worldGen';

export type EnginePhase = 'attract' | 'playing' | 'relic_draft' | 'paused' | 'gameover';

export interface HudState {
  mode: GameMode;
  score: number;
  meters: number;
  combo: number;
  feverRatio: number;
  isFever: boolean;
  stardustRun: number;
  blitzTimeLeft: number;
  biomeName: string;
  relicStacks: Record<string, number>;
  bossActive: boolean;
}

export interface EngineCallbacks {
  onHudUpdate: (hud: HudState) => void;
  onRelicDraft: (choices: RelicDef[], gateMeters: number) => void;
  onRunOver: (summary: RunSummary) => void;
  onToast: (title: string, subtitle: string, icon: string) => void;
  onBiomeBanner: (name: string, subtitle: string) => void;
}

export class GameEngine {
  private renderer: GameRenderer;
  private callbacks: EngineCallbacks;
  private worldGen: WorldGenerator;
  private rng: SeededRNG;

  public phase: EnginePhase = 'attract';
  public mode: GameMode = 'odyssey';

  private time = 0;
  private startY = 640;
  private cameraY = 0;
  private eclipseY: number | null = null;
  private hasLaunchedOnce = false;

  private score = 0;
  private displayScore = 0;
  private maxMeters = 0;
  private combo = 0;
  private maxComboRun = 0;
  private prismsRun = 0;
  private bankShotsRun = 0;
  private supernovasRun = 0;
  private enemiesRun = 0;
  private bossesRun = 0;
  private stardustRun = 0;
  private blitzTimer = BLITZ_DURATION_SECONDS;

  private relicStacks: Record<string, number> = {};
  private relicOrder: string[] = [];
  private nextGateMeters = FIRST_GATE_METERS;
  private nextBossIdx = 0;
  private currentBiomeIdx = 0;

  private hitStopTimer = 0;
  private shakeTrauma = 0;
  private flashAlpha = 0;
  private flashColor = '#ffffff';
  private chronoBlend = 0;

  private attractCooldown = 0.8;
  private hudSyncTimer = 0;
  private completedMissionsRun: { title: string; reward: number }[] = [];
  private unlockedAchRun: { title: string; icon: string; reward: number }[] = [];

  private player!: PlayerState;
  private aim!: AimState;
  private entities: WorldEntity[] = [];
  private echoes: EchoProjectile[] = [];
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private lightnings: LightningArc[] = [];
  private floatingTexts: FloatingText[] = [];
  private wallRipples: WallRipple[] = [];
  private boss: BossState | null = null;

  private currentSeed: number | string = Date.now();

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.renderer = new GameRenderer(canvas);
    this.callbacks = callbacks;
    this.rng = new SeededRNG(Date.now());
    this.worldGen = new WorldGenerator(Date.now());

    this.bindInput(canvas);

    const onResize = () => this.handleViewportResize();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    }

    this.startAttractMode();
  }

  private handleViewportResize(): void {
    const oldW = this.renderer.logicalWidth;
    const { width: newW, height: newH } = this.renderer.resize();
    if (!this.player || Math.abs(newW - oldW) < 0.5) return;

    // If in attract mode or sitting on launch pad before first shot, cleanly rebuild layout for exact new width!
    if (this.phase === 'attract') {
      this.setupWorld('zen', Date.now(), true);
      return;
    }
    if (!this.hasLaunchedOnce && this.phase === 'playing') {
      this.setupWorld(this.mode, this.currentSeed, false);
      return;
    }

    const ratioX = newW / Math.max(1, oldW);
    this.player.x = clamp(
      this.player.x * ratioX,
      WALL_MARGIN + this.player.radius,
      newW - WALL_MARGIN - this.player.radius
    );
    for (const pt of this.player.trail) {
      pt.x = pt.x * ratioX;
    }
    for (const ent of this.entities) {
      ent.baseX = clamp(ent.baseX * ratioX, WALL_MARGIN + 32, newW - WALL_MARGIN - 32);
      ent.x = clamp(ent.x * ratioX, WALL_MARGIN + 24, newW - WALL_MARGIN - 24);
    }
    if (this.boss && this.boss.active) {
      this.boss.x = clamp(this.boss.x * ratioX, 80, newW - 80);
    }
    if (this.cameraY > this.player.y - newH * 0.2) {
      this.cameraY = this.player.y - newH * 0.54;
    }
  }

  public syncAudioSettings(): void {
    const s = storage.data.settings;
    sound.sfxEnabled = s.sfx;
    sound.setMusicEnabled(s.music);
    sound.hapticsEnabled = s.haptics;
  }

  public startAttractMode(): void {
    this.phase = 'attract';
    this.setupWorld('zen', Date.now(), true);
  }

  public startRun(mode: GameMode): void {
    sound.unlock();
    this.syncAudioSettings();
    storage.refreshDailyIfNeeded();

    this.mode = mode;
    this.phase = 'playing';

    const seed =
      mode === 'daily'
        ? `DAILY_${getTodaySeedString()}`
        : `${Date.now()}_${Math.random()}`;

    if (mode === 'daily') {
      storage.data.dailyPlaysToday++;
    }
    storage.data.stats.totalRuns++;
    storage.save();

    this.setupWorld(mode, seed, false);

    // Headstart boost from Workshop (if unlocked & in Odyssey/Blitz)
    const headstartLvl = storage.data.workshop.headstart;
    if (headstartLvl > 0 && (mode === 'odyssey' || mode === 'blitz')) {
      this.hasLaunchedOnce = true;
      this.player.vy = -1250 - headstartLvl * 160;
      this.player.blazeTimer = 1.1 + headstartLvl * 0.35;
      this.player.maxBlaze = this.player.blazeTimer;
      this.spawnShockwave(this.player.x, this.player.y, 130, '#fde047', 5);
      this.addFloatingText(this.player.x, this.player.y - 25, 'COMET IGNITION!', 'HEADSTART', '#fde047', 1.15);
      sound.playSlingLaunch(1, true);
    }

    const { biome } = getBiomeForMeters(0);
    this.callbacks.onBiomeBanner(biome.name, biome.subtitle);
    this.emitHud();
  }

  private setupWorld(mode: GameMode, seed: number | string, isAttract: boolean): void {
    this.currentSeed = seed;
    this.rng = new SeededRNG(seed);
    const W = this.renderer.logicalWidth;
    this.startY = this.renderer.logicalHeight * 0.72;
    this.cameraY = 0;
    this.hasLaunchedOnce = isAttract;

    this.score = 0;
    this.displayScore = 0;
    this.maxMeters = 0;
    this.combo = 0;
    this.maxComboRun = 0;
    this.prismsRun = 0;
    this.bankShotsRun = 0;
    this.supernovasRun = 0;
    this.enemiesRun = 0;
    this.bossesRun = 0;
    this.stardustRun = 0;
    this.blitzTimer = BLITZ_DURATION_SECONDS;
    this.completedMissionsRun = [];
    this.unlockedAchRun = [];

    this.relicStacks = {};
    this.relicOrder = [];
    this.nextGateMeters = FIRST_GATE_METERS;
    this.nextBossIdx = 0;
    this.currentBiomeIdx = 0;
    this.boss = null;

    this.echoes = [];
    this.particles = [];
    this.shockwaves = [];
    this.lightnings = [];
    this.floatingTexts = [];
    this.wallRipples = [];
    this.hitStopTimer = 0;
    this.shakeTrauma = 0;
    this.flashAlpha = 0;
    this.chronoBlend = 0;

    const spirit = getSpiritById(storage.data.selectedSpirit);
    if (!isAttract && spirit.starterRelic) {
      this.relicStacks[spirit.starterRelic] = 1;
      this.relicOrder.push(spirit.starterRelic);
    }

    const maxCharges =
      DEFAULT_MAX_CHARGES +
      (spirit.bonusCharges || 0) +
      this.getRelicCount('extra_orbit');

    const hasStarterShield =
      !isAttract &&
      (storage.data.workshop.startingShield > 0 || this.getRelicCount('phoenix_aegis') > 0);

    this.player = {
      x: W * 0.5,
      y: this.startY,
      vx: 0,
      vy: 0,
      radius: PLAYER_RADIUS,
      charges: maxCharges,
      maxCharges,
      blazeTimer: 0,
      maxBlaze: BLAZE_DURATION,
      feverTimer: 0,
      maxFever: FEVER_DURATION,
      hasShield: hasStarterShield,
      invulnTimer: 0,
      bankWindowTimer: 0,
      lastWallSide: null,
      squashX: 1,
      squashY: 1,
      visualAngle: 0,
      lookX: 0,
      lookY: -1,
      trail: [],
    };

    this.aim = {
      active: false,
      pointerId: -1,
      anchorX: 0,
      anchorY: 0,
      currentX: 0,
      currentY: 0,
      pullRatio: 0,
      canceled: false,
      dirX: 0,
      dirY: -1,
      holdTimer: 0,
    };

    this.eclipseY =
      mode === 'zen' || mode === 'blitz' || isAttract
        ? null
        : this.startY + 340;

    this.entities = this.worldGen.reset(seed, this.startY, W);
    const extra = this.worldGen.generateUpTo(
      this.cameraY - 900,
      this.startY,
      W,
      this.getGoldChanceBonus(),
      mode === 'zen' || isAttract
    );
    this.entities.push(...extra);
  }

  private getRelicCount(id: string): number {
    return this.relicStacks[id] || 0;
  }

  private getGoldChanceBonus(): number {
    return this.getRelicCount('midas_wake') * 0.24;
  }

  private getLaunchSpeed(pullRatio: number): number {
    const boost = 1 + this.getRelicCount('thruster_boost') * 0.14;
    return lerp(MIN_SLING_SPEED, BASE_SLING_SPEED, pullRatio) * boost;
  }

  private getFeverThreshold(): number {
    return Math.max(6, FEVER_COMBO_THRESHOLD - this.getRelicCount('fever_catalyst') * 3);
  }

  private getFeverMaxDuration(): number {
    return (
      FEVER_DURATION +
      storage.data.workshop.feverDuration * 0.8 +
      this.getRelicCount('fever_catalyst') * 2.5
    );
  }

  public pause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.cancelAim(false);
    }
  }

  public resume(): void {
    if (this.phase === 'paused') {
      this.phase = 'playing';
    }
  }

  public selectRelic(relicId: string): void {
    if (this.phase !== 'relic_draft') return;
    sound.playUiTap(true);

    this.relicStacks[relicId] = (this.relicStacks[relicId] || 0) + 1;
    if (!this.relicOrder.includes(relicId)) this.relicOrder.push(relicId);

    // Apply immediate benefits
    this.player.maxCharges =
      DEFAULT_MAX_CHARGES +
      (getSpiritById(storage.data.selectedSpirit).bonusCharges || 0) +
      this.getRelicCount('extra_orbit');
    this.player.charges = this.player.maxCharges;

    if (this.getRelicCount('phoenix_aegis') > 0) {
      this.player.hasShield = true;
    }

    // Celebratory upward shrine boost!
    this.player.vy = Math.min(this.player.vy, -880);
    this.player.blazeTimer = 0.85;
    this.flashColor = '#fde047';
    this.flashAlpha = 0.35;
    this.spawnShockwave(this.player.x, this.player.y, 140, '#fde047', 4.5);

    this.phase = 'playing';
    this.emitHud();
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      if (this.phase !== 'playing') return;
      sound.unlock();
      if (this.aim.active) return;
      if (this.player.charges <= 0) {
        // Gentle visual feedback if out of charges mid-air
        this.addFloatingText(this.player.x, this.player.y - 24, 'NO CHARGE!', 'LAND OR HIT GEM', '#94a3b8', 0.85);
        return;
      }

      canvas.setPointerCapture(e.pointerId);
      const pt = this.renderer.clientToLogical(e.clientX, e.clientY);
      this.aim.active = true;
      this.aim.pointerId = e.pointerId;
      this.aim.anchorX = pt.x;
      this.aim.anchorY = pt.y;
      this.aim.currentX = pt.x;
      this.aim.currentY = pt.y;
      this.aim.pullRatio = 0.45;
      this.aim.canceled = false;
      this.aim.dirX = 0;
      this.aim.dirY = -1;
      this.aim.holdTimer = 0;
      sound.resetPullTicks();
      sound.setChronoFilter(true);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.aim.active || e.pointerId !== this.aim.pointerId) return;
      const pt = this.renderer.clientToLogical(e.clientX, e.clientY);
      this.aim.currentX = pt.x;
      this.aim.currentY = pt.y;

      const invert = storage.data.settings.invertAim ? 1 : -1;
      const dx = (pt.x - this.aim.anchorX) * invert;
      const dy = (pt.y - this.aim.anchorY) * invert;
      const pullLen = Math.hypot(dx, dy);

      if (pullLen < MIN_PULL_DIST) {
        if (!this.aim.canceled && this.aim.holdTimer > 0.08) {
          sound.playCancel();
        }
        this.aim.canceled = true;
        this.aim.pullRatio = 0;
      } else {
        this.aim.canceled = false;
        this.aim.pullRatio = clamp((pullLen - MIN_PULL_DIST) / (MAX_PULL_DIST - MIN_PULL_DIST), 0.15, 1);
        this.aim.dirX = dx / pullLen;
        this.aim.dirY = dy / pullLen;
        this.player.lookX = this.aim.dirX;
        this.player.lookY = this.aim.dirY;
        sound.playPullTension(this.aim.pullRatio);
      }
    });

    const finishPointer = (e: PointerEvent, isCancel: boolean) => {
      if (!this.aim.active || e.pointerId !== this.aim.pointerId) return;
      if (isCancel || this.aim.canceled) {
        this.cancelAim(false);
        return;
      }
      // Quick tap without dragging still fires a snappy upward hop if desired, or cancel if tiny accidental tap
      const dragDist = dist(this.aim.anchorX, this.aim.anchorY, this.aim.currentX, this.aim.currentY);
      if (dragDist < MIN_PULL_DIST) {
        this.cancelAim(false);
        return;
      }
      this.executeSling();
    };

    canvas.addEventListener('pointerup', (e) => finishPointer(e, false));
    canvas.addEventListener('pointercancel', (e) => finishPointer(e, true));
  }

  private cancelAim(playSound: boolean): void {
    this.aim.active = false;
    this.aim.pointerId = -1;
    sound.setChronoFilter(false);
    if (playSound) sound.playCancel();
  }

  private executeSling(): void {
    const p = this.player;
    const speed = this.getLaunchSpeed(this.aim.pullRatio);

    p.vx = this.aim.dirX * speed;
    p.vy = this.aim.dirY * speed;
    p.charges = Math.max(0, p.charges - 1);

    const blazeMult = 1 + this.getRelicCount('thruster_boost') * 0.22;
    p.maxBlaze = BLAZE_DURATION * blazeMult;
    p.blazeTimer = p.maxBlaze;
    p.squashX = 1.42;
    p.squashY = 0.68;
    p.visualAngle = Math.atan2(p.vy, p.vx) + Math.PI * 0.5;

    this.hasLaunchedOnce = true;
    this.aim.active = false;
    this.aim.pointerId = -1;
    sound.setChronoFilter(false);
    sound.playSlingLaunch(this.aim.pullRatio, p.feverTimer > 0);

    storage.data.stats.totalSlings++;

    // Launch burst particles
    this.spawnBurst(p.x, p.y, 12, p.feverTimer > 0 ? '#fde047' : '#7dd3fc', 210);
    this.addShake(0.18);

    // Twin Echo Relic: fires spectral echo orbs!
    const twinCount = this.getRelicCount('twin_comet');
    if (twinCount > 0) {
      const baseAngle = Math.atan2(this.aim.dirY, this.aim.dirX);
      const offsets = twinCount === 1 ? [0.22] : [-0.2, 0.2];
      for (const off of offsets) {
        const ang = baseAngle + off;
        this.echoes.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(ang) * speed * 1.06,
          vy: Math.sin(ang) * speed * 1.06,
          radius: 11,
          life: 1.15,
          maxLife: 1.15,
          color: '#f472b6',
          trail: [],
        });
      }
    }
  }

  public step(rawDt: number): void {
    const clampedDt = Math.min(rawDt, 0.05);
    this.time += clampedDt;

    if (this.phase === 'paused' || this.phase === 'relic_draft' || this.phase === 'gameover') {
      // Still gently decay flash & render crisp frame
      this.flashAlpha = damp(this.flashAlpha, 0, 8, clampedDt);
      this.renderCurrentFrame();
      return;
    }

    // Hit-stop micro-freeze for juicy impacts!
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= clampedDt;
      this.shakeTrauma = Math.max(0, this.shakeTrauma - clampedDt * 0.9);
      this.renderCurrentFrame();
      return;
    }

    // Bullet-Time Chrono Scaling when aiming in mid-air
    const maxHold = CHRONO_MAX_HOLD * (1 + this.getRelicCount('chrono_lens') * 0.65);
    let targetTimeScale = 1.0;
    if (this.aim.active) {
      this.aim.holdTimer += clampedDt;
      if (this.aim.holdTimer < maxHold) {
        const lensBonus = this.getRelicCount('chrono_lens') > 0 ? 0.09 : CHRONO_TIME_SCALE;
        targetTimeScale = lensBonus;
      } else {
        // Smoothly expire bullet-time if held too long
        this.cancelAim(true);
      }
    }

    this.chronoBlend = damp(this.chronoBlend, targetTimeScale < 0.5 ? 1 : 0, 14, clampedDt);
    const simDt = clampedDt * lerp(1, targetTimeScale, this.chronoBlend);

    if (this.phase === 'attract') {
      this.updateAttractAI(clampedDt);
    }

    // Blitz 60s Mode Countdown (uses real time, paused slightly in bullet-time fairness)
    if (this.phase === 'playing' && this.mode === 'blitz' && this.hasLaunchedOnce) {
      this.blitzTimer -= clampedDt * lerp(1, 0.45, this.chronoBlend);
      if (this.blitzTimer <= 0) {
        this.blitzTimer = 0;
        this.finishRun();
        this.renderCurrentFrame();
        return;
      }
    }

    this.updatePlayer(simDt);
    this.updateEchoes(simDt);
    this.updateEntities(simDt);
    this.updateBossEncounter(simDt);
    this.updateCameraAndTide(simDt, clampedDt);
    this.updateEffects(clampedDt);

    // Check Milestones & Gates
    if (this.phase === 'playing') {
      this.checkProgressMilestones();
    }

    // Periodic HUD push (~20Hz so DOM stays ultra-fast!)
    this.hudSyncTimer += clampedDt;
    if (this.hudSyncTimer >= 0.05 && this.phase === 'playing') {
      this.hudSyncTimer = 0;
      this.emitHud();
    }

    this.renderCurrentFrame();
  }

  private updateAttractAI(dt: number): void {
    this.attractCooldown -= dt;
    if (this.attractCooldown <= 0 && this.player.vy > -120) {
      this.attractCooldown = 0.62 + Math.random() * 0.35;
      // Aim toward highest nearby prism above Luma
      let best: WorldEntity | null = null;
      let bestScore = Infinity;
      for (const e of this.entities) {
        if (!e.alive || (e.kind !== 'prism' && e.kind !== 'gold_prism' && e.kind !== 'supernova')) continue;
        if (e.y < this.player.y - 50 && e.y > this.player.y - 380) {
          const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
          if (d < bestScore) {
            bestScore = d;
            best = e;
          }
        }
      }
      const tx = best ? best.x : this.renderer.logicalWidth * (0.25 + Math.random() * 0.5);
      const ty = best ? best.y - 60 : this.player.y - 280;
      const ang = Math.atan2(ty - this.player.y, tx - this.player.x);
      this.player.vx = Math.cos(ang) * 920;
      this.player.vy = Math.sin(ang) * 920;
      this.player.blazeTimer = 0.55;
      this.player.charges = this.player.maxCharges;
      this.spawnBurst(this.player.x, this.player.y, 8, '#7dd3fc', 160);
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;

    if (p.blazeTimer > 0) p.blazeTimer = Math.max(0, p.blazeTimer - dt);
    if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    if (p.bankWindowTimer > 0) p.bankWindowTimer = Math.max(0, p.bankWindowTimer - dt);
    if (p.feverTimer > 0) {
      p.feverTimer = Math.max(0, p.feverTimer - dt);
    }

    // Before first launch, rest gently on launch pad
    if (!this.hasLaunchedOnce) {
      p.y = this.startY + Math.sin(this.time * 3.5) * 3;
      p.squashX = damp(p.squashX, this.aim.active ? 1.24 : 1, 12, dt);
      p.squashY = damp(p.squashY, this.aim.active ? 0.8 : 1, 12, dt);
      return;
    }

    // Gravity & subtle horizontal air drag
    p.vy = Math.min(MAX_FALL_SPEED, p.vy + GRAVITY * dt);
    p.vx *= 1 - AIR_DRAG * dt;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Aurora Wall Ricochets!
    const W = this.renderer.logicalWidth;
    const minX = WALL_MARGIN + p.radius;
    const maxX = W - WALL_MARGIN - p.radius;
    const pinballStacks = this.getRelicCount('pinball_king');
    const bounceMult = WALL_BOUNCE_RESTITUTION * (1 + pinballStacks * 0.14);

    if (p.x < minX) {
      p.x = minX;
      p.vx = Math.max(240, Math.abs(p.vx) * bounceMult);
      this.onWallBounce('left', pinballStacks);
    } else if (p.x > maxX) {
      p.x = maxX;
      p.vx = -Math.max(240, Math.abs(p.vx) * bounceMult);
      this.onWallBounce('right', pinballStacks);
    }

    // Visual squash-stretch recovery & look direction
    const speed = Math.hypot(p.vx, p.vy);
    const stretch = clamp(1 + (speed - 350) / 1500, 0.94, 1.34);
    p.squashY = damp(p.squashY, this.aim.active ? 0.82 : stretch, 14, dt);
    p.squashX = damp(p.squashX, this.aim.active ? 1.22 : 1 / Math.sqrt(stretch), 14, dt);

    if (speed > 45 && !this.aim.active) {
      p.visualAngle = Math.atan2(p.vy, p.vx) + Math.PI * 0.5;
      p.lookX = p.vx / speed;
      p.lookY = p.vy / speed;
    }

    // Record silky ribbon trail
    p.trail.push({
      x: p.x,
      y: p.y,
      r: p.radius * (p.feverTimer > 0 ? 1.05 : 0.88),
      fever: p.feverTimer > 0,
    });
    if (p.trail.length > 18) p.trail.shift();

    // Update Altitude
    const currentMeters = Math.max(0, Math.floor((this.startY - p.y) / PIXELS_PER_METER));
    if (currentMeters > this.maxMeters) {
      const gained = currentMeters - this.maxMeters;
      this.maxMeters = currentMeters;
      this.score += gained * 5;
    }
  }

  private onWallBounce(side: 'left' | 'right', pinballStacks: number): void {
    const p = this.player;
    p.bankWindowTimer = BANK_SHOT_WINDOW;
    p.lastWallSide = side;
    p.squashX = 0.72;
    p.squashY = 1.32;

    const wallX = side === 'left' ? WALL_MARGIN : this.renderer.logicalWidth - WALL_MARGIN;
    this.wallRipples.push({
      side,
      y: p.y,
      amp: 13 + pinballStacks * 4,
      life: 0.48,
      maxLife: 0.48,
      color: '#38bdf8',
    });
    this.spawnBurst(wallX, p.y, 9, '#34d399', 170);

    if (this.phase === 'playing') {
      sound.playBankShot(side === 'left' ? -0.75 : 0.75);
      if (pinballStacks > 0) {
        p.vy = Math.min(p.vy, -560); // extra upward lift!
        p.blazeTimer = Math.max(p.blazeTimer, 0.45);
        this.spawnShockwave(wallX, p.y, 95 + pinballStacks * 30, '#34d399', 3.5);
      }
    }
  }

  private updateEchoes(dt: number): void {
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const ec = this.echoes[i];
      ec.life -= dt;
      if (ec.life <= 0) {
        this.echoes.splice(i, 1);
        continue;
      }
      ec.vy += GRAVITY * 0.55 * dt;
      ec.x += ec.vx * dt;
      ec.y += ec.vy * dt;

      const W = this.renderer.logicalWidth;
      if (ec.x < WALL_MARGIN + ec.radius) {
        ec.x = WALL_MARGIN + ec.radius;
        ec.vx = Math.abs(ec.vx);
      } else if (ec.x > W - WALL_MARGIN - ec.radius) {
        ec.x = W - WALL_MARGIN - ec.radius;
        ec.vx = -Math.abs(ec.vx);
      }

      ec.trail.push({ x: ec.x, y: ec.y });
      if (ec.trail.length > 8) ec.trail.shift();

      // Echoes shatter prisms, drifters, and supernovas!
      for (const ent of this.entities) {
        if (!ent.alive) continue;
        if (
          ent.kind === 'prism' ||
          ent.kind === 'gold_prism' ||
          ent.kind === 'supernova' ||
          ent.kind === 'drifter'
        ) {
          if (distSq(ec.x, ec.y, ent.x, ent.y) <= Math.pow(ec.radius + ent.radius + 4, 2)) {
            this.shatterEntity(ent, true);
          }
        }
      }
    }
  }

  private updateEntities(dt: number): void {
    const p = this.player;
    const isFever = p.feverTimer > 0;
    const isBlazing = p.blazeTimer > 0 || isFever;

    // Magnet radius from Workshop + Relics + Fever
    const magnetRange =
      42 +
      storage.data.workshop.magnet * 18 +
      this.getRelicCount('prism_magnet') * 62 +
      (isFever ? 95 : 0);

    for (const ent of this.entities) {
      if (!ent.alive) continue;

      ent.angle += ent.spinSpeed * dt;
      ent.hitScale = damp(ent.hitScale, 1, 14, dt);

      if (ent.patrolAmp > 0) {
        ent.x = ent.baseX + Math.sin(this.time * ent.patrolSpeed + ent.bobPhase) * ent.patrolAmp;
      }

      // Gravity Pulsar curves player trajectory!
      if (ent.kind === 'pulsar') {
        const dx = ent.x - p.x;
        const dy = ent.y - p.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < 150 * 150 && dSq > 100 && this.hasLaunchedOnce) {
          const d = Math.sqrt(dSq);
          const pull = (1 - d / 150) * 1450 * dt;
          p.vx += (dx / d) * pull;
          p.vy += (dy / d) * pull;
        }
        if (dSq <= Math.pow(p.radius + ent.radius, 2)) {
          // Slingshot boost + full charge refill on center touch!
          p.charges = p.maxCharges;
          p.blazeTimer = Math.max(p.blazeTimer, 0.55);
          p.vy = Math.min(p.vy - 240, -720);
          ent.hitScale = 1.35;
          if (this.phase === 'playing') sound.playBumper(this.panForX(ent.x));
        }
        continue;
      }

      // Magnetic pull on Prisms & Gold Gems!
      if (ent.kind === 'prism' || ent.kind === 'gold_prism') {
        const d = dist(p.x, p.y, ent.x, ent.y);
        if (d < magnetRange && this.hasLaunchedOnce) {
          const pullSpeed = lerp(680, 220, d / magnetRange);
          ent.x += ((p.x - ent.x) / Math.max(1, d)) * pullSpeed * dt;
          ent.y += ((p.y - ent.y) / Math.max(1, d)) * pullSpeed * dt;
        }
      }

      // Cloud-Pad Bounce (One-way platform when falling or landing!)
      if (ent.kind === 'cloud_pad') {
        const halfW = (ent.width || 96) * 0.5 + p.radius * 0.6;
        if (
          p.vy >= 0 &&
          Math.abs(p.x - ent.x) <= halfW &&
          Math.abs(p.y + p.radius - ent.y) <= 18
        ) {
          p.y = ent.y - p.radius;
          p.vy = -780;
          p.charges = p.maxCharges;
          p.squashX = 1.35;
          p.squashY = 0.68;
          ent.hitScale = 1.28;

          // Banking air combo safely when touching a Cloud-Pad (unless in Fever!)
          if (this.combo >= 4 && !isFever && this.phase === 'playing') {
            const bankBonus = this.combo * 35;
            this.score += bankBonus;
            this.addFloatingText(p.x, p.y - 26, `STREAK BANKED +${bankBonus}`, `${this.combo}x`, '#7dd3fc', 1.0);
            this.combo = 0;
          } else if (!isFever) {
            this.combo = 0;
          }

          if (this.phase === 'playing') {
            sound.playCloudBounce(this.panForX(ent.x));
            this.triggerCloudNovaIfUnlocked(ent.x, ent.y);
          }
          this.spawnBurst(ent.x, ent.y, 10, '#bae6fd', 150);
        }
        continue;
      }

      // Circle-Circle Collision with Player
      const hitDist = p.radius + ent.radius + (isBlazing ? 5 : 0);
      if (distSq(p.x, p.y, ent.x, ent.y) > hitDist * hitDist) continue;

      switch (ent.kind) {
        case 'prism':
        case 'gold_prism':
        case 'supernova': {
          this.shatterEntity(ent, false);
          break;
        }

        case 'bumper': {
          const nx = (p.x - ent.x) / Math.max(1, dist(p.x, p.y, ent.x, ent.y));
          const ny = (p.y - ent.y) / Math.max(1, dist(p.x, p.y, ent.x, ent.y));
          p.vx = nx * 780;
          p.vy = Math.min(-520, ny * 880);
          p.charges = p.maxCharges;
          p.blazeTimer = Math.max(p.blazeTimer, 0.5);
          ent.hitScale = 1.42;
          this.score += 50;
          this.spawnBurst(ent.x, ent.y, 12, '#f472b6', 200);
          if (this.phase === 'playing') {
            sound.playBumper(this.panForX(ent.x));
            this.triggerCloudNovaIfUnlocked(ent.x, ent.y);
          }
          break;
        }

        case 'drifter':
        case 'shield_knight': {
          if (ent.kind === 'shield_knight' && !isFever) {
            const incomingAng = Math.atan2(p.y - ent.y, p.x - ent.x);
            const diff = Math.abs(normalizeAngle(incomingAng - ent.angle));
            if (diff < Math.PI * 0.42) {
              // Bounced off Knight's shield! Refills 1 charge so player can bank-shot over it!
              p.vx = Math.cos(incomingAng) * 520;
              p.vy = Math.sin(incomingAng) * 520;
              p.charges = Math.min(p.maxCharges, p.charges + 1);
              ent.hitScale = 1.3;
              if (this.phase === 'playing') {
                sound.playShieldDeflect(this.panForX(ent.x));
                this.addFloatingText(ent.x, ent.y - 24, 'SHIELDED!', 'STRIKE FROM ABOVE', '#fbbf24', 0.95);
              }
              break;
            }
          }

          if (isBlazing || p.vy < -220) {
            this.shatterEntity(ent, false);
            // Slight upward bounce reward on enemy smash!
            p.vy = Math.min(p.vy, -540);
          } else {
            this.handleHazardHit(ent);
          }
          break;
        }

        case 'plasma_hazard': {
          if (isFever) {
            // Rainbow Supernova Fever obliterates even Red Plasma Hazards!
            ent.alive = false;
            this.score += 200;
            this.spawnBurst(ent.x, ent.y, 16, '#fde047', 260);
            if (this.phase === 'playing') sound.playEnemySmash(this.combo, this.panForX(ent.x));
          } else {
            this.handleHazardHit(ent);
          }
          break;
        }
      }
    }

    // Generate new setpieces ahead & prune far-below entities
    if (this.worldGen.generatedTopY > this.cameraY - 950 && (!this.boss || !this.boss.active)) {
      const added = this.worldGen.generateUpTo(
        this.cameraY - 950,
        this.startY,
        this.renderer.logicalWidth,
        this.getGoldChanceBonus(),
        this.mode === 'zen' || this.phase === 'attract'
      );
      this.entities.push(...added);
    }

    const cullY = this.cameraY + this.renderer.logicalHeight + 480;
    if (this.entities.length > 90) {
      this.entities = this.entities.filter((e) => e.alive && e.y < cullY);
    }
  }

  private triggerCloudNovaIfUnlocked(x: number, y: number): void {
    const stacks = this.getRelicCount('cloud_nova');
    if (stacks <= 0) return;
    const rad = 165 + stacks * 55;
    this.spawnShockwave(x, y, rad, '#67e8f9', 4);
    for (const e of this.entities) {
      if (!e.alive || e.y > y) continue;
      if (
        (e.kind === 'prism' || e.kind === 'gold_prism' || e.kind === 'drifter' || e.kind === 'supernova') &&
        distSq(x, y, e.x, e.y) <= rad * rad
      ) {
        this.shatterEntity(e, true);
      }
    }
  }

  private shatterEntity(ent: WorldEntity, fromSecondaryEffect: boolean): void {
    if (!ent.alive) return;
    ent.alive = false;

    const p = this.player;
    const pan = this.panForX(ent.x);
    const spirit = getSpiritById(storage.data.selectedSpirit);

    // Refund sling charge & extend blaze slightly!
    p.charges = Math.min(p.maxCharges, p.charges + 1);
    if (!fromSecondaryEffect) {
      p.blazeTimer = Math.max(p.blazeTimer, 0.34);
    }

    // Combo progression
    const isGold = ent.kind === 'gold_prism';
    const goldComboBonus = isGold && this.getRelicCount('midas_wake') > 0 ? 1 : 0;
    this.combo += 1 + goldComboBonus;

    // Bank-Shot Trick Bonus!
    let trickMult = 1;
    if (!fromSecondaryEffect && p.bankWindowTimer > 0) {
      p.bankWindowTimer = 0;
      const pinballStacks = this.getRelicCount('pinball_king');
      this.combo += 1 + pinballStacks * 2;
      trickMult = 2;
      this.bankShotsRun++;
      storage.data.stats.totalBankShots++;
      if (this.phase === 'playing') {
        sound.playBankBonus(pan);
        this.addFloatingText(ent.x, ent.y - 26, 'BANK SHOT! 2x', `${this.combo}x STREAK`, '#34d399', 1.18);
      }
    }

    if (this.combo > this.maxComboRun) this.maxComboRun = this.combo;
    if (this.combo > storage.data.stats.highestCombo && this.phase === 'playing') {
      storage.data.stats.highestCombo = this.combo;
    }

    // Trigger Rainbow Supernova Fever!
    if (this.combo >= this.getFeverThreshold() && p.feverTimer <= 0 && this.phase === 'playing') {
      p.maxFever = this.getFeverMaxDuration();
      p.feverTimer = p.maxFever;
      this.flashColor = '#fde047';
      this.flashAlpha = 0.38;
      this.spawnShockwave(p.x, p.y, 190, '#fde047', 5);
      this.addFloatingText(p.x, p.y - 38, 'SUPERNOVA FEVER!', 'INVINCIBLE 2x SCORE', '#fde047', 1.32);
      sound.playFeverStart();

      // Blitz mode rewards +2.5s bonus time on Fever trigger!
      if (this.mode === 'blitz') {
        this.blitzTimer += 2.5;
        this.addFloatingText(p.x, p.y - 65, '+2.5s TIME!', undefined, '#38bdf8', 1.1);
      }
    } else if (p.feverTimer > 0) {
      // Hits during Fever top off a tiny fraction of Fever!
      p.feverTimer = Math.min(p.maxFever, p.feverTimer + 0.18);
    }

    const feverMult = p.feverTimer > 0 ? 2 : 1;
    const lumaBonus = spirit.id === 'luma' ? 1.1 : 1.0;

    if (ent.kind === 'supernova') {
      this.supernovasRun++;
      this.detonateSupernova(ent.x, ent.y, 175);
      return;
    }

    if (ent.kind === 'drifter' || ent.kind === 'shield_knight') {
      this.enemiesRun++;
      const pts = Math.round(140 * Math.max(1, this.combo * 0.45) * trickMult * feverMult * lumaBonus);
      this.score += pts;
      this.stardustRun += 3;
      this.hitStopTimer = Math.max(this.hitStopTimer, 0.024);
      this.addShake(0.24);
      this.spawnBurst(ent.x, ent.y, 16, '#c084fc', 230);
      if (this.phase === 'playing') {
        sound.playEnemySmash(this.combo, pan);
        this.addFloatingText(ent.x, ent.y - 14, `+${pts}`, `${this.combo}x`, '#e879f9', 1.05);
      }
    } else {
      // Prism or Gold Crown-Gem
      this.prismsRun++;
      storage.data.stats.totalPrisms++;
      const basePts = isGold ? 120 : 45;
      const pts = Math.round(basePts * (1 + this.combo * 0.25) * trickMult * feverMult * lumaBonus);
      this.score += pts;
      this.stardustRun += isGold ? 4 : 1;

      this.spawnBurst(ent.x, ent.y, isGold ? 14 : 9, isGold ? '#fde047' : '#38bdf8', 185);
      if (this.phase === 'playing') {
        sound.playPrismHit(this.combo, pan, isGold);
        if (trickMult === 1 && (isGold || this.combo >= 3)) {
          this.addFloatingText(
            ent.x,
            ent.y - 12,
            isGold ? `+${pts} ★` : `${this.combo}x`,
            undefined,
            isGold ? '#fde047' : '#7dd3fc',
            isGold ? 1.05 : 0.92
          );
        }
      }
    }

    // Relic: Solar Core (every 6th air hit triggers a radial blast!)
    const solarStacks = this.getRelicCount('supernova_heart');
    if (solarStacks > 0 && this.combo > 0 && this.combo % 6 === 0 && !fromSecondaryEffect) {
      this.detonateSupernova(p.x, p.y, 125 + solarStacks * 35);
    }

    // Relic: Arc Conduit (Chain Lightning!)
    const chainStacks = this.getRelicCount('chain_spark');
    if (chainStacks > 0 && !fromSecondaryEffect) {
      let zapsLeft = chainStacks + 1;
      for (const other of this.entities) {
        if (zapsLeft <= 0) break;
        if (!other.alive || other === ent) continue;
        if (other.kind === 'prism' || other.kind === 'gold_prism' || other.kind === 'drifter') {
          if (distSq(ent.x, ent.y, other.x, other.y) <= 155 * 155) {
            this.lightnings.push({
              x1: ent.x,
              y1: ent.y,
              x2: other.x,
              y2: other.y,
              color: '#22d3ee',
              life: 0.22,
              maxLife: 0.22,
            });
            this.shatterEntity(other, true);
            zapsLeft--;
          }
        }
      }
    }
  }

  private detonateSupernova(cx: number, cy: number, blastRadius: number): void {
    this.hitStopTimer = 0.042;
    this.addShake(0.55);
    this.flashColor = '#fde047';
    this.flashAlpha = 0.28;
    this.spawnShockwave(cx, cy, blastRadius * 1.15, '#fb923c', 6);
    this.spawnShockwave(cx, cy, blastRadius * 0.75, '#fde047', 3.5);
    this.spawnBurst(cx, cy, 28, '#fde047', 320);
    this.spawnBurst(cx, cy, 18, '#fb923c', 240);

    if (this.phase === 'playing') {
      sound.playSupernova(this.panForX(cx));
      this.addFloatingText(cx, cy - 22, 'SUPERNOVA!', undefined, '#fde047', 1.25);
    }

    // Boost player skyward if close to blast!
    if (dist(this.player.x, this.player.y, cx, cy) < blastRadius * 1.15) {
      this.player.vy = Math.min(this.player.vy, -880);
      this.player.charges = this.player.maxCharges;
      this.player.blazeTimer = Math.max(this.player.blazeTimer, 0.65);
    }

    // Chain-shatter everything inside blast radius (including hazards!)
    for (const other of this.entities) {
      if (!other.alive) continue;
      if (distSq(cx, cy, other.x, other.y) <= blastRadius * blastRadius) {
        if (other.kind === 'plasma_hazard') {
          other.alive = false;
          this.score += 120;
          this.spawnBurst(other.x, other.y, 10, '#fb7185', 180);
        } else if (other.kind !== 'cloud_pad' && other.kind !== 'bumper' && other.kind !== 'pulsar') {
          this.shatterEntity(other, true);
        }
      }
    }
  }

  private handleHazardHit(hazard: WorldEntity): void {
    const p = this.player;
    if (p.invulnTimer > 0 || this.mode === 'zen' || this.phase === 'attract') return;

    if (p.hasShield) {
      // Bubble Shield saves the player with a heroic shockwave!
      p.hasShield = false;
      p.invulnTimer = 1.4;
      p.vy = -760;
      p.charges = p.maxCharges;
      hazard.alive = false;

      this.hitStopTimer = 0.04;
      this.addShake(0.42);
      this.flashColor = '#fde047';
      this.flashAlpha = 0.35;
      this.spawnShockwave(p.x, p.y, 160, '#fde047', 5);
      this.spawnBurst(p.x, p.y, 20, '#fde047', 240);
      sound.playShieldSaved();
      this.addFloatingText(p.x, p.y - 28, 'SHIELD SAVED!', undefined, '#fde047', 1.2);
      return;
    }

    if (this.mode === 'blitz') {
      // In 60s Blitz, hitting plasma deducts 4s and bounces you instead of ending run early!
      p.invulnTimer = 1.1;
      p.vy = -520;
      this.combo = 0;
      this.blitzTimer = Math.max(0.5, this.blitzTimer - 4);
      hazard.alive = false;
      this.addShake(0.35);
      this.flashColor = '#f43f5e';
      this.flashAlpha = 0.3;
      sound.playShieldDeflect(this.panForX(hazard.x));
      this.addFloatingText(p.x, p.y - 24, '-4.0s!', 'STREAK LOST', '#fb7185', 1.15);
      return;
    }

    // Fatal hit in Odyssey / Daily
    this.finishRun();
  }

  private updateBossEncounter(dt: number): void {
    const boss = this.boss;
    if (!boss || !boss.active) return;

    const W = this.renderer.logicalWidth;
    const p = this.player;
    const { spawnPulse } = updateBoss(boss, dt, W);

    // Keep rechargeable side prisms & safety floor cloud pads alive during Boss Fight!
    if (spawnPulse) {
      const spread = Math.min(180, W * 0.27);
      for (let i = -1; i <= 1; i++) {
        this.entities.push(
          makeEntity(
            i === 0 ? 'gold_prism' : 'prism',
            W * 0.5 + i * spread,
            boss.y + 165 + Math.abs(i) * 30,
            this.rng
          )
        );
      }
    }

    // Check collision with Orbiting Crystal Locks
    for (const lock of boss.locks) {
      if (!lock.alive) continue;
      const lx = boss.x + Math.cos(lock.angleOffset) * lock.dist;
      const ly = boss.y + Math.sin(lock.angleOffset) * lock.dist;
      if (distSq(p.x, p.y, lx, ly) <= Math.pow(p.radius + 15, 2)) {
        lock.alive = false;
        lock.respawnTimer = 6.5;
        p.charges = p.maxCharges;
        p.blazeTimer = Math.max(p.blazeTimer, 0.45);
        this.combo++;
        this.score += 250;
        this.spawnBurst(lx, ly, 14, '#38bdf8', 210);
        sound.playPrismHit(this.combo + 3, this.panForX(lx), true);
        this.addFloatingText(lx, ly - 15, 'LOCK SHATTERED!', '+250', '#38bdf8', 1.0);
      }
    }

    // Check collision with Boss Core
    const dToBoss = dist(p.x, p.y, boss.x, boss.y);
    if (dToBoss <= p.radius + boss.radius && boss.invulnTimer <= 0) {
      const incomingAngle = Math.atan2(p.y - boss.y, p.x - boss.x);
      const blocked = p.feverTimer <= 0 && isAngleBlockedByBossShield(boss, incomingAngle);

      if (blocked) {
        p.vx = Math.cos(incomingAngle) * 620;
        p.vy = Math.sin(incomingAngle) * 620;
        p.charges = p.maxCharges;
        sound.playShieldDeflect(this.panForX(boss.x));
        this.addFloatingText(boss.x, boss.y + 52, 'AEGIS SHIELD!', 'BANK BEHIND IT', '#fbbf24', 1.0);
      } else {
        // Direct hit on Boss Core!!
        boss.hp -= 1;
        boss.invulnTimer = 0.42;
        boss.flashTimer = 0.22;

        p.vx = Math.cos(incomingAngle) * 580;
        p.vy = Math.min(-560, Math.sin(incomingAngle) * 680);
        p.charges = p.maxCharges;
        p.blazeTimer = 0.5;

        this.combo += 2;
        this.score += 600;
        this.hitStopTimer = 0.048;
        this.addShake(0.5);
        this.spawnShockwave(boss.x, boss.y, 140, '#f472b6', 5);
        this.spawnBurst(boss.x, boss.y, 22, '#fde047', 260);
        sound.playBossHit();
        this.addFloatingText(boss.x, boss.y - 25, 'CRITICAL STRIKE!', '+600', '#fde047', 1.22);

        if (boss.hp <= 0) {
          this.onBossDefeated(boss);
        }
      }
    }
  }

  private onBossDefeated(boss: BossState): void {
    boss.active = false;
    this.boss = null;
    this.bossesRun++;
    storage.data.stats.bossesDefeated++;

    this.score += 2500;
    this.stardustRun += 45;
    this.hitStopTimer = 0.08;
    this.addShake(0.85);
    this.flashColor = '#ffffff';
    this.flashAlpha = 0.55;

    this.spawnShockwave(boss.x, boss.y, 260, '#fde047', 7);
    this.spawnShockwave(boss.x, boss.y, 180, '#f472b6', 5);
    this.spawnBurst(boss.x, boss.y, 45, '#fde047', 360);
    sound.playBossDefeat();
    this.addFloatingText(boss.x, boss.y, 'TITAN VANQUISHED!', '+2,500 PTS', '#fde047', 1.4);

    // Shower of celebratory Gold Crown-Gems above!
    const W = this.renderer.logicalWidth;
    for (let i = 0; i < 12; i++) {
      const ang = -Math.PI * 0.9 + (i / 11) * Math.PI * 0.8;
      const rad = 70 + (i % 3) * 42;
      this.entities.push(
        makeEntity('gold_prism', clamp(boss.x + Math.cos(ang) * rad, 55, W - 55), boss.y - 60 + Math.sin(ang) * rad, this.rng)
      );
    }

    // Rocket player upward & resume world generation right above boss arena!
    this.worldGen.generatedTopY = Math.min(this.worldGen.generatedTopY, boss.y - 180);
    this.player.vy = -1050;
    this.player.feverTimer = Math.max(this.player.feverTimer, 4.5);
    this.player.maxFever = Math.max(this.player.maxFever, 4.5);

    this.checkLiveAchievements();
  }

  private updateCameraAndTide(simDt: number, realDt: number): void {
    const H = this.renderer.logicalHeight;
    const targetCamY = Math.min(this.cameraY, this.player.y - H * 0.54);

    if (this.boss && this.boss.active) {
      const bossCamY = this.boss.baseY - 145;
      this.cameraY = damp(this.cameraY, bossCamY, 5.5, realDt);
    } else {
      // Smooth upward tracking; allow slight downward peek only in Zen/Attract so player doesn't fall off screen
      if (this.mode === 'zen' || this.phase === 'attract') {
        const zenTarget = this.player.y - H * 0.56;
        this.cameraY = damp(this.cameraY, zenTarget, 6.5, realDt);
        // Prevent falling endlessly in Zen by placing a soft cloud if falling far
        if (this.player.y > this.cameraY + H - 90 && this.player.vy > 0) {
          this.player.vy = -840;
          this.player.charges = this.player.maxCharges;
          this.spawnBurst(this.player.x, this.player.y, 12, '#7dd3fc', 160);
        }
      } else if (this.mode === 'blitz') {
        // Blitz also has a bouncy stardust updraft at bottom of camera so pace stays 100% non-stop!
        this.cameraY = damp(this.cameraY, targetCamY, 7.5, realDt);
        if (this.player.y > this.cameraY + H - 60 && this.player.vy > 0) {
          this.player.vy = -860;
          this.player.charges = this.player.maxCharges;
          this.combo = 0;
          sound.playCloudBounce(0);
          this.spawnBurst(this.player.x, this.player.y, 12, '#38bdf8', 170);
        }
      } else {
        this.cameraY = damp(this.cameraY, targetCamY, 7.5, realDt);
      }
    }

    // Rising Eclipse Tide in Odyssey & Daily
    if (this.eclipseY !== null && this.hasLaunchedOnce && this.phase === 'playing') {
      if (this.boss && this.boss.active) {
        // Lock tide safely below Boss Arena Sanctuary Floor!
        this.eclipseY = damp(this.eclipseY, this.boss.arenaFloorY + 95, 4, simDt);
      } else {
        const baseRiseSpeed = 58 + clamp(this.maxMeters / 35, 0, 72);
        this.eclipseY -= baseRiseSpeed * simDt;

        // Rubber-band so tide never trails 900px behind (keeps pleasant tension without unfair jumps)
        const maxLagY = this.cameraY + H + 210;
        if (this.eclipseY > maxLagY) {
          this.eclipseY = lerp(this.eclipseY, maxLagY, 0.08);
        }

        if (this.player.y - this.player.radius > this.eclipseY + 8) {
          if (this.player.hasShield) {
            this.player.hasShield = false;
            this.player.invulnTimer = 1.4;
            this.player.y = this.eclipseY - 40;
            this.player.vy = -1020;
            this.player.charges = this.player.maxCharges;
            this.eclipseY += 140;
            sound.playShieldSaved();
            this.spawnShockwave(this.player.x, this.player.y, 180, '#fde047', 5);
            this.addFloatingText(this.player.x, this.player.y - 30, 'ECLIPSE ESCAPE!', 'SHIELD USED', '#fde047', 1.2);
          } else {
            this.finishRun();
          }
        }
      }
    }
  }

  private checkProgressMilestones(): void {
    // Biome transition check
    const { biome, index } = getBiomeForMeters(this.maxMeters);
    if (index > this.currentBiomeIdx) {
      this.currentBiomeIdx = index;
      this.callbacks.onBiomeBanner(biome.name, biome.subtitle);
    }
    sound.setGameContext(this.currentBiomeIdx, this.player.feverTimer > 0);

    // Boss Milestone Check (Odyssey & Daily)
    if (
      (this.mode === 'odyssey' || this.mode === 'daily') &&
      !this.boss &&
      this.nextBossIdx < BOSS_MILESTONES.length &&
      this.maxMeters >= BOSS_MILESTONES[this.nextBossIdx]
    ) {
      const W = this.renderer.logicalWidth;
      const tier = this.nextBossIdx;
      this.nextBossIdx++;
      this.boss = createBoss(tier, this.player.y, W);

      // Spawn wide bouncy Sanctuary Floor Clouds across the entire boss arena width!
      const padCount = Math.max(3, Math.round(W / 160));
      const padStep = (W - 140) / Math.max(1, padCount - 1);
      for (let i = 0; i < padCount; i++) {
        this.entities.push(
          makeEntity('cloud_pad', 70 + i * padStep, this.boss.arenaFloorY, this.rng, {
            width: 118,
          })
        );
      }
      this.callbacks.onBiomeBanner(`⚔️ ${this.boss.name}`, this.boss.title);
      sound.playGateChime();
      return;
    }

    // Celestial Relic Gate Check (Odyssey & Daily)
    if (
      (this.mode === 'odyssey' || this.mode === 'daily') &&
      (!this.boss || !this.boss.active) &&
      this.maxMeters >= this.nextGateMeters
    ) {
      const reachedMeters = this.nextGateMeters;
      this.nextGateMeters += GATE_STEP_METERS;
      this.cancelAim(false);
      sound.playGateChime();

      // Draft 3 eligible Relics
      const eligible = RELICS.filter((r) => this.getRelicCount(r.id) < r.maxStacks);
      const shuffled = [...eligible];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const choices = shuffled.slice(0, 3);
      if (choices.length > 0) {
        this.phase = 'relic_draft';
        this.callbacks.onRelicDraft(choices, reachedMeters);
      }
    }

    this.checkLiveAchievements();
  }

  private checkLiveAchievements(): void {
    const unlock = (id: string) => {
      if (storage.data.achievements.includes(id)) return;
      const def = ACHIEVEMENTS.find((a) => a.id === id);
      if (!def) return;
      storage.data.achievements.push(id);
      storage.data.stardust += def.reward;
      this.unlockedAchRun.push({ title: def.title, icon: def.icon, reward: def.reward });
      storage.save();
      this.callbacks.onToast(`Trophy Unlocked: ${def.title}`, `+${def.reward} Stardust`, def.icon);
    };

    if (this.maxMeters >= 250) unlock('first_flight');
    if (this.maxComboRun >= 15) unlock('combo_15');
    if (this.maxComboRun >= 30) unlock('combo_30');
    if (this.bankShotsRun >= 5) unlock('bank_5');
    if (this.bossesRun >= 1) unlock('boss_1');
    if (this.maxMeters >= 1000 && (this.mode === 'odyssey' || this.mode === 'daily')) unlock('meters_1000');
    if (this.maxMeters >= 2200) unlock('meters_2200');
    if (this.mode === 'blitz' && this.score >= 25000) unlock('blitz_25k');
  }

  public finishRun(): void {
    if (this.phase === 'gameover') return;
    this.cancelAim(false);
    this.phase = 'gameover';
    sound.playGameOver();

    const save = storage.data;
    const spirit = getSpiritById(save.selectedSpirit);

    // Calculate Stardust earned
    const altitudeDust = Math.floor(this.maxMeters / 16);
    const dailyMult = this.mode === 'daily' && save.dailyPlaysToday <= 1 ? 1.5 : 1.0;
    const workshopMult = 1 + save.workshop.stardustBoost * 0.12;
    const spiritMult = spirit.stardustMult || 1.0;
    const totalStardust = Math.max(
      8,
      Math.round((this.stardustRun + altitudeDust) * dailyMult * workshopMult * spiritMult)
    );

    save.stardust += totalStardust;
    save.stats.totalMeters += this.maxMeters;

    const prevBestScore = save.bestScore[this.mode] || 0;
    const prevBestAlt = save.bestAltitude[this.mode] || 0;
    const isNewBestScore = this.score > prevBestScore;
    const isNewBestAltitude = this.maxMeters > prevBestAlt;

    if (isNewBestScore) save.bestScore[this.mode] = this.score;
    if (isNewBestAltitude) save.bestAltitude[this.mode] = this.maxMeters;

    if (this.mode === 'daily') {
      if (this.score > save.dailyBestScore) save.dailyBestScore = this.score;
      if (this.maxMeters > save.dailyBestAltitude) save.dailyBestAltitude = this.maxMeters;
      if (!save.achievements.includes('daily_hero')) {
        const ach = ACHIEVEMENTS.find((a) => a.id === 'daily_hero')!;
        save.achievements.push('daily_hero');
        save.stardust += ach.reward;
        this.unlockedAchRun.push({ title: ach.title, icon: ach.icon, reward: ach.reward });
      }
    }

    // Evaluate Active Missions!
    for (let i = 0; i < save.missions.length; i++) {
      const m = save.missions[i];
      let val = 0;
      switch (m.type) {
        case 'prisms': val = this.prismsRun; break;
        case 'bankShots': val = this.bankShotsRun; break;
        case 'maxCombo': val = this.maxComboRun; break;
        case 'altitude': val = this.maxMeters; break;
        case 'supernovas': val = this.supernovasRun; break;
        case 'enemies': val = this.enemiesRun; break;
      }
      m.progress = m.singleRun ? Math.max(m.progress, val) : m.progress + val;
      if (m.progress >= m.target) {
        save.stardust += m.reward;
        save.missionsCompletedCount++;
        this.completedMissionsRun.push({ title: m.title, reward: m.reward });
        const activeTypes = save.missions.filter((_, idx) => idx !== i).map((x) => x.type);
        save.missions[i] = createMission(save.missionsCompletedCount + i + 3, activeTypes);
      }
    }

    storage.save();

    const summary: RunSummary = {
      mode: this.mode,
      score: this.score,
      bestScore: save.bestScore[this.mode],
      isNewBestScore,
      altitude: this.maxMeters,
      bestAltitude: save.bestAltitude[this.mode],
      isNewBestAltitude,
      maxCombo: this.maxComboRun,
      prismsShattered: this.prismsRun,
      bankShots: this.bankShotsRun,
      supernovas: this.supernovasRun,
      enemiesSmashed: this.enemiesRun,
      bossesDefeated: this.bossesRun,
      stardustEarned: totalStardust,
      relicsCollected: [...this.relicOrder],
      completedMissions: this.completedMissionsRun,
      unlockedAchievements: this.unlockedAchRun,
    };

    this.callbacks.onRunOver(summary);
  }

  private updateEffects(dt: number): void {
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.65);
    this.flashAlpha = damp(this.flashAlpha, 0, 9, dt);
    this.displayScore = damp(this.displayScore, this.score, 14, dt);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy += pt.gravity * dt;
      pt.vx *= 1 - pt.drag * dt;
      pt.vy *= 1 - pt.drag * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      if (sw.life <= 0) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const t = 1 - sw.life / sw.maxLife;
      sw.radius = sw.maxRadius * (1 - Math.pow(1 - t, 3));
    }

    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      this.lightnings[i].life -= dt;
      if (this.lightnings[i].life <= 0) this.lightnings.splice(i, 1);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      ft.y += ft.vy * dt;
      ft.vy *= 0.94;
    }

    for (let i = this.wallRipples.length - 1; i >= 0; i--) {
      this.wallRipples[i].life -= dt;
      if (this.wallRipples[i].life <= 0) this.wallRipples.splice(i, 1);
    }
  }

  private spawnBurst(x: number, y: number, count: number, color: string, maxSpeed: number): void {
    if (this.particles.length > 220) count = Math.min(count, 6);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * maxSpeed;
      const life = 0.3 + Math.random() * 0.38;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 2.2 + Math.random() * 3.4,
        color,
        alpha: 0.95,
        life,
        maxLife: life,
        drag: 2.8,
        gravity: 260,
      });
    }
  }

  private spawnShockwave(
    x: number,
    y: number,
    maxRadius: number,
    color: string,
    lineWidth: number
  ): void {
    this.shockwaves.push({
      x,
      y,
      radius: 8,
      maxRadius,
      color,
      lineWidth,
      life: 0.36,
      maxLife: 0.36,
    });
  }

  private addFloatingText(
    x: number,
    y: number,
    text: string,
    subtext: string | undefined,
    color: string,
    scale = 1
  ): void {
    if (this.phase === 'attract') return;
    if (this.floatingTexts.length > 14) this.floatingTexts.shift();
    this.floatingTexts.push({
      x: clamp(x, 65, this.renderer.logicalWidth - 65),
      y,
      vy: -68,
      text,
      subtext,
      color,
      scale,
      life: 0.88,
      maxLife: 0.88,
    });
  }

  private addShake(amount: number): void {
    if (this.phase === 'attract') return;
    const mult = storage.data.settings.reducedShake ? 0.25 : 1.0;
    this.shakeTrauma = clamp(this.shakeTrauma + amount * mult, 0, 1);
  }

  private panForX(x: number): number {
    return ((x / Math.max(1, this.renderer.logicalWidth)) * 2 - 1) * 0.75;
  }

  private emitHud(): void {
    const { biome } = getBiomeForMeters(this.maxMeters);
    const p = this.player;
    const isFever = p.feverTimer > 0;
    const feverRatio = isFever
      ? p.feverTimer / Math.max(0.1, p.maxFever)
      : clamp(this.combo / this.getFeverThreshold(), 0, 1);

    this.callbacks.onHudUpdate({
      mode: this.mode,
      score: Math.round(this.score),
      meters: this.maxMeters,
      combo: this.combo,
      feverRatio,
      isFever,
      stardustRun: this.stardustRun,
      blitzTimeLeft: this.blitzTimer,
      biomeName: biome.name,
      relicStacks: { ...this.relicStacks },
      bossActive: Boolean(this.boss && this.boss.active),
    });
  }

  private renderCurrentFrame(): void {
    const shakeMag = this.shakeTrauma * this.shakeTrauma * 14;
    const shakeX = (Math.random() * 2 - 1) * shakeMag;
    const shakeY = (Math.random() * 2 - 1) * shakeMag;

    const snap: RenderSnapshot = {
      time: this.time,
      cameraY: this.cameraY,
      startY: this.startY,
      viewHeight: this.renderer.logicalHeight,
      meters: this.maxMeters,
      nextGateMeters:
        this.mode === 'odyssey' || this.mode === 'daily' ? this.nextGateMeters : null,
      eclipseY: this.eclipseY,
      chronoBlend: this.chronoBlend,
      shakeX,
      shakeY,
      flashAlpha: this.flashAlpha,
      flashColor: this.flashColor,
      spirit: getSpiritById(storage.data.selectedSpirit),
      player: this.player,
      aim: this.aim,
      launchSpeed: this.getLaunchSpeed(this.aim.pullRatio),
      maxBouncesPreview: 1 + this.getRelicCount('chrono_lens'),
      entities: this.entities,
      echoes: this.echoes,
      particles: this.particles,
      shockwaves: this.shockwaves,
      lightnings: this.lightnings,
      floatingTexts: this.floatingTexts,
      wallRipples: this.wallRipples,
      boss: this.boss,
      showLaunchHint: !this.hasLaunchedOnce && this.phase === 'playing',
      isAttractMode: this.phase === 'attract',
    };

    this.renderer.render(snap);
  }
}
