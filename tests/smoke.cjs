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
let captured = null; const captures = new Set();
let drawCalls = 0;
let recordTransforms = false; const transforms = [];
let recordRotations = false; const rotations = [];
const context = new Proxy({}, { get: (_, key) => (...args) => {
  for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `Non-finite ${key}`);
  if (recordTransforms && key === 'setTransform') transforms.push(args);
  if (recordRotations && key === 'rotate') rotations.push(args[0]);
  drawCalls++;
}, set: () => true });
const canvas = {
  getContext: () => context, getBoundingClientRect: () => rect,
  addEventListener: (name, fn) => { listeners[name] = fn; },
  setPointerCapture: id => { captured = id; captures.add(id); },
  hasPointerCapture: id => captures.has(id),
  releasePointerCapture: id => { captures.delete(id); captured = captures.size ? [...captures][0] : null; }
};
const status = {};
const hint = { classList: { add() {}, remove() {}, toggle() {} } };
let uiPointerDown;
let overUi = false; const gameStyle = {};
let clear, home; const zoomOutput = {};
const guide = { hidden: false };
const eraseButton = { setAttribute(name, value) { this[name] = value; }, addEventListener(name, fn) { this[name] = fn; } };
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
  document: { getElementById: id => ({ erase: eraseButton, 'edge-guide': guide, game: { style: { setProperty: (key,value) => { gameStyle[key]=value; } } }, canvas, status, hint, 'hint-text': {}, zoom: zoomOutput, home: { addEventListener: (_, fn) => { home = fn; } }, clear: { addEventListener: (_, fn) => { clear = fn; } } })[id],
    elementFromPoint: () => ({ closest: () => overUi }),
    querySelectorAll: selector => selector === '[data-mode]' ? modeButtons : selector === '[data-drawing-ui]' ? [{ addEventListener: (_,fn) => { uiPointerDown=fn; } }] : choices,
    createElement: () => ({ getContext: () => context, addEventListener() {} }),
    addEventListener: (name, fn) => { documentEvents[name] = fn; } },
  window: { devicePixelRatio: 2, addEventListener: (name, fn) => { windowEvents[name] = fn; } },
  requestAnimationFrame: fn => { scheduled = fn; animationRequests++; }
};
let source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
// Legacy single-route assertions inspect the most recently created train only.
source = source.replace(/\}\)\(\);\s*$/, `globalThis.inspect = () => {
  const train = trains[trains.length - 1];
  return { tracks, trains, active: train ? tracksById.get(train.trackId) : null,
    distance: train?.distance || 0, direction: train?.direction || 1, draft, pointerId, width, height, effects, selectedType, mode, camera, inputState, pointers, railsDirty, dpr, edgePoint, drawingAge, activeTool, eraseTap, tracksById };
}; globalThis.testing = { formation, carPoses, smooth, sample, measure, endpointNear, CONNECT_RADIUS, ROAD_CONNECT_RADIUS, drawRoad, drawTrain, screenToWorld, worldToScreen, setCamera, findPathAtPoint, removePath, pathWidth, carAppearance }; })();`);
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../hit.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../edge.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../camera.js'), 'utf8'), sandbox);
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
// Legacy geometric fixtures are world positions, converted through the public camera math.
const event = (x, y, id = 1) => {
  const p = sandbox.testing.worldToScreen({ x, y });
  return { clientX: p.x + rect.left, clientY: p.y + rect.top, pointerId: id, pointerType: 'touch', isPrimary: id === 1, button: 0, preventDefault() {} };
};
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
assert.ok(Math.abs(state().active.length - oldLength) < 1e-8);
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
assert.equal(state().pointerId, null); // v0.3.1 second finger cancels the draft.
listeners.pointercancel(event(20, 30));
assert.equal(state().draft, null);
assert.equal(state().tracks.length, 3);
listeners.pointerup(event(100,100,2));
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
const beforeJoin = currentPoses(); stroke([[800, 300], [1100, 300]]); unchanged(beforeJoin);
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
modeButtons[0].click(); assert.equal(state().draft, null);
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

// Road stroke width follows vehicle scale through resize AND coordinate rebasing.
clear(); modeButtons[1].click(); stroke([[100,100],[700,100]]);
const roadStrokeWidths = [];
const roadContext = new Proxy({}, { get(target, key) {
  if (key === 'stroke') return () => roadStrokeWidths.push(target.lineWidth);
  return target[key] || (() => {});
} });
function outerRoadWidth() {
  roadStrokeWidths.length = 0; sandbox.testing.drawRoad(roadContext, state().tracks[0]);
  return roadStrokeWidths[0];
}
near(outerRoadWidth(), 36);
rect = { left: 0, top: 0, width: 600, height: 450 }; windowEvents.resize();
near(outerRoadWidth(), 36);
stroke([[700,100],[1000,100]]);
assert.equal(state().tracks.length, 1); near(outerRoadWidth(), 36);
rect = { left: 0, top: 0, width: 1200, height: 900 }; windowEvents.resize();
near(outerRoadWidth(), 36);
console.log('PASS road width remains proportional across resize and extension rebasing.');

// Actual draw transform must face travel direction rather than only reversing distance.
const facingCar = state().trains[0], facingRoute = state().tracks[0];
const facingPose = carPoses(facingRoute, facingCar.distance, facingCar)[0];
recordRotations = true;
facingCar.direction = 1; sandbox.testing.drawTrain(facingPose, 0, 1, 1, facingCar);
facingCar.direction = -1; sandbox.testing.drawTrain(facingPose, 0, 1, 1, facingCar);
recordRotations = false;
near(rotations[1] - rotations[0], Math.PI);
console.log('PASS car render orientation reverses by PI at unchanged center.');

// v0.3.1 camera/input contract: actual CSS screen events, independent of old world fixtures.
clear(); home();
rect = { left: 17, top: 29, width: 390, height: 844 }; windowEvents.resize();
const camMath = sandbox.window.WorldCamera;
const { setCamera, screenToWorld, worldToScreen } = sandbox.testing;
near(state().camera.x, 2500); near(state().camera.y, 2500); near(state().camera.zoom, 1);
assert.equal(zoomOutput.textContent, '100%');
const cssEvent = (x,y,id=1) => ({ clientX:x+rect.left,clientY:y+rect.top,pointerId:id,
  pointerType:'touch',isPrimary:id===1,button:0,preventDefault(){} });
const cssDown = (x,y,id=1) => listeners.pointerdown(cssEvent(x,y,id));
const cssMove = (x,y,id=1) => listeners.pointermove(cssEvent(x,y,id));
const cssUp = (x,y,id=1) => listeners.pointerup(cssEvent(x,y,id));
for (const zoom of [.5,1,3]) {
  setCamera({x:2300,y:2600,zoom});
  for (const p of [{x:0,y:0},{x:2500,y:2500},{x:5000,y:5000}]) {
    const round = screenToWorld(worldToScreen(p)); near(round.x,p.x); near(round.y,p.y);
  }
}
// Finger two cancels a real unfinished stroke; simultaneous pan keeps its anchor.
home(); const oldCount = state().tracks.length;
cssDown(100,200); cssMove(120,200); assert.ok(state().draft);
cssDown(280,200,2); assert.equal(state().draft,null); assert.equal(state().inputState,'cameraGesture');
const anchor = screenToWorld({x:200,y:200});
cssMove(160,230); cssMove(320,230,2);
const anchoredPoint = worldToScreen(anchor); near(anchoredPoint.x,240); near(anchoredPoint.y,230);
near(state().camera.x,2460); near(state().camera.y,2470);
cssUp(320,230,2); cssMove(200,250); assert.equal(state().draft,null);
cssUp(200,250); assert.equal(state().tracks.length,oldCount); assert.equal(state().inputState,'idle');
// Pinch uses the start midpoint's world position, not the center of the viewport.
home(); cssDown(100,250); cssDown(200,250,2);
const pinchAnchor = screenToWorld({x:150,y:250});
cssMove(0,300); cssMove(300,300,2); near(state().camera.zoom,3);
let anchoredScreen = worldToScreen(pinchAnchor); near(anchoredScreen.x,150); near(anchoredScreen.y,300);
cssMove(-100,300); cssMove(400,300,2); near(state().camera.zoom,3);
cssMove(145,300); cssMove(155,300,2); near(state().camera.zoom,.5);
anchoredScreen=worldToScreen(pinchAnchor); near(anchoredScreen.x,150); near(anchoredScreen.y,300);
cssUp(145,300); cssUp(155,300,2); assert.equal(state().tracks.length,0);
// Cancel/lost capture/third finger and replacement pair do not create paths.
home(); cssDown(50,200); cssMove(100,200); listeners.pointercancel(cssEvent(100,200));
assert.equal(state().tracks.length,0); assert.equal(captures.size,0);
cssDown(50,200); cssDown(150,200,2); cssDown(250,200,3);
cssUp(50,200); cssMove(170,220,2); cssMove(270,220,3);
listeners.lostpointercapture(cssEvent(170,220,2)); cssMove(280,230,3); cssUp(280,230,3);
assert.equal(state().tracks.length,0); assert.equal(state().inputState,'idle');
// Clamping is deterministic, including viewports larger than the whole world.
for (const zoom of [.5,1,3]) {
  setCamera({x:-1e9,y:1e9,zoom});
  near(state().camera.x,rect.width/(2*zoom));
  near(state().camera.y,5000-rect.height/(2*zoom));
  const before = JSON.stringify(state().camera); setCamera(state().camera); assert.equal(JSON.stringify(state().camera),before);
}
const oversized=camMath.clamp({x:-1e6,y:1e6,zoom:.5},4000,4000);
near(oversized.x,2500); near(oversized.y,2500);
// Each zoom uses 28 screen px endpoint tolerance, capped at 56 world units.
for (const zoom of [.5,1,3]) for (const kindIndex of [0,1]) for(const gapPx of [28,29]) {
  clear(); modeButtons[kindIndex].click(); setCamera({x:2500,y:2500,zoom});
  stroke([[2350,2500],[2650,2500]]);
  const firstVehicle=state().trains[0], before=carPoses(state().tracks[0],firstVehicle.distance,firstVehicle)[0];
  stroke([[2650+gapPx/zoom,2500],[2850,2500]]);
  assert.equal(state().tracks.length,gapPx===28?1:2);
  if(gapPx===28){const after=carPoses(state().tracks[0],firstVehicle.distance,firstVehicle)[0];near(after.x,before.x);near(after.y,before.y);}
}
// 5 trains + 5 cars: camera, zoom, rotation and DPR never mutate world data.
clear(); home();
for(let i=0;i<10;i++){
  modeButtons[i%2].click(); choices[i%5].click();
  stroke([[2200,2100+i*70],[3000,2100+i*70]]);
}
tick(10);
const worldBefore=JSON.stringify(state().tracks), vehiclesBefore=JSON.stringify(state().trains);
setCamera({x:4200,y:4200,zoom:3});
rect={left:13,top:37,width:844,height:390}; windowEvents.resize();
sandbox.window.devicePixelRatio=3; windowEvents.resize();
assert.equal(canvas.width,2532); assert.equal(canvas.height,1170);
assert.equal(JSON.stringify(state().tracks),worldBefore);assert.equal(JSON.stringify(state().trains),vehiclesBefore);
const travelBefore=state().trains.map(t=>t.distance);tick(20);
state().trains.forEach((t,i)=>assert.notEqual(t.distance,travelBefore[i]));
const runningBeforeHome=JSON.stringify(state().trains);home();
assert.equal(JSON.stringify(state().trains),runningBeforeHome);assert.equal(JSON.stringify(state().tracks),worldBefore);
near(state().camera.x,2500);near(state().camera.y,2500);near(state().camera.zoom,1);
// Restore invalidates the viewport cache and resets elapsed time, never routes.
tick();assert.equal(state().railsDirty,false);
documentEvents.visibilitychange();assert.equal(state().railsDirty,true);
const pausedProgress=JSON.stringify(state().trains);time+=3600000;tick();
assert.equal(JSON.stringify(state().trains),pausedProgress);assert.equal(JSON.stringify(state().tracks),worldBefore);
windowEvents.pageshow();assert.equal(state().railsDirty,true);tick();
// This is simulated restoration, not a Safari long-suspension test (C-32).
clear();home();setCamera({x:3000,y:2800,zoom:.5});modeButtons[1].click();
const firstExpected=screenToWorld({x:100,y:180});
cssDown(100,180);cssMove(300,180);cssUp(300,180);
near(state().tracks[0].points[0].x,firstExpected.x);near(state().tracks[0].points[0].y,firstExpected.y);
assert.equal(state().tracks[0].kind,'road');
// Home cancels a stroke and keeps it blocked until that contact lifts.
const countBeforeHome=state().tracks.length;cssDown(100,280);cssMove(200,280);home();cssMove(300,280);cssUp(300,280);
assert.equal(state().tracks.length,countBeforeHome);
clear();cssDown(100,180);cssMove(300,180);cssUp(300,180);assert.equal(state().trains.length,1);
assert.ok(canvas.width<5000 && canvas.height<5000);
console.log('PASS C-01..27/29..30 camera logic: CSS/world round-trip, pan/pinch anchor and bounds, contacts/cancel, 0.5/1/3x snapping, offscreen motion, resize/DPR immutability, home, simulated restore. C-28/31/32 need browser/device checks.');

// Every frame installs absolute DPR/camera matrices and returns to screen space.
setCamera({x:2400,y:2600,zoom:3});recordTransforms=true;tick(2);recordTransforms=false;
const expectedMatrix=[9,0,0,9,3*(rect.width/2-2400*3),3*(rect.height/2-2600*3)];
assert.ok(transforms.some(m=>m.every((n,i)=>Math.abs(n-expectedMatrix[i])<1e-8)));
assert.deepEqual(transforms.at(-1),[3,0,0,3,0,0]);
console.log('PASS absolute DPR/world transforms and screen-space restoration, no accumulation.');

// v0.3.2: frame-driven edge scrolling, using stationary CSS pointer positions.
const edgeConfig = sandbox.window.EdgeScroll;
assert.equal(edgeConfig.SIZE,48); assert.equal(gameStyle['--edge-size'],'48px');
const advance = (n,ms=16) => { for(let i=0;i<n;i++) scheduled(time+=ms); };
function edgeSetup(kind=0,zoom=1) {
  clear();home();modeButtons[kind].click();
  rect={left:17,top:29,width:320,height:568};windowEvents.resize();
  setCamera({x:2500,y:2500,zoom});overUi=false;tick();
}
edgeSetup();cssDown(160,280);advance(60);near(state().camera.x,2500);near(state().camera.y,2500);cssUp(160,280);
for(const [x,y,sx,sy] of [[320,280,1,0],[0,280,-1,0],[160,0,0,-1],[160,568,0,1],[320,568,1,1]]){
  edgeSetup();cssDown(x,y);advance(9); // 144ms: delay has not expired.
  near(state().camera.x,2500);near(state().camera.y,2500);
  advance(31); // 640ms total; 490ms active at full 240 CSS px/s.
  near(state().camera.x,2500+sx*240*.49,1e-6);near(state().camera.y,2500+sy*240*.49,1e-6);
  assert.ok(state().draft.length>2);
  for(let i=1;i<state().draft.length;i++)assert.ok(Math.hypot(state().draft[i].x-state().draft[i-1].x,state().draft[i].y-state().draft[i-1].y)<=6.000001);
  const stopped=JSON.stringify(state().camera);cssMove(160,280);advance(30);assert.equal(JSON.stringify(state().camera),stopped);
  cssUp(160,280);assert.equal(state().trains.length,1);advance(30);assert.equal(JSON.stringify(state().camera),stopped);
}
// Quadratic speed, zoom-invariant screen distance, 60-ish/20/10 FPS agreement.
for(const zoom of [.5,1,3])for(const ms of [10,50,100]){
  edgeSetup(1,zoom);cssDown(308,280);advance(1000/ms,ms);
  const screenDistance=(state().camera.x-2500)*zoom;
  near(screenDistance,240*(36/48)**2*.85,1e-6);
  assert.ok(state().draft.length>2);cssUp(308,280);assert.equal(state().tracks[0].kind,'road');
}
// Every boundary stops without duplicate points; the unblocked diagonal axis continues.
for(const [x,y,cx,cy] of [[320,280,4840,2500],[0,280,160,2500],[160,0,2500,284],[160,568,2500,4716]]){
  edgeSetup();setCamera({x:cx,y:cy,zoom:1});cssDown(x,y);advance(100);
  near(state().camera.x,cx);near(state().camera.y,cy);assert.equal(state().draft.length,1);cssUp(x,y);
  assert.equal(state().trains.length,0);
}
edgeSetup();setCamera({x:4840,y:2500,zoom:1});cssDown(320,568);advance(60);
near(state().camera.x,4840);assert.ok(state().camera.y>2500);cssUp(320,568);
// Outside the Canvas, UI hit-testing, second finger, cancel and home all stop scrolling.
edgeSetup();cssDown(320,280);advance(30);cssMove(321,280);
let stoppedEdge=JSON.stringify(state().camera);advance(30);assert.equal(JSON.stringify(state().camera),stoppedEdge);
cssMove(320,280);overUi=true;advance(30);assert.equal(JSON.stringify(state().camera),stoppedEdge);overUi=false;
cssDown(150,280,2);assert.equal(state().draft,null);advance(30);assert.equal(JSON.stringify(state().camera),stoppedEdge);
cssUp(150,280,2);cssMove(310,280);advance(30);assert.equal(JSON.stringify(state().camera),stoppedEdge);cssUp(310,280);assert.equal(state().trains.length,0);
edgeSetup();cssDown(320,280);advance(30);listeners.pointercancel(cssEvent(320,280));
stoppedEdge=JSON.stringify(state().camera);advance(30);assert.equal(JSON.stringify(state().camera),stoppedEdge);assert.equal(state().trains.length,0);
edgeSetup();cssDown(320,280);advance(30);uiPointerDown();assert.equal(state().draft,null);
stoppedEdge=JSON.stringify(state().camera);advance(30);assert.equal(JSON.stringify(state().camera),stoppedEdge);cssUp(320,280);assert.equal(state().trains.length,0);
// Both kinds extend from an existing endpoint while moving the camera; IDs/types/poses persist.
for(const kind of [0,1]){
  edgeSetup(kind);const a=screenToWorld({x:60,y:280}),b=screenToWorld({x:280,y:280});
  stroke([[a.x,a.y],[b.x,b.y]]);tick(5);
  const vehicle=state().trains[0],route=state().tracks[0],id=vehicle.id,type=vehicle.type;
  cssDown(280,280);cssMove(315,280);advance(50);
  const before=carPoses(route,vehicle.distance,vehicle)[0];cssUp(315,280);
  assert.equal(state().trains.length,1);assert.equal(vehicle.id,id);assert.equal(vehicle.type,type);
  const after=carPoses(route,vehicle.distance,vehicle)[0];near(after.x,before.x);near(after.y,before.y);
  assert.ok(route.length>220);
}
// Rotation invalidates the old CSS pointer until a new move arrives; resume from the new rect.
edgeSetup();cssDown(320,280);advance(30);rect={left:5,top:9,width:568,height:320};windowEvents.resize();
stoppedEdge=JSON.stringify(state().camera);advance(30);assert.equal(JSON.stringify(state().camera),stoppedEdge);
cssMove(568,160);advance(30);assert.ok(state().camera.x>JSON.parse(stoppedEdge).x);cssUp(568,160);
// Recovery drops pointers; a huge elapsed interval is clamped even without a visibility signal.
edgeSetup();cssDown(320,280);advance(30);const beforePause=state().camera.x;advance(1,3600000);
assert.ok(state().camera.x-beforePause<=24.00001);
documentEvents.visibilitychange();stoppedEdge=JSON.stringify(state().camera);advance(1,3600000);
assert.equal(JSON.stringify(state().camera),stoppedEdge);assert.equal(state().draft,null);
clear();cssDown(160,280);cssMove(260,280);cssUp(260,280);assert.equal(state().trains.length,1);
// Mixed 10 vehicles continue during edge scrolling, with one shared RAF chain.
edgeSetup();for(let i=0;i<10;i++){modeButtons[i%2].click();stroke([[2200,2100+i*70],[3000,2100+i*70]]);}tick(2);
const mixedEdgeBefore=state().trains.map(t=>t.distance),edgeRequests=animationRequests;
cssDown(320,280);advance(30);state().trains.forEach((t,i)=>assert.notEqual(t.distance,mixedEdgeBefore[i]));
assert.equal(animationRequests-edgeRequests,30);listeners.pointercancel(cssEvent(320,280));assert.equal(state().trains.length,10);
console.log('PASS E-01..23/25..29 logic: delay, 4 edges/diagonal, stationary points, quadratic speed, 0.5/1/3x, 10/20/100 FPS, boundary, UI/cancel/gesture, extension IDs, rotation, recovery and mixed vehicles. E-24/30..35 require browser/device checks; long suspension remains unverified.');

// v0.3.3: erasing is a single-contact transaction, never a pointerdown mutation.
const { findPathAtPoint, removePath, pathWidth } = sandbox.testing;
const geometry = sandbox.window.PathHit;
function eraseSetup() {
  clear(); modeButtons[0].click(); home(); overUi=false;
  rect={left:17,top:29,width:800,height:700}; windowEvents.resize();
}
function tapWorld(p) { listeners.pointerdown(event(p.x,p.y)); listeners.pointerup(event(p.x,p.y)); }
function seed(kind=0,y=2500) { modeButtons[kind].click(); stroke([[2200,y],[2800,y]]); return state().tracks.at(-1); }
function erasing() { if(state().activeTool!=='erase') eraseButton.click(); }
function integrity() {
  assert.equal(state().tracks.length,state().trains.length);
  assert.equal(state().tracksById.size,state().tracks.length);
  assert.equal(new Set(state().tracks.map(t=>t.id)).size,state().tracks.length);
  state().trains.forEach(t=>assert.ok(state().tracksById.has(t.trackId)));
}
eraseSetup();assert.equal(state().activeTool,'draw');assert.equal(guide.hidden,false);
const railA=seed(),roadA=seed(1,2600);choices[3].click();erasing();
assert.equal(eraseButton['aria-pressed'],'true');assert.equal(guide.hidden,true);
assert.equal(state().selectedType,'bus');assert.equal(state().mode,'road');
const untouched=JSON.stringify({track:roadA,train:state().trains[1]});
listeners.pointerdown(event(2600,2500));assert.equal(state().tracks.length,2);assert.equal(state().eraseTap.pathId,railA.id);
listeners.pointerup(event(2600,2500));assert.equal(state().tracks.length,1);
assert.equal(JSON.stringify({track:roadA,train:state().trains[0]}),untouched);integrity();
tapWorld({x:2500,y:2400});assert.equal(state().tracks.length,1);
tapWorld({x:2600,y:2600});assert.equal(state().tracks.length,0);assert.equal(state().activeTool,'erase');integrity();
assert.equal(removePath(railA.id),false);
eraseButton.click();assert.equal(guide.hidden,false);assert.equal(state().selectedType,'bus');
seed();erasing();modeButtons[0].click();assert.equal(state().activeTool,'draw');assert.equal(guide.hidden,false);
// Radius uses the visible width + 12 CSS px at every zoom; geometry uses segment interiors.
for(const zoom of [.5,1,3]) for(const kind of [0,1]) {
  eraseSetup();const route=seed(kind);setCamera({x:2600,y:2500,zoom});
  const radius=pathWidth(route)/2+12/zoom;
  assert.equal(findPathAtPoint({x:2600,y:2500+radius-.001})?.id,route.id);
  assert.equal(findPathAtPoint({x:2600,y:2500+radius+.001}),null);
  erasing();tapWorld({x:2600,y:2500});assert.equal(state().tracks.length,0);integrity();
}
near(geometry.distanceToSegment({x:3,y:4},{x:0,y:0},{x:0,y:0}),5);
near(geometry.distanceToSegment({x:50,y:5},{x:0,y:0},{x:100,y:0}),5);
near(geometry.pathDistance({x:50,y:50},{closed:true,points:[{x:0,y:0},{x:100,y:0},{x:100,y:100}]}),0);
// Closed paths of either kind and extended paths disappear as one ID.
for(const kind of [0,1]) {
  eraseSetup();modeButtons[kind].click();
  stroke([[2400,2400],[2600,2400],[2600,2600],[2400,2600],[2400,2400]]);
  const route=state().tracks[0];assert.equal(route.closed,true);erasing();tapWorld(route.points.at(-1));integrity();assert.equal(state().tracks.length,0);
  modeButtons[kind].click();const extended=seed(kind);stroke([[2800,2500],[2900,2500]]);
  assert.equal(state().tracks.length,1);assert.ok(extended.length>600);erasing();tapWorld({x:2600,y:2500});assert.equal(state().tracks.length,0);
}
// Nearest first, then selected kind, then frontmost same-kind path. Vehicles are away from taps.
eraseSetup();const crossRail=seed();modeButtons[1].click();stroke([[2600,2200],[2600,2800]]);
const crossRoad=state().tracks.at(-1);assert.equal(findPathAtPoint({x:2600,y:2500}).id,crossRoad.id);
modeButtons[0].click();assert.equal(findPathAtPoint({x:2600,y:2500}).id,crossRail.id);
erasing();tapWorld({x:2600,y:2500});assert.equal(state().tracks.length,1);integrity();
eraseSetup();const nearA=seed();const nearB=seed(0,2530);
assert.equal(findPathAtPoint({x:2600,y:2520}).id,nearB.id);
assert.equal(findPathAtPoint({x:2600,y:2515}).id,nearB.id);
assert.equal(findPathAtPoint({x:2600,y:2514}).id,nearA.id);
// Every car in every type, with rotated poses and reverse orientation. Body wins over a crossing route.
for(const kind of [0,1]) for(let type=0;type<5;type++) for(const direction of [-1,1]) {
  eraseSetup();modeButtons[kind].click();choices[type].click();stroke([[2250,2250],[2750,2750]]);
  const route=state().tracks[0],train=state().trains[0];train.direction=direction;
  for(const pose of carPoses(route,train.distance,train)) assert.equal(findPathAtPoint(pose)?.id,route.id);
  const pose=carPoses(route,train.distance,train).at(-1);erasing();tapWorld(pose);assert.equal(state().trains.length,0);
}
eraseSetup();const bodyRoute=seed();const bodyTrain=state().trains[0];const bodyPose=carPoses(bodyRoute,bodyTrain.distance,bodyTrain)[1];
modeButtons[1].click();stroke([[bodyPose.x,2200],[bodyPose.x,2800]]);
assert.equal(findPathAtPoint(bodyPose).id,bodyRoute.id); // selected road loses to visible rail body.
assert.equal(findPathAtPoint({x:0,y:0}),null); // outside viewport cannot select offscreen vehicles.
// A second finger, cancelled capture, UI, resize, coalesced excursions, or leave-and-return cancels.
for(const action of ['two','cancel','lost','move','coalesced','outside','mode','ui','resize','restore']) {
  eraseSetup();seed();erasing();const p={x:2600,y:2500};listeners.pointerdown(event(p.x,p.y));
  if(action==='two') {
    listeners.pointerdown(event(2650,2500,2));assert.equal(state().eraseTap,null);
    listeners.pointermove(event(2700,2550,2));assert.equal(state().inputState,'cameraGesture');
    listeners.pointerup(event(2700,2550,2));listeners.pointermove(event(2600,2500));
  } else if(action==='cancel') listeners.pointercancel(event(p.x,p.y));
  else if(action==='lost') listeners.lostpointercapture(event(p.x,p.y));
  else if(action==='move') { listeners.pointermove(event(2620,2500));listeners.pointermove(event(2600,2500)); }
  else if(action==='coalesced') { const e=event(2600,2500);e.getCoalescedEvents=()=>[event(2620,2500)];listeners.pointermove(e); }
  else if(action==='outside') { cssMove(-1,100);listeners.pointermove(event(2600,2500)); }
  else if(action==='mode') modeButtons[1].click();
  else if(action==='ui') uiPointerDown();
  else if(action==='resize') windowEvents.resize();
  else documentEvents.visibilitychange();
  assert.equal(state().eraseTap,null);listeners.pointerup(event(p.x,p.y));assert.equal(state().tracks.length,1);integrity();
}
// Up-only movement counts; target changing while held must not delete a different path.
eraseSetup();seed();erasing();listeners.pointerdown(event(2600,2500));listeners.pointerup(event(2620,2500));assert.equal(state().tracks.length,1);
eraseSetup();seed();stroke([[2300,2510],[2700,2510]]);erasing();listeners.pointerdown(event(2600,2500));listeners.pointerup(event(2600,2510));assert.equal(state().tracks.length,2);
// Edge hold does not move camera or delete before release, guide stays hidden.
eraseSetup();seed();erasing();setCamera({x:2200+400-5,y:2500,zoom:1});
const heldCamera=JSON.stringify(state().camera);cssDown(5,350);advance(150);
assert.equal(JSON.stringify(state().camera),heldCamera);assert.equal(state().tracks.length,1);assert.equal(guide.hidden,true);
cssUp(5,350);assert.equal(state().tracks.length,0);integrity();
eraseButton.click();cssDown(0,350);advance(40);assert.notEqual(JSON.stringify(state().camera),heldCamera);listeners.pointercancel(cssEvent(0,350));
// Delete one of 10 mixed routes, preserve other nine byte-for-byte, then keep running and extend.
eraseSetup();for(let i=0;i<10;i++){modeButtons[i%2].click();choices[i%5].click();stroke([[2200,2200+i*60],[2800,2200+i*60]]);}
const doomed=state().tracks[4].id;
const survivors=JSON.stringify({tracks:state().tracks.filter(t=>t.id!==doomed),trains:state().trains.filter(t=>t.trackId!==doomed)});
assert.equal(removePath(doomed),true);assert.equal(JSON.stringify({tracks:state().tracks,trains:state().trains}),survivors);integrity();
const progress=state().trains.map(t=>t.distance);tick(20);state().trains.forEach((t,i)=>assert.notEqual(t.distance,progress[i]));
modeButtons[0].click();const survivor=state().tracks[0],vehicle=state().trains[0];stroke([[2800,2200],[2900,2200]]);assert.equal(state().tracks[0],survivor);assert.equal(state().trains[0],vehicle);
const lastId=Math.max(...state().tracks.map(t=>t.id));stroke([[2300,2850],[2700,2850]]);assert.ok(state().tracks.at(-1).id>lastId);
// Offscreen vehicle is deleted with a visible distant segment; post-rotation coordinate mapping.
eraseSetup();const far=seed();setCamera({x:2800,y:2500,zoom:3});erasing();tapWorld({x:2780,y:2500});assert.equal(state().trains.length,0);
eraseSetup();seed();erasing();rect={left:31,top:7,width:700,height:800};windowEvents.resize();tapWorld({x:2600,y:2500});assert.equal(state().tracks.length,0);
eraseSetup();seed();seed(1,2600);erasing();clear();assert.equal(state().activeTool,'erase');assert.equal(guide.hidden,true);integrity();
eraseButton.click();seed();assert.equal(state().trains.length,1);integrity();
console.log('PASS D-01..31/33..40 logic: per-ID deletion, route/body priority, 0.5/1/3x hit radius, all vehicle types/orientations, closed/extended paths, gesture/cancel/slop/resize safety, long edge hold, survivors and cache integrity. D-32 and visual/touch behavior require browser/device QA.');
