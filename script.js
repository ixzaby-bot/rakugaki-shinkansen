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
    const s = Math.max(0, Math.min(track.length, value));
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

  function drawTrain(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + (direction === -1 ? Math.PI : 0));
    ctx.shadowColor = '#164b4030'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(-23, -11); ctx.quadraticCurveTo(-27, -11, -27, -6);
    ctx.lineTo(-27, 6); ctx.quadraticCurveTo(-27, 11, -23, 11);
    ctx.lineTo(7, 11); ctx.bezierCurveTo(18, 11, 34, 3, 34, 0);
    ctx.bezierCurveTo(34, -3, 18, -11, 7, -11); ctx.closePath();
    ctx.fillStyle = '#079b81'; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#08745f'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-25, 7); ctx.lineTo(9, 7); ctx.quadraticCurveTo(19, 6, 29, 1);
    ctx.strokeStyle = '#f28ca8'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#e5f6ef'; ctx.fillRect(-23, -7, 23, 4);
    ctx.beginPath(); ctx.moveTo(5, -7); ctx.quadraticCurveTo(15, -5, 17, -1);
    ctx.lineTo(8, 3); ctx.lineTo(3, 1); ctx.closePath(); ctx.fillStyle = '#184d55'; ctx.fill();
    ctx.restore();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (width && height && (width !== rect.width || height !== rect.height)) {
      const scale = Math.min(rect.width / width, rect.height / height);
      const dx = (rect.width - width * scale) / 2, dy = (rect.height - height * scale) / 2;
      const transform = p => ({ x: p.x * scale + dx, y: p.y * scale + dy });
      const selected = tracks.indexOf(active);
      tracks.forEach((track, i) => {
        const points = track.closed ? track.points.slice(0, -1) : track.points;
        tracks[i] = measure(points.map(transform), track.closed);
      });
      active = tracks[selected] || null;
      distance *= scale;
      if (draft) draft = draft.map(transform);
    }
    width = rect.width; height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const surface of [canvas, railLayer]) { surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    railCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    railsDirty = true;
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(width, event.clientX - rect.left)), y: Math.max(0, Math.min(height, event.clientY - rect.top)) };
  }
  function append(event) {
    const p = point(event);
    if (separation(draft[draft.length - 1], p) >= 2) draft.push(p);
  }
  function finish(event, cancelled = false) {
    if (event.pointerId !== pointerId) return;
    if (!cancelled) append(event);
    if (!cancelled && draft.length > 1) {
      let track = measure(draft);
      if (track.length >= MIN_LENGTH) {
        const closed = track.length >= 100 && separation(draft[0], draft[draft.length - 1]) <= 24;
        track = measure(draft, closed);
        tracks.push(track); active = track; distance = 0; direction = 1; railsDirty = true;
        status.textContent = closed ? 'つながった！ ぐるぐる はしるよ' : 'さいごの せんろを いったり きたり';
      } else status.textContent = 'もうすこし ながく かいてみよう';
    }
    const released = pointerId;
    draft = null; pointerId = null;
    if (canvas.hasPointerCapture(released)) canvas.releasePointerCapture(released);
    hint.classList.toggle('hidden', tracks.length > 0);
  }
  canvas.addEventListener('pointerdown', event => {
    if (pointerId !== null || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId; draft = [point(event)];
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
    tracks.length = 0; active = null; draft = null; pointerId = null; distance = 0;
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
    if (draft && draft.length > 1) drawRails(ctx, measure(draft), true);
    if (active && active.length > 0) {
      if (active.closed) distance = (distance + SPEED * dt) % active.length;
      else {
        // Triangle-wave phase preserves overshoot even on a very short resized track.
        let phase = direction === 1 ? distance : 2 * active.length - distance;
        phase = (phase + SPEED * dt) % (2 * active.length);
        direction = phase < active.length ? 1 : -1;
        distance = direction === 1 ? phase : 2 * active.length - phase;
      }
      drawTrain(sample(active, distance));
    }
    requestAnimationFrame(frame);
  }
  resize();
  requestAnimationFrame(frame);
})();
