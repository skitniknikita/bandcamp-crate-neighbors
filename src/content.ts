(() => {
  const scope = globalThis as typeof globalThis & { __crateNeighbors?: boolean };
  if (scope.__crateNeighbors) return;
  scope.__crateNeighbors = true;
  function profileUrl(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return;
    const fan = value as Record<string, unknown>;
    if (typeof fan.username === 'string' && /^[a-zA-Z0-9_-]+$/.test(fan.username)) return 'https://bandcamp.com/' + fan.username;
    if (typeof fan.trackpipe_url === 'string') {
      try {
        const url = new URL(fan.trackpipe_url);
        if (url.origin === 'https://bandcamp.com' && /^\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) return url.href;
      } catch { /* A missing profile is handled by the URL input. */ }
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== 'crate-page-context') return;
    let detected: string | undefined;
    try {
      const raw = document.querySelector('#pagedata')?.getAttribute('data-blob');
      const page = raw ? JSON.parse(raw) : {};
      detected = profileUrl(page.current_fan) ||
        (page.fan_data?.is_own_page ? profileUrl(page.fan_data) : undefined) ||
        profileUrl(page.identities?.fan);
    } catch { /* Never return the source blob. */ }
    if (!detected) {
      const links = document.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"][aria-label], #menubar-wrapper a, #user-menu a, .menubar a, header a');
      for (const link of links) {
        if (!/^(your )?collection$|^коллекция$/i.test((link.getAttribute('aria-label') || link.textContent || '').trim())) continue;
        try {
          const url = new URL(link.href);
          if (url.origin === 'https://bandcamp.com' && /^\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) { detected = url.href; break; }
        } catch { /* Ignore malformed navigation links. */ }
      }
    }
    const releaseUrl = /^\/(album|track)\/[^/]+/.test(location.pathname) ? location.href.split(/[?#]/)[0] : undefined;
    respond({ profileUrl: detected, releaseUrl });
  });
})();
