// Bike Fit Explorer — app controller.
// State lives in one object; render functions are small and targeted so
// focus and animations survive selection changes.

import {
  SECTIONS, METRICS, CONTACTS, computePoints, contactShift, isFitData, isNum, metricValue,
  formatNumber, formatValue, formatDelta, describeDelta, prettyName, buildBikeGeoCalcUrl,
} from './geometry.js';
import { BikeScene } from './scene.js';
import { icon, iconEl } from './icons.js';

const REPO = 'randin/bikefits';
const BRANCH = 'main';
const STORAGE_KEY = 'bikefits:state';
const THEME_KEY = 'bikefits:theme';
const SLOT_NAMES = ['A', 'B'];
const UPLOAD_GROUP = ':upload';
const IGNORED_JSON = new Set(['files.json', 'package.json', 'package-lock.json']);

const $ = (sel) => document.querySelector(sel);
const els = {
  app: $('.app'),
  sidebar: $('.sidebar'),
  list: $('#fit-list'),
  count: $('#fit-count'),
  search: $('#search'),
  searchClear: $('#search-clear'),
  dropzone: $('#dropzone'),
  fileInput: $('#file-input'),
  slots: [$('#slot-a'), $('#slot-b')],
  swap: $('#swap'),
  copy: $('#copy-link'),
  open: $('#open-bgc'),
  stage: $('#stage'),
  canvas: $('#scene'),
  legend: $('#legend'),
  empty: $('#stage-empty'),
  tryExample: $('#try-example'),
  caption: $('#stage-caption'),
  shift: $('#shift'),
  alignBtns: [...document.querySelectorAll('[data-align]')],
  specs: $('#specs'),
  specsNote: $('#specs-note'),
  cards: $('#spec-cards'),
  onlyDiff: $('#only-diff'),
  onlyDiffWrap: $('#only-diff-wrap'),
  overlay: $('#drop-overlay'),
  toasts: $('#toasts'),
  themeToggle: $('#theme-toggle'),
};

const state = {
  fits: [],
  slots: [null, null],
  query: '',
  align: 'bb',
  onlyDiff: false,
  hover: null,
  pinned: null,
  collapsed: Object.fromEntries(SECTIONS.map((s) => [s.id, !!s.collapsedByDefault])),
  savedSlots: [null, null],
};

const canHover = window.matchMedia('(hover: hover)').matches;
let scene;
let uploadVersion = 0;

// ── Utilities ───────────────────────────────────────────────────────────────

/** Tiny DOM builder: h('div', { class: 'x', onclick }, [children]). */
function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const encodePath = (file) => file.split('/').map(encodeURIComponent).join('/');
const editUrl = (fit) => `https://github.com/${REPO}/edit/${BRANCH}/${encodePath(fit.file)}`;
const fitById = (id) => (id ? state.fits.find((f) => f.id === id) || null : null);
const activeFits = () => state.slots.map((id, slot) => ({ fit: fitById(id), slot })).filter((x) => x.fit);
const round = (v) => (isNum(v) ? Math.round(v) : '—');
const metaText = (fit) => `Stack ${round(fit.data?.stack)} · Reach ${round(fit.data?.reach)}`;
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

function groupKey(file) {
  const i = file.lastIndexOf('/');
  return i === -1 ? '' : file.slice(0, i);
}

function groupLabel(key) {
  if (key === '') return 'My bikes';
  if (key === UPLOAD_GROUP) return 'Uploaded';
  return prettyName(key.split('/').pop().replace(/[-_]+/g, ' '));
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — not critical */
  }
}

// ── Data loading ────────────────────────────────────────────────────────────

async function loadManifest() {
  let problem;
  try {
    const res = await fetch('files.json', { cache: 'no-cache' });
    if (res.ok) {
      try {
        const list = JSON.parse(await res.text());
        if (Array.isArray(list)) return { files: list.filter((f) => typeof f === 'string') };
        problem = 'files.json should be a list of file names';
      } catch {
        problem = 'files.json has a JSON syntax error';
      }
    } else {
      problem = `Couldn't load files.json (HTTP ${res.status})`;
    }
  } catch {
    problem = "Couldn't load files.json";
  }

  // Fallback: ask GitHub which fit files exist, so a broken index never hides fits.
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
    if (!res.ok) throw new Error(String(res.status));
    const { tree } = await res.json();
    const files = tree
      .filter((t) => t.type === 'blob' && /\.json$/i.test(t.path) && !t.path.startsWith('.'))
      .map((t) => t.path)
      .filter((p) => !IGNORED_JSON.has(p.split('/').pop()));
    return { files, notice: `${problem} — listed fits from GitHub instead` };
  } catch {
    return { files: [], notice: problem };
  }
}

function makeFit(base, data) {
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : base.name;
  return { ...base, name, label: prettyName(name), data, pts: computePoints(data) };
}

async function loadFit(file) {
  const stem = file.split('/').pop().replace(/\.json$/i, '');
  const base = { id: file, file, group: groupKey(file), name: stem, label: prettyName(stem), uploaded: false };
  try {
    const res = await fetch(encodePath(file), { cache: 'no-cache' });
    if (!res.ok) return { ...base, error: res.status === 404 ? 'File not found' : `HTTP ${res.status}` };
    let data;
    try {
      data = JSON.parse(await res.text());
    } catch {
      return { ...base, error: 'Invalid JSON' };
    }
    if (!isFitData(data)) return { ...base, error: 'Not a BikeGeoCalc fit' };
    return makeFit(base, data);
  } catch {
    return { ...base, error: "Couldn't load" };
  }
}

async function loadLibrary() {
  const { files, notice } = await loadManifest();
  state.fits = await Promise.all(files.map(loadFit));
  updateLibraryBounds();
  els.list.removeAttribute('aria-busy');
  if (notice) toast(notice, 'error');
  const broken = state.fits.filter((f) => f.error);
  if (broken.length === 1) toast(`${broken[0].file}: ${broken[0].error}`, 'error');
  else if (broken.length > 1) toast(`${broken.length} fits couldn't be loaded`, 'error');
}

function updateLibraryBounds() {
  scene.setLibrary(state.fits.filter((f) => f.pts).map((f) => f.pts));
}

async function addFiles(fileList) {
  let added = null;
  for (const file of [...fileList]) {
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      toast(`${file.name} isn't a JSON file`, 'error');
      continue;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast(`${file.name}: invalid JSON`, 'error');
      continue;
    }
    if (!isFitData(data)) {
      toast(`${file.name} doesn't look like a BikeGeoCalc fit`, 'error');
      continue;
    }
    const stem = file.name.replace(/\.json$/i, '');
    const id = `upload:${file.name}`;
    const fit = makeFit({ id, file: file.name, group: UPLOAD_GROUP, name: stem, uploaded: true, version: ++uploadVersion }, data);
    const i = state.fits.findIndex((f) => f.id === id);
    if (i === -1) state.fits.push(fit);
    else state.fits[i] = fit;
    added = fit;
  }
  if (!added) return;
  updateLibraryBounds();
  renderList();
  if (state.slots.includes(added.id)) onSelectionChange();
  else toggleFit(added.id);
  toast(`Added ${added.label}`, 'success');
}

function removeUpload(id) {
  state.fits = state.fits.filter((f) => f.id !== id);
  state.slots = state.slots.map((s) => (s === id ? null : s));
  updateLibraryBounds();
  renderList();
  onSelectionChange();
}

// ── Selection ───────────────────────────────────────────────────────────────

/** Row click: fill an empty slot, or replace B so A stays as the reference. */
function toggleFit(id) {
  const at = state.slots.indexOf(id);
  if (at !== -1) state.slots[at] = null;
  else if (!state.slots[0]) state.slots[0] = id;
  else state.slots[1] = id;
  onSelectionChange();
}

/** A/B toggle: put a fit in a specific slot (swapping if it was in the other). */
function assign(id, slot) {
  if (state.slots[slot] === id) {
    state.slots[slot] = null;
  } else {
    const other = 1 - slot;
    if (state.slots[other] === id) state.slots[other] = state.slots[slot];
    state.slots[slot] = id;
  }
  onSelectionChange();
}

function clearSlot(slot) {
  state.slots[slot] = null;
  onSelectionChange();
}

function swapSlots() {
  state.slots = [state.slots[1], state.slots[0]];
  els.swap.classList.toggle('is-spun');
  onSelectionChange();
}

function onSelectionChange({ animate = true } = {}) {
  updateListSelection();
  renderCompareBar();
  renderLegend();
  renderSpecs();
  updateScene(animate);
  renderShift();
  renderCaption();
  syncUrl();
  persist();
}

function restoreSelection() {
  const valid = (id) => {
    const f = fitById(id);
    return f && !f.error ? f.id : null;
  };
  const params = new URLSearchParams(window.location.search);
  if (params.has('a') || params.has('b')) {
    state.slots = ['a', 'b'].map((k) => {
      const v = params.get(k);
      if (!v) return null;
      const file = (/\.json$/i.test(v) ? v : `${v}.json`).toLowerCase();
      return valid(state.fits.find((f) => f.file.toLowerCase() === file)?.id);
    });
  } else {
    state.slots = state.savedSlots.map(valid);
  }
}

function syncUrl() {
  const params = new URLSearchParams(window.location.search);
  ['a', 'b'].forEach((k, i) => {
    const fit = fitById(state.slots[i]);
    if (fit && !fit.uploaded) params.set(k, fit.file.replace(/\.json$/i, ''));
    else params.delete(k);
  });
  const qs = params.toString().replace(/%2F/gi, '/');
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

function persist() {
  writeStorage(STORAGE_KEY, {
    slots: state.slots.map((id) => (fitById(id)?.uploaded ? null : id)),
    align: state.align,
    onlyDiff: state.onlyDiff,
    collapsed: state.collapsed,
  });
}

function restorePrefs() {
  const saved = readJson(STORAGE_KEY);
  if (!saved) return;
  if (saved.align === 'bb' || saved.align === 'axle') state.align = saved.align;
  state.onlyDiff = !!saved.onlyDiff;
  if (saved.collapsed && typeof saved.collapsed === 'object') Object.assign(state.collapsed, saved.collapsed);
  if (Array.isArray(saved.slots)) state.savedSlots = [saved.slots[0] ?? null, saved.slots[1] ?? null];
}

// ── Library list ────────────────────────────────────────────────────────────

function groupedFits() {
  const groups = new Map();
  for (const fit of state.fits) {
    if (!groups.has(fit.group)) groups.set(fit.group, []);
    groups.get(fit.group).push(fit);
  }
  const rank = (k) => (k === '' ? 0 : k === UPLOAD_GROUP ? 2 : 1);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, fits]) => ({
      key,
      label: groupLabel(key),
      fits: fits.sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true, sensitivity: 'base' })),
    }));
}

function renderList() {
  const q = state.query.trim().toLowerCase();
  const matches = (f) => !q || f.label.toLowerCase().includes(q) || f.file.toLowerCase().includes(q);
  const sections = [];
  for (const group of groupedFits()) {
    const items = group.fits.filter(matches);
    if (!items.length) continue;
    sections.push(h('section', { class: 'fit-group', 'aria-label': group.label }, [
      h('h3', { class: 'fit-group-title' }, [group.label, h('span', { class: 'count' }, String(items.length))]),
      h('ul', { class: 'fit-items', role: 'list' }, items.map(renderFitItem)),
    ]));
  }
  if (!sections.length) {
    sections.push(h('p', { class: 'list-empty' }, state.fits.length ? `No fits match “${state.query.trim()}”` : 'No fits found. Drop a BikeGeoCalc JSON to get started.'));
  }
  els.list.replaceChildren(...sections);
  els.count.textContent = String(state.fits.filter((f) => !f.error).length);
  updateListSelection();
}

function renderFitItem(fit) {
  if (fit.error) {
    return h('li', { class: 'fit has-error', 'data-id': fit.id }, [
      h('div', { class: 'fit-main' }, [
        h('span', { class: 'fit-name' }, fit.label),
        h('span', { class: 'fit-meta fit-error' }, [iconEl('alert', 'icon'), fit.error]),
      ]),
      h('a', {
        class: 'icon-btn sm fit-side', href: editUrl(fit), target: '_blank', rel: 'noopener',
        title: 'Fix on GitHub', 'aria-label': `Fix ${fit.label} on GitHub`, html: icon('edit'),
      }),
    ]);
  }

  const side = fit.uploaded
    ? h('button', {
      type: 'button', class: 'icon-btn sm fit-side', title: 'Remove from list',
      'aria-label': `Remove ${fit.label}`, html: icon('trash'), onclick: () => removeUpload(fit.id),
    })
    : h('a', {
      class: 'icon-btn sm fit-side', href: editUrl(fit), target: '_blank', rel: 'noopener',
      title: 'Edit on GitHub', 'aria-label': `Edit ${fit.label} on GitHub`, html: icon('edit'),
    });

  return h('li', { class: 'fit', 'data-id': fit.id }, [
    h('button', { type: 'button', class: 'fit-main', 'data-id': fit.id, onclick: () => toggleFit(fit.id) }, [
      h('span', { class: 'fit-name' }, fit.label),
      h('span', { class: 'fit-meta' }, metaText(fit)),
    ]),
    side,
    h('div', { class: 'slot-toggles', role: 'group', 'aria-label': `Compare slot for ${fit.label}` }, [0, 1].map((slot) => h('button', {
      type: 'button',
      class: 'slot-toggle',
      'data-slot': String(slot),
      'aria-pressed': 'false',
      title: `Set as bike ${SLOT_NAMES[slot]}`,
      'aria-label': `Bike ${SLOT_NAMES[slot]}`,
      onclick: () => assign(fit.id, slot),
    }, SLOT_NAMES[slot]))),
  ]);
}

function updateListSelection() {
  for (const li of els.list.querySelectorAll('.fit[data-id]')) {
    const id = li.dataset.id;
    const slot = state.slots.indexOf(id);
    li.classList.toggle('is-a', slot === 0);
    li.classList.toggle('is-b', slot === 1);
    li.querySelector('button.fit-main')?.setAttribute('aria-pressed', String(slot !== -1));
    li.querySelectorAll('.slot-toggle').forEach((b) => {
      b.setAttribute('aria-pressed', String(state.slots[Number(b.dataset.slot)] === id));
    });
  }
}

function focusLibrary() {
  els.search.focus({ preventScroll: true });
  els.sidebar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Compare bar ─────────────────────────────────────────────────────────────

function renderCompareBar() {
  state.slots.forEach((id, slot) => {
    const el = els.slots[slot];
    const fit = fitById(id);
    // Empty slots read differently depending on whether the other slot is filled.
    const key = fit ? `${fit.id}#${fit.version || 0}` : `empty:${state.slots[1 - slot] ? 1 : 0}`;
    if (el.dataset.key === key && el.firstChild) return; // unchanged: keep DOM (and focus)
    el.dataset.key = key;
    el.replaceChildren(fit ? slotCard(fit, slot) : slotEmpty(slot));
  });

  const active = activeFits();
  const url = active.length ? buildBikeGeoCalcUrl(active.map((a) => a.fit)) : '';
  if (url) {
    els.open.href = url;
    els.open.removeAttribute('aria-disabled');
    els.open.removeAttribute('tabindex');
  } else {
    els.open.removeAttribute('href');
    els.open.setAttribute('aria-disabled', 'true');
    els.open.tabIndex = -1;
  }
  els.copy.disabled = !url;
  els.swap.disabled = !active.length;
}

function slotCard(fit, slot) {
  return h('div', { class: 'slot-card' }, [
    h('span', { class: 'slot-chip', 'aria-hidden': 'true' }, SLOT_NAMES[slot]),
    h('div', { class: 'slot-body' }, [
      h('div', { class: 'slot-name', title: fit.label }, [h('span', { class: 'visually-hidden' }, `Bike ${SLOT_NAMES[slot]}: `), fit.label]),
      h('div', { class: 'slot-meta' }, `${metaText(fit)} · ${groupLabel(fit.group)}`),
    ]),
    h('div', { class: 'slot-actions' }, [
      !fit.uploaded && h('a', {
        class: 'icon-btn sm', href: editUrl(fit), target: '_blank', rel: 'noopener',
        title: 'Edit on GitHub', 'aria-label': `Edit ${fit.label} on GitHub`, html: icon('edit'),
      }),
      h('button', {
        type: 'button', class: 'icon-btn sm', title: 'Remove',
        'aria-label': `Remove ${fit.label} from bike ${SLOT_NAMES[slot]}`, html: icon('close'),
        onclick: () => clearSlot(slot),
      }),
    ]),
  ]);
}

function slotEmpty(slot) {
  const other = fitById(state.slots[1 - slot]);
  const title = slot === 0 ? 'Choose bike A' : 'Add bike B';
  const hint = slot === 0 ? (other ? 'A reference to compare with' : 'Pick a fit from the list') : 'Compare against A';
  return h('button', { type: 'button', class: 'slot-empty', onclick: focusLibrary }, [
    h('span', { class: 'slot-chip', 'aria-hidden': 'true' }, SLOT_NAMES[slot]),
    h('span', { class: 'slot-body' }, [
      h('span', { class: 'slot-name' }, title),
      h('span', { class: 'slot-meta' }, hint),
    ]),
  ]);
}

async function copyLink() {
  const url = els.open.getAttribute('href');
  if (!url) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0', readonly: true });
    ta.value = url;
    document.body.append(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
  }
  if (!ok) {
    toast("Couldn't copy the link", 'error');
    return;
  }
  toast('BikeGeoCalc link copied', 'success');
  const label = els.copy.querySelector('span');
  els.copy.querySelector('svg').outerHTML = icon('check');
  label.textContent = 'Copied';
  clearTimeout(copyLink.timer);
  copyLink.timer = setTimeout(() => {
    els.copy.querySelector('svg').outerHTML = icon('copy');
    label.textContent = 'Copy link';
  }, 1600);
}

// ── Stage ───────────────────────────────────────────────────────────────────

function updateScene(animate) {
  scene.setBikes(state.slots.map((id) => {
    const f = fitById(id);
    return f ? { key: `${f.id}#${f.version || 0}`, data: f.data, pts: f.pts } : null;
  }), { animate });
  els.empty.hidden = state.slots.some(Boolean);
  els.canvas.setAttribute('aria-label', describeScene());
}

function describeScene() {
  const active = activeFits();
  const where = state.align === 'axle' ? 'rear axle' : 'bottom bracket';
  if (!active.length) return 'Bike geometry overlay. No fits selected.';
  const names = active.map(({ fit, slot }) => `${fit.label} (${SLOT_NAMES[slot]}, ${slot ? 'orange' : 'blue'})`);
  return `Geometry overlay of ${names.join(' and ')}, aligned at the ${where}.`;
}

function renderLegend() {
  const active = activeFits();
  els.legend.replaceChildren(...(active.length
    ? active.map(({ fit, slot }) => h('span', { class: `legend-item ${slot ? 'is-b' : 'is-a'}` }, [
      h('span', { class: 'legend-swatch' }),
      `${SLOT_NAMES[slot]} · ${fit.label}`,
    ]))
    : [h('span', { class: 'legend-item' }, 'Geometry overlay')]));
}

/** Empty state: offer a one-click example comparison. */
function setupExample() {
  const usable = (list) => list.filter((f) => !f.error);
  const mine = usable(groupedFits().find((g) => g.key === '')?.fits || []);
  const pool = mine.length >= 2 ? mine : usable(state.fits);
  if (pool.length < 2) {
    els.tryExample.hidden = true;
    return;
  }
  const [a, b] = pool;
  els.tryExample.replaceChildren(`Try ${a.label} vs ${b.label}`);
  els.tryExample.hidden = false;
  els.tryExample.onclick = () => {
    state.slots = [a.id, b.id];
    onSelectionChange();
  };
}

// Contact-point shift: where saddle, bars and hoods end up on B relative to A.
const PLOT = 46;
const PLOT_RANGE = 20; // mm at the edge of the mini plot

function renderShift() {
  const active = activeFits();
  const show = active.length === 2;
  els.shift.hidden = !show;
  els.stage.classList.toggle('has-shift', show);
  if (!show) {
    els.shift.replaceChildren();
    return;
  }
  const [a, b] = active.map((x) => x.fit);
  els.shift.replaceChildren(
    h('div', { class: 'shift-head' }, [
      h('span', { class: 'shift-title' }, 'Contact points'),
      h('span', { class: 'shift-sub' }, 'B relative to A'),
    ]),
    ...CONTACTS.map((c) => shiftItem(c, contactShift(a, b, c))),
  );
}

function shiftItem(contact, d) {
  const tiny = (v) => Math.abs(v) < 0.5;
  const vert = tiny(d.y) ? null : { arrow: d.y > 0 ? '↑' : '↓', v: d.y, word: d.y > 0 ? 'higher' : 'lower' };
  const horiz = tiny(d.x) ? null : { arrow: d.x > 0 ? '→' : '←', v: d.x, word: d.x > 0 ? 'further forward' : 'further back' };
  const parts = [vert, horiz].filter(Boolean);
  const words = parts.map((p) => `${formatNumber(Math.abs(p.v))} mm ${p.word}`).join(', ') || 'same position';
  return h('div', { class: 'shift-item', role: 'group', 'aria-label': `${contact.label}: ${words}`, title: `${contact.label} on B: ${words}` }, [
    h('span', { class: 'shift-plot', 'aria-hidden': 'true', html: shiftPlot(d) }),
    h('span', { class: 'shift-text' }, [
      h('span', { class: 'shift-label' }, contact.label),
      h('span', { class: 'shift-values' }, parts.length
        ? parts.map((p) => h('span', {}, [h('span', { class: 'shift-arrow' }, p.arrow), formatNumber(Math.abs(p.v))]))
        : h('span', { class: 'is-same' }, 'Same')),
    ]),
  ]);
}

function shiftPlot(d) {
  const c = PLOT / 2;
  const reach = c - 6;
  const k = reach / PLOT_RANGE;
  const mag = Math.hypot(d.x, d.y) * k;
  const clamp = mag > reach ? reach / mag : 1;
  const x = (c + d.x * k * clamp).toFixed(1);
  const y = (c - d.y * k * clamp).toFixed(1);
  return `<svg viewBox="0 0 ${PLOT} ${PLOT}" width="${PLOT}" height="${PLOT}">`
    + `<rect class="frame" x="0.5" y="0.5" width="${PLOT - 1}" height="${PLOT - 1}" rx="9"/>`
    + `<path class="axis" d="M${c} 5V${PLOT - 5}M5 ${c}H${PLOT - 5}"/>`
    + `<circle class="ring" cx="${c}" cy="${c}" r="${(reach / 2).toFixed(1)}"/>`
    + `<line class="vec" x1="${c}" y1="${c}" x2="${x}" y2="${y}"/>`
    + `<circle class="pa" cx="${c}" cy="${c}" r="3.4"/>`
    + `<circle class="pb" cx="${x}" cy="${y}" r="3.4"/>`
    + '</svg>';
}

function setAlign(mode, { focus = false } = {}) {
  if (mode !== 'bb' && mode !== 'axle') return;
  state.align = mode;
  scene.setAlign(mode);
  syncAlignButtons(focus);
  els.canvas.setAttribute('aria-label', describeScene());
  persist();
}

function syncAlignButtons(focus = false) {
  els.alignBtns.forEach((b) => {
    const on = b.dataset.align === state.align;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
}

function renderCaption() {
  const cap = els.caption;
  const key = state.hover ?? state.pinned;
  const metric = key ? METRICS[key] : null;
  const active = activeFits();

  if (!active.length) {
    cap.replaceChildren(h('span', { class: 'caption-hint' }, state.fits.length ? 'Select a fit to see its geometry' : 'Loading fits…'));
    return;
  }
  if (!metric) {
    cap.replaceChildren(h('span', { class: 'caption-hint' }, canHover
      ? 'Hover any measurement to draw it on the bike · click to pin'
      : 'Tap a measurement to draw it on the bike'));
    return;
  }
  const vals = active.map(({ fit, slot }) => ({ slot, v: metricValue(metric, fit) }));
  const parts = [
    h('span', { class: 'caption-metric' }, metric.label),
    h('span', { class: 'caption-values' }, vals.map(({ slot, v }) => h('span', { class: slot ? 'is-b' : 'is-a' }, `${SLOT_NAMES[slot]} ${formatValue(v, metric.unit)}`))),
  ];
  if (vals.length === 2 && vals.every((x) => isNum(x.v))) {
    parts.push(h('span', { class: 'caption-delta' }, describeDelta(metric, vals[1].v - vals[0].v)));
  }
  if (state.pinned === key) parts.push(h('span', { class: 'caption-pin' }, 'Pinned · Esc to clear'));
  cap.replaceChildren(...parts);
}

function setHover(key) {
  if (state.hover === key) return;
  state.hover = key;
  refreshHighlight();
}

function togglePin(key) {
  state.pinned = state.pinned === key ? null : key;
  refreshHighlight();
}

function refreshHighlight() {
  scene.setHighlight(state.hover ?? state.pinned);
  for (const tr of els.cards.querySelectorAll('tr[data-metric]')) {
    tr.classList.toggle('is-pinned', tr.dataset.metric === state.pinned);
  }
  renderCaption();
}

// ── Measurements ────────────────────────────────────────────────────────────

function renderSpecs() {
  const active = activeFits();
  els.specs.hidden = !active.length;
  els.app.classList.toggle('no-specs', !active.length);
  if (!active.length) {
    els.cards.replaceChildren();
    return;
  }
  const compare = active.length === 2;
  els.onlyDiffWrap.hidden = !compare;
  els.specsNote.textContent = compare ? 'mm · Δ = B − A' : 'mm';
  els.cards.replaceChildren(...SECTIONS.map((section) => renderSpecCard(section, active, compare)));
  refreshHighlight();
}

function renderSpecCard(section, active, compare) {
  const rows = [];
  for (const metric of section.metrics) {
    const vals = active.map(({ fit }) => metricValue(metric, fit));
    if (vals.every((v) => v === undefined)) continue;
    const delta = compare && vals.every(isNum) ? vals[1] - vals[0] : undefined;
    if (compare && state.onlyDiff && isNum(delta) && Math.abs(delta) < 0.05) continue;
    rows.push(renderSpecRow(metric, vals, delta, active, compare));
  }

  const collapsed = !!state.collapsed[section.id];
  const bodyId = `spec-body-${section.id}`;
  const card = h('article', { class: `spec-card${collapsed ? ' is-collapsed' : ''}`, 'data-section': section.id });
  const toggle = h('button', {
    type: 'button', class: 'spec-toggle', 'aria-expanded': String(!collapsed), 'aria-controls': bodyId,
  }, [
    h('span', { class: 'spec-title' }, section.title),
    section.subtitle && h('span', { class: 'spec-sub' }, section.subtitle),
    iconEl('chevron', 'icon spec-chevron'),
  ]);
  const body = h('div', { id: bodyId, hidden: collapsed });
  toggle.addEventListener('click', () => {
    const next = !state.collapsed[section.id];
    state.collapsed[section.id] = next;
    card.classList.toggle('is-collapsed', next);
    body.hidden = next;
    toggle.setAttribute('aria-expanded', String(!next));
    persist();
  });

  if (rows.length) {
    body.append(h('table', { class: `spec-table${compare ? '' : ' is-single'}` }, [
      h('colgroup', {}, [
        h('col'),
        ...active.map(() => h('col', { class: 'c-val' })),
        compare && h('col', { class: 'c-delta' }),
      ]),
      h('thead', {}, h('tr', {}, [
        h('th', { scope: 'col' }, 'Measurement'),
        ...active.map(({ slot }) => h('th', { scope: 'col' }, h('span', { class: `chip chip-${slot ? 'b' : 'a'}`, title: `Bike ${SLOT_NAMES[slot]}` }, SLOT_NAMES[slot]))),
        compare && h('th', { scope: 'col', title: 'Difference, B minus A' }, 'Δ'),
      ])),
      h('tbody', {}, rows),
    ]));
  } else {
    body.append(h('p', { class: 'spec-empty' }, compare && state.onlyDiff ? 'Identical on both bikes.' : 'No data in these fits.'));
  }
  card.append(h('header', {}, toggle), body);
  return card;
}

function renderSpecRow(metric, vals, delta, active, compare) {
  const cells = [
    h('th', { scope: 'row' }, h('span', { class: 'm-cell' }, [
      h('span', { class: 'm-label' }, metric.label),
      metric.hint && h('span', { class: 'm-hint' }, metric.hint),
      metric.unit === '°' && h('span', { class: 'm-unit', 'aria-label': 'degrees' }, '°'),
    ])),
    ...vals.map((v, i) => h('td', { class: isNum(v) ? `v-${active[i].slot ? 'b' : 'a'}` : 'v-missing' }, formatNumber(v))),
  ];
  if (compare) {
    const minor = metric.unit === '°' ? 0.25 : 1;
    const abs = Math.abs(delta);
    const cls = !isNum(delta) ? 'delta is-zero' : abs < 0.05 ? 'delta is-zero' : abs < minor ? 'delta is-minor' : 'delta';
    cells.push(h('td', { class: cls, title: isNum(delta) ? describeDelta(metric, delta) : 'Missing in one fit' }, isNum(delta) ? formatDelta(delta) : '—'));
  }

  const tr = h('tr', { 'data-metric': metric.key }, cells);
  if (metric.dims) {
    tr.classList.add('has-dims');
    tr.tabIndex = 0;
    if (canHover) {
      tr.addEventListener('mouseenter', () => setHover(metric.key));
      tr.addEventListener('mouseleave', () => setHover(null));
    }
    tr.addEventListener('click', () => togglePin(metric.key));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePin(metric.key);
      }
    });
    tr.addEventListener('focus', () => {
      if (tr.matches(':focus-visible')) setHover(metric.key); // keyboard focus only
    });
    tr.addEventListener('blur', () => setHover(null));
  }
  return tr;
}

// ── Theme ───────────────────────────────────────────────────────────────────

const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function setTheme(theme, remember) {
  document.documentElement.dataset.theme = theme;
  if (remember) writeStorage(THEME_KEY, theme);
  updateThemeToggle();
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  scene?.refreshColors();
}

function updateThemeToggle() {
  const dark = currentTheme() === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  els.themeToggle.innerHTML = icon(dark ? 'sun' : 'moon');
  els.themeToggle.setAttribute('aria-label', label);
  els.themeToggle.title = label;
}

// ── Toasts ──────────────────────────────────────────────────────────────────

function toast(message, kind = 'info') {
  const el = h('div', { class: `toast toast-${kind}` }, [
    kind !== 'info' && iconEl(kind === 'error' ? 'alert' : 'check', 'icon'),
    h('span', {}, message),
  ]);
  els.toasts.append(el);
  while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  }, kind === 'error' ? 5200 : 2400);
}

// ── Events ──────────────────────────────────────────────────────────────────

function bindEvents() {
  // Search
  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    renderList();
  });
  els.search.addEventListener('keydown', (e) => {
    const first = els.list.querySelector('button.fit-main');
    if (e.key === 'ArrowDown' && first) {
      e.preventDefault();
      first.focus();
    } else if (e.key === 'Enter' && first && state.query.trim()) {
      e.preventDefault();
      toggleFit(first.dataset.id);
    }
  });
  els.searchClear.addEventListener('click', () => {
    els.search.value = '';
    state.query = '';
    renderList();
    els.search.focus();
  });

  // Arrow-key navigation within the list
  els.list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...els.list.querySelectorAll('button.fit-main')];
    const i = items.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) els.search.focus();
    else items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });

  // Uploads
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files.length) addFiles(els.fileInput.files);
    els.fileInput.value = '';
  });
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    els.overlay.classList.add('is-active');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.overlay.classList.remove('is-active');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.overlay.classList.remove('is-active');
    addFiles(e.dataTransfer.files);
  });

  // Compare bar
  els.swap.addEventListener('click', swapSlots);
  els.copy.addEventListener('click', copyLink);

  // Alignment (radio group with arrow keys)
  els.alignBtns.forEach((b) => {
    b.addEventListener('click', () => setAlign(b.dataset.align));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      setAlign(state.align === 'bb' ? 'axle' : 'bb', { focus: true });
    });
  });

  // Measurements
  els.onlyDiff.addEventListener('change', () => {
    state.onlyDiff = els.onlyDiff.checked;
    renderSpecs();
    persist();
  });

  // Theme
  els.themeToggle.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) setTheme(e.matches ? 'dark' : 'light', false);
  });

  // Global shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      els.search.focus();
      els.search.select();
    } else if (e.key === 'Escape') {
      if (e.target === els.search && els.search.value) {
        els.searchClear.click();
      } else if (state.pinned) {
        state.pinned = null;
        refreshHighlight();
      }
    }
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────

async function init() {
  restorePrefs();
  scene = new BikeScene(els.canvas);
  scene.setAlign(state.align, { animate: false });
  syncAlignButtons();
  updateThemeToggle();
  els.onlyDiff.checked = state.onlyDiff;
  bindEvents();
  renderCompareBar();
  renderLegend();
  renderCaption();

  await loadLibrary();
  restoreSelection();
  renderList();
  setupExample();
  onSelectionChange();
  document.fonts?.ready?.then(() => scene.requestDraw());
}

init();
