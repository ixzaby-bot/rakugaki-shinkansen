// View-only camera math. Route geometry and vehicle progress never enter this module.
(() => {
  'use strict';
  const WORLD_WIDTH = 5000, WORLD_HEIGHT = 5000;
  const MIN_ZOOM = .5, MAX_ZOOM = 3, INITIAL_ZOOM = 1;
  const initial = () => ({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, zoom: INITIAL_ZOOM });
  const screenToWorld = (p, camera, width, height) => ({
    x: (p.x - width / 2) / camera.zoom + camera.x,
    y: (p.y - height / 2) / camera.zoom + camera.y
  });
  const worldToScreen = (p, camera, width, height) => ({
    x: (p.x - camera.x) * camera.zoom + width / 2,
    y: (p.y - camera.y) * camera.zoom + height / 2
  });
  function clamp(camera, width, height) {
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom));
    const axis = (center, viewport, world) => viewport / zoom >= world ? world / 2 :
      Math.max(viewport / (2 * zoom), Math.min(world - viewport / (2 * zoom), center));
    return { x: axis(camera.x, width, WORLD_WIDTH), y: axis(camera.y, height, WORLD_HEIGHT), zoom };
  }
  function anchored(anchor, screen, zoom, width, height) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    return clamp({ x: anchor.x - (screen.x - width / 2) / zoom,
      y: anchor.y - (screen.y - height / 2) / zoom, zoom }, width, height);
  }
  window.WorldCamera = Object.freeze({ WORLD_WIDTH, WORLD_HEIGHT, MIN_ZOOM, MAX_ZOOM,
    INITIAL_ZOOM, initial, screenToWorld, worldToScreen, clamp, anchored });
})();
