let glowHost: HTMLElement | null = null;
let glowTimer: ReturnType<typeof setTimeout> | undefined;

export function markAgent() {
  document.documentElement?.setAttribute('data-aeye-agent', '');
  glow(true);
}

export function glow(on: boolean) {
  const root = document.documentElement;
  if (!root) return;
  if (!glowHost) {
    glowHost = document.createElement('aeye-glow');
    const sr = glowHost.attachShadow({ mode: 'closed' });
    sr.innerHTML =
      '<div style="position:fixed;inset:0;pointer-events:none;z-index:2147483647;' +
      'box-shadow:inset 0 0 0 3px rgba(255,110,40,.9),inset 0 0 28px rgba(255,110,40,.45)"></div>';
  }
  if (!glowHost.isConnected) root.appendChild(glowHost);
  glowHost.style.display = on ? '' : 'none';
  clearTimeout(glowTimer);
  if (on) glowTimer = setTimeout(() => glowHost && (glowHost.style.display = 'none'), 6000);
}
