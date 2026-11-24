(() => {
  'use strict';
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const railLayer = document.createElement('canvas');
  const railCtx = railLayer.getContext('2d');
  const hint = document.getElementById('hint');
  const status = document.getElementById('status');
  const trainArt = window.TrainArt;
  let mode = 'rail', selectedType = 'hayabusa';
  const selections = { rail: 'hayabusa', road: 'police' };
  const catalogs = { rail: ['hayabusa', 'komachi', 'kagayaki', 'nozomi', 'd51'],
    road: ['police', 'fire', 'ambulance', 'bus', 'minivan'] };
  const choices = [...document.querySelectorAll('[data-train-type]')];
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const routeName = () => mode === 'road' ? 'どうろ' : 'せんろ';
  function refreshChoices() {
    choices.forEach((button, i) => {
      const type = catalogs[mode][i];
      button.dataset.trainType = type;
      button.querySelector('span').textContent = trainArt.types[type].label || trainArt.types[type].name;
      button.setAttribute('aria-label', type === 'd51' ? 'D51 蒸気機関車' : trainArt.types[type].name);
      button.setAttribute('aria-pressed', String(type === selectedType));
      const icon = button.querySelector('canvas').getContext('2d');
      icon.setTransform(1, 0, 0, 1, 0, 0); icon.clearRect(0, 0, 140, 80);
      icon.setTransform(2, 0, 0, 2, 64, 46);
      trainArt.drawCar(icon, type, type === 'd51' ? 'engine' : 'cab');
    });
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    document.getElementById('hint-text').textContent = 'ゆびで ' + routeName() + 'を かいてみよう！';
  }
  choices.forEach(button => button.addEventListener('click', () => {
    selectedType = button.dataset.trainType;
    selections[mode] = selectedType;
    refreshChoices();
    status.textContent = trainArt.types[selectedType].name + 'で かこう！';
  }));
  modeButtons.forEach(button => button.addEventListener('click', () => {
    if (button.dataset.mode === mode) return;
    cancelInput();
    mode = button.dataset.mode; selectedType = selections[mode];
    refreshChoices(); status.textContent = routeName() + 'の はしから つなげるよ';
  }));
  // Shared route/vehicle arrays: kind filters topology, IDs remain globally unique.
  const tracks = [];
  const trains = [];
  const tracksById = new Map();
  let nextTrackId = 1, nextTrainId = 1;
  const SPEED = 70; // World units per second, independent of zoom
  const ROAD_SPEED = 60;
  const ROAD_CONNECT_RADIUS = 28; // CSS px; independent road tuning
  const MIN_LENGTH = 24;
  const CONNECT_RADIUS = 28; // CSS px; endpoint snapping tolerance
  const MAX_CONNECT_WORLD = 56;
  const cameraMath = window.WorldCamera;
  const camera = cameraMath.initial();
  const pointers = new Map();
  let inputState = 'idle', gesture = null;
  const effects = [];
  let width = 0, height = 0, dpr = 1;
  let draft = null, pointerId = null;
  let draftTrack = null;
  let lastTime = null, railsDirty = true;

  const separation = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  function measure(points, closed = false) {
    const path = points.slice();
    if (closed) path.push({ ...points[0] });
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + separation(path[i - 1], path[i]));
    return { points: path, cumulative, length: cumulative[cumulative.length - 1], closed };
  }

  function sample(track, value) {
    const s = track.closed ? ((value % track.length) + track.length) % track.length : Math.max(0, Math.min(track.length, value));
    let lo = 1, hi = track.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (track.cumulative[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    const a = track.points[lo - 1], b = track.points[lo];
    const segment = track.cumulative[lo] - track.cumulative[lo - 1];
    const t = segment ? (s - track.cumulative[lo - 1]) / segment : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  function smooth(points, closed = false) {
    const raw = measure(points, closed);
    if (!raw.length) return raw;
    const steps = Math.max(closed ? 3 : 1, Math.ceil(raw.length / 6));
    let path = Array.from({ length: steps + (closed ? 0 : 1) }, (_, i) => sample(raw, raw.length * i / steps));
    // Uniform spacing makes filtering independent of pointer event frequency.
    // Two local corner-cutting passes preserve endpoints and only round nearby bends.
    for (let pass = 0; pass < 2; pass++) {
      const next = closed ? [] : [path[0]];
      for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        next.push({ x: .75 * a.x + .25 * b.x, y: .75 * a.y + .25 * b.y });
        next.push({ x: .25 * a.x + .75 * b.x, y: .25 * a.y + .75 * b.y });
      }
      if (!closed) next.push(path[path.length - 1]);
      path = next;
    }
    return measure(path, closed);
  }

  const screenToWorld = p => cameraMath.screenToWorld(p, camera, width, height);
  const worldToScreen = p => cameraMath.worldToScreen(p, camera, width, height);
  function setCamera(next) {
    Object.assign(camera, cameraMath.clamp(next, width, height));
    railsDirty = true;
    document.getElementById('zoom').textContent = Math.round(camera.zoom * 100) + '%';
  }
  // Keep one immutable coordinate system; source remains the canonical measured path.
  function worldPath(source) { return { ...source, source, scale: 1 }; }
  function worldTransform(context) {
    const z = camera.zoom;
    context.setTransform(dpr * z, 0, 0, dpr * z,
      dpr * (width / 2 - camera.x * z), dpr * (height / 2 - camera.y * z));
  }

  function formation(track, train = trains.find(item => item.trackId === track.id)) {
    const originalLength = track.source.length;
    const count = train?.carCount || Math.max(1, Math.min(4, Math.floor(originalLength / 70)));
    const scale = (train?.baseSize || Math.min(1, originalLength / 100)) * track.scale;
    const spacing = 66 * scale, margin = 34 * scale;
    const travel = track.closed ? track.length : Math.max(0, track.length - 2 * margin - (count - 1) * spacing);
    return { count, scale, spacing, margin, travel };
  }

  function endpointNear(p, kind = mode) {
    const radius = Math.min(MAX_CONNECT_WORLD, (kind === 'road' ? ROAD_CONNECT_RADIUS : CONNECT_RADIUS) / camera.zoom);
    const candidates = [];
    tracks.filter(t => !t.closed && t.kind === kind).forEach(track => {
      for (const end of [0, 1]) {
        const point = track.points[end ? track.points.length - 1 : 0];
        const gap = separation(p, point);
        if (gap <= radius + 1e-7) candidates.push({ track, end, point, gap });
      }
    });
    candidates.sort((a, b) => a.gap - b.gap);
    if (candidates.length > 1 && (candidates[1].gap - candidates[0].gap) * camera.zoom < .5) return { ambiguous: true };
    return candidates[0] || null;
  }

  // Only the new stroke is blended; existing track coordinates stay untouched.
  function blendJoin(points, hit, atStart) {
    if (!hit) return points;
    let path = atStart ? points.slice() : points.slice().reverse();
    const route = measure(path), span = Math.min(16, route.length / 3);
    if (span < .01) return points;
    const p = hit.point;
    const inner = sample(hit.track, hit.end ? hit.track.length - 8 : 8);
    const norm = separation(inner, p) || 1;
    const q = sample(route, span), next = sample(route, Math.min(route.length, span + 4));
    const norm2 = separation(q, next) || 1;
    const handle = Math.min(span / 3, separation(p, q) / 2);
    const a = { x: p.x + (p.x - inner.x) / norm * handle, y: p.y + (p.y - inner.y) / norm * handle };
    const b = { x: q.x - (next.x - q.x) / norm2 * handle, y: q.y - (next.y - q.y) / norm2 * handle };
    const curve = [p];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      curve.push({ x: u ** 3 * p.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t ** 3 * q.x,
        y: u ** 3 * p.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t ** 3 * q.y });
    }
    path = curve.concat(path.filter((_, i) => route.cumulative[i] > span));
    return atStart ? path : path.reverse();
  }

  function commitStroke() {
    const raw = draft.map(p => ({ ...p }));
    const first = endpointNear(raw[0]), last = endpointNear(raw[raw.length - 1]);
    const closed = !!(first?.track && last?.track && first.track === last.track && first.end !== last.end);
    const bounds = raw.reduce((box, p) => ({ minX: Math.min(box.minX, p.x), maxX: Math.max(box.maxX, p.x),
      minY: Math.min(box.minY, p.y), maxY: Math.max(box.maxY, p.y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const extent = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const invalid = first?.ambiguous || last?.ambiguous ||
      (first && last && (first.track !== last.track || first.end === last.end)) ||
      (closed && (measure(raw).length < 40 || extent < CONNECT_RADIUS));
    if (invalid || (!first && !last)) {
      addIndependentStroke();
      return;
    }
    if (first) raw[0] = first.point;
    if (last) raw[raw.length - 1] = last.point;
    let extension = smooth(raw).points;
    extension = blendJoin(extension, first, true);
    extension = blendJoin(extension, last, false);
    const old = (first || last).track;
    const train = trains.find(item => item.trackId === old.id);
    const oldFormation = formation(old, train);
    let reversed = false, points = [];
    if (first) {
      points = first.end ? first.track.points.slice() : first.track.points.slice().reverse();
      reversed = !first.end;
    }
    points = points.length ? points.concat(extension.slice(1)) : extension;
    if (last && !closed) {
      const tail = last.end ? last.track.points.slice().reverse() : last.track.points.slice();
      points = points.concat(tail.slice(1));
      reversed = !!last.end;
    }
    if (closed) points.pop(); // measure() adds the shared closing endpoint once.
    if (reversed) points.reverse();
    const source = measure(points, closed);
    if (!Number.isFinite(source.length) || source.length <= old.length || (closed && source.length < 100)) {
      addIndependentStroke(); return;
    }
    const track = worldPath(source);
    const index = points.indexOf(old.points[0]);
    if (index < 0 || !train) { addIndependentStroke(); return; }
    const firstCarDistance = source.cumulative[index] + oldFormation.margin + train.distance;
    // Preserve physical size, train ID and world position when adding a prefix.
    train.baseSize = oldFormation.scale;
    train.distance = firstCarDistance - (closed ? 0 : formation(track, train).margin);
    if (closed) train.distance = ((train.distance % track.length) + track.length) % track.length;
    else train.distance = Math.max(0, Math.min(formation(track, train).travel, train.distance));
    Object.assign(old, track);
    for (const hit of [first, last].filter(Boolean)) effects.push({ ...hit.point, age: 0 });
    status.textContent = closed ? 'つながった！ ぐるぐる はしるよ' : 'つながった！ もっと はしれるよ';
  }

  function addIndependentStroke() {
    const closed = measure(draft).length >= 100 && separation(draft[0], draft[draft.length - 1]) <= 24;
    const track = worldPath(smooth(draft, closed));
    if (!Number.isFinite(track.length) || track.length <= 0) return;
    track.id = nextTrackId++; track.kind = mode;
    tracks.push(track); tracksById.set(track.id, track);
    trains.push({ id: nextTrainId++, trackId: track.id, type: selectedType, distance: 0, direction: 1, speed: mode === 'road' ? ROAD_SPEED : SPEED,
      carCount: mode === 'road' ? 1 : Math.max(1, Math.min(4, Math.floor(track.source.length / 70))),
      baseSize: Math.min(1, track.source.length / 100) });
    status.textContent = closed ? 'ぐるぐる！ みんなで はしるよ' : routeName() + 'が ふえた！ みんなで はしるよ';
  }

  function drawEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i]; effect.age += dt;
      if (effect.age >= .6) { effects.splice(i, 1); continue; }
      const radius = 8 + effect.age * 28;
      ctx.save(); ctx.translate(effect.x, effect.y);
      ctx.globalAlpha = 1 - effect.age / .6; ctx.strokeStyle = '#eeb83e'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let j = 0; j < 8; j++) {
        const angle = j * Math.PI / 4;
        ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        ctx.lineTo(Math.cos(angle) * (radius + 6), Math.sin(angle) * (radius + 6));
      }
      ctx.stroke(); ctx.restore();
    }
  }

  function carPoses(track, offset, train) {
    const f = formation(track, train);
    return Array.from({ length: f.count }, (_, i) => {
      const s = (track.closed ? 0 : f.margin) + offset + i * f.spacing;
      const p = sample(track, s);
      const a = sample(track, s - 6 * f.scale), b = sample(track, s + 6 * f.scale);
      return { ...p, angle: Math.atan2(b.y - a.y, b.x - a.x), s };
    });
  }

  function drawRoad(context, track) {
    const scale = formation(track).scale;
    context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath();
    track.points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
    context.strokeStyle = '#abb2b5'; context.lineWidth = 36 * scale; context.stroke();
    context.strokeStyle = '#747e84'; context.lineWidth = 32 * scale; context.stroke();
    context.setLineDash([10 * scale, 12 * scale]); context.lineWidth = 2 * scale; context.strokeStyle = '#fff1ba'; context.stroke();
    context.restore();
  }

  function drawRails(context, track, selected) {
    if (track.length <= 0) return;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = selected ? '#a3aa9f' : '#ced3cd';
    context.lineWidth = 4;
    context.beginPath();
    for (let s = 0; s < track.length; s += 14) {
      const p = sample(track, s), nx = -Math.sin(p.angle) * 11, ny = Math.cos(p.angle) * 11;
      context.moveTo(p.x - nx, p.y - ny);
      context.lineTo(p.x + nx, p.y + ny);
    }
    context.stroke();
    context.strokeStyle = selected ? '#687a75' : '#adb9b4';
    context.lineWidth = 2.5;
    // Bounded vertex normals avoid spikes at sharp turns; sleepers remain visible.
    for (const side of [-1, 1]) {
      context.beginPath();
      track.points.forEach((p, i) => {
        const last = track.points.length - 1;
        const before = track.points[i - 1] || (track.closed ? track.points[last - 1] : p);
        const after = track.points[i + 1] || (track.closed ? track.points[1] : p);
        const angle = Math.atan2(after.y - before.y, after.x - before.x);
        const x = p.x - Math.sin(angle) * 5.25 * side;
        const y = p.y + Math.cos(angle) * 5.25 * side;
        if (i) context.lineTo(x, y); else context.moveTo(x, y);
      });
      context.stroke();
    }
  }

  function drawTrain(p, index, count, scale, train) {
    const steam = train.type === 'd51';
    const road = trainArt.types[train.type].kind === 'road';
    // Keep the locomotive on the same physical car: reverse running pushes coaches.
    const role = steam ? (index === count - 1 ? 'engine' : 'coach') :
      (index === 0 || index === count - 1 ? 'cab' : 'coach');
    const reverse = steam || road ? train.direction < 0 : index === 0 && count > 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + (reverse ? Math.PI : 0));
    ctx.scale(scale, scale);
    trainArt.drawCar(ctx, train.type, role, train.distance / (5.5 * scale));
    ctx.restore();
  }
  function drawFormation(track, train) {
    const f = formation(track, train), poses = carPoses(track, train.distance, train);
    ctx.strokeStyle = '#546f66'; ctx.lineWidth = 3 * f.scale;
    // Follow the path behind the bodies so couplings also wrap across the seam.
    ctx.beginPath();
    for (let i = 1; i < poses.length; i++) {
      const start = poses[i - 1].s, end = poses[i].s;
      const steps = Math.max(1, Math.ceil((end - start) / (4 * f.scale)));
      for (let j = 0; j <= steps; j++) {
        const p = sample(track, start + (end - start) * j / steps);
        if (j) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      }
    }
    ctx.stroke();
    poses.forEach((p, i) => drawTrain(p, i, f.count, f.scale, train));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const surface of [canvas, railLayer]) {
      surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr);
    }
    // Do not project geometry or change vehicle progress on viewport changes.
    setCamera(camera);
    if (inputState === 'cameraGesture') gesture = null; // Wait for all fingers after rotation.
  }
  function screenPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function point(event) {
    const p = screenToWorld(screenPoint(event));
    return { x: Math.max(0, Math.min(cameraMath.WORLD_WIDTH, p.x)),
      y: Math.max(0, Math.min(cameraMath.WORLD_HEIGHT, p.y)) };
  }
  function append(event) {
    const p = point(event);
    if (separation(draft[draft.length - 1], p) * camera.zoom >= 2) {
      draft.push(p); draftTrack = null;
    }
  }
  function cancelInput() {
    draft = null; draftTrack = null; pointerId = null; gesture = null;
    inputState = pointers.size ? 'cameraGesture' : 'idle';
    hint.classList.toggle('hidden', tracks.length > 0);
  }
  function release(id) {
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function resetInput() {
    const ids = [...pointers.keys()]; pointers.clear(); cancelInput(); ids.forEach(release);
  }
  function beginGesture() {
    draft = null; draftTrack = null; pointerId = null;
    inputState = 'cameraGesture';
    const pair = [...pointers.entries()].slice(0, 2);
    const [a, b] = pair.map(entry => entry[1]);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture = { ids: pair.map(entry => entry[0]), anchor: screenToWorld(midpoint),
      distance: Math.max(1, separation(a, b)), zoom: camera.zoom };
    hint.classList.toggle('hidden', tracks.length > 0);
  }
  function moveGesture() {
    if (!gesture || !gesture.ids.every(id => pointers.has(id))) return;
    const [a, b] = gesture.ids.map(id => pointers.get(id));
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const zoom = gesture.zoom * Math.max(1, separation(a, b)) / gesture.distance;
    setCamera(cameraMath.anchored(gesture.anchor, midpoint, zoom, width, height));
  }
  function finish(event, cancelled = false) {
    if (!pointers.has(event.pointerId)) return;
    if (inputState === 'drawing' && event.pointerId === pointerId && draft) {
      if (!cancelled) append(event);
      if (!cancelled && draft.length > 1) {
        if (measure(draft).length >= MIN_LENGTH) { commitStroke(); railsDirty = true; }
        else status.textContent = 'もうすこし ながく かいてみよう';
      }
      draft = null; draftTrack = null; pointerId = null;
    }
    pointers.delete(event.pointerId);
    if (!pointers.size) { inputState = 'idle'; gesture = null; }
    else {
      inputState = 'cameraGesture';
      if (gesture && gesture.ids.includes(event.pointerId)) {
        gesture = null;
        if (!cancelled && pointers.size >= 2) beginGesture();
      }
      if (cancelled) gesture = null;
    }
    release(event.pointerId);
    hint.classList.toggle('hidden', tracks.length > 0);
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.has(event.pointerId)) return;
    // Secondary touch contacts are essential for camera gestures; ignore secondary pens/mice.
    if (event.isPrimary === false && event.pointerType !== 'touch') return;
    event.preventDefault();
    pointers.set(event.pointerId, screenPoint(event)); canvas.setPointerCapture(event.pointerId);
    if (pointers.size >= 2) {
      if (pointers.size === 2) beginGesture();
      return;
    }
    if (inputState !== 'idle') return;
    inputState = 'drawing'; pointerId = event.pointerId;
    draft = [point(event)]; draftTrack = null; hint.classList.add('hidden');
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault(); pointers.set(event.pointerId, screenPoint(event));
    if (inputState === 'cameraGesture') { moveGesture(); return; }
    if (event.pointerId !== pointerId || !draft) return;
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
    (events.length ? events : [event]).forEach(append);
  });
  canvas.addEventListener('pointerup', event => finish(event));
  canvas.addEventListener('pointercancel', event => finish(event, true));
  canvas.addEventListener('lostpointercapture', event => finish(event, true));
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.getElementById('home').addEventListener('click', () => {
    cancelInput(); setCamera(cameraMath.initial());
    status.textContent = 'まんなかに もどったよ';
  });
  document.getElementById('clear').addEventListener('click', () => {
    resetInput();
    tracks.length = 0; trains.length = 0; tracksById.clear();
    nextTrackId = 1; nextTrainId = 1; lastTime = null; effects.length = 0;
    railsDirty = true; hint.classList.remove('hidden');
    status.textContent = routeName() + 'の はしから つなげるよ';
  });
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  function restoreView() { resetInput(); lastTime = null; resize(); railsDirty = true; }
  document.addEventListener('visibilitychange', restoreView);
  window.addEventListener('pageshow', restoreView);
  window.addEventListener('blur', resetInput);
  for (const surface of [canvas, railLayer]) {
    surface.addEventListener('contextlost', event => { event.preventDefault(); railsDirty = true; });
    surface.addEventListener('contextrestored', restoreView);
  }

  function frame(time) {
    if (dpr !== Math.min(window.devicePixelRatio || 1, 3)) resize();
    const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (railsDirty) {
      railCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      railCtx.clearRect(0, 0, width, height);
      worldTransform(railCtx);
      // Roads below rails at crossings; no junction or stopping logic yet.
      tracks.filter(t => t.kind === 'road').forEach(track => drawRoad(railCtx, track));
      tracks.filter(t => t.kind === 'rail').forEach(track => drawRails(railCtx, track, true));
      railsDirty = false;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // White paper with a quiet boundary; no 5000px bitmap is allocated.
    ctx.fillStyle = '#edf1ee'; ctx.fillRect(0, 0, width, height);
    worldTransform(ctx);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cameraMath.WORLD_WIDTH, cameraMath.WORLD_HEIGHT);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(railLayer, 0, 0, width, height);
    worldTransform(ctx);
    if (draft && draft.length > 1) {
      if (!draftTrack) draftTrack = worldPath(smooth(draft));
      if (mode === 'road') drawRoad(ctx, draftTrack);
      else drawRails(ctx, draftTrack, true);
    }
    for (const train of trains) {
      const track = tracksById.get(train.trackId);
      const { travel } = formation(track, train);
      if (track.closed) train.distance = ((train.distance + train.direction * train.speed * dt) % travel + travel) % travel;
      else if (!travel) train.distance = 0;
      else {
        // Triangle-wave phase preserves overshoot even on a very short resized track.
        let phase = train.direction === 1 ? train.distance : 2 * travel - train.distance;
        phase = (phase + train.speed * dt) % (2 * travel);
        train.direction = phase < travel ? 1 : -1;
        train.distance = train.direction === 1 ? phase : 2 * travel - phase;
      }
      drawFormation(track, train);
    }
    drawEffects(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestAnimationFrame(frame);
  }
  refreshChoices();
  resize();
  requestAnimationFrame(frame);
})();
