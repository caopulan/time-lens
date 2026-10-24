/* DOM/event tests. Geometry is stubbed: this is NOT a visual browser test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require(require.resolve('jsdom', { paths: [process.env.TIME_LENS_TEST_DEPS || __dirname] }));
const parser = fs.readFileSync(path.join(__dirname, 'parser.js'), 'utf8');
const content = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 220));
let count = 0;

function setup(html, overrides = {}, behavior = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: 'https://time-lens.test/post', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  let systemZone = behavior.systemZone;
  let nowEpoch = behavior.nowEpoch;
  if (Number.isFinite(nowEpoch)) window.Date.now = () => nowEpoch;
  if (systemZone) {
    const NativeDateTimeFormat = window.Intl.DateTimeFormat;
    function SystemDateTimeFormat(locales, options) {
      return new NativeDateTimeFormat(locales, { ...options, timeZone: options?.timeZone || systemZone });
    }
    SystemDateTimeFormat.prototype = NativeDateTimeFormat.prototype;
    SystemDateTimeFormat.supportedLocalesOf = NativeDateTimeFormat.supportedLocalesOf.bind(NativeDateTimeFormat);
    window.Intl.DateTimeFormat = SystemDateTimeFormat;
  }
  const store = { enabled: true, sourceZone: '', localZone: 'Asia/Shanghai', ...overrides };
  const changed = new Set();
  window.chrome = {
    runtime: { lastError: null },
    storage: {
      sync: { get: (defaults, cb) => cb({ ...defaults, ...store }) },
      onChanged: { addListener: fn => changed.add(fn), removeListener: fn => changed.delete(fn) }
    }
  };
  const rect = { left: 40, right: 540, top: 90, bottom: 120, width: 500, height: 30, x: 40, y: 90 };
  window.Range.prototype.getBoundingClientRect = () => rect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.id === 'time-lens-root' ? { ...rect, width: 318, height: 245 } : rect;
  };
  window.eval(parser);
  window.eval(content);
  async function select(selector = '#sample', trigger = 'mouseup') {
    const node = window.document.querySelector(selector);
    const range = window.document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    node.dispatchEvent(new window.MouseEvent(trigger, { bubbles: true, composed: true }));
    await tick();
    return window.document.querySelector('#time-lens-root');
  }
  return { dom, window, errors, changed, select, setSystemZone: zone => { systemZone = zone; }, setNowEpoch: value => { nowEpoch = value; }, close: () => { window.__timeLensController.destroy(); dom.window.close(); } };
}

async function test(name, fn) {
  await fn();
  count++;
  console.log('PASS ' + name);
}

(async () => {
  await test('Screenshot: exactly two equal panels with correct October date and UTC offsets', async () => {
    const t = setup('<article><p id="sample">USA (PDT) Before 10:00 AM, Oct 23</p><time datetime="2026-10-23T04:47:00Z"></time></article>');
    try {
      const host = await t.select();
      assert.ok(host, 'popup must open');
      const root = host.shadowRoot;
      const panels = [...root.querySelectorAll('.time-block')];
      assert.equal(panels.length, 2);
      assert.equal(root.querySelector('.comparison').children.length, 2);
      const values = panels.map(panel => [...panel.querySelectorAll('.weekday,.date,.clock,.zone-name,.utc-offset')].map(x => x.textContent));
      assert.deepEqual(values, [
        ['周五','10月23日','10:00','PDT','UTC-7'],
        ['周六','10月24日','01:00','Asia/Shanghai','UTC+8']
      ]);
      assert.equal(root.querySelectorAll('.weekday').length, 2);
      assert.equal(root.querySelectorAll('.year').length, 0);
      assert.ok(!root.querySelector('.comparison').textContent.includes('2026'));
      assert.equal(panels[0].className, panels[1].className);
      assert.equal(panels[0].querySelector('.weekday').className, panels[1].querySelector('.weekday').className);
      assert.equal(panels[0].querySelector('.clock').className, panels[1].querySelector('.clock').className);
      assert.equal(root.querySelectorAll('button,input,textarea,h1,h2,header,.tl-warning,.tl-original').length, 0);
      assert.equal(host.dataset.version, '0.4.1');
      assert.deepEqual(t.errors, []);
    } finally { t.close(); }
  });

  await test('Date-only: both clock elements are absent, local date may be a range', async () => {
    const t = setup('<p id="sample">May 04 \'26 (Anywhere on Earth)</p>');
    try {
      const host = await t.select();
      assert.ok(host);
      assert.equal(host.shadowRoot.querySelectorAll('.clock').length, 0);
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.date')].map(x=>x.textContent), ['5月4日','5月4日–5月5日']);
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.weekday')].map(x=>x.textContent), ['周一','周一–周二']);
      assert.equal(host.shadowRoot.querySelectorAll('.year').length, 0);
      assert.ok(!host.shadowRoot.querySelector('.comparison').textContent.includes('2026'));
      assert.ok(!host.shadowRoot.querySelector('.comparison').textContent.includes('23:59'));
    } finally { t.close(); }
  });

  await test('Date-only year boundary shows weekday range, not a year label', async () => {
    const t = setup('<p id="sample">December 31, 2026 AoE</p>');
    try {
      const host = await t.select();
      assert.ok(host);
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.weekday')].map(x=>x.textContent), ['周四','周四–周五']);
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.date')].map(x=>x.textContent), ['12月31日','12月31日–1月1日']);
      assert.equal(host.shadowRoot.querySelectorAll('.year,.clock').length, 0);
      assert.ok(!/2026|2027/.test(host.shadowRoot.querySelector('.comparison').textContent));
    } finally { t.close(); }
  });

  await test('Nonwhole UTC offsets retain minutes while zero offset is UTC', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am UTC+05:45</p>', {localZone:'UTC'});
    try {
      const host = await t.select();
      assert.ok(host);
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.utc-offset')].map(x=>x.textContent), ['UTC+5:45','UTC']);
      assert.equal(host.shadowRoot.querySelectorAll('.year').length, 0);
    } finally { t.close(); }
  });

  await test('System mode refreshes the same selection after the OS timezone changes', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am UTC</p>', { localZone: '' }, { systemZone: 'Asia/Shanghai' });
    try {
      let host = await t.select();
      assert.equal(host.shadowRoot.querySelectorAll('.zone-name')[1].textContent, 'Asia/Shanghai');
      assert.equal(host.shadowRoot.querySelectorAll('.clock')[1].textContent, '18:00');
      t.setSystemZone('Asia/Tokyo');
      host = await t.select();
      assert.equal(host.shadowRoot.querySelectorAll('.zone-name')[1].textContent, 'Asia/Tokyo');
      assert.equal(host.shadowRoot.querySelectorAll('.clock')[1].textContent, '19:00');
      assert.equal(host.shadowRoot.querySelectorAll('.utc-offset')[1].textContent, 'UTC+9');
    } finally { t.close(); }
  });

  await test('Manual timezone stays fixed when the system timezone changes', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am UTC</p>', { localZone: 'Asia/Shanghai' }, { systemZone: 'Asia/Shanghai' });
    try {
      await t.select();
      t.setSystemZone('Asia/Tokyo');
      const host = await t.select();
      assert.equal(host.shadowRoot.querySelectorAll('.zone-name')[1].textContent, 'Asia/Shanghai');
      assert.equal(host.shadowRoot.querySelectorAll('.clock')[1].textContent, '18:00');
    } finally { t.close(); }
  });

  await test('Capture listener works when a site stops mouseup bubbling', async () => {
    const t = setup('<div id="stopper"><p id="sample">October 23, 2026 10am PDT</p></div>');
    try {
      t.window.document.querySelector('#stopper').addEventListener('mouseup', event => event.stopPropagation());
      assert.ok(await t.select());
    } finally { t.close(); }
  });

  await test('Spelled-out month and dotted p.m. trigger without the old narrow prefilter', async () => {
    const t = setup('<p id="sample">December 4, 2026 at 6 p.m. Pacific time</p>');
    try { assert.ok(await t.select()); } finally { t.close(); }
  });

  await test('selectionchange path works without mouseup', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>');
    try {
      await t.select('#sample', 'selectionchange');
      assert.ok(t.window.document.querySelector('#time-lens-root'));
    } finally { t.close(); }
  });

  await test('Pointer release trigger works', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>');
    try { assert.ok(await t.select('#sample', 'pointerup')); } finally { t.close(); }
  });

  await test('HTML sink restriction does not affect rendering', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>');
    const descriptor = Object.getOwnPropertyDescriptor(t.window.Element.prototype, 'innerHTML');
    try {
      Object.defineProperty(t.window.Element.prototype, 'innerHTML', { set() { throw new TypeError('TrustedHTML required'); }, configurable: true });
      assert.ok(await t.select());
      assert.deepEqual(t.errors, []);
    } finally {
      Object.defineProperty(t.window.Element.prototype, 'innerHTML', descriptor);
      t.close();
    }
  });

  await test('Scrolling inside the popover does not dismiss it', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>');
    try {
      const host = await t.select();
      host.shadowRoot.querySelector('.comparison').dispatchEvent(new t.window.Event('scroll', { bubbles: true, composed: true }));
      assert.ok(t.window.document.querySelector('#time-lens-root'));
    } finally { t.close(); }
  });

  await test('Escape dismisses the popover', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>');
    try {
      await t.select();
      t.window.document.dispatchEvent(new t.window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
      assert.equal(t.window.document.querySelector('#time-lens-root'), null);
    } finally { t.close(); }
  });

  await test('Keyboard or programmatic deselection clears stale popup', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>');
    try {
      await t.select();
      t.window.getSelection().removeAllRanges();
      t.window.document.dispatchEvent(new t.window.Event('selectionchange'));
      await tick();
      assert.equal(t.window.document.querySelector('#time-lens-root'), null);
    } finally { t.close(); }
  });

  await test('Outside pointer click dismisses the popover', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>');
    try {
      await t.select();
      t.window.document.body.dispatchEvent(new t.window.MouseEvent('pointerdown', { bubbles: true }));
      assert.equal(t.window.document.querySelector('#time-lens-root'), null);
    } finally { t.close(); }
  });

  await test('Disabled setting prevents popup', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>', { enabled: false });
    try { assert.equal(await t.select(), null); } finally { t.close(); }
  });

  await test('Time-only selections show an empty source date and the correct local day relation', async () => {
    for (const sample of [
      { text: '10am PST', localZone: 'Asia/Shanghai', sourceTime: '10:00', localTime: '02:00', label: '第二天' },
      { text: '09:15 UTC+8', localZone: 'UTC', sourceTime: '09:15', localTime: '01:15', label: '当天' },
      { text: '00:30 UTC+8', localZone: 'UTC', sourceTime: '00:30', localTime: '16:30', label: '前一天' }
    ]) {
      const t = setup('<article><p id="sample">' + sample.text + '</p><time datetime="2020-01-02T04:47:00Z"></time></article>', { localZone: sample.localZone });
      try {
        const host = await t.select();
        assert.ok(host, sample.text);
        const root = host.shadowRoot;
        const panels = [...root.querySelectorAll('.time-block')];
        assert.equal(panels.length, 2);
        assert.equal(panels[0].className, panels[1].className);
        assert.deepEqual([...root.querySelectorAll('.date')].map(x => x.textContent), ['', sample.label]);
        assert.deepEqual([...root.querySelectorAll('.clock')].map(x => x.textContent), [sample.sourceTime, sample.localTime]);
        assert.equal(root.querySelectorAll('.weekday,.year').length, 0);
        assert.ok(!/\d+月|2020/.test(root.querySelector('.comparison').textContent));
        const result = t.window.__timeLensController.getLastResult();
        assert.equal(result.sourceKind, 'time');
        assert.equal(result.sourceDate, null);
        assert.deepEqual(t.errors, []);
      } finally { t.close(); }
    }
  });

  await test('Undated regional time refreshes today’s DST rule when returning to the window', async () => {
    const t = setup('<p id="sample">10am PT</p>', { localZone: 'UTC' }, { nowEpoch: Date.parse('2026-01-15T12:00:00Z') });
    try {
      let host = await t.select();
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.clock')].map(x => x.textContent), ['10:00', '18:00']);
      t.setNowEpoch(Date.parse('2026-07-15T12:00:00Z'));
      t.window.dispatchEvent(new t.window.Event('focus'));
      await tick();
      host = t.window.document.querySelector('#time-lens-root');
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.clock')].map(x => x.textContent), ['10:00', '17:00']);
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.date')].map(x => x.textContent), ['', '当天']);
      assert.deepEqual([...host.shadowRoot.querySelectorAll('.utc-offset')].map(x => x.textContent), ['UTC-7', 'UTC']);
    } finally { t.close(); }
  });

  await test('Different post timestamp is never borrowed', async () => {
    const t = setup('<article><time datetime="2026-10-23T04:47:00Z"></time></article><article><p id="sample">Oct 23 10am PDT</p></article>');
    try { assert.equal(await t.select(), null); } finally { t.close(); }
  });

  await test('Same script injected twice does not duplicate the popup', async () => {
    const t = setup('<p id="sample">October 23, 2026 10am PDT</p>');
    try {
      t.window.eval(content);
      await t.select();
      assert.equal(t.window.document.querySelectorAll('#time-lens-root').length, 1);
    } finally { t.close(); }
  });

  console.log('All ' + count + ' Time Lens DOM/event tests passed (not browser visual verification).');
})().catch(error => { console.error(error); process.exitCode = 1; });
