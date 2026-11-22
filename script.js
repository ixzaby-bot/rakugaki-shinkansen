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
    if (pointerId !== null) finish({ pointerId }, true);
    mode = button.dataset.mode; selectedType = selections[mode];
    refreshChoices(); status.textContent = routeName() + 'の はしから つなげるよ';
  }));
  // Shared route/vehicle arrays: kind filters topology, IDs remain globally unique.
  const tracks = [];
  const trains = [];
  const tracksById = new Map();
  let nextTrackId = 1, nextTrainId = 1;
  const SPEED = 70; // CSS pixels per second
  const ROAD_SPEED = 60;
  const ROAD_CONNECT_RADIUS = 28; // CSS px; independent road tuning
  const MIN_LENGTH = 24;
  const CONNECT_RADIUS = 28; // CSS px; endpoint snapping tolerance
  const effects = [];
  let width = 0, height = 0, dpr = 1;
  let draft = null, pointerId = null;
  let draftWidth = 0, draftHeight = 0, draftTrack = null;
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

  function view(baseWidth, baseHeight) {
    const scale = Math.min(width / baseWidth, height / baseHeight);
    return { scale, x: (width - baseWidth * scale) / 2, y: (height - baseHeight * scale) / 2 };
  }

  function project(source, baseWidth, baseHeight) {
    const v = view(baseWidth, baseHeight);
    const points = source.closed ? source.points.slice(0, -1) : source.points;
    return { ...measure(points.map(p => ({ x: p.x * v.scale + v.x, y: p.y * v.scale + v.y })), source.closed),
      source, baseWidth, baseHeight, scale: v.scale };
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
    const radius = kind === 'road' ? ROAD_CONNECT_RADIUS : CONNECT_RADIUS;
    const candidates = [];
    tracks.filter(t => !t.closed && t.kind === kind).forEach(track => {
      for (const end of [0, 1]) {
        const point = track.points[end ? track.points.length - 1 : 0];
        const gap = separation(p, point);
        if (gap <= radius) candidates.push({ track, end, point, gap });
      }
    });
    candidates.sort((a, b) => a.gap - b.gap);
    if (candidates.length > 1 && candidates[1].gap - candidates[0].gap < .5) return { ambiguous: true };
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
    const v = view(draftWidth, draftHeight);
    const raw = draft.map(p => ({ x: p.x * v.scale + v.x, y: p.y * v.scale + v.y }));
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
    const track = project(source, width, height);
    const index = points.indexOf(old.points[0]);
    if (index < 0 || !train) { addIndependentStroke(); return; }
    const firstCarDistance = source.cumulative[index] + oldFormation.margin + train.distance;
    // Rebase the size to the new source viewport, keeping the same train and track IDs.
    train.baseSize = oldFormation.scale;
    train.distance = firstCarDistance - (closed ? 0 : formation(track, train).margin);
    if (closed) train.distance = ((train.distance % track.length) + track.length) % track.length;
    else train.distance = Math.max(0, Math.min(formation(track, train).travel, train.distance));
    Object.assign(old, track);
    for (const hit of [first, last].filter(Boolean)) effects.push({ ...hit.point, width, height, age: 0 });
    status.textContent = closed ? 'つながった！ ぐるぐる はしるよ' : 'つながった！ もっと はしれるよ';
  }

  function addIndependentStroke() {
    const closed = measure(draft).length >= 100 && separation(draft[0], draft[draft.length - 1]) <= 24;
    const track = project(smooth(draft, closed), draftWidth, draftHeight);
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
      const v = view(effect.width, effect.height), radius = 8 + effect.age * 28;
      ctx.save(); ctx.translate(effect.x * v.scale + v.x, effect.y * v.scale + v.y);
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
    context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath();
    track.points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
    context.strokeStyle = '#abb2b5'; context.lineWidth = 36; context.stroke();
    context.strokeStyle = '#747e84'; context.lineWidth = 32; context.stroke();
    context.setLineDash([10, 12]); context.lineWidth = 2; context.strokeStyle = '#fff1ba'; context.stroke();
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
    const progress = trains.map(train => {
      const travel = formation(tracksById.get(train.trackId), train).travel;
      return travel ? train.distance / travel : 0;
    });
    width = rect.width; height = rect.height;
    tracks.forEach(track => { Object.assign(track, project(track.source, track.baseWidth, track.baseHeight)); });
    trains.forEach((train, i) => { train.distance = progress[i] * formation(tracksById.get(train.trackId), train).travel; });
    draftTrack = null;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const surface of [canvas, railLayer]) { surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    railCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    railsDirty = true;
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const v = view(draftWidth, draftHeight);
    return { x: (Math.max(0, Math.min(width, event.clientX - rect.left)) - v.x) / v.scale,
      y: (Math.max(0, Math.min(height, event.clientY - rect.top)) - v.y) / v.scale };
  }
  function append(event) {
    const p = point(event);
    if (separation(draft[draft.length - 1], p) * view(draftWidth, draftHeight).scale >= 2) {
      draft.push(p); draftTrack = null;
    }
  }
  function finish(event, cancelled = false) {
    if (event.pointerId !== pointerId) return;
    if (!cancelled) append(event);
    if (!cancelled && draft.length > 1) {
      if (measure(draft).length >= MIN_LENGTH) {
        commitStroke(); railsDirty = true;
      } else status.textContent = 'もうすこし ながく かいてみよう';
    }
    const released = pointerId;
    draft = null; draftTrack = null; pointerId = null;
    if (canvas.hasPointerCapture(released)) canvas.releasePointerCapture(released);
    hint.classList.toggle('hidden', tracks.length > 0);
  }
  canvas.addEventListener('pointerdown', event => {
    if (pointerId !== null || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    draftWidth = width; draftHeight = height;
    pointerId = event.pointerId; draft = [point(event)]; draftTrack = null;
    canvas.setPointerCapture(pointerId); hint.classList.add('hidden');
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
    (events.length ? events : [event]).forEach(append);
  });
  canvas.addEventListener('pointerup', event => finish(event));
  canvas.addEventListener('pointercancel', event => finish(event, true));
  canvas.addEventListener('lostpointercapture', event => finish(event, true));
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.getElementById('clear').addEventListener('click', () => {
    const released = pointerId;
    tracks.length = 0; trains.length = 0; tracksById.clear();
    nextTrackId = 1; nextTrainId = 1;
    draft = null; draftTrack = null; pointerId = null; lastTime = null;
    effects.length = 0;
    if (released !== null && canvas.hasPointerCapture(released)) canvas.releasePointerCapture(released);
    railsDirty = true; hint.classList.remove('hidden');
    status.textContent = routeName() + 'の はしから つなげるよ';
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { lastTime = null; });

  function frame(time) {
    const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (railsDirty) {
      railCtx.clearRect(0, 0, width, height);
      // Roads below rails at crossings; no junction or stopping logic yet.
      tracks.filter(t => t.kind === 'road').forEach(track => drawRoad(railCtx, track));
      tracks.filter(t => t.kind === 'rail').forEach(track => drawRails(railCtx, track, true));
      railsDirty = false;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(railLayer, 0, 0, width, height);
    if (draft && draft.length > 1) {
      if (!draftTrack) draftTrack = project(smooth(draft), draftWidth, draftHeight);
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
    requestAnimationFrame(frame);
  }
  refreshChoices();
  resize();
  requestAnimationFrame(frame);
})();
