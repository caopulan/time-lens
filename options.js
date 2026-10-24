(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const controls = ['enabled', 'mode-system', 'mode-manual', 'localZone'].map(byId);
  const picker = byId('timezone-picker');
  const combobox = byId('localZone');
  const listbox = byId('timezone-options');
  const defaults = { enabled: true, localZone: '' };
  let state = { ...defaults };
  let committed = { ...defaults };
  let customDraft = '';
  let ready = false;
  let revision = 0;
  let pending = 0;
  let queue = Promise.resolve();
  let lastRequest = null;
  let optionsSignature = '';
  let zoneOptions = [];
  let optionElements = [];
  let expanded = false;
  let activeIndex = -1;
  let typeAhead = '';
  let typedAt = 0;
  let supportedZones = [];
  let completeZoneList = false;
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      supportedZones = Intl.supportedValuesOf('timeZone');
      completeZoneList = supportedZones.length > 0;
    }
  } catch { /* Preserve the user's valid zone if the browser lacks enumeration. */ }

  function systemZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  }

  function validZone(zone) {
    if (!zone || zone.length > 100) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; }
    catch { return false; }
  }

  function offsetLabel(zone, now) {
    try {
      const value = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(now).find(part => part.type === 'timeZoneName')?.value;
      const text = (value || 'UTC').replace(/^GMT/, 'UTC').replace('−', '-');
      const offset = text.match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/);
      if (!offset) return text;
      const hour = Number(offset[2]), minute = Number(offset[3] || 0), second = Number(offset[4] || 0);
      if (!hour && !minute && !second) return 'UTC';
      return 'UTC' + offset[1] + hour + (minute || second ? ':' + String(minute).padStart(2, '0') : '') + (second ? ':' + String(second).padStart(2, '0') : '');
    } catch { return ''; }
  }

  function setStatus(text, kind = '') {
    const status = byId('status');
    const isError = kind === 'error';
    status.textContent = isError ? text : '';
    status.hidden = !isError;
    status.dataset.state = kind;
  }

  function setZoneError(message = '') {
    byId('zone-error').textContent = message;
    byId('zone-error').hidden = !message;
    byId('localZone').setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function refreshZoneOptions(now) {
    // Always include the complete runtime list and accepted saved/system aliases.
    const extras = ['UTC', systemZone(), state.localZone, customDraft, 'Asia/Kolkata', 'Asia/Kathmandu'];
    const names = [...new Set([...supportedZones, ...extras.filter(validZone)])]
      .sort((a, b) => a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b, 'en'));
    const options = names.map(zone => ({ zone, offset: offsetLabel(zone, now) }));
    const signature = JSON.stringify(options);
    if (signature !== optionsSignature) {
      const previousActive = zoneOptions[activeIndex]?.zone;
      const fragment = document.createDocumentFragment();
      optionElements = options.map(({ zone, offset }, index) => {
        const option = document.createElement('div');
        option.id = 'timezone-option-' + index;
        option.className = 'zone-option zone-row';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-label', zone + ' · ' + offset);
        option.dataset.zone = zone;
        option.title = zone + ' · ' + offset;
        const name = document.createElement('span');
        name.className = 'zone-name';
        name.textContent = zone;
        const group = document.createElement('span');
        group.className = 'zone-offset';
        const prefix = document.createElement('span');
        prefix.className = 'utc-prefix';
        prefix.textContent = offset ? 'UTC' : '';
        const value = document.createElement('span');
        value.className = 'utc-value';
        value.textContent = offset.replace(/^UTC/, '');
        group.append(prefix, value);
        const mark = document.createElement('span');
        mark.className = 'zone-mark';
        mark.setAttribute('aria-hidden', 'true');
        option.append(name, group, mark);
        fragment.append(option);
        return option;
      });
      listbox.replaceChildren(fragment);
      zoneOptions = options;
      activeIndex = options.findIndex(option => option.zone === previousActive);
      optionsSignature = signature;
    }
  }

  function syncPicker() {
    combobox.setAttribute('aria-expanded', String(expanded));
    listbox.hidden = !expanded;
    optionElements.forEach((option, index) => {
      const selected = zoneOptions[index].zone === combobox.value;
      option.setAttribute('aria-selected', String(selected));
      option.dataset.active = String(expanded && index === activeIndex);
      option.querySelector('.zone-mark').textContent = selected ? '✓' : '';
    });
    const active = expanded && optionElements[activeIndex];
    if (active) combobox.setAttribute('aria-activedescendant', active.id);
    else combobox.removeAttribute('aria-activedescendant');
  }

  function scrollActiveOption() {
    const option = optionElements[activeIndex];
    if (!expanded || !option) return;
    // Scroll only the bounded list, keeping the Chrome popup itself stationary.
    if (option.offsetTop < listbox.scrollTop) listbox.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > listbox.scrollTop + listbox.clientHeight) {
      listbox.scrollTop = option.offsetTop + option.offsetHeight - listbox.clientHeight;
    }
  }

  function closeOptions() {
    expanded = false;
    activeIndex = zoneOptions.findIndex(option => option.zone === combobox.value);
    typeAhead = '';
    syncPicker();
  }

  function openOptions() {
    if (!ready || !state.localZone || expanded) return;
    render();
    expanded = true;
    activeIndex = Math.max(0, zoneOptions.findIndex(option => option.zone === combobox.value));
    typeAhead = '';
    syncPicker();
    combobox.focus();
    scrollActiveOption();
  }

  function moveActive(index) {
    activeIndex = Math.max(0, Math.min(zoneOptions.length - 1, index));
    syncPicker();
    scrollActiveOption();
  }

  function render() {
    const now = new Date();
    const manual = Boolean(state.localZone);
    const zone = manual ? state.localZone : systemZone();
    refreshZoneOptions(now);
    byId('enabled').checked = state.enabled;
    byId('mode-system').setAttribute('aria-pressed', String(!manual));
    byId('mode-manual').setAttribute('aria-pressed', String(manual));
    byId('manual-zone').hidden = !manual;
    byId('zone-caption').textContent = manual ? '当前选择' : '当前系统时区';
    byId('active-zone').textContent = zone;
    byId('active-offset').textContent = offsetLabel(zone, now);
    byId('active-offset').title = '当前 UTC 偏移；时间换算会按事件日期处理夏令时';
    combobox.value = manual ? state.localZone : validZone(customDraft) ? customDraft : zone;
    const selectedOffset = offsetLabel(combobox.value, now);
    byId('local-zone-name').textContent = combobox.value;
    combobox.title = combobox.value + (selectedOffset ? ' · ' + selectedOffset : '');
    byId('local-zone-offset').querySelector('.utc-prefix').textContent = selectedOffset ? 'UTC' : '';
    byId('local-zone-offset').querySelector('.utc-value').textContent = selectedOffset.replace(/^UTC/, '');
    if (!manual || !ready) { expanded = false; typeAhead = ''; }
    if (expanded && activeIndex < 0) activeIndex = Math.max(0, zoneOptions.findIndex(option => option.zone === combobox.value));
    syncPicker();
    controls.forEach(control => { control.disabled = !ready; });
    if (manual && !completeZoneList) setZoneError('当前浏览器无法提供完整时区列表，请升级 Chrome。已有时区仍可保留。');
  }

  function persist() {
    if (!ready) return;
    // Write only these two settings; keep previously saved sourceZone/other keys.
    const snapshot = { enabled: state.enabled, localZone: state.localZone };
    const signature = JSON.stringify(snapshot);
    if (lastRequest === signature) return;
    lastRequest = signature;
    const requestRevision = ++revision;
    pending++;
    setStatus('正在保存…');
    queue = queue.then(() => new Promise(resolve => {
      try {
        chrome.storage.sync.set(snapshot, () => {
          const error = chrome.runtime.lastError;
          pending--;
          if (error) {
            if (requestRevision === revision) {
              state = { ...committed };
              customDraft = state.localZone || customDraft;
              lastRequest = null;
              render();
              setStatus('保存失败，请重试', 'error');
            }
          } else {
            committed = { ...snapshot };
            if (requestRevision === revision) setStatus('已自动保存', 'saved');
          }
          resolve();
        });
      } catch {
        pending--;
        if (requestRevision === revision) {
          state = { ...committed };
          lastRequest = null;
          render();
          setStatus('保存失败，请重试', 'error');
        }
        resolve();
      }
    }));
  }

  function commitZone(zone) {
    if (!ready || !state.localZone) return;
    if (!validZone(zone) || !zoneOptions.some(option => option.zone === zone)) {
      setZoneError('请选择列表中的有效时区');
      return;
    }
    setZoneError();
    customDraft = zone;
    state.localZone = zone;
    closeOptions();
    render();
    persist();
    combobox.focus();
  }

  byId('enabled').addEventListener('change', () => {
    if (!ready) return;
    state.enabled = byId('enabled').checked;
    persist();
  });
  byId('mode-system').addEventListener('click', () => {
    if (!ready) return;
    closeOptions();
    state.localZone = '';
    setZoneError();
    render();
    persist();
  });
  byId('mode-manual').addEventListener('click', () => {
    if (!ready) return;
    closeOptions();
    state.localZone = validZone(customDraft) ? customDraft : systemZone();
    customDraft = state.localZone;
    setZoneError();
    render();
    persist();
    combobox.focus();
  });
  combobox.addEventListener('click', () => {
    if (expanded) closeOptions();
    else openOptions();
  });
  combobox.addEventListener('keydown', event => {
    if (!ready || !state.localZone) return;
    const key = event.key;
    if (key === 'Tab') { closeOptions(); return; }
    if (key === 'Escape') {
      if (expanded) { event.preventDefault(); closeOptions(); }
      return;
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      if (expanded) commitZone(zoneOptions[activeIndex]?.zone);
      else openOptions();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const wasExpanded = expanded;
      openOptions();
      typeAhead = '';
      if (key === 'Home') moveActive(0);
      else if (key === 'End') moveActive(zoneOptions.length - 1);
      else if (wasExpanded) moveActive(activeIndex + (key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      openOptions();
      const now = Date.now();
      typeAhead = now - typedAt > 700 ? key.toLowerCase() : typeAhead + key.toLowerCase();
      typedAt = now;
      const repeated = [...typeAhead].every(character => character === typeAhead[0]);
      const prefix = repeated ? typeAhead[0] : typeAhead;
      const start = repeated ? activeIndex + 1 : activeIndex;
      for (let step = 0; step < zoneOptions.length; step++) {
        const index = (start + step + zoneOptions.length) % zoneOptions.length;
        if (zoneOptions[index].zone.toLowerCase().startsWith(prefix)) { moveActive(index); break; }
      }
    }
  });
  listbox.addEventListener('pointerdown', event => {
    if (event.target.closest('[role=option]') && event.button === 0) event.preventDefault();
  });
  listbox.addEventListener('click', event => {
    const option = event.target.closest('[role=option]');
    if (expanded && option && listbox.contains(option)) commitZone(option.dataset.zone);
  });
  picker.addEventListener('focusout', event => {
    if (!picker.contains(event.relatedTarget)) closeOptions();
  });
  const closeOutside = event => { if (expanded && !picker.contains(event.target)) closeOptions(); };
  document.addEventListener('pointerdown', closeOutside);
  document.addEventListener('click', closeOutside);
  window.addEventListener('focus', () => { if (ready) render(); });
  render();

  try {
    chrome.storage.sync.get(defaults, values => {
      if (chrome.runtime.lastError) { setStatus('无法读取设置，请重新打开', 'error'); return; }
      state = { enabled: values.enabled !== false, localZone: typeof values.localZone === 'string' ? values.localZone : '' };
      customDraft = state.localZone;
      committed = { ...state };
      ready = true;
      render();
      setStatus('设置自动保存');
      if (state.localZone && !validZone(state.localZone)) setZoneError('已保存的时区无效，请重新选择或跟随系统');
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (!ready || area !== 'sync' || pending) return;
      if (changes.enabled) state.enabled = changes.enabled.newValue !== false;
      if (changes.localZone) { state.localZone = changes.localZone.newValue || ''; customDraft = state.localZone; }
      committed = { ...state };
      lastRequest = null;
      closeOptions();
      render();
    });
  } catch { setStatus('无法读取设置，请重新打开', 'error'); }
})();
