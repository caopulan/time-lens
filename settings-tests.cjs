/* Settings tests with mocked Chrome storage and system timezone.
   This verifies behavior and DOM state, not browser rendering. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require(require.resolve('jsdom', {
  paths: [process.env.TIME_LENS_TEST_DEPS || __dirname]
}));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let count = 0;

async function setup(persisted = {}, behavior = {}) {
  const errors = [];
  const writes = [];
  const changed = new Set();
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'options.html'), 'utf8'), {
    url: 'chrome-extension://time-lens-test/options.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  let systemZone = behavior.systemZone || 'Asia/Shanghai';
  let nowEpoch = Date.parse(behavior.now || '2026-10-24T12:00:00Z');
  const NativeDate = window.Date;
  class TestDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [nowEpoch])); }
    static now() { return nowEpoch; }
  }
  window.Date = TestDate;
  const NativeDateTimeFormat = window.Intl.DateTimeFormat;
  function LocalDateTimeFormat(locales, options) {
    const resolved = { ...options };
    if (!resolved.timeZone) resolved.timeZone = systemZone;
    return new NativeDateTimeFormat(locales, resolved);
  }
  LocalDateTimeFormat.prototype = NativeDateTimeFormat.prototype;
  LocalDateTimeFormat.supportedLocalesOf = NativeDateTimeFormat.supportedLocalesOf.bind(NativeDateTimeFormat);
  window.Intl.DateTimeFormat = LocalDateTimeFormat;
  if (behavior.noEnumeration) window.Intl.supportedValuesOf = undefined;

  const runtime = {
    lastError: null,
    getManifest: () => ({ version: '0.4.1' }),
    openOptionsPage: () => Promise.resolve()
  };
  function getResult(keys) {
    if (keys === null || keys === undefined) return { ...persisted };
    if (typeof keys === 'object' && !Array.isArray(keys)) return { ...keys, ...persisted };
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(persisted, key)).map(key => [key, persisted[key]]));
  }
  function callbackResult(callback, error, value) {
    if (error) runtime.lastError = { message: error };
    try { callback(value); } finally { runtime.lastError = null; }
  }
  const storage = {
    get(keys, callback) {
      if (typeof callback !== 'function') {
        return delay(behavior.readDelay || 0).then(() => {
          if (behavior.readError) throw new Error(behavior.readError);
          return getResult(keys);
        });
      }
      setTimeout(() => callbackResult(callback, behavior.readError, behavior.readError ? undefined : getResult(keys)), behavior.readDelay || 0);
    },
    set(values, callback) {
      const patch = JSON.parse(JSON.stringify(values));
      writes.push(patch);
      const complete = () => {
        if (behavior.writeError) throw new Error(behavior.writeError);
        const delta = {};
        for (const [key, value] of Object.entries(patch)) {
          delta[key] = { oldValue: persisted[key], newValue: value };
          persisted[key] = value;
        }
        for (const fn of changed) fn(delta, 'sync');
      };
      if (typeof callback !== 'function') return Promise.resolve().then(complete);
      setTimeout(() => {
        if (behavior.writeError) return callbackResult(callback, behavior.writeError);
        complete();
        callbackResult(callback, null);
      }, behavior.writeDelay || 0);
    }
  };
  window.chrome = {
    runtime,
    storage: {
      sync: storage,
      onChanged: { addListener: fn => changed.add(fn), removeListener: fn => changed.delete(fn) }
    }
  };
  for (const script of window.document.querySelectorAll('script[src]')) {
    const source = script.getAttribute('src');
    assert.ok(!source.includes('://') && !source.includes('..'), 'settings scripts must be local');
    window.eval(fs.readFileSync(path.join(__dirname, source), 'utf8'));
  }
  await delay((behavior.readDelay || 0) + 25);
  const byId = id => {
    const el = window.document.getElementById(id);
    assert.ok(el, 'Missing setting element #' + id);
    return el;
  };
  async function click(id) {
    byId(id).click();
    await delay((behavior.writeDelay || 0) + 25);
  }
  async function toggle(value) {
    byId('enabled').checked = value;
    byId('enabled').dispatchEvent(new window.Event('change', { bubbles: true }));
    await delay((behavior.writeDelay || 0) + 25);
  }
  const options = () => [...byId('timezone-options').querySelectorAll('[role=option]')];
  const optionFor = zone => options().find(option => option.dataset.zone === zone);
  function chooseZone(zone) {
    if (byId('localZone').getAttribute('aria-expanded') !== 'true') byId('localZone').click();
    const option = optionFor(zone);
    assert.ok(option, 'Missing timezone option ' + zone);
    option.click();
  }
  async function enterZone(zone) {
    chooseZone(zone);
    await delay((behavior.writeDelay || 0) + 25);
  }
  async function key(value, modifiers = {}) {
    const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...modifiers });
    byId('localZone').dispatchEvent(event);
    await delay((behavior.writeDelay || 0) + 25);
    return event;
  }
  return { dom, window, persisted, errors, writes, byId, click, toggle, enterZone, chooseZone, key, options, optionFor,
    setSystemZone: value => { systemZone = value; },
    setNow: value => { nowEpoch = Date.parse(value); },
    close: () => dom.window.close() };
}

async function test(name, fn) {
  await fn(); count++;
  console.log('PASS ' + name);
}

(async () => {
  await test('Fresh settings default to enabled and follow the system without saving during load', async () => {
    const t = await setup();
    try {
      assert.equal(t.byId('enabled').checked, true);
      assert.equal(t.byId('mode-system').getAttribute('aria-pressed'), 'true');
      assert.equal(t.byId('mode-manual').getAttribute('aria-pressed'), 'false');
      assert.equal(t.byId('manual-zone').hidden, true);
      assert.equal(t.byId('active-zone').textContent.trim(), 'Asia/Shanghai');
      assert.equal(t.byId('active-offset').textContent.trim(), 'UTC+8');
      assert.equal(t.writes.length, 0);
      assert.deepEqual(t.errors, []);
    } finally { t.close(); }
  });

  await test('Stored enabled/manual settings hydrate without overwriting them', async () => {
    const t = await setup({ enabled: false, localZone: 'America/New_York' });
    try {
      assert.equal(t.byId('enabled').checked, false);
      assert.equal(t.byId('mode-manual').getAttribute('aria-pressed'), 'true');
      assert.equal(t.byId('manual-zone').hidden, false);
      assert.equal(t.byId('localZone').value, 'America/New_York');
      assert.equal(t.byId('active-zone').textContent.trim(), 'America/New_York');
      assert.equal(t.writes.length, 0);
    } finally { t.close(); }
  });

  await test('Enabled switch saves automatically', async () => {
    const t = await setup({ enabled: true, localZone: '' });
    try {
      await t.toggle(false);
      assert.equal(t.persisted.enabled, false);
      await t.toggle(true);
      assert.equal(t.persisted.enabled, true);
      assert.ok(t.writes.some(patch => patch.enabled === false));
      assert.equal(t.window.document.querySelector('#save'), null);
    } finally { t.close(); }
  });

  await test('System to manual selects and persists an explicit detected zone', async () => {
    const t = await setup({ enabled: true, localZone: '' });
    try {
      await t.click('mode-manual');
      assert.equal(t.byId('manual-zone').hidden, false);
      assert.equal(t.byId('mode-manual').getAttribute('aria-pressed'), 'true');
      assert.equal(t.persisted.localZone, 'Asia/Shanghai');
      assert.equal(t.byId('localZone').value, 'Asia/Shanghai');
    } finally { t.close(); }
  });

  await test('Manual to system stores empty preference and displays the actual system zone', async () => {
    const t = await setup({ enabled: true, localZone: 'America/New_York' });
    try {
      await t.click('mode-system');
      assert.equal(t.persisted.localZone, '');
      assert.equal(t.byId('manual-zone').hidden, true);
      assert.equal(t.byId('active-zone').textContent.trim(), 'Asia/Shanghai');
      assert.equal(t.byId('active-offset').textContent.trim(), 'UTC+8');
    } finally { t.close(); }
  });

  await test('Clicking a valid dropdown option commits and closes the list', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      await t.enterZone('Europe/London');
      assert.equal(t.persisted.localZone, 'Europe/London');
      assert.equal(t.byId('active-zone').textContent.trim(), 'Europe/London');
      assert.ok(!t.byId('zone-error').textContent.trim());
      assert.equal(t.byId('localZone').getAttribute('aria-expanded'), 'false');
      assert.equal(t.byId('timezone-options').hidden, true);
      assert.equal(t.window.document.activeElement, t.byId('localZone'));
    } finally { t.close(); }
  });

  await test('Select-only combobox contains the full runtime list and UTC before interaction', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      const combobox = t.byId('localZone');
      const values = new Set(t.options().map(option => option.dataset.zone));
      assert.equal(combobox.getAttribute('role'), 'combobox');
      assert.equal(combobox.getAttribute('aria-controls'), 'timezone-options');
      assert.equal(t.byId('timezone-options').getAttribute('role'), 'listbox');
      assert.equal(t.window.document.querySelector('datalist'), null);
      assert.equal(t.window.document.querySelector('input[type=text], select'), null);
      assert.ok(values.has('UTC'));
      const supported = t.window.Intl.supportedValuesOf('timeZone');
      assert.ok(supported.length > 300, 'test runtime should provide a complete list');
      assert.ok(supported.every(zone => values.has(zone)), 'every runtime-supported timezone must be listed');
      assert.equal(values.size, t.options().length, 'duplicate option values are not useful');
    } finally { t.close(); }
  });

  await test('Selecting one timezone does not filter the dropdown to the current value', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      const before = t.options().map(option => option.dataset.zone);
      await t.enterZone('Asia/Tokyo');
      assert.equal(t.persisted.localZone, 'Asia/Tokyo');
      assert.deepEqual(t.options().map(option => option.dataset.zone), before);
    } finally { t.close(); }
  });

  await test('Arrow, Home, and End keys move focus without saving until Enter', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      const combobox = t.byId('localZone');
      const active = () => t.window.document.getElementById(combobox.getAttribute('aria-activedescendant'));
      await t.key('ArrowDown');
      assert.equal(combobox.getAttribute('aria-expanded'), 'true');
      assert.equal(t.byId('timezone-options').hidden, false);
      assert.equal(t.window.document.activeElement, combobox);
      assert.equal(active(), t.optionFor('Asia/Shanghai'));
      await t.key('ArrowDown');
      assert.notEqual(active(), t.optionFor('Asia/Shanghai'));
      await t.key('Home');
      assert.equal(active(), t.options()[0]);
      await t.key('End');
      assert.equal(active(), t.options().at(-1));
      await t.key('ArrowUp');
      assert.equal(active(), t.options().at(-2));
      const chosenZone = active().dataset.zone;
      assert.equal(active().dataset.active, 'true');
      assert.equal(t.optionFor('Asia/Shanghai').getAttribute('aria-selected'), 'true');
      assert.equal(combobox.value, 'Asia/Shanghai');
      assert.equal(t.persisted.localZone, 'Asia/Shanghai');
      assert.equal(t.writes.length, 0);
      await t.key('Enter');
      assert.equal(t.persisted.localZone, chosenZone);
      assert.equal(t.writes.length, 1);
      assert.equal(t.optionFor(chosenZone).getAttribute('aria-selected'), 'true');
      assert.equal(combobox.getAttribute('aria-expanded'), 'false');
      assert.equal(combobox.hasAttribute('aria-activedescendant'), false);
    } finally { t.close(); }
  });

  await test('Escape cancels highlight and reopening restores the committed option', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      await t.click('localZone');
      await t.key('End');
      await t.key('Escape');
      assert.equal(t.byId('localZone').getAttribute('aria-expanded'), 'false');
      assert.equal(t.byId('timezone-options').hidden, true);
      assert.equal(t.byId('localZone').value, 'Asia/Shanghai');
      assert.equal(t.persisted.localZone, 'Asia/Shanghai');
      assert.equal(t.writes.length, 0);
      await t.click('localZone');
      assert.equal(t.byId('localZone').getAttribute('aria-activedescendant'), t.optionFor('Asia/Shanghai').id);
      assert.equal(t.options().filter(option => option.dataset.active === 'true').length, 1);
      assert.equal(t.window.document.activeElement, t.byId('localZone'));
    } finally { t.close(); }
  });

  await test('Space opens and selects without invoking the button default click twice', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      assert.equal((await t.key(' ')).defaultPrevented, true);
      assert.equal(t.byId('localZone').getAttribute('aria-expanded'), 'true');
      await t.key('Home');
      assert.equal((await t.key(' ')).defaultPrevented, true);
      assert.equal(t.byId('localZone').getAttribute('aria-expanded'), 'false');
      assert.equal(t.persisted.localZone, 'UTC');
      assert.equal(t.writes.length, 1);
    } finally { t.close(); }
  });

  await test('Tab, outside click, and focus leaving close without committing a highlight', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      await t.click('localZone');
      await t.key('End');
      assert.equal((await t.key('Tab')).defaultPrevented, false, 'Tab must retain normal focus navigation');
      assert.equal(t.byId('timezone-options').hidden, true);
      await t.click('localZone');
      await t.key('Home');
      t.byId('zone-heading').dispatchEvent(new t.window.Event('pointerdown', { bubbles: true }));
      assert.equal(t.byId('timezone-options').hidden, true);
      await t.click('localZone');
      await t.key('Home');
      t.byId('zone-heading').click();
      assert.equal(t.byId('timezone-options').hidden, true);
      await t.click('localZone');
      await t.key('End');
      t.byId('enabled').focus();
      assert.equal(t.byId('timezone-options').hidden, true);
      assert.equal(t.window.document.activeElement, t.byId('enabled'));
      assert.equal(t.persisted.localZone, 'Asia/Shanghai');
      assert.equal(t.writes.length, 0);
    } finally { t.close(); }
  });

  await test('Prefix typing locates a timezone without filtering or saving until confirmed', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      const values = t.options().map(option => option.dataset.zone);
      for (const character of 'Europe/London') await t.key(character);
      assert.equal(t.byId('localZone').getAttribute('aria-activedescendant'), t.optionFor('Europe/London').id);
      assert.equal(t.byId('localZone').value, 'Asia/Shanghai');
      assert.equal(t.writes.length, 0);
      assert.deepEqual(t.options().map(option => option.dataset.zone), values);
      await t.key('Enter');
      assert.equal(t.persisted.localZone, 'Europe/London');
      assert.equal(t.writes.length, 1);
    } finally { t.close(); }
  });

  await test('An invalid option value is not saved', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      await t.click('localZone');
      const option = t.optionFor('UTC');
      option.dataset.zone = 'Wrong/Imaginary_Zone';
      option.click();
      await delay(25);
      assert.equal(t.persisted.localZone, 'Asia/Shanghai');
      assert.ok(t.byId('zone-error').textContent.trim());
      assert.ok(!t.writes.some(patch => patch.localZone === 'Wrong/Imaginary_Zone'));
    } finally { t.close(); }
  });

  await test('An empty selection does not silently switch or overwrite the saved zone', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      await t.click('localZone');
      const option = t.optionFor('UTC');
      option.dataset.zone = '';
      option.click();
      await delay(25);
      assert.equal(t.persisted.localZone, 'Asia/Shanghai');
      assert.equal(t.byId('mode-manual').getAttribute('aria-pressed'), 'true');
      assert.ok(t.byId('zone-error').textContent.trim());
    } finally { t.close(); }
  });

  await test('Switching to system wins over a queued manual selection save', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' }, { writeDelay: 40 });
    try {
      t.chooseZone('America/New_York');
      await t.click('mode-system');
      await delay(80);
      assert.equal(t.persisted.localZone, '');
      assert.equal(t.byId('mode-system').getAttribute('aria-pressed'), 'true');
      assert.equal(t.byId('active-zone').textContent.trim(), 'Asia/Shanghai');
    } finally { t.close(); }
  });

  await test('Storage writes preserve sourceZone and unrelated prior settings', async () => {
    const persisted = { enabled: true, localZone: '', sourceZone: 'America/Los_Angeles', unrelated: { keep: true } };
    const t = await setup(persisted);
    try {
      await t.toggle(false);
      await t.click('mode-manual');
      await t.enterZone('UTC');
      assert.equal(persisted.sourceZone, 'America/Los_Angeles');
      assert.deepEqual(persisted.unrelated, { keep: true });
      assert.ok(t.writes.every(patch => Object.keys(patch).every(key => ['enabled','localZone'].includes(key))));
    } finally { t.close(); }
  });

  await test('Half-hour and zero offsets are displayed compactly', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Kolkata' });
    try {
      assert.equal(t.byId('active-offset').textContent.trim(), 'UTC+5:30');
      await t.enterZone('UTC');
      assert.equal(t.byId('active-offset').textContent.trim(), 'UTC');
    } finally { t.close(); }
  });

  await test('Every dropdown row separates the full timezone, fixed UTC prefix, signed value, and mark', async () => {
    const t = await setup({ enabled: true, localZone: 'Asia/Shanghai' });
    try {
      for (const option of t.options()) {
        assert.equal(option.querySelector('.zone-name').textContent, option.dataset.zone);
        assert.equal(option.querySelector('.zone-offset > .utc-prefix').textContent, 'UTC');
        assert.match(option.querySelector('.zone-offset > .utc-value').textContent, /^(?:[+-]\d{1,2}(?::\d{2})?(?::\d{2})?)?$/);
        assert.equal(option.children.length, 3);
        assert.equal(option.lastElementChild.className, 'zone-mark');
        assert.equal(option.title, option.getAttribute('aria-label'));
      }
      const label = zone => t.optionFor(zone).getAttribute('aria-label');
      assert.equal(label('Asia/Shanghai'), 'Asia/Shanghai · UTC+8');
      assert.equal(label('Asia/Kathmandu'), 'Asia/Kathmandu · UTC+5:45');
      assert.equal(label('Asia/Kolkata'), 'Asia/Kolkata · UTC+5:30');
      assert.equal(label('UTC'), 'UTC · UTC');
      assert.equal(t.optionFor('UTC').querySelector('.utc-value').textContent, '');
      assert.equal(t.byId('local-zone-offset').querySelector('.utc-prefix').textContent, 'UTC');
      assert.equal(t.byId('local-zone-offset').querySelector('.utc-value').textContent, '+8');
      const css = fs.readFileSync(path.join(__dirname, 'options.css'), 'utf8');
      assert.match(css, /\.zone-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+72px\s+12px/);
      assert.match(css, /\.zone-offset\s*\{[^}]*grid-template-columns:\s*3ch\s+minmax\(0,\s*1fr\)/);
      assert.match(css, /\.zone-list\s*\{[^}]*max-height:\s*196px;[^}]*overflow-y:\s*auto/);
    } finally { t.close(); }
  });

  await test('Current offsets in list and summary refresh together across DST', async () => {
    const t = await setup({ enabled: true, localZone: 'America/New_York' }, { now: '2026-01-15T12:00:00Z' });
    try {
      const selected = () => t.options().find(option => option.getAttribute('aria-selected') === 'true').getAttribute('aria-label');
      assert.equal(selected(), 'America/New_York · UTC-5');
      assert.equal(t.byId('active-offset').textContent, 'UTC-5');
      t.setNow('2026-07-15T12:00:00Z');
      t.window.dispatchEvent(new t.window.Event('focus'));
      await delay(25);
      assert.equal(selected(), 'America/New_York · UTC-4');
      assert.equal(t.byId('active-offset').textContent, 'UTC-4');
      assert.equal(t.writes.length, 0, 'refreshing labels must not overwrite preferences');
    } finally { t.close(); }
  });

  await test('Valid saved timezone alias remains selectable without canonicalization', async () => {
    const t = await setup({ enabled: true, localZone: 'US/Eastern' });
    try {
      assert.equal(t.byId('localZone').value, 'US/Eastern');
      assert.equal(t.byId('active-zone').textContent, 'US/Eastern');
      assert.ok(t.optionFor('US/Eastern'));
      assert.equal(t.writes.length, 0);
      assert.equal(t.persisted.localZone, 'US/Eastern');
    } finally { t.close(); }
  });

  await test('Unavailable timezone enumeration reports compatibility error and preserves saved zone', async () => {
    const t = await setup({ enabled: true, localZone: 'US/Eastern' }, { noEnumeration: true });
    try {
      assert.equal(t.byId('localZone').value, 'US/Eastern');
      assert.ok(t.byId('zone-error').textContent.includes('完整时区列表'));
      assert.equal(t.persisted.localZone, 'US/Eastern');
      assert.equal(t.writes.length, 0);
    } finally { t.close(); }
  });

  await test('Follow-system preference uses the new system zone after reopening', async () => {
    const persisted = { enabled: true, localZone: '' };
    const first = await setup(persisted, { systemZone: 'Asia/Shanghai' });
    first.close();
    const t = await setup(persisted, { systemZone: 'Asia/Tokyo' });
    try {
      assert.equal(t.byId('active-zone').textContent.trim(), 'Asia/Tokyo');
      assert.equal(t.byId('active-offset').textContent.trim(), 'UTC+9');
      assert.equal(t.persisted.localZone, '');
      assert.equal(t.writes.length, 0);
    } finally { t.close(); }
  });

  await test('Saved settings survive reopening the popup', async () => {
    const persisted = { enabled: true, localZone: '' };
    const first = await setup(persisted);
    await first.click('mode-manual');
    await first.enterZone('Europe/Paris');
    await first.toggle(false);
    first.close();
    const t = await setup(persisted);
    try {
      assert.equal(t.byId('enabled').checked, false);
      assert.equal(t.byId('mode-manual').getAttribute('aria-pressed'), 'true');
      assert.equal(t.byId('localZone').value, 'Europe/Paris');
      assert.equal(t.writes.length, 0);
    } finally { t.close(); }
  });

  await test('Storage write failure is reported without claiming success', async () => {
    const t = await setup({ enabled: true, localZone: '' }, { writeError: 'Storage quota exceeded' });
    try {
      await t.toggle(false);
      assert.equal(t.persisted.enabled, true);
      const status = t.byId('status').textContent.trim();
      assert.ok(status, 'a failed save needs visible feedback');
      assert.ok(!/已保存|保存成功/.test(status));
    } finally { t.close(); }
  });

  await test('Storage read failure keeps controls disabled instead of overwriting saved values', async () => {
    const t = await setup({ enabled: false, localZone: 'Europe/London' }, { readError: 'Storage unavailable' });
    try {
      assert.equal(t.byId('enabled').disabled, true);
      assert.equal(t.byId('mode-system').disabled, true);
      assert.equal(t.byId('mode-manual').disabled, true);
      assert.ok(t.byId('status').textContent.trim());
      assert.equal(t.writes.length, 0);
      assert.equal(t.persisted.localZone, 'Europe/London');
    } finally { t.close(); }
  });

  await test('Manifest makes toolbar click open the settings popup', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
    assert.equal(manifest.version, '0.4.1');
    assert.equal(manifest.action.default_popup, 'options.html');
    assert.equal(manifest.options_page, 'options.html');
  });

  console.log('All ' + count + ' Time Lens settings tests passed (mocked storage and DOM, not browser visual verification).');
})().catch(error => { console.error(error); process.exitCode = 1; });
