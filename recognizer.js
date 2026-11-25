// Small, direction-preserving point-cloud matcher. No model or external data.
(() => {
  'use strict';
  const line = (...pairs) => pairs.map(([x, y]) => ({ x, y }));
  const oval = (x, y, rx, ry, petals = 0) => Array.from({ length: 65 }, (_, i) => {
    const a = i / 64 * Math.PI * 2, r = 1 + petals * Math.cos(a * 6);
    return { x: x + Math.cos(a) * rx * r, y: y + Math.sin(a) * ry * r };
  });
  function bounds(strokes) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const stroke of strokes) for (const p of stroke) {
      left = Math.min(left, p.x); right = Math.max(right, p.x);
      top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
    }
    return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top };
  }
  function cloud(strokes) {
    const segments = []; let length = 0;
    for (const stroke of strokes) for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1], b = stroke[i], size = Math.hypot(b.x - a.x, b.y - a.y);
      if (size) { segments.push({ a, b, start: length, size }); length += size; }
    }
    if (!length) return null;
    const box = bounds(strokes), scale = Math.max(box.width, box.height);
    const points = []; let j = 0;
    for (let i = 0; i < 64; i++) {
      const distance = length * (i + .5) / 64;
      while (j < segments.length - 1 && segments[j].start + segments[j].size < distance) j++;
      const s = segments[j], t = (distance - s.start) / s.size;
      points.push({ x: (s.a.x + (s.b.x - s.a.x) * t - box.x) / scale,
        y: (s.a.y + (s.b.y - s.a.y) * t - box.y) / scale });
    }
    return { points, box, length, aspect: box.width / (box.width + box.height) };
  }
  const templates = [];
  function add(type, strokes) { templates.push({ type, ...cloud(strokes) }); }
  for (let v = 0; v < 3; v++) {
    const w = 85 + 15 * v;
    add('mountain', v === 2 ? [line([0,80],[35,5],[65,55],[95,0],[140,80])] :
      [line([0,80],[w/2,0],[w,80], ...(v ? [[0,80]] : []))]);
    add('pond', [oval(50,40,50 + v*15,35 + v*5, v === 2 ? .1 : 0)]);
    add('flower', [oval(50,30,25,25,.18 + v*.09), line([50,55],[50,100]),
      ...(v ? [line([50,80],[70,65],[50,72])] : [])]);
    add('tree', [oval(50,30,35+v*5,28), line([45,58],[45,100],[55,100],[55,58]),
      ...(v === 2 ? [line([50,75],[25,50])] : [])]);
    add('house', [line([0,40],[50,0],[100,40],[0,40]), line([10,40],[10,100],[90,100],[90,40]),
      ...(v ? [line([40,100],[40,65],[60,65],[60,100])] : []),
      ...(v === 2 ? [line([20,50],[30,50],[30,60],[20,60],[20,50])] : [])]);
    add('station', [line([0,25],[20,0],[140+v*20,0],[160+v*20,25],[0,25]),
      line([10,25],[10,80],[150+v*20,80],[150+v*20,25]),
      ...[35,75,115].map(x => line([x,40],[x+18,40],[x+18,60],[x,60],[x,40]))]);
  }
  const nearestMean = (a, b) => a.reduce((sum, p) => sum + Math.min(...b.map(q => Math.hypot(p.x-q.x,p.y-q.y))), 0) / a.length;
  function recognize(strokes, zoom = 1) {
    const input = cloud(strokes);
    if (!input || input.length * zoom < 40 || Math.min(input.box.width, input.box.height) * zoom < 10) return null;
    let best = null;
    for (const template of templates) {
      const score = (nearestMean(input.points, template.points) + nearestMean(template.points, input.points)) / 2 +
        .2 * Math.abs(input.aspect - template.aspect);
      if (!best || score < best.score) best = { type: template.type, score, bounds: input.box };
    }
    return best;
  }
  window.SketchRecognizer = Object.freeze({ recognize });
})();
