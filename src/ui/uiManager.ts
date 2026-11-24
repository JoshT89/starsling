import { sound } from '../core/audio';
import { getTodaySeedString } from '../core/math';
import { GameMode, storage } from '../core/storage';
import { ACHIEVEMENTS, getWorkshopCost, WORKSHOP_UPGRADES } from '../data/achievements';
import { RARITY_LABELS, RELICS, RelicDef } from '../data/relics';
import { getSpiritById, SPIRITS } from '../data/spirits';
import { GameEngine, HudState } from '../game/engine';
import { RunSummary } from '../game/types';

const MODE_DETAILS: Record<
  GameMode,
  { name: string; icon: string; desc: string; cta: string }
> = {
  odyssey: {
    name: 'Odyssey',
    icon: '🚀',
    desc: 'Climb infinite celestial biomes, draft Relics & vanquish Constellation Titans.',
    cta: 'LAUNCH ODYSSEY',
  },
  daily: {
    name: 'Daily',
    icon: '📅',
    desc: `Seeded cosmos (${getTodaySeedString()}). First play today grants 1.5x Stardust!`,
    cta: 'PLAY DAILY COSMOS',
  },
  blitz: {
    name: 'Blitz 60s',
    icon: '⚡',
    desc: '60-second high-speed score frenzy! Trigger Supernova Fever for +2.5s bonus time.',
    cta: 'START 60s BLITZ',
  },
  zen: {
    name: 'Zen Sky',
    icon: '🌙',
    desc: 'Pure chill musical flow. No Void Tide, no hazards — just harmonic chain reactions.',
    cta: 'ENTER ZEN SKY',
  },
};

export class UIManager {
  private root: HTMLElement;
  private engine!: GameEngine;
  private selectedMode: GameMode = 'odyssey';

  // Cached fast-update HUD elements
  private hudScoreEl: HTMLElement | null = null;
  private hudAltEl: HTMLElement | null = null;
  private hudDustEl: HTMLElement | null = null;
  private hudBlitzEl: HTMLElement | null = null;
  private hudFeverFill: HTMLElement | null = null;
  private hudComboEl: HTMLElement | null = null;
  private hudRelicsEl: HTMLElement | null = null;
  private lastRelicKey = '';

  private bannerTimeout: number | null = null;
  private toastTimeout: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  public attachEngine(engine: GameEngine): void {
    this.engine = engine;
    this.renderHome();
  }

  public pauseIfPlaying(): void {
    if (this.engine.phase === 'playing') {
      this.engine.pause();
      if (!this.root.querySelector('.modal-backdrop')) {
        this.openSettingsModal(true);
      }
    }
  }

  private clearHudRefs(): void {
    this.hudScoreEl = null;
    this.hudAltEl = null;
    this.hudDustEl = null;
    this.hudBlitzEl = null;
    this.hudFeverFill = null;
    this.hudComboEl = null;
    this.hudRelicsEl = null;
    this.lastRelicKey = '';
  }

  private canAffordAnything(): { spirit: boolean; workshop: boolean } {
    const dust = storage.data.stardust;
    const spirit = SPIRITS.some(
      (s) => !storage.data.unlockedSpirits.includes(s.id) && dust >= s.cost
    );
    const workshop = WORKSHOP_UPGRADES.some((u) => {
      const lvl = storage.data.workshop[u.key];
      return lvl < u.maxLevel && dust >= getWorkshopCost(u, lvl);
    });
    return { spirit, workshop };
  }

  public renderHome(): void {
    this.clearHudRefs();
    storage.refreshDailyIfNeeded();
    const save = storage.data;
    const spirit = getSpiritById(save.selectedSpirit);
    const info = MODE_DETAILS[this.selectedMode];
    const bestScore = save.bestScore[this.selectedMode] || 0;
    const bestAlt = save.bestAltitude[this.selectedMode] || 0;
    const afford = this.canAffordAnything();

    this.root.innerHTML = `
      <div class="top-bar">
        <div class="stardust-pill" title="Stardust Currency">
          <span>✦</span>
          <span>${save.stardust.toLocaleString()}</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="icon-btn interactive" id="btn-how" aria-label="How to Play" title="How to Play">?</button>
          <button class="icon-btn interactive" id="btn-settings" aria-label="Settings" title="Settings">⚙️</button>
        </div>
      </div>

      <div class="title-screen">
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
          <div class="hero-brand">
            <span class="hero-eyebrow">Cosmic Ricochet Roguelite</span>
            <h1 class="hero-logo">STARSLING</h1>
            <p class="hero-tagline">Pull back • Bullet-time aim • Shatter the stars</p>
          </div>

          <button class="spirit-preview-chip interactive" id="btn-quick-spirit">
            <span class="spirit-orb-dot" style="background:${spirit.coreColor}; color:${spirit.glowColor}"></span>
            <span style="font-size:12.5px; font-weight:700; color:#f8fafc;">
              ${spirit.name} <span style="color:#94a3b8; font-weight:600;">• ${spirit.perkTitle}</span>
            </span>
            <span style="font-size:11px; color:#38bdf8; font-weight:800;">CHANGE ›</span>
          </button>
        </div>

        <div class="home-deck interactive">
          <div class="mode-grid" role="tablist">
            ${(['odyssey', 'daily', 'blitz', 'zen'] as GameMode[])
              .map(
                (m) => `
              <button class="mode-tab ${this.selectedMode === m ? 'active' : ''}" data-mode="${m}">
                <span class="m-icon">${MODE_DETAILS[m].icon}</span>
                <span class="m-name">${MODE_DETAILS[m].name}</span>
              </button>
            `
              )
              .join('')}
          </div>

          <div class="mode-info-card">
            <div class="mode-desc-text">${info.desc}</div>
            <div class="mode-record-badge">
              <div class="mode-record-label">Best</div>
              <div class="mode-record-val">${bestScore.toLocaleString()}</div>
              <div style="font-size:10.5px; color:#7dd3fc; font-weight:700;">${bestAlt}m</div>
            </div>
          </div>

          <button class="play-cta-btn" id="btn-play-main">
            <span>${info.icon}</span>
            <span>${info.cta}</span>
          </button>

          <div class="nav-row">
            <button class="nav-card-btn" id="btn-spirits">
              <span>🦊</span><span>Spirits</span>
              ${afford.spirit ? '<span class="notif-dot"></span>' : ''}
            </button>
            <button class="nav-card-btn" id="btn-workshop">
              <span>🔮</span><span>Workshop</span>
              ${afford.workshop ? '<span class="notif-dot"></span>' : ''}
            </button>
            <button class="nav-card-btn" id="btn-missions">
              <span>🏆</span><span>Quests</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.root.querySelectorAll<HTMLButtonElement>('.mode-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.unlock();
        sound.playUiTap();
        this.selectedMode = btn.dataset.mode as GameMode;
        this.renderHome();
      });
    });

    document.getElementById('btn-play-main')?.addEventListener('click', () => {
      sound.unlock();
      sound.playUiTap(true);
      this.renderHudSkeleton(this.selectedMode);
      this.engine.startRun(this.selectedMode);
    });

    document.getElementById('btn-spirits')?.addEventListener('click', () => {
      sound.unlock();
      sound.playUiTap();
      this.openSpiritsModal();
    });
    document.getElementById('btn-quick-spirit')?.addEventListener('click', () => {
      sound.unlock();
      sound.playUiTap();
      this.openSpiritsModal();
    });
    document.getElementById('btn-workshop')?.addEventListener('click', () => {
      sound.unlock();
      sound.playUiTap();
      this.openWorkshopModal();
    });
    document.getElementById('btn-missions')?.addEventListener('click', () => {
      sound.unlock();
      sound.playUiTap();
      this.openMissionsModal();
    });
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      sound.unlock();
      sound.playUiTap();
      this.openSettingsModal(false);
    });
    document.getElementById('btn-how')?.addEventListener('click', () => {
      sound.unlock();
      sound.playUiTap();
      this.openHowToPlayModal();
    });
  }

  private renderHudSkeleton(mode: GameMode): void {
    this.root.innerHTML = `
      <div class="hud-wrap">
        <div class="hud-top-row">
          <div class="hud-score-box">
            <div class="hud-score-num" id="hud-score">0</div>
            <div class="hud-sub-stats">
              <span id="hud-alt">0m</span>
              <span>•</span>
              <span style="color:#fde047;" id="hud-dust">✦ 0</span>
            </div>
          </div>

          ${
            mode === 'blitz'
              ? `<div class="hud-center-pill" id="hud-blitz">60.0s</div>`
              : ''
          }

          <div class="hud-right-actions">
            ${
              mode === 'zen'
                ? `<button class="icon-btn interactive" id="btn-zen-finish" title="Finish & Bank Stardust" style="width:auto; padding:0 12px; border-radius:999px; font-size:12px; font-weight:800; color:#fde047;">✓ Finish</button>`
                : ''
            }
            <button class="icon-btn interactive" id="btn-pause" aria-label="Pause">⏸</button>
          </div>
        </div>

        <div class="fever-bar-wrap">
          <div class="fever-track">
            <div class="fever-fill" id="hud-fever-fill"></div>
          </div>
          <div class="combo-pill" id="hud-combo">0x</div>
        </div>

        <div class="relic-strip" id="hud-relics"></div>
      </div>
      <div id="dynamic-overlay-slot"></div>
    `;

    this.hudScoreEl = document.getElementById('hud-score');
    this.hudAltEl = document.getElementById('hud-alt');
    this.hudDustEl = document.getElementById('hud-dust');
    this.hudBlitzEl = document.getElementById('hud-blitz');
    this.hudFeverFill = document.getElementById('hud-fever-fill');
    this.hudComboEl = document.getElementById('hud-combo');
    this.hudRelicsEl = document.getElementById('hud-relics');
    this.lastRelicKey = '';

    document.getElementById('btn-pause')?.addEventListener('click', () => {
      sound.playUiTap();
      this.engine.pause();
      this.openSettingsModal(true);
    });

    document.getElementById('btn-zen-finish')?.addEventListener('click', () => {
      sound.playUiTap(true);
      this.engine.finishRun();
    });
  }

  public updateHud(hud: HudState): void {
    if (!this.hudScoreEl) return;
    this.hudScoreEl.textContent = hud.score.toLocaleString();
    if (this.hudAltEl) this.hudAltEl.textContent = `${hud.meters}m`;
    if (this.hudDustEl) this.hudDustEl.textContent = `✦ ${hud.stardustRun}`;
    if (this.hudBlitzEl) {
      this.hudBlitzEl.textContent = `${hud.blitzTimeLeft.toFixed(1)}s`;
      this.hudBlitzEl.style.color = hud.blitzTimeLeft <= 10 ? '#fb7185' : '#fde047';
    }
    if (this.hudFeverFill) {
      this.hudFeverFill.style.width = `${Math.round(hud.feverRatio * 100)}%`;
      this.hudFeverFill.classList.toggle('overdrive', hud.isFever);
    }
    if (this.hudComboEl) {
      this.hudComboEl.textContent = hud.isFever ? `FEVER ${hud.combo}x` : `${hud.combo}x`;
      this.hudComboEl.classList.toggle('fever', hud.isFever);
    }
    if (this.hudRelicsEl) {
      const key = JSON.stringify(hud.relicStacks);
      if (key !== this.lastRelicKey) {
        this.lastRelicKey = key;
        this.hudRelicsEl.innerHTML = Object.entries(hud.relicStacks)
          .map(([id, cnt]) => {
            const def = RELICS.find((r) => r.id === id);
            if (!def) return '';
            return `<span class="relic-mini-badge">${def.icon}${cnt > 1 ? ` ×${cnt}` : ''}</span>`;
          })
          .join('');
      }
    }
  }

  public showBiomeBanner(name: string, subtitle: string): void {
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    document.querySelector('.biome-banner')?.remove();

    const el = document.createElement('div');
    el.className = 'biome-banner';
    el.innerHTML = `
      <div class="biome-banner-title">${name.toUpperCase()}</div>
      <div class="biome-banner-sub">${subtitle}</div>
    `;
    this.root.appendChild(el);
    this.bannerTimeout = window.setTimeout(() => el.remove(), 2600);
  }

  public showToast(title: string, subtitle: string, icon: string): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    document.querySelector('.toast-banner')?.remove();

    const el = document.createElement('div');
    el.className = 'toast-banner';
    el.innerHTML = `
      <div style="font-size:24px;">${icon}</div>
      <div>
        <div style="font-family:var(--font-display); font-weight:800; font-size:14px; color:#fde047;">${title}</div>
        <div style="font-size:11.5px; color:#cbd5e1;">${subtitle}</div>
      </div>
    `;
    this.root.appendChild(el);
    this.toastTimeout = window.setTimeout(() => el.remove(), 3100);
  }

  public showRelicDraft(choices: RelicDef[], gateMeters: number): void {
    const slot = document.getElementById('dynamic-overlay-slot') || this.root;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop interactive';
    modal.innerHTML = `
      <div class="draft-header">
        <div class="draft-eyebrow">✦ Celestial Shrine • ${gateMeters}m ✦</div>
        <h2 class="draft-title">Choose a Starlight Relic</h2>
        <p style="font-size:12.5px; color:#94a3b8; margin-top:4px;">Charges restored • Powers stack for this run</p>
      </div>
      <div class="relic-choices">
        ${choices
          .map((r) => {
            const rar = RARITY_LABELS[r.rarity];
            return `
            <button class="relic-card" data-relic="${r.id}" style="border-color:${rar.color}55">
              <div class="relic-icon-box" style="box-shadow: inset 0 0 18px ${r.color}33">${r.icon}</div>
              <div class="relic-card-main">
                <div class="relic-rarity-tag" style="color:${rar.color}">${rar.label}</div>
                <div class="relic-name">${r.name}</div>
                <div class="relic-desc">${r.detailDesc}</div>
              </div>
            </button>
          `;
          })
          .join('')}
      </div>
    `;

    slot.appendChild(modal);
    modal.querySelectorAll<HTMLButtonElement>('.relic-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.relic!;
        modal.remove();
        this.engine.selectRelic(id);
      });
    });
  }

  public showRunSummary(sum: RunSummary): void {
    this.clearHudRefs();
    const modeInfo = MODE_DETAILS[sum.mode];

    const missionsHtml =
      sum.completedMissions.length > 0
        ? `<div style="background:rgba(52,211,153,0.12); border:1px solid rgba(52,211,153,0.35); border-radius:14px; padding:9px 12px; font-size:12px;">
            ${sum.completedMissions
              .map(
                (m) =>
                  `<div style="display:flex; justify-content:space-between; font-weight:700; color:#6ee7b7;">
                    <span>✓ ${m.title}</span><span>+${m.reward} ✦</span>
                  </div>`
              )
              .join('')}
          </div>`
        : '';

    this.root.innerHTML = `
      <div class="modal-backdrop interactive">
        <div class="summary-card">
          <div style="text-align:center;">
            <div style="font-size:11px; font-weight:800; letter-spacing:0.16em; text-transform:uppercase; color:#94a3b8;">
              ${modeInfo.icon} ${modeInfo.name} Complete
            </div>
            <div style="margin-top:6px;">
              <span class="summary-score-big">${sum.score.toLocaleString()}</span>
              ${sum.isNewBestScore ? '<span class="new-best-tag">NEW RECORD!</span>' : ''}
            </div>
            <div style="font-size:12px; color:#94a3b8; margin-top:3px;">
              Best: ${sum.bestScore.toLocaleString()}
            </div>
          </div>

          <div class="stats-bento">
            <div class="bento-cell">
              <div class="bento-val">${sum.altitude}m</div>
              <div class="bento-lbl">${sum.isNewBestAltitude ? '🌟 Peak!' : 'Altitude'}</div>
            </div>
            <div class="bento-cell">
              <div class="bento-val">${sum.maxCombo}x</div>
              <div class="bento-lbl">Best Streak</div>
            </div>
            <div class="bento-cell">
              <div class="bento-val" style="color:#fde047;">+${sum.stardustEarned} ✦</div>
              <div class="bento-lbl">Stardust</div>
            </div>
            <div class="bento-cell">
              <div class="bento-val">${sum.prismsShattered}</div>
              <div class="bento-lbl">Prisms</div>
            </div>
            <div class="bento-cell">
              <div class="bento-val">${sum.bankShots}</div>
              <div class="bento-lbl">Bank Shots</div>
            </div>
            <div class="bento-cell">
              <div class="bento-val">${sum.supernovas}</div>
              <div class="bento-lbl">Supernovas</div>
            </div>
          </div>

          ${missionsHtml}

          <div style="display:flex; flex-direction:column; gap:9px; margin-top:2px;">
            <button class="play-cta-btn" id="btn-again" style="height:54px; font-size:19px;">
              <span>↻</span><span>SLING AGAIN</span>
            </button>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <button class="nav-card-btn" id="btn-sum-workshop">🔮 Upgrades</button>
              <button class="nav-card-btn" id="btn-sum-home">🏠 Home</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-again')?.addEventListener('click', () => {
      sound.playUiTap(true);
      this.renderHudSkeleton(sum.mode);
      this.engine.startRun(sum.mode);
    });

    document.getElementById('btn-sum-home')?.addEventListener('click', () => {
      sound.playUiTap();
      this.engine.startAttractMode();
      this.renderHome();
    });

    document.getElementById('btn-sum-workshop')?.addEventListener('click', () => {
      sound.playUiTap();
      this.engine.startAttractMode();
      this.renderHome();
      this.openWorkshopModal();
    });
  }

  private openSpiritsModal(): void {
    const save = storage.data;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop interactive';

    const renderContent = () => {
      modal.innerHTML = `
        <div class="drawer-sheet">
          <div class="drawer-header">
            <div>
              <div class="drawer-title">🦊 Star-Spirits</div>
              <div style="font-size:12px; color:#fde047; font-weight:700;">✦ ${save.stardust.toLocaleString()} Stardust</div>
            </div>
            <button class="icon-btn" id="btn-close-modal">✕</button>
          </div>
          <div class="drawer-body">
            ${SPIRITS.map((sp) => {
              const unlocked = save.unlockedSpirits.includes(sp.id);
              const selected = save.selectedSpirit === sp.id;
              const canBuy = save.stardust >= sp.cost;
              return `
                <div class="item-card ${selected ? 'selected' : ''}">
                  <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width:42px; height:42px; border-radius:50%; background:radial-gradient(circle at 35% 35%, #fff, ${sp.coreColor}, ${sp.glowColor}); box-shadow:0 0 16px ${sp.glowColor}; flex-shrink:0;"></div>
                    <div>
                      <div style="font-family:var(--font-display); font-weight:800; font-size:16px;">
                        ${sp.name} <span style="font-size:11.5px; color:#94a3b8; font-weight:600;">• ${sp.title}</span>
                      </div>
                      <div style="font-size:12px; color:#7dd3fc; font-weight:700; margin-top:2px;">${sp.perkTitle}</div>
                      <div style="font-size:11.5px; color:#cbd5e1; margin-top:1px;">${sp.perkDesc}</div>
                    </div>
                  </div>
                  ${
                    selected
                      ? `<button class="action-pill-btn" disabled>Active</button>`
                      : unlocked
                      ? `<button class="action-pill-btn" data-select="${sp.id}">Equip</button>`
                      : `<button class="action-pill-btn gold" data-buy="${sp.id}" ${!canBuy ? 'disabled' : ''}>✦ ${sp.cost}</button>`
                  }
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;

      modal.querySelector('#btn-close-modal')?.addEventListener('click', () => {
        sound.playUiTap();
        modal.remove();
        this.renderHome();
      });

      modal.querySelectorAll<HTMLButtonElement>('[data-select]').forEach((btn) => {
        btn.addEventListener('click', () => {
          sound.playUiTap(true);
          save.selectedSpirit = btn.dataset.select!;
          storage.save();
          this.engine.startAttractMode();
          renderContent();
        });
      });

      modal.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sp = getSpiritById(btn.dataset.buy!);
          if (save.stardust < sp.cost) return;
          sound.playGateChime();
          save.stardust -= sp.cost;
          save.unlockedSpirits.push(sp.id);
          save.selectedSpirit = sp.id;
          if (save.unlockedSpirits.length >= 3 && !save.achievements.includes('collector_3')) {
            const ach = ACHIEVEMENTS.find((a) => a.id === 'collector_3')!;
            save.achievements.push('collector_3');
            save.stardust += ach.reward;
            this.showToast(`Trophy: ${ach.title}`, `+${ach.reward} Stardust`, ach.icon);
          }
          storage.save();
          this.engine.startAttractMode();
          renderContent();
        });
      });
    };

    renderContent();
    this.root.appendChild(modal);
  }

  private openWorkshopModal(): void {
    const save = storage.data;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop interactive';

    const renderContent = () => {
      modal.innerHTML = `
        <div class="drawer-sheet">
          <div class="drawer-header">
            <div>
              <div class="drawer-title">🔮 Starlight Workshop</div>
              <div style="font-size:12px; color:#fde047; font-weight:700;">✦ ${save.stardust.toLocaleString()} Stardust</div>
            </div>
            <button class="icon-btn" id="btn-close-modal">✕</button>
          </div>
          <div class="drawer-body">
            ${WORKSHOP_UPGRADES.map((up) => {
              const lvl = save.workshop[up.key];
              const isMax = lvl >= up.maxLevel;
              const cost = getWorkshopCost(up, lvl);
              const canBuy = !isMax && save.stardust >= cost;
              return `
                <div class="item-card">
                  <div style="display:flex; align-items:center; gap:12px;">
                    <div class="relic-icon-box" style="width:44px; height:44px; font-size:22px;">${up.icon}</div>
                    <div>
                      <div style="font-family:var(--font-display); font-weight:800; font-size:15.5px;">
                        ${up.name} <span style="color:#38bdf8; font-size:12px;">Lv.${lvl}/${up.maxLevel}</span>
                      </div>
                      <div style="font-size:12px; color:#cbd5e1; margin-top:2px;">${up.desc(Math.max(1, lvl))}</div>
                    </div>
                  </div>
                  ${
                    isMax
                      ? `<button class="action-pill-btn" disabled>MAX</button>`
                      : `<button class="action-pill-btn gold" data-up="${up.key}" ${!canBuy ? 'disabled' : ''}>✦ ${cost}</button>`
                  }
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;

      modal.querySelector('#btn-close-modal')?.addEventListener('click', () => {
        sound.playUiTap();
        modal.remove();
        this.renderHome();
      });

      modal.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.up as keyof typeof save.workshop;
          const up = WORKSHOP_UPGRADES.find((u) => u.key === key)!;
          const lvl = save.workshop[key];
          const cost = getWorkshopCost(up, lvl);
          if (lvl >= up.maxLevel || save.stardust < cost) return;
          sound.playUiTap(true);
          save.stardust -= cost;
          save.workshop[key]++;
          storage.save();
          renderContent();
        });
      });
    };

    renderContent();
    this.root.appendChild(modal);
  }

  private openMissionsModal(): void {
    const save = storage.data;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop interactive';
    modal.innerHTML = `
      <div class="drawer-sheet">
        <div class="drawer-header">
          <div class="drawer-title">🏆 Quests & Trophies</div>
          <button class="icon-btn" id="btn-close-modal">✕</button>
        </div>
        <div class="drawer-body">
          <div style="font-size:11px; font-weight:800; letter-spacing:0.14em; text-transform:uppercase; color:#38bdf8;">Active Cosmic Quests</div>
          ${save.missions
            .map((m) => {
              const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
              return `
                <div class="item-card" style="flex-direction:column; align-items:stretch; gap:7px;">
                  <div style="display:flex; justify-content:space-between; font-size:13.5px; font-weight:700;">
                    <span>${m.title}</span>
                    <span style="color:#fde047;">+${m.reward} ✦</span>
                  </div>
                  <div class="fever-track">
                    <div class="fever-fill" style="width:${pct}%"></div>
                  </div>
                  <div style="font-size:11px; color:#94a3b8; display:flex; justify-content:space-between;">
                    <span>${m.singleRun ? 'Single Run Goal' : 'Cumulative Goal'}</span>
                    <span>${Math.min(m.progress, m.target)} / ${m.target}</span>
                  </div>
                </div>
              `;
            })
            .join('')}

          <div style="font-size:11px; font-weight:800; letter-spacing:0.14em; text-transform:uppercase; color:#fde047; margin-top:8px;">
            Trophy Vault (${save.achievements.length}/${ACHIEVEMENTS.length})
          </div>
          ${ACHIEVEMENTS.map((a) => {
            const done = save.achievements.includes(a.id);
            return `
              <div class="item-card" style="opacity:${done ? '1' : '0.52'}">
                <div style="display:flex; align-items:center; gap:11px;">
                  <span style="font-size:24px;">${done ? a.icon : '🔒'}</span>
                  <div>
                    <div style="font-weight:800; font-size:14px;">${a.title}</div>
                    <div style="font-size:11.5px; color:#cbd5e1;">${a.desc}</div>
                  </div>
                </div>
                <span style="font-size:12px; font-weight:800; color:${done ? '#34d399' : '#fde047'};">
                  ${done ? '✓ Earned' : `+${a.reward} ✦`}
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    modal.querySelector('#btn-close-modal')?.addEventListener('click', () => {
      sound.playUiTap();
      modal.remove();
    });
    this.root.appendChild(modal);
  }

  private openSettingsModal(isMidGamePause: boolean): void {
    const s = storage.data.settings;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop interactive';

    const renderContent = () => {
      modal.innerHTML = `
        <div class="drawer-sheet">
          <div class="drawer-header">
            <div class="drawer-title">${isMidGamePause ? '⏸ Game Paused' : '⚙️ Settings'}</div>
            <button class="icon-btn" id="btn-close-settings">✕</button>
          </div>
          <div class="drawer-body">
            <div class="toggle-row">
              <div>
                <div style="font-weight:700; font-size:14.5px;">Sound Effects</div>
                <div style="font-size:11.5px; color:#94a3b8;">Harmonic Lydian chimes & impacts</div>
              </div>
              <button class="switch-btn ${s.sfx ? 'on' : ''}" data-toggle="sfx"></button>
            </div>

            <div class="toggle-row">
              <div>
                <div style="font-weight:700; font-size:14.5px;">Cosmic Synth Music</div>
                <div style="font-size:11.5px; color:#94a3b8;">Generative ambient space chords</div>
              </div>
              <button class="switch-btn ${s.music ? 'on' : ''}" data-toggle="music"></button>
            </div>

            <div class="toggle-row">
              <div>
                <div style="font-weight:700; font-size:14.5px;">Haptic Vibration</div>
                <div style="font-size:11.5px; color:#94a3b8;">Tactile pulses on supported phones</div>
              </div>
              <button class="switch-btn ${s.haptics ? 'on' : ''}" data-toggle="haptics"></button>
            </div>

            <div class="toggle-row">
              <div>
                <div style="font-weight:700; font-size:14.5px;">Direct Drag Aim</div>
                <div style="font-size:11.5px; color:#94a3b8;">Off = Pull-Back Slingshot • On = Drag Toward</div>
              </div>
              <button class="switch-btn ${s.invertAim ? 'on' : ''}" data-toggle="invertAim"></button>
            </div>

            <div class="toggle-row" style="border-bottom:none;">
              <div>
                <div style="font-weight:700; font-size:14.5px;">Reduced Screen Shake</div>
                <div style="font-size:11.5px; color:#94a3b8;">Gentler camera motion on explosions</div>
              </div>
              <button class="switch-btn ${s.reducedShake ? 'on' : ''}" data-toggle="reducedShake"></button>
            </div>

            ${
              isMidGamePause
                ? `
                <div style="display:flex; flex-direction:column; gap:9px; margin-top:8px;">
                  <button class="play-cta-btn" id="btn-resume" style="height:52px; font-size:18px;">▶ RESUME RUN</button>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <button class="nav-card-btn" id="btn-restart">↻ Restart</button>
                    <button class="nav-card-btn" id="btn-quit">🏠 End & Menu</button>
                  </div>
                </div>
              `
                : ''
            }
          </div>
        </div>
      `;

      const close = () => {
        sound.playUiTap();
        modal.remove();
        if (isMidGamePause) this.engine.resume();
      };

      modal.querySelector('#btn-close-settings')?.addEventListener('click', close);
      modal.querySelector('#btn-resume')?.addEventListener('click', close);

      modal.querySelector('#btn-restart')?.addEventListener('click', () => {
        sound.playUiTap(true);
        modal.remove();
        const mode = this.engine.mode;
        this.renderHudSkeleton(mode);
        this.engine.startRun(mode);
      });

      modal.querySelector('#btn-quit')?.addEventListener('click', () => {
        sound.playUiTap();
        modal.remove();
        this.engine.startAttractMode();
        this.renderHome();
      });

      modal.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.toggle as keyof typeof s;
          s[key] = !s[key];
          storage.save();
          this.engine.syncAudioSettings();
          sound.playUiTap();
          renderContent();
        });
      });
    };

    renderContent();
    this.root.appendChild(modal);
  }

  private openHowToPlayModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop interactive';
    modal.innerHTML = `
      <div class="drawer-sheet">
        <div class="drawer-header">
          <div class="drawer-title">✨ How to Sling</div>
          <button class="icon-btn" id="btn-close-how">✕</button>
        </div>
        <div class="drawer-body" style="gap:12px;">
          <div class="item-card">
            <span style="font-size:26px;">👆</span>
            <div style="font-size:12.5px; line-height:1.45; color:#e2e8f0;">
              <strong>Touch & Pull Anywhere:</strong> Time slows to Bullet-Time! Pull back to aim your curved trajectory, then release to rocket skyward.
            </div>
          </div>
          <div class="item-card">
            <span style="font-size:26px;">💎</span>
            <div style="font-size:12.5px; line-height:1.45; color:#e2e8f0;">
              <strong>Infinite Mid-Air Chains:</strong> Every Star-Prism, Enemy, or Bumper you hit <strong>refills your Sling Charge</strong> and raises your musical Combo!
            </div>
          </div>
          <div class="item-card">
            <span style="font-size:26px;">📐</span>
            <div style="font-size:12.5px; line-height:1.45; color:#e2e8f0;">
              <strong>Aurora Bank-Shots:</strong> Ricochet off the glowing left/right walls into a target for <strong>2x Trick Bonus</strong> & sneaky angles behind shields!
            </div>
          </div>
          <div class="item-card">
            <span style="font-size:26px;">🌈</span>
            <div style="font-size:12.5px; line-height:1.45; color:#e2e8f0;">
              <strong>Supernova Fever:</strong> Hit a 12x air streak to become an <strong>Invincible Rainbow Comet</strong> that smashes even Crimson Plasma spikes!
            </div>
          </div>
        </div>
      </div>
    `;
    modal.querySelector('#btn-close-how')?.addEventListener('click', () => {
      sound.playUiTap();
      modal.remove();
    });
    this.root.appendChild(modal);
  }
}
