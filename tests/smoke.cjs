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
source = source.replace(/\}\)\(\);\s*$/, 'globalThis.inspect = () => ({ tracks, active, distance, direction, draft, pointerId, width, height, effects }); globalThis.testing = { formation, carPoses, smooth, sample, measure, endpointNear, CONNECT_RADIUS }; })();');
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
  clear(); // Independent short-track fixtures, not extensions of previous cases.
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

// v0.2.0: finish without advancing time to isolate join continuity from motion.
function stroke(points) {
  listeners.pointerdown(event(...points[0]));
  points.slice(1).forEach(p => listeners.pointermove(event(...p)));
  listeners.pointerup(event(...points.at(-1)));
}
function setupLine() {
  clear(); rect = { left: 17, top: 29, width: 1200, height: 900 }; windowEvents.resize();
  stroke([[300, 300], [800, 300]]); tick(30);
}
function currentPoses() { return carPoses(state().active, state().distance); }
function unchanged(before) {
  const after = currentPoses();
  assert.equal(after.length, before.length);
  after.forEach((p, i) => { near(p.x, before[i].x, 1e-6); near(p.y, before[i].y, 1e-6); });
}
for (const extension of [
  [[802, 302], [1000, 400]], // start at old end
  [[302, 302], [100, 400]], // start at old start
  [[1000, 400], [802, 302]], // end at old end
  [[100, 400], [302, 302]] // end at old start
]) {
  setupLine(); const before = currentPoses(); const heading = state().direction;
  stroke(extension);
  assert.equal(state().tracks.length, 1); assert.ok(state().active.length > 650);
  unchanged(before); assert.equal(state().direction, heading);
  assert.equal(state().effects.length, 1);
  tick(500); assert.equal(state().effects.length, 0);
}

setupLine();
const radius = sandbox.testing.CONNECT_RADIUS;
assert.ok(sandbox.testing.endpointNear({ x: 800 + radius, y: 300 }));
assert.equal(sandbox.testing.endpointNear({ x: 800 + radius + .01, y: 300 }), null);
stroke([[800 + radius + 1, 300], [1100, 300]]);
assert.equal(state().tracks.length, 2); // Outside tolerance stays independent.
near(state().active.points[0].x, 829);

setupLine();
for (let end = 850; end <= 1100; end += 50) {
  const before = currentPoses(); stroke([[end - 50, 300], [end, 300]]);
  unchanged(before); assert.equal(state().tracks.length, 1);
}
near(state().active.length, 800);
tick(600); assert.ok(currentPoses().some(p => p.x > 800));

// Closing a running open track keeps poses and both forward/reverse direction.
for (const reverse of [false, true]) for (const drawReverse of [false, true]) {
  setupLine(); if (reverse) tick(210);
  const before = currentPoses(), heading = state().direction;
  const closing = [[802, 300], [1000, 550], [100, 550], [300, 302]];
  stroke(drawReverse ? closing.reverse() : closing);
  assert.equal(state().active.closed, true); unchanged(before);
  assert.equal(state().direction, heading);
  const start = state().distance; tick();
  near(state().distance, (start + heading * 1.12 + state().active.length) % state().active.length);
  tick(1500); assert.ok(Number.isFinite(state().distance));
}

// Two existing tracks can be joined in any endpoint orientation; active is the second.
for (const leftEnd of [0, 1]) for (const rightEnd of [0, 1]) {
  clear();
  stroke([[100, 150], [450, 150]]);
  stroke([[700, 600], [1100, 600]]); tick(20);
  const before = currentPoses();
  stroke([[leftEnd ? 450 : 100, 150], [550, 400], [rightEnd ? 1100 : 700, 600]]);
  assert.equal(state().tracks.length, 1); unchanged(before);
  tick(100);
}

// Joining an inactive line must not teleport the running train away from its line.
setupLine(); const inactive = state().active;
stroke([[100, 700], [1100, 700]]); const running = state().active, beforeOther = currentPoses();
stroke([[800, 300], [1000, 400]]);
assert.equal(state().active, running); unchanged(beforeOther);
assert.ok(!state().tracks.includes(inactive)); assert.equal(state().tracks.length, 2);

// Equal nearest endpoints and reuse of the same endpoint are ambiguous: independent.
clear(); stroke([[100, 100], [400, 100]]); stroke([[100, 140], [400, 140]]);
stroke([[400, 120], [600, 120]]); assert.equal(state().tracks.length, 3);
clear(); stroke([[100, 100], [400, 100]]);
stroke([[400, 100], [500, 200], [400, 100]]); assert.equal(state().tracks.length, 2);

// Short-track extensions keep the existing small consist instead of spawning cars in place.
clear(); stroke([[100, 100], [124, 100]]); const tiny = currentPoses();
stroke([[124, 100], [700, 200]]); unchanged(tiny);
assert.equal(formation(state().active).count, 1); tick(300);

// Drawing, cancellation, and rotation while train is moving.
setupLine(); listeners.pointerdown(event(800, 300)); listeners.pointermove(event(900, 300));
const during = state().distance; tick(20); assert.notEqual(state().distance, during);
listeners.pointercancel(event(900, 300)); assert.equal(state().tracks.length, 1);
const beforeRotate = state().active.source;
rect = { left: 0, top: 0, width: 600, height: 450 }; windowEvents.resize();
const beforeJoin = currentPoses(); stroke([[400, 150], [550, 150]]); unchanged(beforeJoin);
assert.notEqual(state().active.source, beforeRotate);
const joinedPoints = JSON.stringify(state().active.points);
for (let i = 0; i < 10; i++) {
  rect = { left: 0, top: 0, width: 450, height: 600 }; windowEvents.resize();
  rect = { left: 0, top: 0, width: 600, height: 450 }; windowEvents.resize();
}
assert.equal(JSON.stringify(state().active.points), joinedPoints);
clear(); assert.equal(state().effects.length, 0); tick();
// A start snap chooses the nearer candidate, not insertion order.
clear(); stroke([[100, 100], [400, 100]]); const farther = state().active;
stroke([[100, 140], [400, 140]]); const nearer = state().active;
assert.equal(sandbox.testing.endpointNear({ x: 400, y: 125 }).track, nearer);
stroke([[400, 125], [650, 200]]);
assert.ok(state().tracks.includes(farther)); assert.ok(!state().tracks.includes(nearer));
// No branch attachment at the middle, and closed routes have no eligible endpoints.
setupLine(); stroke([[550, 300], [550, 600]]); assert.equal(state().tracks.length, 2);
clear(); stroke([[200, 200], [500, 200], [500, 500], [200, 500], [200, 200]]);
assert.equal(sandbox.testing.endpointNear({ x: 200, y: 200 }), null);
stroke([[200, 200], [50, 50]]); assert.equal(state().tracks.length, 2);
console.log('PASS v0.2.0: all four endpoint directions, radius boundary, repeated extension, closed joins in both travel directions, merging two tracks, inactive joins, ambiguous fallback, short consist, moving/cancelled input, rotation and effects.');
