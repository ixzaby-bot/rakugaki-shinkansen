(() => {
  'use strict';
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const railLayer = document.createElement('canvas');
  const railCtx = railLayer.getContext('2d');
  const hint = document.getElementById('hint');
  const status = document.getElementById('status');
  const tracks = [];
  const SPEED = 70; // CSS pixels per second
  const MIN_LENGTH = 24;
  let width = 0, height = 0, dpr = 1;
  let draft = null, pointerId = null, active = null;
  let draftWidth = 0, draftHeight = 0, draftTrack = null;
  let distance = 0, direction = 1, lastTime = null, railsDirty = true;

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

  function formation(track) {
    const originalLength = track.source.length;
    const count = Math.max(1, Math.min(4, Math.floor(originalLength / 70)));
    const scale = Math.min(1, originalLength / 100) * track.scale;
    const spacing = 66 * scale, margin = 34 * scale;
    const travel = track.closed ? track.length : Math.max(0, track.length - 2 * margin - (count - 1) * spacing);
    return { count, scale, spacing, margin, travel };
  }

  function carPoses(track, offset) {
    const f = formation(track);
    return Array.from({ length: f.count }, (_, i) => {
      const s = (track.closed ? 0 : f.margin) + offset + i * f.spacing;
      const p = sample(track, s);
      const a = sample(track, s - 6 * f.scale), b = sample(track, s + 6 * f.scale);
      return { ...p, angle: Math.atan2(b.y - a.y, b.x - a.x), s };
    });
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

  function drawTrain(p, index, count, scale) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + (index === 0 && count > 1 ? Math.PI : 0));
    ctx.scale(scale, scale);
    const cab = index === 0 || index === count - 1;
    ctx.shadowColor = '#164b4030'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(-23, -11); ctx.quadraticCurveTo(-27, -11, -27, -6);
    ctx.lineTo(-27, 6); ctx.quadraticCurveTo(-27, 11, -23, 11);
    if (cab) {
      ctx.lineTo(7, 11); ctx.bezierCurveTo(18, 11, 34, 3, 34, 0);
      ctx.bezierCurveTo(34, -3, 18, -11, 7, -11);
    } else {
      ctx.lineTo(23, 11); ctx.quadraticCurveTo(27, 11, 27, 6);
      ctx.lineTo(27, -6); ctx.quadraticCurveTo(27, -11, 23, -11);
    }
    ctx.closePath();
    ctx.fillStyle = '#079b81'; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#08745f'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-25, 7); ctx.lineTo(9, 7);
    if (cab) ctx.quadraticCurveTo(19, 6, 29, 1); else ctx.lineTo(25, 7);
    ctx.strokeStyle = '#f28ca8'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#e5f6ef'; ctx.fillRect(-23, -7, 23, 4);
    ctx.fillStyle = '#184d55';
    if (cab) {
      ctx.beginPath(); ctx.moveTo(5, -7); ctx.quadraticCurveTo(15, -5, 17, -1);
      ctx.lineTo(8, 3); ctx.lineTo(3, 1); ctx.closePath(); ctx.fill();
    } else {
      for (let x = -19; x <= 17; x += 12) ctx.fillRect(x, -2, 7, 5);
    }
    ctx.restore();
  }

  function drawFormation(track) {
    const f = formation(track), poses = carPoses(track, distance);
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
    poses.forEach((p, i) => drawTrain(p, i, f.count, f.scale));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const selected = tracks.indexOf(active);
    const progress = active && formation(active).travel ? distance / formation(active).travel : 0;
    width = rect.width; height = rect.height;
    tracks.forEach((track, i) => { tracks[i] = project(track.source, track.baseWidth, track.baseHeight); });
    active = tracks[selected] || null;
    distance = active ? progress * formation(active).travel : 0;
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
      let track = measure(draft);
      if (track.length >= MIN_LENGTH) {
        const closed = track.length >= 100 && separation(draft[0], draft[draft.length - 1]) <= 24;
        track = project(smooth(draft, closed), draftWidth, draftHeight);
        tracks.push(track); active = track; distance = 0; direction = 1; railsDirty = true;
        status.textContent = closed ? 'つながった！ ぐるぐる はしるよ' : 'さいごの せんろを いったり きたり';
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
    tracks.length = 0; active = null; draft = null; draftTrack = null; pointerId = null; distance = 0;
    if (released !== null && canvas.hasPointerCapture(released)) canvas.releasePointerCapture(released);
    railsDirty = true; hint.classList.remove('hidden');
    status.textContent = 'さいごに かいた せんろを はしるよ';
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { lastTime = null; });

  function frame(time) {
    const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (railsDirty) {
      railCtx.clearRect(0, 0, width, height);
      tracks.forEach(track => drawRails(railCtx, track, track === active));
      railsDirty = false;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(railLayer, 0, 0, width, height);
    if (draft && draft.length > 1) {
      if (!draftTrack) draftTrack = project(smooth(draft), draftWidth, draftHeight);
      drawRails(ctx, draftTrack, true);
    }
    if (active && active.length > 0) {
      const { travel } = formation(active);
      if (active.closed) distance = (distance + SPEED * dt) % travel;
      else if (!travel) distance = 0;
      else {
        // Triangle-wave phase preserves overshoot even on a very short resized track.
        let phase = direction === 1 ? distance : 2 * travel - distance;
        phase = (phase + SPEED * dt) % (2 * travel);
        direction = phase < travel ? 1 : -1;
        distance = direction === 1 ? phase : 2 * travel - phase;
      }
      drawFormation(active);
    }
    requestAnimationFrame(frame);
  }
  resize();
  requestAnimationFrame(frame);
})();
