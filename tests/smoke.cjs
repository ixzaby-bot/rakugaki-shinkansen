// Dependency-free behavioral checks. DOM/Canvas mocks do not verify browser rendering.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let rect = { left: 17, top: 29, width: 390, height: 844 };
let scheduled;
const listeners = {};
const windowEvents = {};
const documentEvents = {};
let captured = null;
let drawCalls = 0;
const context = new Proxy({}, { get: (_, key) => (...args) => {
  for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `Non-finite ${key}`);
  drawCalls++;
}, set: () => true });
const canvas = {
  getContext: () => context, getBoundingClientRect: () => rect,
  addEventListener: (name, fn) => { listeners[name] = fn; },
  setPointerCapture: id => { captured = id; },
  hasPointerCapture: id => captured === id,
  releasePointerCapture: () => { captured = null; }
};
const status = {};
const hint = { classList: { add() {}, remove() {}, toggle() {} } };
let clear;
const sandbox = {
  document: { getElementById: id => ({ canvas, status, hint, clear: { addEventListener: (_, fn) => { clear = fn; } } })[id],
    createElement: () => ({ getContext: () => context }),
    addEventListener: (name, fn) => { documentEvents[name] = fn; } },
  window: { devicePixelRatio: 2, addEventListener: (name, fn) => { windowEvents[name] = fn; } },
  requestAnimationFrame: fn => { scheduled = fn; }
};
let source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
source = source.replace(/\}\)\(\);\s*$/, 'globalThis.inspect = () => ({ tracks, active, distance, direction, draft, pointerId, width, height }); globalThis.testing = { formation, carPoses, smooth, sample, measure }; })();');
vm.runInNewContext(source, sandbox);
const state = () => sandbox.inspect();
const { formation, carPoses, smooth, sample, measure } = sandbox.testing;
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
let time = 0;
const tick = (n = 1) => { for (let i = 0; i < n; i++) scheduled(time += 16); };
const event = (x, y, id = 1) => ({ clientX: x + rect.left, clientY: y + rect.top, pointerId: id, isPrimary: true, button: 0, preventDefault() {} });
function draw(points) {
  listeners.pointerdown(event(...points[0]));
  points.slice(1).forEach(p => listeners.pointermove(event(...p)));
  listeners.pointerup(event(...points.at(-1)));
  tick();
}
draw([[20, 20], [21, 20]]);
assert.equal(state().tracks.length, 0);
draw([[30, 100], [230, 100]]);
assert.equal(state().active.length, 200);
assert.equal(state().active.points[0].x, 30); // Element offset must be subtracted.
const speedStart = state().distance;
tick(20);
near(state().distance - speedStart, 22.4);
tick(50);
assert.equal(state().direction, -1);
assert.ok(state().distance >= 0 && state().distance <= 200);
draw([[40, 200], [200, 360], [40, 360], [200, 200]]);
const crossing = state().active;
tick(600);
assert.equal(state().active, crossing);
assert.ok(state().distance >= 0 && state().distance <= crossing.length);
draw([[100, 200], [200, 200], [200, 300], [100, 300], [100, 200]]);
assert.equal(state().active.closed, true);
assert.equal(state().tracks.length, 3);
tick(800);
assert.equal(state().direction, 1);
assert.ok(state().distance >= 0 && state().distance < state().active.length);
const oldLength = state().active.length;
const originalPoints = JSON.stringify(state().active.points);
const originalSource = state().active.source;
const oldDistance = state().distance;
rect = { left: 0, top: 0, width: 844, height: 390 };
windowEvents.resize();
assert.ok(Math.abs(state().active.length - oldLength * 390 / 844) < 1e-8);
assert.equal(canvas.width, 1688);
for (let i = 0; i < 20; i++) {
  rect = { left: 17, top: 29, width: 390, height: 844 };
  windowEvents.resize();
  near(state().active.length, oldLength);
  near(state().distance, oldDistance);
  assert.equal(JSON.stringify(state().active.points), originalPoints);
  assert.equal(state().active.source, originalSource);
  rect = { left: 0, top: 0, width: 844, height: 390 };
  windowEvents.resize();
}
tick();
listeners.pointerdown(event(20, 30));
listeners.pointerdown(event(100, 100, 2));
assert.equal(state().pointerId, 1);
listeners.pointercancel(event(20, 30));
assert.equal(state().draft, null);
assert.equal(state().tracks.length, 3);
listeners.pointerdown(event(10, 10));
listeners.pointermove(event(60, 10));
clear();
assert.equal(state().tracks.length, 0);
assert.equal(state().active, null);
assert.equal(captured, null);
draw([[10, 10], [34, 10]]);
rect = { left: 0, top: 0, width: 1, height: 1 };
windowEvents.resize();
tick(100);
assert.ok(state().distance >= 0 && state().distance <= state().active.length);
documentEvents.visibilitychange();
tick();
assert.ok(drawCalls > 0);

// Formation positions remain on the corrected route with a fixed path-distance gap.
clear();
rect = { left: 17, top: 29, width: 1000, height: 800 };
windowEvents.resize();
draw([[50, 200], [950, 200]]);
let track = state().active;
assert.equal(formation(track).count, 4);
for (const offset of [0, 100, formation(track).travel]) {
  const poses = carPoses(track, offset);
  poses.forEach((p, i) => {
    near(p.y, 200); near(p.angle, 0);
    if (i) near(p.x - poses[i - 1].x, 66);
  });
}
let reversals = 0;
let previous = carPoses(track, state().distance);
let previousDirection = state().direction;
for (let i = 0; i < 1800; i++) {
  tick();
  const poses = carPoses(track, state().distance);
  poses.forEach((p, j) => {
    assert.ok(Math.hypot(p.x - previous[j].x, p.y - previous[j].y) <= 1.120001);
    near(p.angle, previous[j].angle); // No teleport or 180-degree flip at reversal.
    assert.ok(p.s >= 0 && p.s <= track.length);
  });
  if (state().direction !== previousDirection) reversals++;
  previous = poses; previousDirection = state().direction;
}
assert.ok(reversals >= 2);

draw([[100, 100], [700, 100], [700, 130], [120, 160], [120, 600]]);
track = state().active;
assert.equal(formation(track).count, 4);
for (let offset = 0; offset <= formation(track).travel; offset += 7) {
  carPoses(track, offset).forEach((p, i, poses) => {
    const onPath = sample(track, p.s);
    near(p.x, onPath.x); near(p.y, onPath.y);
    assert.ok(Number.isFinite(p.angle));
    if (i) near(p.s - poses[i - 1].s, 66);
  });
}
tick(200);

const circle = Array.from({ length: 81 }, (_, i) => [450 + 200 * Math.cos(i * Math.PI / 40), 400 + 200 * Math.sin(i * Math.PI / 40)]);
draw(circle);
track = state().active;
assert.equal(track.closed, true);
assert.equal(formation(track).count, 4);
for (let car = 0; car < 4; car++) {
  const seam = track.length - car * formation(track).spacing;
  const before = carPoses(track, seam - .01)[car], after = carPoses(track, seam + .01)[car];
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < .021);
  const delta = Math.atan2(Math.sin(after.angle - before.angle), Math.cos(after.angle - before.angle));
  assert.ok(Math.abs(delta) < .01);
}

for (const length of [24, 69, 70, 100, 139, 140, 210, 280]) {
  draw([[50, 200], [50 + length, 200]]);
  track = state().active;
  const f = formation(track);
  assert.equal(f.count, Math.max(1, Math.min(4, Math.floor(length / 70))));
  assert.ok(f.travel > 0);
  for (const offset of [0, f.travel]) {
    const poses = carPoses(track, offset);
    assert.ok(poses[0].s - 34 * f.scale >= -1e-8);
    assert.ok(poses.at(-1).s + 34 * f.scale <= track.length + 1e-8);
  }
  tick(100);
}

// Noise reduction, endpoint retention and bounded intentional corner rounding.
const noisy = Array.from({ length: 101 }, (_, i) => ({ x: i * 3, y: i === 0 || i === 100 ? 200 : 200 + (i % 2 ? 2 : -2) }));
const filtered = smooth(noisy);
assert.ok(filtered.length < measure(noisy).length * .85);
near(filtered.points[0].x, 0); near(filtered.points.at(-1).x, 300);
assert.ok(filtered.points.every(p => Math.abs(p.y - 200) <= 2));
const corner = smooth([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
assert.ok(corner.points.some(p => Math.hypot(p.x - 100, p.y) < 4));
assert.ok(corner.points.every(p => Math.min(Math.abs(p.y), Math.abs(100 - p.x)) < 4));

// Resize while drawing: inverse input transform matches displayed coordinates.
clear();
listeners.pointerdown(event(50, 200));
listeners.pointermove(event(150, 200));
rect = { left: 0, top: 0, width: 500, height: 400 };
windowEvents.resize();
listeners.pointermove(event(100, 100));
listeners.pointerup(event(100, 100));
near(state().active.points.at(-1).x, 100);
near(state().active.points.at(-1).y, 100);
const drawnSmall = state().active.source;
draw([[100, 200], [400, 200]]); // A different source viewport must also round-trip.
const smallPoints = JSON.stringify(state().active.points);
rect = { left: 0, top: 0, width: 1000, height: 800 };
windowEvents.resize();
assert.equal(state().tracks[0].source, drawnSmall);
rect = { left: 0, top: 0, width: 500, height: 400 };
windowEvents.resize();
assert.equal(JSON.stringify(state().active.points), smallPoints);
tick();
console.log('PASS v0.1.1: regression checks; four cars; sharp curves; loop seams; continuous reversal; short-track formation; smoothing; 20 resize round-trips; mixed source viewports; resize during drawing.');
