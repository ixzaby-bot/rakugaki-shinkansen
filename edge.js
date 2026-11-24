// Shared CSS-pixel settings for edge activation and its fixed visual guide.
(() => {
  'use strict';
  const SIZE = 48, MAX_SPEED = 240, DELAY = .15, MAX_DT = .1;
  function velocity(p, width, height) {
    if (!p || p.x < 0 || p.y < 0 || p.x > width || p.y > height) return { x: 0, y: 0 };
    const strength = distance => Math.max(0, Math.min(1, (SIZE - distance) / SIZE)) ** 2;
    return { x: MAX_SPEED * (strength(width - p.x) - strength(p.x)),
      y: MAX_SPEED * (strength(height - p.y) - strength(p.y)) };
  }
  window.EdgeScroll = Object.freeze({ SIZE, MAX_SPEED, DELAY, MAX_DT, velocity });
})();
