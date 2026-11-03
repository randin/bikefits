// Geometry model for BikeGeoCalc fit files.
//
// Coordinates are millimetres in BikeGeoCalc's frame (x → forward, y → up).
// Every fit has its own origin, so anything compared across bikes should be
// measured relative to a shared landmark (the bottom bracket, usually).

/** BikeGeoCalc URL key mapping (JSON key → URL letter). Order matters. */
export const KEY_MAPPING = {
  offsetX: 'a',
  offsetY: 'b',
  bottomBracketX: 'c',
  bottomBracketY: 'd',
  seatTubeTopCenterX: 'e',
  seatTubeTopCenterY: 'f',
  saddleTopY: 'g',
  saddleBackX: 'h',
  backHubX: 'i',
  hubY: 'j',
  frontHubX: 'k',
  headTubeTopCenterY: 'l',
  headTubeTopCenterX: 'm',
  headTubeBottomCenterY: 'n',
  headTubeBottomCenterX: 'o',
  handlebarTopY: 'p',
  handlebarBackX: 'q',
  hoodsRestTopX: 'r',
  hoodsRestTopY: 's',
  handlebarDiameter: 't',
  stemStack: 'u',
  stemAngle: 'v',
  headsetBottomStack: 'w',
  headsetTopStack: 'x',
  saddleLength: 'y',
  saddleStack: 'z',
  saddleAngle: 'A',
  saddleFrontToCenter: 'B',
  seatpostSetback: 'C',
  forkLength: 'D',
  forkRake: 'E',
  crankLength: 'F',
  headTubeTopToTopTubeCenter: 'G',
  seatTubeTopToTopTubeCenter: 'H',
};

/** Standard fallback geometry used when a fit file is missing keys. */
export const DEFAULT_GEOMETRY = {
  offsetX: 0,
  offsetY: 0,
  bottomBracketX: 750,
  bottomBracketY: 270,
  seatTubeTopCenterX: 618,
  seatTubeTopCenterY: 737,
  saddleTopY: 926,
  saddleBackX: 433,
  backHubX: 340,
  hubY: 340,
  frontHubX: 1324,
  headTubeTopCenterY: 819,
  headTubeTopCenterX: 1134,
  headTubeBottomCenterY: 687,
  headTubeBottomCenterX: 1174,
  handlebarTopY: 893,
  handlebarBackX: 1203,
  hoodsRestTopX: 1328,
  hoodsRestTopY: 902,
  handlebarDiameter: 31.8,
  stemStack: 40,
  stemAngle: 6,
  headsetBottomStack: 0,
  headsetTopStack: 8,
  saddleLength: 240,
  saddleStack: 40,
  saddleAngle: 0,
  saddleFrontToCenter: 150,
  seatpostSetback: 20,
  forkLength: 370,
  forkRake: 44,
  crankLength: 170,
  headTubeTopToTopTubeCenter: 30,
  seatTubeTopToTopTubeCenter: 30,
};

/** Extra fallbacks that only matter for drawing. */
const DRAWING_DEFAULTS = { wheelRadius: 340, headsetSpacersStack: 10 };

const RAD = Math.PI / 180;

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const has = (d, ...keys) => keys.every((k) => isNum(d[k]));
const valueOr = (d, k) => (isNum(d[k]) ? d[k] : isNum(DEFAULT_GEOMETRY[k]) ? DEFAULT_GEOMETRY[k] : DRAWING_DEFAULTS[k] ?? 0);

// ── Vector helpers ──────────────────────────────────────────────────────────
export const pt = (x, y) => ({ x, y });
export const add = (a, b) => pt(a.x + b.x, a.y + b.y);
export const sub = (a, b) => pt(a.x - b.x, a.y - b.y);
export const mul = (a, k) => pt(a.x * k, a.y * k);
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => len(sub(a, b));
export const unit = (a) => {
  const l = len(a) || 1;
  return pt(a.x / l, a.y / l);
};
const dot = (a, b) => a.x * b.x + a.y * b.y;

/** True when an object looks like a BikeGeoCalc fit export. */
export function isFitData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Object.keys(KEY_MAPPING).filter((k) => isNum(data[k])).length >= 6;
}

/**
 * Derive every point needed to draw and measure a bike.
 * Verified against BikeGeoCalc exports: stack/reach, saddle height and stem
 * length all reconstruct exactly from these points.
 */
export function computePoints(d) {
  const g = (k) => valueOr(d, k);

  const bb = pt(g('bottomBracketX'), g('bottomBracketY'));
  const rHub = pt(g('backHubX'), g('hubY'));
  const fHub = pt(g('frontHubX'), g('hubY'));
  const stTop = pt(g('seatTubeTopCenterX'), g('seatTubeTopCenterY'));
  const htTop = pt(g('headTubeTopCenterX'), g('headTubeTopCenterY'));
  const htBot = pt(g('headTubeBottomCenterX'), g('headTubeBottomCenterY'));

  const uST = unit(sub(stTop, bb)); // up the seat tube
  const uHT = unit(sub(htTop, htBot)); // up the steering axis
  const seatAxisAt = (y) => add(bb, mul(uST, (y - bb.y) / (uST.y || 1)));

  const ground = has(d, 'bottomBracketHeight') ? bb.y - d.bottomBracketHeight : g('offsetY');
  const rolling = rHub.y - ground;
  const wheelR = rolling > 150 && rolling < 500 ? rolling : g('wheelRadius');

  // Frame junctions
  const ttRear = sub(stTop, mul(uST, g('seatTubeTopToTopTubeCenter')));
  const ttFront = sub(htTop, mul(uHT, g('headTubeTopToTopTubeCenter')));
  const htLen = dist(htTop, htBot);
  const dtFront = add(htBot, mul(uHT, Math.min(28, htLen * 0.25)));
  const crown = sub(htBot, mul(uHT, g('headsetBottomStack')));

  // Steerer, spacers and stem
  const spacerBase = add(htTop, mul(uHT, g('headsetTopStack')));
  const spacerTop = add(spacerBase, mul(uHT, g('headsetSpacersStack')));
  const stemCenter = add(spacerTop, mul(uHT, g('stemStack') / 2));
  const barR = g('handlebarDiameter') / 2;
  const barBack = pt(g('handlebarBackX'), g('handlebarTopY'));
  const barCenter = pt(barBack.x + barR, barBack.y - barR);
  const hoods = pt(g('hoodsRestTopX'), g('hoodsRestTopY'));

  // Saddle: back → nose along the saddle angle; "center" is BikeGeoCalc's
  // saddle-height reference point (saddleFrontToCenter behind the nose).
  const sa = g('saddleAngle') * RAD;
  const sDir = pt(Math.cos(sa), -Math.sin(sa));
  const saddleBack = pt(g('saddleBackX'), g('saddleTopY'));
  const saddleNose = add(saddleBack, mul(sDir, g('saddleLength')));
  const saddleCenter = sub(saddleNose, mul(sDir, g('saddleFrontToCenter')));
  const saddleRail = pt(saddleCenter.x, saddleCenter.y - g('saddleStack'));

  // Seatpost runs up the seat axis to rail height, then lays back by its setback.
  const seatAxisAtRail = seatAxisAt(saddleRail.y);
  const backward = pt(-uST.y, uST.x);
  const seatClamp = add(seatAxisAtRail, mul(backward, g('seatpostSetback')));

  // Steering geometry
  const axisGround = sub(htBot, mul(uHT, (htBot.y - ground) / (uHT.y || 1)));
  const contact = pt(fHub.x, ground);
  const rakeFoot = add(htBot, mul(uHT, dot(sub(fHub, htBot), uHT)));

  const crank = g('crankLength');

  return {
    bb, rHub, fHub, stTop, htTop, htBot, uST, uHT,
    ground, wheelR, wheelRadius: g('wheelRadius'),
    ttRear, ttFront, dtFront, crown,
    spacerBase, spacerTop, stemCenter, barR, barBack, barCenter, hoods,
    saddleBack, saddleNose, saddleCenter, saddleRail, seatAxisAtRail, seatClamp,
    axisGround, contact, rakeFoot,
    seatAxisAtHT: seatAxisAt(htTop.y),
    crank, pedal: pt(bb.x + crank, bb.y),
  };
}

// ── Measurements ────────────────────────────────────────────────────────────
// Each metric: label, unit, value(data, points) and optional dims(points)
// describing how to draw it on the bike (in world coordinates).

const field = (k) => (d) => (isNum(d[k]) ? d[k] : undefined);
// `stack` forces which way B's copy is offset (-1 = up on screen); default: away from the points.
const hdim = (a, b, y, stack) => ({ type: 'h', a, b, y, stack });
const vdim = (a, b, x) => ({ type: 'v', a, b, x });
const ldim = (a, b, side = 1) => ({ type: 'line', a, b, side });
const angle = (at, from, to, r) => ({ type: 'angle', at, from, to, r });
const guide = (a, b) => ({ type: 'guide', a, b });
const mark = (p, axis) => ({ type: 'point', p, axis });
const BACK = pt(-1, 0);
const FORWARD = pt(1, 0);

const LONGER = { more: 'longer', less: 'shorter' };
const HIGHER = { more: 'higher', less: 'lower' };
const STEEPER = { more: 'steeper', less: 'slacker' };

export const SECTIONS = [
  {
    id: 'fit',
    title: 'Fit',
    subtitle: 'Contact points, from the BB',
    metrics: [
      {
        key: 'saddleHeight', label: 'Saddle height', unit: 'mm', ...HIGHER,
        value: (d, p) => (isNum(d.saddleTopToBottomBracket) ? d.saddleTopToBottomBracket
          : has(d, 'bottomBracketX', 'bottomBracketY', 'saddleBackX', 'saddleTopY') ? dist(p.bb, p.saddleCenter) : undefined),
        dims: (p) => [ldim(p.bb, p.saddleCenter, -1)],
      },
      {
        key: 'setback', label: 'Saddle setback', hint: 'to nose', unit: 'mm', more: 'further back', less: 'further forward',
        value: (d, p) => (has(d, 'bottomBracketX', 'saddleBackX') ? p.bb.x - p.saddleNose.x : undefined),
        dims: (p) => [hdim(p.saddleNose, p.bb, p.saddleNose.y + 45)],
      },
      {
        key: 'drop', label: 'Saddle-to-bar drop', unit: 'mm', more: 'more drop', less: 'less drop',
        value: (d) => (has(d, 'saddleTopY', 'handlebarTopY') ? d.saddleTopY - d.handlebarTopY : undefined),
        dims: (p) => [vdim(pt(p.saddleNose.x, p.saddleBack.y), p.barBack, p.barBack.x - 20)],
      },
      {
        key: 'noseToHoods', label: 'Saddle nose to hoods', unit: 'mm', ...LONGER,
        value: (d, p) => (has(d, 'hoodsRestTopX', 'saddleBackX') ? p.hoods.x - p.saddleNose.x : undefined),
        dims: (p) => [hdim(p.saddleNose, p.hoods, Math.max(p.saddleNose.y, p.hoods.y) + 45)],
      },
      {
        key: 'barReach', label: 'Bar reach', unit: 'mm', ...LONGER,
        value: (d) => (has(d, 'handlebarBackX', 'bottomBracketX') ? d.handlebarBackX - d.bottomBracketX : undefined),
        dims: (p) => [hdim(p.bb, p.barBack, p.barBack.y + 45)],
      },
      {
        key: 'barStack', label: 'Bar stack', unit: 'mm', ...HIGHER,
        value: (d) => (has(d, 'handlebarTopY', 'bottomBracketY') ? d.handlebarTopY - d.bottomBracketY : undefined),
        dims: (p) => [vdim(p.bb, p.barBack, p.barBack.x - 25)],
      },
      {
        key: 'hoodsReach', label: 'Hoods reach', unit: 'mm', ...LONGER,
        value: (d) => (has(d, 'hoodsRestTopX', 'bottomBracketX') ? d.hoodsRestTopX - d.bottomBracketX : undefined),
        dims: (p) => [hdim(p.bb, p.hoods, p.hoods.y + 45)],
      },
      {
        key: 'hoodsStack', label: 'Hoods stack', unit: 'mm', ...HIGHER,
        value: (d) => (has(d, 'hoodsRestTopY', 'bottomBracketY') ? d.hoodsRestTopY - d.bottomBracketY : undefined),
        dims: (p) => [vdim(p.bb, p.hoods, p.hoods.x + 30)],
      },
    ],
  },
  {
    id: 'frame',
    title: 'Frame',
    metrics: [
      { key: 'stack', label: 'Stack', unit: 'mm', more: 'taller', less: 'shorter', value: field('stack'),
        dims: (p) => [vdim(p.bb, p.htTop, p.htTop.x)] },
      { key: 'reach', label: 'Reach', unit: 'mm', ...LONGER, value: field('reach'),
        dims: (p) => [hdim(p.bb, p.htTop, p.htTop.y + 30)] },
      { key: 'headTubeAngle', label: 'Head tube angle', unit: '°', ...STEEPER, value: field('headTubeAngle'),
        dims: (p) => [guide(add(p.htTop, mul(p.uHT, 30)), p.axisGround), angle(p.htTop, FORWARD, mul(p.uHT, -1), 105)] },
      { key: 'seatTubeAngle', label: 'Seat tube angle', unit: '°', ...STEEPER, value: field('seatTubeAngle'),
        dims: (p) => [angle(p.bb, BACK, p.uST, 150)] },
      { key: 'headTubeLength', label: 'Head tube length', unit: 'mm', ...LONGER, value: field('headTubeLength'),
        dims: (p) => [ldim(p.htBot, p.htTop, -1)] },
      { key: 'topTube', label: 'Effective top tube', unit: 'mm', ...LONGER, value: field('topTubeHorizontal'),
        dims: (p) => [guide(p.stTop, p.seatAxisAtHT), hdim(p.seatAxisAtHT, p.htTop, p.htTop.y + 40)] },
      { key: 'seatTube', label: 'Seat tube', hint: 'c–t', unit: 'mm', ...LONGER, value: field('seatTubeCenterToTop'),
        dims: (p) => [ldim(p.bb, p.stTop, 1)] },
      { key: 'chainStay', label: 'Chainstay', unit: 'mm', ...LONGER, value: field('chainStayLength'),
        dims: (p) => [ldim(p.rHub, p.bb, -1)] },
      { key: 'wheelBase', label: 'Wheelbase', unit: 'mm', ...LONGER, value: field('wheelBase'),
        dims: (p) => [hdim(p.rHub, p.fHub, p.ground - 28, -1)] },
      { key: 'bbDrop', label: 'BB drop', unit: 'mm', more: 'more', less: 'less', value: field('bottomBracketDrop'),
        dims: (p) => [vdim(p.rHub, p.bb, p.bb.x + 55)] },
      { key: 'bbHeight', label: 'BB height', unit: 'mm', ...HIGHER, value: field('bottomBracketHeight'),
        dims: (p) => [vdim(pt(p.bb.x, p.ground), p.bb, p.bb.x + 55)] },
      { key: 'trail', label: 'Trail', unit: 'mm', more: 'more', less: 'less', value: field('trail'),
        dims: (p) => [guide(p.htBot, p.axisGround), guide(p.fHub, p.contact), hdim(p.contact, p.axisGround, p.ground - 28, -1)] },
      { key: 'forkLength', label: 'Fork length', hint: 'axle–crown', unit: 'mm', ...LONGER, value: field('forkLength'),
        dims: (p) => [ldim(p.crown, p.fHub, 1)] },
      { key: 'forkRake', label: 'Fork rake', unit: 'mm', more: 'more', less: 'less', value: field('forkRake'),
        dims: (p) => [guide(p.htBot, p.rakeFoot), ldim(p.rakeFoot, p.fHub, 1)] },
    ],
  },
  {
    id: 'cockpit',
    title: 'Cockpit & components',
    metrics: [
      { key: 'stemLength', label: 'Stem length', unit: 'mm', ...LONGER, value: field('stemLength'),
        dims: (p) => [ldim(p.stemCenter, p.barCenter, 1)] },
      { key: 'stemAngle', label: 'Stem angle', unit: '°', more: 'more', less: 'less', value: field('stemAngle') },
      { key: 'spacers', label: 'Spacers', unit: 'mm', more: 'more', less: 'less', value: field('headsetSpacersStack'),
        dims: (p) => [ldim(p.spacerBase, p.spacerTop, 1)] },
      { key: 'headsetTopStack', label: 'Headset top stack', unit: 'mm', more: 'more', less: 'less', value: field('headsetTopStack'),
        dims: (p) => [ldim(p.htTop, p.spacerBase, 1)] },
      { key: 'headsetBottomStack', label: 'Headset bottom stack', unit: 'mm', more: 'more', less: 'less', value: field('headsetBottomStack') },
      { key: 'handlebarDiameter', label: 'Bar diameter', unit: 'mm', more: 'more', less: 'less', value: field('handlebarDiameter') },
      { key: 'crankLength', label: 'Crank length', unit: 'mm', ...LONGER, value: field('crankLength'),
        dims: (p) => [ldim(p.bb, p.pedal, -1)] },
      { key: 'saddleLength', label: 'Saddle length', unit: 'mm', ...LONGER, value: field('saddleLength'),
        dims: (p) => [ldim(p.saddleBack, p.saddleNose, 1)] },
      { key: 'saddleStack', label: 'Saddle stack', hint: 'rail to top', unit: 'mm', ...HIGHER, value: field('saddleStack'),
        dims: (p) => [vdim(p.saddleRail, p.saddleCenter, p.saddleBack.x - 25)] },
      { key: 'saddleAngle', label: 'Saddle angle', unit: '°', more: 'more', less: 'less', value: field('saddleAngle') },
      { key: 'seatpostSetback', label: 'Seatpost setback', unit: 'mm', more: 'more', less: 'less', value: field('seatpostSetback'),
        dims: (p) => [ldim(p.seatAxisAtRail, p.seatClamp, -1)] },
      { key: 'wheelRadius', label: 'Wheel radius', unit: 'mm', more: 'larger', less: 'smaller', value: field('wheelRadius'),
        dims: (p) => [ldim(p.fHub, pt(p.fHub.x, p.fHub.y + p.wheelRadius), -1)] },
    ],
  },
  {
    id: 'raw',
    title: 'BikeGeoCalc coordinates',
    subtitle: 'Raw positions; origin differs per bike',
    collapsedByDefault: true,
    metrics: [
      { key: 'rawSaddleTopY', label: 'Saddle top', hint: 'Y', unit: 'mm', ...HIGHER, value: field('saddleTopY'),
        dims: (p) => [mark(p.saddleBack, 'y')] },
      { key: 'rawSaddleBackX', label: 'Saddle back', hint: 'X', unit: 'mm', more: 'further forward', less: 'further back', value: field('saddleBackX'),
        dims: (p) => [mark(p.saddleBack, 'x')] },
      { key: 'rawBarBackX', label: 'Handlebar back', hint: 'X', unit: 'mm', more: 'further forward', less: 'further back', value: field('handlebarBackX'),
        dims: (p) => [mark(p.barBack, 'x')] },
      { key: 'rawBarTopY', label: 'Handlebar top', hint: 'Y', unit: 'mm', ...HIGHER, value: field('handlebarTopY'),
        dims: (p) => [mark(p.barBack, 'y')] },
      { key: 'rawHoodsX', label: 'Hoods top', hint: 'X', unit: 'mm', more: 'further forward', less: 'further back', value: field('hoodsRestTopX'),
        dims: (p) => [mark(p.hoods, 'x')] },
      { key: 'rawHoodsY', label: 'Hoods top', hint: 'Y', unit: 'mm', ...HIGHER, value: field('hoodsRestTopY'),
        dims: (p) => [mark(p.hoods, 'y')] },
    ],
  },
];

export const METRICS = Object.fromEntries(SECTIONS.flatMap((s) => s.metrics.map((m) => [m.key, m])));

/** Rider contact points, used for the "how does my position change" summary. */
export const CONTACTS = [
  { key: 'saddle', label: 'Saddle', point: (p) => p.saddleCenter },
  { key: 'bars', label: 'Bars', point: (p) => p.barBack },
  { key: 'hoods', label: 'Hoods', point: (p) => p.hoods },
];

/** How far a contact point moves from fit A to fit B, measured from each BB. */
export function contactShift(fitA, fitB, contact) {
  const a = sub(contact.point(fitA.pts), fitA.pts.bb);
  const b = sub(contact.point(fitB.pts), fitB.pts.bb);
  return sub(b, a);
}

/** Value of a metric for a loaded fit ({ data, pts }), or undefined. */
export function metricValue(metric, fit) {
  if (!metric || !fit?.data) return undefined;
  const v = metric.value(fit.data, fit.pts);
  return isNum(v) ? v : undefined;
}

// ── Formatting ──────────────────────────────────────────────────────────────
const MINUS = '\u2212';

export function formatNumber(v) {
  if (!isNum(v)) return '—';
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return s === '-0.0' ? '0.0' : s.replace('-', MINUS);
}

export function formatValue(v, unit) {
  if (!isNum(v)) return '—';
  return unit === '°' ? `${formatNumber(v)}°` : `${formatNumber(v)} ${unit}`;
}

export function formatDelta(delta) {
  if (!isNum(delta)) return '';
  if (Math.abs(delta) < 0.05) return '—';
  const s = Math.abs(Math.round(delta * 10) / 10).toFixed(1);
  return delta > 0 ? `+${s}` : `${MINUS}${s}`;
}

/** "B is 16.0 mm taller" — plain-language description of a B − A delta. */
export function describeDelta(metric, delta, names = ['A', 'B']) {
  if (!isNum(delta)) return '';
  if (Math.abs(delta) < 0.05) return `Same on both`;
  const amount = metric.unit === '°' ? `${formatNumber(Math.abs(delta))}°` : `${formatNumber(Math.abs(delta))} mm`;
  const word = delta > 0 ? metric.more : metric.less;
  return `${names[1]} is ${amount} ${word}`;
}

/** Title-case all-lowercase words for display ("break away small" → "Break Away Small"). */
export function prettyName(name) {
  return String(name)
    .trim()
    .split(/\s+/)
    .map((w) => (/^[a-z]/.test(w) && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Build a BikeGeoCalc link for one or two fits (same format as before). */
export function buildBikeGeoCalcUrl(fits) {
  let url = 'https://www.bikegeocalc.com/#';
  for (const fit of fits) {
    const data = fit.data;
    const nameStr = String(data.name || fit.name).replace(/\s+/g, '+');
    let part = `${nameStr.length}${nameStr}`;
    for (const [key, letter] of Object.entries(KEY_MAPPING)) {
      const rawVal = data[key] !== undefined ? data[key] : DEFAULT_GEOMETRY[key];
      const val = Math.round(rawVal * 100000) / 100000;
      part += `${letter}${val}`;
    }
    url += `${part}Z`;
  }
  return url;
}
