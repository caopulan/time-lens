/* Time Lens: two equal time panels, isolated from the site's styles. */
(function () {
  'use strict';

  const VERSION = '0.4.1';
  if (window.__timeLensController?.version === VERSION) return;
  window.__timeLensController?.destroy?.();

  const defaults = { sourceZone: '', localZone: '', enabled: true };
  let settings = { ...defaults };
  let host = null;
  let timer = null;
  let dragging = false;
  let lastSignature = '';
  let lastResult = null;
  const listeners = [];

  // No HTML parsing sinks: safe text nodes work on Trusted-Types pages too.
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  const panelStyles = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .comparison {
      color-scheme: light;
      width: 100%;
      overflow: auto;
      max-height: calc(100dvh - 20px);
      border: 1px solid #dfdcd8;
      border-radius: 16px;
      background: #fdfcfb;
      color: #292826;
      box-shadow: 0 10px 34px rgb(42 34 24 / 12%), 0 2px 8px rgb(42 34 24 / 4%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum';
      line-height: 1.4;
      text-align: left;
      direction: ltr;
      cursor: text;
      user-select: text;
      -webkit-user-select: text;
    }
    .time-block { padding: 18px 20px; background: transparent; }
    .time-block + .time-block { border-top: 1px solid #e8e5e1; }
    .weekday { font-size: 12px; font-weight: 500; line-height: 1.4; letter-spacing: .05em; color: #74716d; }
    .date-line { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; column-gap: 14px; row-gap: 4px; margin-top: 5px; }
    .date { font-size: 21px; font-weight: 570; line-height: 1.45; letter-spacing: -.04em; overflow-wrap: anywhere; }
    .clock { font-size: 26px; font-weight: 550; line-height: 1.25; letter-spacing: -.03em; white-space: nowrap; }
    .zone-line { display: flex; align-items: baseline; justify-content: space-between; gap: 5px 12px; margin-top: 13px; flex-wrap: wrap; }
    .zone-name { color: #68645f; font-size: 12px; font-weight: 450; overflow-wrap: anywhere; min-width: 0; }
    .utc-offset { color: #68645f; font-size: 12px; font-weight: 450; font-variant-numeric: tabular-nums; white-space: nowrap; }
    @media (prefers-reduced-motion: no-preference) {
      .comparison { animation: appear 110ms ease-out; }
      @keyframes appear { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
    }
  `;

  function close() {
    host?.remove();
    host = null;
    lastSignature = '';
  }

  function insidePopup(event) {
    return Boolean(host && (event.composedPath?.().includes(host) || host.contains(event.target)));
  }

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }

  function readAnchor(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el) return null;
    // Stay within the selected post, never use the first date from a whole feed.
    const article = el.closest('article, [data-testid="tweet"], .post, .entry, .article');
    let timestamp = null;
    if (article) {
      const times = Array.from(article.querySelectorAll('time[datetime]'))
        .filter(time => time.closest('article, [data-testid="tweet"], .post, .entry, .article') === article);
      if (times.length === 1) timestamp = times[0].getAttribute('datetime');
    } else {
      timestamp = document.querySelector('meta[property="article:published_time"], meta[name="datePublished"]')?.content;
    }
    if (!timestamp || !/T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) return null;
    const epoch = Date.parse(timestamp);
    return Number.isFinite(epoch) ? epoch : null;
  }

  function makeTimePanel(display, label) {
    const panel = element('section', 'time-block');
    panel.setAttribute('aria-label', label);
    if (display.weekday) panel.append(element('div', 'weekday', display.weekday));
    const dateLine = element('div', 'date-line');
    dateLine.append(element('div', 'date', display.date));
    if (display.time) dateLine.append(element('div', 'clock', display.time));
    panel.append(dateLine);
    const zoneLine = element('div', 'zone-line');
    zoneLine.append(element('span', 'zone-name', display.zoneName), element('span', 'utc-offset', display.utcOffset));
    panel.append(zoneLine);
    return panel;
  }

  function show(result, rect) {
    close();
    if (result.status !== 'ok' || !result.sourceDisplay || !result.localDisplay) return;
    host = element('div');
    host.id = 'time-lens-root';
    host.dataset.version = VERSION;
    const style = host.style;
    const hostRules = {
      all: 'initial', display: 'block', position: 'fixed', 'z-index': '2147483647',
      width: '318px', 'max-width': 'calc(100vw - 20px)', margin: '0', padding: '0',
      border: '0', 'pointer-events': 'auto', isolation: 'isolate',
      visibility: 'hidden', left: '10px', top: '10px'
    };
    Object.entries(hostRules).forEach(([key, value]) => style.setProperty(key, value, 'important'));
    const shadow = host.attachShadow({ mode: 'open' });
    const css = element('style');
    css.textContent = panelStyles;
    const comparison = element('div', 'comparison');
    comparison.setAttribute('role', 'group');
    comparison.setAttribute('aria-label', '原始时间与本地时间');
    comparison.append(makeTimePanel(result.sourceDisplay, '原始时间'), makeTimePanel(result.localDisplay, '本地时间'));
    shadow.append(css, comparison);
    document.documentElement.append(host);
    const box = host.getBoundingClientRect();
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - box.width - 10));
    let top = rect.bottom + 10;
    if (top + box.height > window.innerHeight - 10) top = Math.max(10, rect.top - box.height - 10);
    style.setProperty('left', `${left}px`, 'important');
    style.setProperty('top', `${top}px`, 'important');
    style.setProperty('visibility', 'visible', 'important');
  }

  function selectionDetails() {
    const active = document.activeElement;
    if (host && (active === host || host.contains(active))) return null;
    // Input text has no DOM selection range. Never inspect password fields.
    if (active?.tagName === 'TEXTAREA' || (active?.tagName === 'INPUT' && ['text', 'search', 'url', 'tel'].includes(active.type))) {
      if (active.selectionStart === active.selectionEnd) return null;
      return { text: active.value.slice(active.selectionStart, active.selectionEnd).trim(), node: active, rect: active.getBoundingClientRect() };
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    if (host && (host.contains(selection.anchorNode) || selection.anchorNode?.getRootNode?.().host === host)) return null;
    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) rect = selection.anchorNode?.parentElement?.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return { text: selection.toString().trim(), node: selection.anchorNode, rect };
  }

  function examine() {
    if (!settings.enabled || dragging) return;
    const active = document.activeElement;
    const anchorNode = window.getSelection()?.anchorNode;
    if (host && (active === host || host.contains(active) || anchorNode?.getRootNode?.().host === host)) return;
    const selection = selectionDetails();
    if (!selection?.text || selection.text.length > 900) { close(); return; }
    const anchor = readAnchor(selection.node);
    const localZone = settings.localZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const signature = JSON.stringify([selection.text, anchor, settings.sourceZone, localZone]);
    if (host && signature === lastSignature) return;
    try {
      lastResult = TimeLensParser.parse(selection.text, { anchorEpoch: anchor, sourceZone: settings.sourceZone, localZone });
      show(lastResult, selection.rect);
      lastSignature = signature;
    } catch (error) {
      close();
      console.warn('[Time Lens] Unable to parse selection:', error?.message || 'Unknown error');
    }
  }

  function schedule(delay = 100) {
    clearTimeout(timer);
    timer = setTimeout(examine, delay);
  }

  const storageChanged = (changes, area) => {
    if (area !== 'sync') return;
    Object.keys(defaults).forEach(key => {
      if (Object.hasOwn(changes, key)) settings[key] = changes[key].newValue ?? defaults[key];
    });
    close();
    if (settings.enabled) schedule();
  };
  try {
    chrome.storage.sync.get(defaults, values => {
      if (!chrome.runtime.lastError) settings = { ...defaults, ...values };
      if (!settings.enabled) close();
    });
    chrome.storage.onChanged.addListener(storageChanged);
    listeners.push(() => { try { chrome.storage.onChanged.removeListener(storageChanged); } catch {} });
  } catch { /* Keep safe enabled defaults if storage is unavailable. */ }

  listen(document, 'pointerdown', event => {
    if (insidePopup(event)) return;
    clearTimeout(timer);
    dragging = true;
    close();
  }, true);
  listen(document, 'pointerup', event => {
    dragging = false;
    if (!insidePopup(event)) schedule();
  }, true);
  listen(document, 'pointercancel', () => { dragging = false; }, true);
  listen(document, 'mouseup', event => {
    dragging = false;
    if (!insidePopup(event)) schedule();
  }, true);
  listen(document, 'selectionchange', () => {
    if (!dragging && document.activeElement !== host) schedule(180);
  });
  listen(document, 'keyup', event => {
    if (event.key === 'Escape') { clearTimeout(timer); close(); return; }
    if (insidePopup(event)) return;
    if (['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A'].includes(event.key)) schedule();
  }, true);
  listen(window, 'scroll', event => {
    if (!insidePopup(event)) { clearTimeout(timer); close(); }
  }, true);
  listen(window, 'resize', close);
  listen(window, 'focus', () => {
    if (host && settings.enabled) {
      // An undated clock uses today's timezone rules, which may change while away.
      if (lastResult?.sourceKind === 'time') lastSignature = '';
      schedule();
    }
  });

  window.__timeLensController = {
    version: VERSION,
    getLastResult: () => lastResult,
    destroy() { clearTimeout(timer); close(); listeners.forEach(remove => remove()); }
  };
})();
