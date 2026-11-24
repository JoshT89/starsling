import {
  WALL_MARGIN,
  MIN_PORTRAIT_WIDTH,
  BASE_VIEW_HEIGHT,
  PIXELS_PER_METER,
  GRAVITY,
  AIR_DRAG,
  WALL_BOUNCE_RESTITUTION,
} from '../core/constants';
import { clamp, hexToRgba, lerp, lerpColor } from '../core/math';
import { BIOMES, BiomeTheme } from '../data/biomes';
import { SpiritDef } from '../data/spirits';
import {
  AimState,
  BossState,
  EchoProjectile,
  FloatingText,
  LightningArc,
  Particle,
  PlayerState,
  Shockwave,
  WallRipple,
  WorldEntity,
} from './types';

interface BgStar {
  x: number;
  y: number;
  size: number;
  depth: number;
  twinklePhase: number;
}

export interface RenderSnapshot {
  time: number;
  cameraY: number;
  startY: number;
  viewHeight: number;
  meters: number;
  nextGateMeters: number | null;
  eclipseY: number | null;
  chronoBlend: number;
  shakeX: number;
  shakeY: number;
  flashAlpha: number;
  flashColor: string;
  spirit: SpiritDef;
  player: PlayerState;
  aim: AimState;
  launchSpeed: number;
  maxBouncesPreview: number;
  entities: WorldEntity[];
  echoes: EchoProjectile[];
  particles: Particle[];
  shockwaves: Shockwave[];
  lightnings: LightningArc[];
  floatingTexts: FloatingText[];
  wallRipples: WallRipple[];
  boss: BossState | null;
  showLaunchHint: boolean;
  isAttractMode: boolean;
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stars: BgStar[] = [];
  public logicalWidth = MIN_PORTRAIT_WIDTH;
  public logicalHeight = BASE_VIEW_HEIGHT;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D context unavailable');
    this.ctx = context;
    this.initStars();
    this.resize();
  }

  private initStars(): void {
    this.stars = [];
    // Normalized 0..1 star coordinates so starfield seamlessly covers ANY screen size or aspect ratio
    for (let i = 0; i < 140; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.75 + Math.random() * 2.1,
        depth: 0.08 + Math.random() * 0.35,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  public resize(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width || window.innerWidth || 430);
    const cssH = Math.max(1, rect.height || window.innerHeight || 820);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    const aspect = cssW / cssH;
    if (aspect * BASE_VIEW_HEIGHT < MIN_PORTRAIT_WIDTH) {
      // Portrait phone: lock width to 430u and expand vertical height to exact screen aspect
      this.logicalWidth = MIN_PORTRAIT_WIDTH;
      this.logicalHeight = MIN_PORTRAIT_WIDTH / aspect;
    } else {
      // Tablet, square, or wide landscape: keep 820u vertical sightline and expand width to exact screen aspect
      this.logicalHeight = BASE_VIEW_HEIGHT;
      this.logicalWidth = BASE_VIEW_HEIGHT * aspect;
    }

    const targetPixelW = Math.max(1, Math.round(cssW * this.dpr));
    const targetPixelH = Math.max(1, Math.round(cssH * this.dpr));
    if (this.canvas.width !== targetPixelW || this.canvas.height !== targetPixelH) {
      this.canvas.width = targetPixelW;
      this.canvas.height = targetPixelH;
    }

    return { width: this.logicalWidth, height: this.logicalHeight };
  }

  public clientToLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / Math.max(1, rect.width);
    const ny = (clientY - rect.top) / Math.max(1, rect.height);
    return {
      x: nx * this.logicalWidth,
      y: ny * this.logicalHeight,
    };
  }

  private getBlendedBiome(meters: number): {
    top: string;
    mid: string;
    bot: string;
    auroraL: string;
    auroraR: string;
    nebulaA: string;
    theme: BiomeTheme;
  } {
    let idx = 0;
    for (let i = BIOMES.length - 1; i >= 0; i--) {
      if (meters >= BIOMES[i].minMeters) {
        idx = i;
        break;
      }
    }
    const curr = BIOMES[idx];
    const next = BIOMES[Math.min(idx + 1, BIOMES.length - 1)];
    if (curr === next) {
      return {
        top: curr.skyTop,
        mid: curr.skyMid,
        bot: curr.skyBottom,
        auroraL: curr.auroraLeft,
        auroraR: curr.auroraRight,
        nebulaA: curr.nebulaA,
        theme: curr,
      };
    }
    const span = Math.max(1, next.minMeters - curr.minMeters);
    const t = clamp((meters - curr.minMeters - span * 0.65) / (span * 0.35), 0, 1);
    return {
      top: lerpColor(curr.skyTop, next.skyTop, t),
      mid: lerpColor(curr.skyMid, next.skyMid, t),
      bot: lerpColor(curr.skyBottom, next.skyBottom, t),
      auroraL: lerpColor(curr.auroraLeft, next.auroraLeft, t),
      auroraR: lerpColor(curr.auroraRight, next.auroraRight, t),
      nebulaA: lerpColor(curr.nebulaA, next.nebulaA, t),
      theme: curr,
    };
  }

  public render(snap: RenderSnapshot): void {
    const ctx = this.ctx;
    const W = this.logicalWidth;
    const H = this.logicalHeight;

    ctx.save();
    ctx.setTransform(
      this.canvas.width / W,
      0,
      0,
      this.canvas.height / H,
      0,
      0
    );

    const palette = this.getBlendedBiome(snap.meters);

    // 1. Painterly Sky Gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, palette.top);
    skyGrad.addColorStop(0.55, palette.mid);
    skyGrad.addColorStop(1, palette.bot);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // 2. Soft Atmospheric Nebula & Distant Crescent Moon
    this.drawBackdropAtmosphere(ctx, W, H, snap, palette.nebulaA, palette.auroraR);

    // Apply Camera Shake
    ctx.save();
    ctx.translate(snap.shakeX, snap.shakeY);

    // 3. Aurora Ricochet Walls (Screen-space X, World-space wave)
    this.drawAuroraWalls(ctx, W, H, snap, palette.auroraL, palette.auroraR);

    // World Space Transform
    ctx.save();
    ctx.translate(0, -snap.cameraY);

    // 4. Upcoming Celestial Gate Beam
    if (snap.nextGateMeters !== null && !snap.isAttractMode) {
      const gateWorldY = snap.startY - snap.nextGateMeters * PIXELS_PER_METER;
      if (gateWorldY > snap.cameraY - 120 && gateWorldY < snap.cameraY + H + 120) {
        this.drawCelestialGateLine(ctx, W, gateWorldY, snap.nextGateMeters, snap.time);
      }
    }

    // 5. Shockwaves & Lightning Arcs (Behind entities)
    this.drawShockwaves(ctx, snap.shockwaves);
    this.drawLightnings(ctx, snap.lightnings);

    // 6. World Entities
    for (const ent of snap.entities) {
      if (!ent.alive) continue;
      if (ent.y < snap.cameraY - 90 || ent.y > snap.cameraY + H + 90) continue;
      this.drawEntity(ctx, ent, snap.time);
    }

    // 7. Boss Encounter
    if (snap.boss && snap.boss.active) {
      this.drawBoss(ctx, snap.boss, snap.time);
    }

    // 8. Trajectory Sightline (When Aiming)
    if (snap.aim.active && !snap.aim.canceled && !snap.isAttractMode) {
      this.drawTrajectoryPreview(ctx, snap);
    }

    // 9. Twin Echo Projectiles
    this.drawEchoes(ctx, snap.echoes);

    // 10. Player Comet Ribbon + Spirit Character + Orbiting Charges
    this.drawPlayerTrail(ctx, snap.player, snap.spirit, snap.time);
    this.drawPlayerSpirit(ctx, snap.player, snap.spirit, snap.aim, snap.time);

    // 11. Particles & Floating Score/Combo Callouts
    this.drawParticles(ctx, snap.particles);
    this.drawFloatingTexts(ctx, snap.floatingTexts);

    // 12. Rising Eclipse Void Tide
    if (snap.eclipseY !== null) {
      this.drawEclipseTide(ctx, W, H, snap.cameraY, snap.eclipseY, snap.time);
    }

    ctx.restore(); // end world space
    ctx.restore(); // end camera shake

    // 13. Screen-Space Overlays: Bullet-time Vignette, Tide Danger Glow, Thumb Tether, Tutorial Hint
    if (snap.chronoBlend > 0.02) {
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.24, W * 0.5, H * 0.5, H * 0.72);
      vig.addColorStop(0, 'rgba(14, 165, 233, 0)');
      vig.addColorStop(1, `rgba(12, 18, 56, ${0.46 * snap.chronoBlend})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }

    if (snap.eclipseY !== null && !snap.isAttractMode) {
      const distToTide = snap.eclipseY - (snap.player.y + snap.player.radius);
      if (distToTide < 320) {
        const danger = clamp(1 - distToTide / 320, 0, 1);
        const dGrad = ctx.createLinearGradient(0, H - 150, 0, H);
        dGrad.addColorStop(0, 'rgba(168, 85, 247, 0)');
        dGrad.addColorStop(1, `rgba(225, 29, 72, ${0.42 * danger * (0.7 + 0.3 * Math.sin(snap.time * 10))})`);
        ctx.fillStyle = dGrad;
        ctx.fillRect(0, H - 150, W, 150);
      }
    }

    if (snap.aim.active && !snap.isAttractMode) {
      this.drawThumbSlingshotWidget(ctx, snap.aim);
    }

    if (snap.showLaunchHint && !snap.aim.active && !snap.isAttractMode) {
      this.drawInteractiveLaunchHint(ctx, W, H, snap.time);
    }

    if (snap.flashAlpha > 0.01) {
      ctx.fillStyle = hexToRgba(snap.flashColor, snap.flashAlpha);
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  private drawBackdropAtmosphere(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    snap: RenderSnapshot,
    nebulaA: string,
    nebulaB: string
  ): void {
    // Soft glowing nebula clouds
    const driftY = ((-snap.cameraY * 0.08) % (H + 400) + (H + 400)) % (H + 400) - 200;
    const neb1 = ctx.createRadialGradient(W * 0.25, driftY, 10, W * 0.25, driftY, 210);
    neb1.addColorStop(0, hexToRgba(nebulaA, 0.16));
    neb1.addColorStop(1, hexToRgba(nebulaA, 0));
    ctx.fillStyle = neb1;
    ctx.fillRect(0, 0, W, H);

    const driftY2 = (((-snap.cameraY * 0.12 + 450) % (H + 400)) + (H + 400)) % (H + 400) - 200;
    const neb2 = ctx.createRadialGradient(W * 0.78, driftY2, 10, W * 0.78, driftY2, 230);
    neb2.addColorStop(0, hexToRgba(nebulaB, 0.15));
    neb2.addColorStop(1, hexToRgba(nebulaB, 0));
    ctx.fillStyle = neb2;
    ctx.fillRect(0, 0, W, H);

    // Distant Crescent Moon (true vector crescent path)
    const moonY = 145 + ((-snap.cameraY * 0.03) % 720);
    if (moonY > -80 && moonY < H + 80) {
      ctx.save();
      ctx.translate(W * 0.8, moonY);
      ctx.rotate(-0.35);
      ctx.fillStyle = 'rgba(254, 240, 138, 0.18)';
      ctx.shadowColor = 'rgba(254, 240, 138, 0.35)';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, 28, -Math.PI * 0.5, Math.PI * 0.5, false);
      ctx.arc(10, 0, 24, Math.PI * 0.44, -Math.PI * 0.44, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Parallax Twinkling Stars (normalized across full width & height)
    for (const s of this.stars) {
      const sx = s.x * W;
      const sy = (((s.y * H - snap.cameraY * s.depth) % H) + H) % H;
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(snap.time * 2.4 + s.twinklePhase));
      ctx.fillStyle = `rgba(255, 255, 255, ${twinkle * 0.75})`;
      ctx.beginPath();
      ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawAuroraWalls(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    snap: RenderSnapshot,
    leftColor: string,
    rightColor: string
  ): void {
    // Ambient edge glow
    const lg = ctx.createLinearGradient(0, 0, 28, 0);
    lg.addColorStop(0, hexToRgba(leftColor, 0.34));
    lg.addColorStop(1, hexToRgba(leftColor, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, 28, H);

    const rg = ctx.createLinearGradient(W, 0, W - 28, 0);
    rg.addColorStop(0, hexToRgba(rightColor, 0.34));
    rg.addColorStop(1, hexToRgba(rightColor, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(W - 28, 0, 28, H);

    // Crisp elastic energy line with ripple deformation
    (['left', 'right'] as const).forEach((side) => {
      const baseX = side === 'left' ? WALL_MARGIN : W - WALL_MARGIN;
      const dir = side === 'left' ? 1 : -1;
      const col = side === 'left' ? leftColor : rightColor;

      ctx.strokeStyle = hexToRgba(col, 0.68);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const step = 18;
      for (let sy = 0; sy <= H; sy += step) {
        const worldY = snap.cameraY + sy;
        let offset = Math.sin(worldY * 0.018 + snap.time * 2.5) * 1.4;
        for (const r of snap.wallRipples) {
          if (r.side !== side) continue;
          const dy = worldY - r.y;
          if (Math.abs(dy) < 110) {
            const env = Math.cos((dy / 110) * Math.PI * 0.5);
            const t = r.life / r.maxLife;
            offset += Math.sin((1 - t) * 20) * r.amp * env * t * dir;
          }
        }
        const px = baseX + offset;
        if (sy === 0) ctx.moveTo(px, sy);
        else ctx.lineTo(px, sy);
      }
      ctx.stroke();
    });
  }

  private drawCelestialGateLine(
    ctx: CanvasRenderingContext2D,
    W: number,
    gateY: number,
    meters: number,
    time: number
  ): void {
    ctx.save();
    const grad = ctx.createLinearGradient(WALL_MARGIN, gateY, W - WALL_MARGIN, gateY);
    grad.addColorStop(0, 'rgba(253, 224, 71, 0)');
    grad.addColorStop(0.2, 'rgba(253, 224, 71, 0.75)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.8, 'rgba(253, 224, 71, 0.75)');
    grad.addColorStop(1, 'rgba(253, 224, 71, 0)');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -time * 36;
    ctx.beginPath();
    ctx.moveTo(WALL_MARGIN, gateY);
    ctx.lineTo(W - WALL_MARGIN, gateY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(254, 240, 138, 0.92)';
    ctx.font = '800 11px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`✦ CELESTIAL SHRINE • ${meters}m ✦`, W * 0.5, gateY - 10);
    ctx.restore();
  }

  private drawEntity(ctx: CanvasRenderingContext2D, e: WorldEntity, time: number): void {
    const bobY = e.y + Math.sin(time * 2.8 + e.bobPhase) * 3.5;
    ctx.save();
    ctx.translate(e.x, bobY);
    ctx.scale(e.hitScale, e.hitScale);

    switch (e.kind) {
      case 'prism':
      case 'gold_prism': {
        const isGold = e.kind === 'gold_prism';
        const r = e.radius;
        ctx.rotate(e.angle);

        // Outer soft halo
        const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.9);
        glow.addColorStop(0, isGold ? 'rgba(251, 191, 36, 0.42)' : 'rgba(56, 189, 248, 0.36)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.9, 0, Math.PI * 2);
        ctx.fill();

        // Faceted Diamond / Hex Jewel
        ctx.beginPath();
        if (isGold) {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        } else {
          ctx.moveTo(0, -r * 1.18);
          ctx.lineTo(r * 0.92, 0);
          ctx.lineTo(0, r * 1.18);
          ctx.lineTo(-r * 0.92, 0);
        }
        ctx.closePath();

        const bodyGrad = ctx.createLinearGradient(-r, -r, r, r);
        if (isGold) {
          bodyGrad.addColorStop(0, '#fef9c3');
          bodyGrad.addColorStop(0.45, '#facc15');
          bodyGrad.addColorStop(1, '#ea580c');
        } else {
          bodyGrad.addColorStop(0, '#e0f2fe');
          bodyGrad.addColorStop(0.5, '#38bdf8');
          bodyGrad.addColorStop(1, '#2563eb');
        }
        ctx.fillStyle = bodyGrad;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isGold ? '#fef08a' : '#bae6fd';
        ctx.stroke();

        // Inner specular facet
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.beginPath();
        ctx.arc(-r * 0.24, -r * 0.28, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'supernova': {
        const pulse = 1 + 0.09 * Math.sin(time * 7 + e.bobPhase);
        const r = e.radius * pulse;

        const glow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.3);
        glow.addColorStop(0, 'rgba(251, 146, 60, 0.65)');
        glow.addColorStop(0.6, 'rgba(239, 68, 68, 0.22)');
        glow.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, r * 2.3, 0, Math.PI * 2);
        ctx.fill();

        // Rotating orbital containment ring
        ctx.save();
        ctx.rotate(time * 2.2);
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.32, r * 0.55, 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Molten Solar Sphere
        const sg = ctx.createRadialGradient(-4, -4, 2, 0, 0, r);
        sg.addColorStop(0, '#ffffff');
        sg.addColorStop(0.4, '#fde047');
        sg.addColorStop(0.8, '#f97316');
        sg.addColorStop(1, '#dc2626');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'bumper': {
        const r = e.radius;
        const glow = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.75);
        glow.addColorStop(0, 'rgba(244, 114, 182, 0.45)');
        glow.addColorStop(1, 'rgba(244, 114, 182, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.75, 0, Math.PI * 2);
        ctx.fill();

        const bg = ctx.createRadialGradient(-5, -5, 3, 0, 0, r);
        bg.addColorStop(0, '#fce7f3');
        bg.addColorStop(0.55, '#f472b6');
        bg.addColorStop(1, '#9333ea');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fbcfe8';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Inner star ring
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case 'cloud_pad': {
        const w = e.width || 96;
        const hw = w * 0.5;
        const h = 18;

        const cg = ctx.createLinearGradient(0, -h * 0.6, 0, h * 0.8);
        cg.addColorStop(0, '#f0f9ff');
        cg.addColorStop(0.6, '#7dd3fc');
        cg.addColorStop(1, '#38bdf8');

        ctx.shadowColor = 'rgba(56, 189, 248, 0.55)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.roundRect(-hw, -h * 0.5, w, h, 9);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Cute cloud puffs along top
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.arc(i * (w * 0.24), -4, i === 0 ? 11 : 8.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      case 'pulsar': {
        const r = e.radius;
        // Gravitational pull field ring
        ctx.strokeStyle = 'rgba(129, 140, 248, 0.24)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, r * 3.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.rotate(time * 2.5);
        for (let arm = 0; arm < 3; arm++) {
          ctx.rotate((Math.PI * 2) / 3);
          ctx.strokeStyle = 'rgba(165, 180, 252, 0.75)';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(8, 0, r * 0.8, 0, Math.PI * 1.1);
          ctx.stroke();
        }

        const pg = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 0.72);
        pg.addColorStop(0, '#ffffff');
        pg.addColorStop(0.5, '#818cf8');
        pg.addColorStop(1, '#312e81');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'drifter':
      case 'shield_knight': {
        const r = e.radius;
        // Armored Knight directional shield arc
        if (e.kind === 'shield_knight') {
          ctx.save();
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 5;
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(0, 0, r + 8, e.angle - Math.PI * 0.42, e.angle + Math.PI * 0.42);
          ctx.stroke();
          ctx.restore();
        }

        // Cute-menacing dark-violet void body (clearly smashable!)
        const dg = ctx.createRadialGradient(-4, -4, 2, 0, 0, r);
        dg.addColorStop(0, '#c084fc');
        dg.addColorStop(0.65, '#6b21a8');
        dg.addColorStop(1, '#2e1065');
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#d8b4fe';
        ctx.stroke();

        // Expressive glowing eyes
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.ellipse(-5.5, -2, 3.2, 4.2, -0.2, 0, Math.PI * 2);
        ctx.ellipse(5.5, -2, 3.2, 4.2, 0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'plasma_hazard': {
        const r = e.radius;
        const glow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.1);
        glow.addColorStop(0, 'rgba(244, 63, 94, 0.65)');
        glow.addColorStop(1, 'rgba(244, 63, 94, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.rotate(time * 1.8 + e.bobPhase);
        // Unmistakable Crimson Electric Spikes
        ctx.fillStyle = '#e11d48';
        ctx.strokeStyle = '#fda4af';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        const spikes = 8;
        for (let i = 0; i < spikes * 2; i++) {
          const rad = i % 2 === 0 ? r * 1.38 : r * 0.72;
          const a = (i / (spikes * 2)) * Math.PI * 2;
          const px = Math.cos(a) * rad;
          const py = Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffe4e6';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }

  private drawBoss(ctx: CanvasRenderingContext2D, boss: BossState, time: number): void {
    ctx.save();
    ctx.translate(boss.x, boss.y);

    // Outer aura
    const aura = ctx.createRadialGradient(0, 0, boss.radius * 0.4, 0, 0, boss.radius * 2.5);
    aura.addColorStop(0, 'rgba(244, 63, 94, 0.38)');
    aura.addColorStop(0.6, 'rgba(168, 85, 247, 0.16)');
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, boss.radius * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Directional rotating shield arc
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(
      0,
      0,
      boss.radius + 16,
      boss.shieldAngle - boss.shieldArc * 0.5,
      boss.shieldAngle + boss.shieldArc * 0.5
    );
    ctx.stroke();
    ctx.restore();

    // Orbiting Crystal Locks (smashable for extra damage & charge refill!)
    for (const lock of boss.locks) {
      if (!lock.alive) continue;
      const lx = Math.cos(lock.angleOffset) * lock.dist;
      const ly = Math.sin(lock.angleOffset) * lock.dist;

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(lx, ly);
      ctx.stroke();

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(time * 3);
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(11, 0);
      ctx.lineTo(0, 13);
      ctx.lineTo(-11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Boss Core Polyhedron/Sphere
    const isFlashing = boss.flashTimer > 0;
    const coreGrad = ctx.createRadialGradient(-8, -8, 4, 0, 0, boss.radius);
    if (isFlashing) {
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(1, '#fde047');
    } else {
      coreGrad.addColorStop(0, '#f472b6');
      coreGrad.addColorStop(0.55, '#7e22ce');
      coreGrad.addColorStop(1, '#1e1b4b');
    }
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, boss.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = isFlashing ? '#ffffff' : '#f472b6';
    ctx.stroke();

    // Cosmic Eye in center
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(Math.sin(time * 2) * 4, 2, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // Floating Boss Name & Crisp HP Bar
    const barW = 136;
    const barY = -boss.radius - 38;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.beginPath();
    ctx.roundRect(-barW * 0.5, barY, barW, 10, 5);
    ctx.fill();

    const hpRatio = clamp(boss.hp / boss.maxHp, 0, 1);
    const hpGrad = ctx.createLinearGradient(-barW * 0.5, 0, barW * 0.5, 0);
    hpGrad.addColorStop(0, '#fb7185');
    hpGrad.addColorStop(1, '#f43f5e');
    ctx.fillStyle = hpGrad;
    ctx.beginPath();
    ctx.roundRect(-barW * 0.5 + 1.5, barY + 1.5, (barW - 3) * hpRatio, 7, 4);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 11px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${boss.name} • ${boss.title.toUpperCase()}`, 0, barY - 7);

    ctx.restore();
  }

  private drawTrajectoryPreview(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const p = snap.player;
    let simX = p.x;
    let simY = p.y;
    let simVx = snap.aim.dirX * snap.launchSpeed;
    let simVy = snap.aim.dirY * snap.launchSpeed;

    const dt = 0.022;
    const steps = snap.maxBouncesPreview > 1 ? 38 : 26;
    let bounces = 0;

    ctx.save();
    for (let i = 1; i <= steps; i++) {
      // Apply gravity & nearby pulsar pull so preview matches real physics!
      simVy += GRAVITY * dt;
      simVx *= 1 - AIR_DRAG * dt;

      for (const ent of snap.entities) {
        if (!ent.alive || ent.kind !== 'pulsar') continue;
        const dx = ent.x - simX;
        const dy = ent.y - simY;
        const dSq = dx * dx + dy * dy;
        if (dSq < 140 * 140 && dSq > 64) {
          const d = Math.sqrt(dSq);
          const pull = (1 - d / 140) * 1450 * dt;
          simVx += (dx / d) * pull;
          simVy += (dy / d) * pull;
        }
      }

      simX += simVx * dt;
      simY += simVy * dt;

      const minX = WALL_MARGIN + p.radius;
      const maxX = this.logicalWidth - WALL_MARGIN - p.radius;
      if (simX < minX) {
        simX = minX;
        simVx = Math.abs(simVx) * WALL_BOUNCE_RESTITUTION;
        bounces++;
      } else if (simX > maxX) {
        simX = maxX;
        simVx = -Math.abs(simVx) * WALL_BOUNCE_RESTITUTION;
        bounces++;
      }
      if (bounces > snap.maxBouncesPreview) break;

      if (i % 2 === 1) {
        const t = 1 - i / steps;
        const r = lerp(2.0, 4.4, t);
        ctx.fillStyle =
          bounces > 0
            ? `rgba(52, 211, 153, ${t * 0.9})`
            : `rgba(254, 240, 138, ${t * 0.92})`;
        ctx.beginPath();
        ctx.arc(simX, simY, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawEchoes(ctx: CanvasRenderingContext2D, echoes: EchoProjectile[]): void {
    for (const ec of echoes) {
      for (let i = 0; i < ec.trail.length; i++) {
        const pt = ec.trail[i];
        const t = (i + 1) / ec.trail.length;
        ctx.fillStyle = hexToRgba(ec.color, t * 0.45);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, ec.radius * t * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = ec.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(ec.x, ec.y, ec.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  private drawPlayerTrail(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    spirit: SpiritDef,
    time: number
  ): void {
    const len = player.trail.length;
    if (len < 2) return;

    ctx.save();
    for (let i = 0; i < len; i++) {
      const pt = player.trail[i];
      const t = (i + 1) / len;
      const col = pt.fever
        ? `hsl(${(time * 380 + i * 16) % 360}, 95%, 65%)`
        : lerpColor(spirit.trailColorB, spirit.trailColorA, t);
      ctx.globalAlpha = t * (player.blazeTimer > 0 || pt.fever ? 0.68 : 0.34);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPlayerSpirit(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    spirit: SpiritDef,
    aim: AimState,
    time: number
  ): void {
    const isFever = player.feverTimer > 0;
    const isBlazing = player.blazeTimer > 0 || isFever;

    ctx.save();
    ctx.translate(player.x, player.y);

    // Orbiting Sling Charge Moons (so player always sees charges right on Luma!)
    for (let c = 0; c < player.maxCharges; c++) {
      const orbitAng = time * 3.1 + (c / player.maxCharges) * Math.PI * 2;
      const ox = Math.cos(orbitAng) * (player.radius + 13);
      const oy = Math.sin(orbitAng) * (player.radius + 13);
      const filled = c < player.charges;

      ctx.beginPath();
      ctx.arc(ox, oy, filled ? 4.3 : 3.2, 0, Math.PI * 2);
      if (filled) {
        ctx.fillStyle = isFever ? '#fde047' : '#7dd3fc';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Regenerating Starlight Bubble Shield
    if (player.hasShield) {
      ctx.strokeStyle = `rgba(253, 224, 71, ${0.65 + 0.25 * Math.sin(time * 5)})`;
      ctx.fillStyle = 'rgba(253, 224, 71, 0.1)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Blaze / Fever Comet Halo
    if (isBlazing) {
      const haloR = player.radius * (isFever ? 2.4 : 1.95);
      const halo = ctx.createRadialGradient(0, 0, player.radius * 0.4, 0, 0, haloR);
      if (isFever) {
        halo.addColorStop(0, `hsla(${(time * 420) % 360}, 100%, 70%, 0.8)`);
        halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
      } else {
        halo.addColorStop(0, hexToRgba(spirit.glowColor, 0.65));
        halo.addColorStop(1, hexToRgba(spirit.glowColor, 0));
      }
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, haloR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Velocity / Aim Squash & Stretch
    ctx.save();
    ctx.rotate(player.visualAngle);
    ctx.scale(player.squashX, player.squashY);

    const r = player.radius;

    // Spirit-specific silhouettes (ears, crest, halo, accretion ring!)
    if (spirit.shape === 'kitsune') {
      ctx.fillStyle = spirit.glowColor;
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.35);
      ctx.lineTo(-r * 0.95, -r * 1.35);
      ctx.lineTo(-r * 0.15, -r * 0.85);
      ctx.moveTo(r * 0.75, -r * 0.35);
      ctx.lineTo(r * 0.95, -r * 1.35);
      ctx.lineTo(r * 0.15, -r * 0.85);
      ctx.fill();
    } else if (spirit.shape === 'phoenix') {
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.8);
      ctx.lineTo(0, -r * 1.55);
      ctx.lineTo(r * 0.4, -r * 0.8);
      ctx.fill();
    } else if (spirit.shape === 'seraph') {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.15, r * 0.7, r * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (spirit.shape === 'singularity') {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.38, r * 0.48, -0.25, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Core Spirit Body
    const bodyGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r);
    if (isFever) {
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.55, '#fef08a');
      bodyGrad.addColorStop(1, `hsl(${(time * 400) % 360}, 95%, 62%)`);
    } else if (spirit.shape === 'singularity') {
      bodyGrad.addColorStop(0, '#312e81');
      bodyGrad.addColorStop(0.75, '#0f172a');
      bodyGrad.addColorStop(1, '#fbbf24');
    } else {
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.55, spirit.coreColor);
      bodyGrad.addColorStop(1, spirit.glowColor);
    }

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    if (spirit.shape === 'octa') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rad = i % 2 === 0 ? r * 1.08 : r * 0.92;
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.restore(); // undo rotation so eyes stay readable & upright!

    // Expressive Reactive Eyes!
    const eyeOffX = clamp(player.lookX * 3.8, -4.2, 4.2);
    const eyeOffY = clamp(player.lookY * 3.8, -4.2, 4.2);
    const eyeColor = spirit.shape === 'singularity' ? '#fde047' : '#0f172a';

    ctx.fillStyle = eyeColor;
    if (isFever) {
      // Happy joyful ^ ^ star arcs during Supernova Fever!
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(-5 + eyeOffX, -1 + eyeOffY, 3.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(5 + eyeOffX, -1 + eyeOffY, 3.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else {
      const eyeH = aim.active ? 3.2 : 4.6; // Determined squint when aiming!
      ctx.beginPath();
      ctx.ellipse(-5 + eyeOffX, -1 + eyeOffY, 2.7, eyeH, 0, 0, Math.PI * 2);
      ctx.ellipse(5 + eyeOffX, -1 + eyeOffY, 2.7, eyeH, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cute eye specular catchlights
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-4.1 + eyeOffX, -2.4 + eyeOffY, 1.1, 0, Math.PI * 2);
      ctx.arc(5.9 + eyeOffX, -2.4 + eyeOffY, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawShockwaves(ctx: CanvasRenderingContext2D, waves: Shockwave[]): void {
    for (const w of waves) {
      const t = clamp(w.life / w.maxLife, 0, 1);
      ctx.strokeStyle = hexToRgba(w.color, t * 0.85);
      ctx.lineWidth = w.lineWidth * t;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawLightnings(ctx: CanvasRenderingContext2D, arcs: LightningArc[]): void {
    for (const a of arcs) {
      const t = clamp(a.life / a.maxLife, 0, 1);
      ctx.save();
      ctx.strokeStyle = hexToRgba(a.color, t);
      ctx.lineWidth = 3 * t;
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      const midX = (a.x1 + a.x2) * 0.5 + (Math.random() - 0.5) * 22;
      const midY = (a.y1 + a.y2) * 0.5 + (Math.random() - 0.5) * 22;
      ctx.lineTo(midX, midY);
      ctx.lineTo(a.x2, a.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
    for (const p of particles) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = hexToRgba(p.color, t * p.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D, texts: FloatingText[]): void {
    ctx.save();
    ctx.textAlign = 'center';
    for (const ft of texts) {
      const t = clamp(ft.life / ft.maxLife, 0, 1);
      const pop = t > 0.82 ? lerp(1.3, 1.0, (1 - t) / 0.18) : 1.0;
      ctx.save();
      ctx.translate(ft.x, ft.y);
      ctx.scale(ft.scale * pop, ft.scale * pop);
      ctx.globalAlpha = Math.min(1, t * 1.6);

      ctx.font = '900 16px "Outfit", sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeText(ft.text, 0, 0);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, 0, 0);

      if (ft.subtext) {
        ctx.font = '800 11px "Plus Jakarta Sans", sans-serif';
        ctx.strokeText(ft.subtext, 0, 15);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(ft.subtext, 0, 15);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawEclipseTide(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    cameraY: number,
    eclipseY: number,
    time: number
  ): void {
    if (eclipseY > cameraY + H + 80) return;
    const bottomY = cameraY + H + 120;

    ctx.save();
    // Glowing violet-crimson crest
    ctx.beginPath();
    ctx.moveTo(0, bottomY);
    for (let x = 0; x <= W; x += 16) {
      const wave =
        Math.sin(x * 0.025 + time * 3.8) * 9 + Math.cos(x * 0.055 - time * 2.4) * 5;
      ctx.lineTo(x, eclipseY + wave);
    }
    ctx.lineTo(W, bottomY);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, eclipseY - 15, 0, eclipseY + 140);
    grad.addColorStop(0, '#f43f5e');
    grad.addColorStop(0.18, '#7e22ce');
    grad.addColorStop(0.55, '#1e1b4b');
    grad.addColorStop(1, '#050511');
    ctx.fillStyle = grad;
    ctx.fill();

    // Luminous surface foam line
    ctx.strokeStyle = '#fda4af';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 16) {
      const wave =
        Math.sin(x * 0.025 + time * 3.8) * 9 + Math.cos(x * 0.055 - time * 2.4) * 5;
      if (x === 0) ctx.moveTo(x, eclipseY + wave);
      else ctx.lineTo(x, eclipseY + wave);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawThumbSlingshotWidget(ctx: CanvasRenderingContext2D, aim: AimState): void {
    ctx.save();
    // Anchor circle where thumb touched down
    ctx.strokeStyle = aim.canceled ? 'rgba(248, 113, 113, 0.65)' : 'rgba(125, 211, 252, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(aim.anchorX, aim.anchorY, 16, 0, Math.PI * 2);
    ctx.stroke();

    // Elastic tether to current thumb position
    ctx.strokeStyle = aim.canceled ? 'rgba(248, 113, 113, 0.5)' : 'rgba(254, 240, 138, 0.65)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(aim.anchorX, aim.anchorY);
    ctx.lineTo(aim.currentX, aim.currentY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Thumb knob
    ctx.fillStyle = aim.canceled ? '#f87171' : '#fde047';
    ctx.beginPath();
    ctx.arc(aim.currentX, aim.currentY, 8, 0, Math.PI * 2);
    ctx.fill();

    if (aim.canceled) {
      ctx.fillStyle = 'rgba(254, 202, 202, 0.92)';
      ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RELEASE TO CANCEL', aim.anchorX, aim.anchorY - 24);
    }
    ctx.restore();
  }

  private drawInteractiveLaunchHint(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    time: number
  ): void {
    const cycle = (time % 1.9) / 1.9;
    const cx = W * 0.5;
    const startY = H * 0.64;
    const pullT = clamp(cycle / 0.68, 0, 1);
    const ease = 1 - Math.pow(1 - pullT, 3);
    const handX = cx - ease * 32;
    const handY = startY + ease * 64;
    const alpha = cycle < 0.8 ? 1 : 1 - (cycle - 0.8) / 0.2;

    ctx.save();
    ctx.globalAlpha = alpha * 0.92;

    ctx.strokeStyle = 'rgba(254, 240, 138, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, startY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(handX, handY, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.font = '800 13px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('DRAG DOWN ANYWHERE TO SLING', cx, startY + 98);
    ctx.restore();
  }
}
