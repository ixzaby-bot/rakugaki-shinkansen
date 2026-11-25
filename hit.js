// Pure geometry: screen tolerances are converted by the caller, never by DPR.
(() => {
  'use strict';
  const PADDING = 12, TAP_SLOP = 12, TIE = .5; // CSS px
  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy;
    const t = square ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function pathDistance(p, track) {
    let gap = Infinity;
    for (let i = 1; i < track.points.length; i++) gap = Math.min(gap, distanceToSegment(p, track.points[i - 1], track.points[i]));
    if (track.closed && track.points.length) gap = Math.min(gap, distanceToSegment(p, track.points.at(-1), track.points[0]));
    return gap;
  }
  window.PathHit = Object.freeze({ PADDING, TAP_SLOP, TIE, distanceToSegment, pathDistance });
})();
