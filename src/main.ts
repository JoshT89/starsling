import './styles.css';
import { GameEngine } from './game/engine';
import { UIManager } from './ui/uiManager';

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-layer') as HTMLElement | null;

  if (!canvas || !uiRoot) {
    throw new Error('Missing #game-canvas or #ui-layer elements');
  }

  const ui = new UIManager(uiRoot);
  const engine = new GameEngine(canvas, {
    onHudUpdate: (hud) => ui.updateHud(hud),
    onRelicDraft: (choices, meters) => ui.showRelicDraft(choices, meters),
    onRunOver: (summary) => ui.showRunSummary(summary),
    onToast: (title, sub, icon) => ui.showToast(title, sub, icon),
    onBiomeBanner: (name, sub) => ui.showBiomeBanner(name, sub),
  });

  ui.attachEngine(engine);

  // Auto-pause if mobile app/tab is backgrounded mid-run so player never dies unfairly!
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      ui.pauseIfPlaying();
    }
  });

  // Keyboard shortcut: Escape pauses/resumes cleanly
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ui.pauseIfPlaying();
    }
  });

  let lastTime = performance.now();
  const loop = (now: number) => {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    engine.step(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Register offline-ready PWA service worker in production
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

bootstrap();
