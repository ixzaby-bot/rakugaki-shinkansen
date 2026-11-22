// Dependency-free behavioral checks. DOM/Canvas mocks do not verify browser rendering.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let rect = { left: 17, top: 29, width: 390, height: 844 };
let scheduled;
let animationRequests = 0;
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
const types = ['hayabusa', 'komachi', 'kagayaki', 'nozomi', 'd51'];
const choices = types.map(type => ({
  dataset: { trainType: type }, pressed: String(type === 'hayabusa'),
  querySelector: () => ({ getContext: () => context }),
  setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; },
  addEventListener(name, fn) { this[name] = fn; }
}));
const modeButtons = ['rail', 'road'].map(mode => ({
  dataset: { mode }, setAttribute(name, value) { this.pressed = value; },
  addEventListener(name, fn) { this[name] = fn; }
}));
let recordArt = false;
const artCalls = [];
const sandbox = {
  document: { getElementById: id => ({ canvas, status, hint, 'hint-text': {}, clear: { addEventListener: (_, fn) => { clear = fn; } } })[id],
    querySelectorAll: selector => selector === '[data-mode]' ? modeButtons : choices,
    createElement: () => ({ getContext: () => context }),
    addEventListener: (name, fn) => { documentEvents[name] = fn; } },
  window: { devicePixelRatio: 2, addEventListener: (name, fn) => { windowEvents[name] = fn; } },
  requestAnimationFrame: fn => { scheduled = fn; animationRequests++; }
};
let source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
// Legacy single-route assertions inspect the most recently created train only.
source = source.replace(/\}\)\(\);\s*$/, `globalThis.inspect = () => {
  const train = trains[trains.length - 1];
  return { tracks, trains, active: train ? tracksById.get(train.trackId) : null,
    distance: train?.distance || 0, direction: train?.direction || 1, draft, pointerId, width, height, effects, selectedType, mode };
}; globalThis.testing = { formation, carPoses, smooth, sample, measure, endpointNear, CONNECT_RADIUS, ROAD_CONNECT_RADIUS }; })();`);
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../vehicles.js'), 'utf8'), sandbox);
const art = sandbox.window.TrainArt;
sandbox.window.TrainArt = { ...art, drawCar(...args) {
  if (recordArt) artCalls.push({ type: args[1], role: args[2] });
  art.drawCar(...args);
} };
vm.runInContext(source, sandbox);
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

// New specification: a bridge between different tracks is independent in every orientation.
for (const leftEnd of [0, 1]) for (const rightEnd of [0, 1]) {
  clear();
  stroke([[100, 150], [450, 150]]);
  stroke([[700, 600], [1100, 600]]); tick(20);
  const before = state().trains.map(t => ({ ...t }));
  const sources = state().tracks.map(t => t.source);
  stroke([[leftEnd ? 450 : 100, 150], [550, 400], [rightEnd ? 1100 : 700, 600]]);
  assert.equal(state().tracks.length, 3); assert.equal(state().trains.length, 3);
  before.forEach((t, i) => { near(state().trains[i].distance, t.distance); assert.equal(state().trains[i].id, t.id); });
  sources.forEach((s, i) => assert.equal(state().tracks[i].source, s));
  tick(100);
}

// Extending an older line leaves the other train's route and position unchanged.
setupLine(); const inactive = state().active;
stroke([[100, 700], [1100, 700]]); const running = state().active, beforeOther = currentPoses();
stroke([[800, 300], [1000, 400]]);
assert.equal(state().active, running); unchanged(beforeOther);
assert.ok(state().tracks.includes(inactive)); assert.equal(state().tracks.length, 2);

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
assert.ok(state().tracks.includes(farther)); assert.ok(state().tracks.includes(nearer));
assert.equal(state().tracks.length, 2); assert.ok(nearer.length > 300);
// No branch attachment at the middle, and closed routes have no eligible endpoints.
setupLine(); stroke([[550, 300], [550, 600]]); assert.equal(state().tracks.length, 2);
clear(); stroke([[200, 200], [500, 200], [500, 500], [200, 500], [200, 200]]);
assert.equal(sandbox.testing.endpointNear({ x: 200, y: 200 }), null);
stroke([[200, 200], [50, 50]]); assert.equal(state().tracks.length, 2);
console.log('PASS endpoint regression: four directions, radius boundary, repeated extension, closed joins, two-track bridge fallback, older-route extension, ambiguity, short consist, moving/cancelled input, rotation and effects.');

// T-01..T-03, T-11: one independent route adds one train; existing trains keep moving.
clear(); rect = { left: 13, top: 21, width: 1200, height: 900 }; windowEvents.resize();
function independentLine(i) { stroke([[100, 80 + i * 75], [1000, 80 + i * 75]]); }
function posesFor(train) { return carPoses(state().tracks.find(t => t.id === train.trackId), train.distance, train); }
function verifyLinks() {
  assert.equal(new Set(state().tracks.map(t => t.id)).size, state().tracks.length);
  assert.equal(new Set(state().trains.map(t => t.id)).size, state().trains.length);
  assert.equal(new Set(state().trains.map(t => t.trackId)).size, state().tracks.length);
  state().trains.forEach(train => {
    const route = state().tracks.find(t => t.id === train.trackId);
    assert.ok(route); assert.equal(train.type, 'hayabusa');
    assert.ok(train.distance >= 0 && train.distance <= formation(route, train).travel);
    posesFor(train).forEach(p => assert.ok(Number.isFinite(p.x + p.y + p.angle)));
  });
}
for (let i = 0; i < 5; i++) {
  const existing = state().trains.map(t => ({ id: t.id, distance: t.distance }));
  independentLine(i);
  assert.equal(state().trains.length, i + 1); assert.equal(state().tracks.length, i + 1);
  existing.forEach((old, j) => { assert.equal(state().trains[j].id, old.id); near(state().trains[j].distance, old.distance); });
  tick(2); verifyLinks();
}
const runningBefore = state().trains.map(t => t.distance);
listeners.pointerdown(event(100, 700)); listeners.pointermove(event(600, 700));
tick(10);
runningBefore.forEach((d, i) => assert.ok(state().trains[i].distance > d));
listeners.pointercancel(event(600, 700)); assert.equal(state().trains.length, 5);

// T-04..T-10: all four endpoint patterns preserve IDs/poses of every train.
for (const extension of [
  [[1002, 82], [1150, 100]], [[102, 157], [40, 210]],
  [[1150, 260], [1002, 232]], [[40, 350], [102, 307]]
]) {
  const allBefore = state().trains.map(t => ({ id: t.id, trackId: t.trackId, direction: t.direction, poses: posesFor(t) }));
  stroke(extension); assert.equal(state().trains.length, 5);
  allBefore.forEach((old, i) => {
    const train = state().trains[i];
    assert.equal(train.id, old.id); assert.equal(train.trackId, old.trackId); assert.equal(train.direction, old.direction);
    posesFor(train).forEach((p, j) => { near(p.x, old.poses[j].x, 1e-6); near(p.y, old.poses[j].y, 1e-6); });
  });
}
verifyLinks();

// T-12: tap/short input generates neither a route nor a train, including by an endpoint.
const beforeShort = state().trains.length;
stroke([[100, 380], [101, 380]]); assert.equal(state().trains.length, beforeShort);
stroke([[20, 700]]); assert.equal(state().trains.length, beforeShort);

// T-17/T-18: preserve every train, not only the last one, over 20 rotations.
const beforeRotation = state().tracks.map(t => ({ id: t.id, source: t.source, points: JSON.stringify(t.points) }));
const trainsBeforeRotation = state().trains.map(t => ({ ...t }));
for (let i = 0; i < 20; i++) {
  rect = { left: 0, top: 0, width: 390, height: 844 }; windowEvents.resize(); verifyLinks();
  rect = { left: 13, top: 21, width: 1200, height: 900 }; windowEvents.resize();
}
beforeRotation.forEach((old, i) => {
  assert.equal(state().tracks[i].id, old.id); assert.equal(state().tracks[i].source, old.source);
  assert.equal(JSON.stringify(state().tracks[i].points), old.points);
});
trainsBeforeRotation.forEach((old, i) => {
  near(state().trains[i].distance, old.distance); assert.equal(state().trains[i].direction, old.direction);
  assert.equal(state().trains[i].id, old.id); assert.equal(state().trains[i].trackId, old.trackId);
});

// ID lookup is independent of array insertion order; speed is per train.
state().tracks.reverse(); state().trains.reverse();
state().trains[0].speed = 35;
const ordered = state().trains.map(t => ({ id: t.id, distance: t.distance, speed: t.speed }));
const requestsBefore = animationRequests;
tick(10);
assert.equal(animationRequests - requestsBefore, 10); // One shared loop, not one per train.
ordered.forEach((old, i) => near(state().trains[i].distance - old.distance, old.speed * .16));
verifyLinks();

// T-15/T-16: clear all runtime state, then generate and run again.
listeners.pointerdown(event(100, 700)); listeners.pointermove(event(700, 700)); clear();
assert.equal(state().tracks.length, 0); assert.equal(state().trains.length, 0);
assert.equal(state().draft, null); assert.equal(state().pointerId, null); assert.equal(state().effects.length, 0);
independentLine(0); tick(5); assert.equal(state().trains.length, 1); assert.ok(state().trains[0].distance > 0);

// T-19: multiple loops wrap independently, retaining their direction.
clear();
for (let i = 0; i < 5; i++) {
  const loop = Array.from({ length: 61 }, (_, j) => [120 + i * 230 + 80 * Math.cos(j * Math.PI / 30), 300 + 80 * Math.sin(j * Math.PI / 30)]);
  stroke(loop);
}
assert.equal(state().trains.length, 5); assert.ok(state().tracks.every(t => t.closed));
state().trains[1].direction = -1;
const loopsBefore = state().trains.map(t => t.distance);
tick(900);
state().trains.forEach((t, i) => {
  const route = state().tracks.find(r => r.id === t.trackId);
  near(t.distance, ((loopsBefore[i] + t.direction * t.speed * .016 * 899) % route.length + route.length) % route.length, 1e-6);
});
verifyLinks();

// T-20 + load: ten independent trains all reverse; timings exclude real Canvas rasterization.
clear(); for (let i = 0; i < 10; i++) independentLine(i);
assert.equal(state().trains.length, 10); tick(120);
const flips = new Map(state().trains.map(t => [t.id, 0]));
const loadStart = performance.now();
for (let i = 0; i < 1600; i++) {
  const directions = state().trains.map(t => t.direction); tick();
  state().trains.forEach((t, j) => { if (t.direction !== directions[j]) flips.set(t.id, flips.get(t.id) + 1); });
}
const loadMs = performance.now() - loadStart;
assert.ok([...flips.values()].every(count => count >= 2)); verifyLinks();

// A small wiggle between a short route's ends must not close it accidentally.
clear(); stroke([[100, 100], [124, 100]]); const shortRoute = state().tracks[0];
stroke([[124, 100], [124, 110], [100, 110], [100, 100]]);
assert.equal(shortRoute.closed, false); assert.equal(state().tracks.length, 2); verifyLinks();
console.log(`PASS multi-train T-01..T-20: IDs, 1/2/5 trains, live input, continuity, no merging, 20 rotations, all clear, multiple loops and reversals; 10 trains × 1600 mock frames: ${loadMs.toFixed(1)} ms (not browser FPS).`);

// v0.2.2: selection affects only future independent trains.
clear();
assert.equal(state().selectedType, 'hayabusa');
assert.equal(choices[0].pressed, 'true');
types.forEach((type, i) => {
  choices[i].click();
  assert.equal(state().selectedType, type);
  assert.equal(choices.filter(b => b.pressed === 'true').length, 1);
  assert.equal(state().draft, null);
  assert.equal(state().trains.length, i);
  stroke([[100, 100 + i * 100], [700, 100 + i * 100]]);
  assert.equal(state().trains[i].type, type);
});
assert.deepEqual(Array.from(state().trains, t => t.type), types);
const selectedTrain = state().trains[4], keptId = selectedTrain.id;
choices[0].click();
const priorDistance = selectedTrain.distance;
stroke([[700, 500], [900, 500]]);
assert.equal(state().trains.length, 5);
assert.equal(selectedTrain.id, keptId);
assert.equal(selectedTrain.type, 'd51');
near(selectedTrain.distance, priorDistance);
recordArt = true; tick(); recordArt = false;
assert.equal(artCalls.filter(c => c.type === 'd51' && c.role === 'engine').length, 1);
assert.equal(artCalls.filter(c => c.type === 'd51' && c.role === 'coach').length, 3);
for (const type of types.slice(0, 4)) {
  assert.equal(artCalls.filter(c => c.type === type && c.role === 'cab').length, 2);
  assert.equal(artCalls.filter(c => c.type === type && c.role === 'coach').length, 2);
}
tick(1600);
assert.deepEqual(Array.from(state().trains, t => t.type), types);
const vehicleRotation = JSON.stringify(state().trains), oldRect2 = rect;
rect = { left: 0, top: 0, width: 390, height: 844 }; windowEvents.resize();
rect = oldRect2; windowEvents.resize();
state().trains.forEach((t, i) => {
  const before = JSON.parse(vehicleRotation)[i];
  assert.equal(t.type, before.type); assert.equal(t.direction, before.direction);
  near(t.distance, before.distance);
});
assert.equal(state().selectedType, 'hayabusa');
choices[4].click(); clear(); assert.equal(state().selectedType, 'd51');
stroke([[100,100],[124,100]]); assert.equal(state().trains[0].carCount, 1); tick(100);
clear(); stroke([[100,100],[600,100],[600,400],[100,400],[100,100]]);
assert.equal(state().tracks[0].closed, true); tick(1800);
assert.equal(state().trains[0].type, 'd51');
clear(); stroke([[100,100],[500,100],[110,110],[500,400]]); tick(1600);
assert.equal(state().trains[0].type, 'd51');
console.log('PASS v0.2.2: five selections/types, simultaneous trains, preserved types and extension position, engine + 3 coaches, short D51, curves/loops/reversals, rotation and clear selection. DOM/Canvas mock only.');

// v0.3.0 road mode: R-01..R-24 logic; touch/layout require a real browser.
assert.equal(state().mode, 'rail'); // R-01
clear(); modeButtons[1].click();
assert.equal(state().mode, 'road'); assert.equal(state().selectedType, 'police');
const roadTypes = ['police', 'fire', 'ambulance', 'bus', 'minivan'];
roadTypes.forEach((type, i) => {
  choices[i].click(); assert.equal(state().selectedType, type);
  assert.equal(state().tracks.length, i); assert.equal(state().draft, null);
  stroke([[100, 100 + i * 150], [1000, 100 + i * 150]]);
  const car = state().trains[i];
  assert.equal(car.type, type); assert.equal(car.carCount, 1);
  assert.equal(state().tracks[i].kind, 'road');
});
assert.deepEqual(Array.from(state().trains, t => t.type), roadTypes);
modeButtons[0].click(); assert.equal(state().selectedType, 'd51');
for (let i = 0; i < 5; i++) {
  choices[i].click(); stroke([[100, 160 + i * 150], [1000, 160 + i * 150]]);
}
assert.equal(state().tracks.length, 10); assert.equal(state().trains.length, 10);
const mixedTypes = Array.from(state().trains, t => t.type);
const mixedProgress = Array.from(state().trains, t => t.distance);
tick(50); state().trains.forEach((t, i) => assert.notEqual(t.distance, mixedProgress[i]));
assert.deepEqual(Array.from(state().trains, t => t.type), mixedTypes);
modeButtons[1].click(); assert.equal(state().selectedType, 'minivan');
// Adding a path must not pause any existing vehicle, including other modes.
listeners.pointerdown(event(30, 30)); listeners.pointermove(event(500, 30));
const beforeLive = Array.from(state().trains, t => t.distance); tick(5);
state().trains.forEach((t, i) => assert.notEqual(t.distance, beforeLive[i]));
// Switching mode while drawing cancels the draft and releases capture.
modeButtons[0].click(); assert.equal(state().draft, null); assert.equal(captured, null);
listeners.pointerup(event(500, 30)); assert.equal(state().tracks.length, 10);
// Repeat landscape/portrait round trips without coordinate accumulation.
const roadOriginalSources = state().tracks.map(t => t.source);
const roadOriginalPoints = JSON.stringify(state().tracks.map(t => t.points));
for (let i = 0; i < 20; i++) {
  rect = { left: 0, top: 0, width: 390, height: 844 }; windowEvents.resize();
  rect = { left: 13, top: 21, width: 1200, height: 900 }; windowEvents.resize();
}
assert.equal(JSON.stringify(state().tracks.map(t => t.points)), roadOriginalPoints);
state().tracks.forEach((t, i) => assert.equal(t.source, roadOriginalSources[i]));
assert.deepEqual(Array.from(state().trains, t => t.type), mixedTypes);
// All four endpoint orientations preserve the car's center, ID, size and type.
modeButtons[1].click();
for (const points of [
  [[800,300],[1050,400]], [[1050,400],[800,300]],
  [[300,300],[50,400]], [[50,400],[300,300]]
]) {
  clear(); stroke([[300,300],[800,300]]); tick(40);
  const car = state().trains[0], route = state().tracks[0];
  const before = carPoses(route, car.distance, car)[0];
  const identity = { id: car.id, type: car.type, direction: car.direction, baseSize: car.baseSize };
  stroke(points);
  assert.equal(state().trains.length, 1); assert.equal(state().tracks.length, 1);
  const after = carPoses(route, car.distance, car)[0]; near(before.x, after.x); near(before.y, after.y);
  for (const key of Object.keys(identity)) assert.equal(car[key], identity[key]);
}
// Separate road tolerance boundary, repeated extensions, loop closure.
assert.equal(sandbox.testing.ROAD_CONNECT_RADIUS, 28);
for (const gap of [28, 29]) {
  clear(); stroke([[300,300],[800,300]]);
  stroke([[800 + gap,300],[1050,300]]);
  assert.equal(state().trains.length, gap === 28 ? 1 : 2);
}
clear(); stroke([[300,300],[800,300]]); tick(30);
for (let end = 850; end <= 1000; end += 50) stroke([[end-50,300],[end,300]]);
assert.equal(state().trains.length, 1);
const loopCar = state().trains[0], loopRoute = state().tracks[0];
const preLoop = carPoses(loopRoute, loopCar.distance, loopCar)[0];
stroke([[1000,300],[1000,600],[300,600],[300,300]]);
assert.equal(loopRoute.closed, true); assert.equal(state().trains[0], loopCar);
const postLoop = carPoses(loopRoute, loopCar.distance, loopCar)[0]; near(preLoop.x, postLoop.x); near(preLoop.y, postLoop.y);
tick(2000); assert.ok(loopCar.distance >= 0 && loopCar.distance < loopRoute.length);
clear(); stroke([[100,100],[500,100]]); tick(600);
assert.equal(state().trains[0].direction, -1);
// Crossing and coincident endpoints NEVER connect across kinds, in either direction.
for (const firstMode of [0, 1]) {
  clear(); modeButtons[firstMode].click(); stroke([[100,300],[700,300]]);
  modeButtons[1-firstMode].click(); stroke([[700,300],[900,500]]);
  stroke([[400,100],[400,600]]);
  assert.equal(state().tracks.length, 3); assert.equal(state().trains.length, 3);
  assert.equal(state().tracks[0].length, 600);
}
modeButtons[1].click(); clear();
stroke([[100,100],[400,100]]); stroke([[700,600],[1000,600]]);
stroke([[400,100],[550,400],[700,600]]);
assert.equal(state().tracks.length, 3); assert.equal(state().trains.length, 3);
// Tiny roads, zero-length input, interrupted pointers and reset preserve selection.
clear(); const retainedRoadType = state().selectedType;
stroke([[100,100],[100,100]]); assert.equal(state().trains.length, 0);
stroke([[100,100],[124,100]]); tick(100); assert.equal(state().trains[0].carCount, 1);
clear(); assert.equal(state().mode, 'road'); assert.equal(state().selectedType, retainedRoadType);
assert.equal(state().tracks.length, 0); assert.equal(state().trains.length, 0);
stroke([[100,100],[700,100]]); assert.equal(state().trains[0].type, retainedRoadType);
// Twenty mixed routes share exactly one scheduled animation chain.
clear();
for (let i = 0; i < 20; i++) {
  modeButtons[i % 2].click(); choices[i % 5].click();
  stroke([[100, 25 + i * 42], [1000, 25 + i * 42]]);
}
assert.equal(state().trains.length, 20);
const scheduledBefore = animationRequests, roadLoadStart = performance.now();
tick(1600);
assert.equal(animationRequests - scheduledBefore, 1600);
state().trains.forEach(car => {
  const route = state().tracks.find(t => t.id === car.trackId);
  assert.equal(route.kind, art.types[car.type].kind === 'road' ? 'road' : 'rail');
  assert.ok(car.distance >= 0 && car.distance <= formation(route, car).travel);
});
console.log(`PASS v0.3.0 R-01..R-24 logic: modes, five cars, 4-way extension/28px, loops/reversals, separated kinds, cancellation, 20 rotations, clear; 20 mixed routes x1600 mock frames ${(performance.now()-roadLoadStart).toFixed(1)} ms. R-17/18 UI hit testing and touch scrolling require browser/device verification.`);
