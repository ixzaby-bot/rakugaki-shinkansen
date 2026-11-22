// Simplified original Canvas illustrations; no photographs, logos or downloads.
(() => {
  'use strict';
  const types = Object.freeze({
    hayabusa: { name: 'はやぶさ', body: '#099d80', stripe: '#ed83aa', edge: '#086b5d', nose: 'long', half: 11 },
    komachi: { name: 'こまち', body: '#cc304c', stripe: '#fff7ed', edge: '#90253b', nose: 'slender', half: 9.5 },
    kagayaki: { name: 'かがやき', body: '#f4f5f2', stripe: '#b97e48', edge: '#3c6480', nose: 'round', half: 11 },
    nozomi: { name: 'のぞみ', body: '#f9fcff', stripe: '#285cac', edge: '#638198', nose: 'duckbill', half: 11 },
    d51: { name: 'D51' }
  });

  function box(c, x, y, w, h, r = 3) {
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }

  function shinkansen(c, type, cab) {
    const spec = types[type], h = spec.half;
    c.beginPath(); c.moveTo(-23, -h); c.quadraticCurveTo(-27, -h, -27, -h + 4);
    c.lineTo(-27, h - 4); c.quadraticCurveTo(-27, h, -23, h);
    if (!cab) {
      c.lineTo(23, h); c.quadraticCurveTo(27, h, 27, h - 4);
      c.lineTo(27, -h + 4); c.quadraticCurveTo(27, -h, 23, -h);
    } else if (spec.nose === 'round') {
      c.lineTo(13, h); c.bezierCurveTo(34, h, 34, -h, 13, -h);
    } else if (spec.nose === 'slender') {
      c.lineTo(-1, h); c.bezierCurveTo(12, h, 34, 2, 34, 0);
      c.bezierCurveTo(34, -2, 12, -h, -1, -h);
    } else if (spec.nose === 'duckbill') {
      c.lineTo(4, h); c.bezierCurveTo(19, h, 17, 5, 29, 4);
      c.bezierCurveTo(37, 3, 35, -3, 29, -4); c.bezierCurveTo(17, -5, 19, -h, 4, -h);
    } else {
      c.lineTo(7, h); c.bezierCurveTo(18, h, 34, 3, 34, 0);
      c.bezierCurveTo(34, -3, 18, -h, 7, -h);
    }
    c.closePath(); c.fillStyle = spec.body; c.fill();
    c.strokeStyle = spec.edge; c.lineWidth = 1.5; c.stroke();
    c.save(); c.clip();
    if (type === 'kagayaki') { c.fillStyle = '#287eb5'; c.fillRect(-28, -h, 46, 7); }
    if (type === 'komachi') { c.fillStyle = '#fff7ed'; c.fillRect(-28, 3, 64, 8); }
    c.strokeStyle = spec.stripe; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-28, 7); c.lineTo(8, 7); c.lineTo(34, cab ? 0 : 7); c.stroke();
    if (type === 'nozomi' || type === 'kagayaki') {
      c.lineWidth = 1.5; c.beginPath(); c.moveTo(-28, -6); c.lineTo(cab ? 8 : 28, -6); c.stroke();
    }
    c.restore();
    c.fillStyle = '#183f50';
    if (cab) {
      c.beginPath();
      if (type === 'kagayaki') {
        c.moveTo(12, -7); c.quadraticCurveTo(23, -6, 23, 0); c.lineTo(12, 3);
      } else if (type === 'komachi') {
        c.moveTo(-1, -6); c.lineTo(12, -3); c.lineTo(9, 2); c.lineTo(-3, 0);
      } else if (type === 'nozomi') {
        c.moveTo(1, -7); c.lineTo(14, -4); c.lineTo(10, 2); c.lineTo(0, 2);
      } else {
        c.moveTo(5, -7); c.quadraticCurveTo(15, -5, 17, -1); c.lineTo(8, 3); c.lineTo(3, 1);
      }
      c.closePath(); c.fill();
      c.fillStyle = type === 'hayabusa' ? '#d7f3ea' : '#dbeafa';
      c.fillRect(-22, -6, 18, 3);
    } else {
      const windowWidth = type === 'nozomi' ? 5 : 7;
      for (let x = -19; x <= 17; x += type === 'nozomi' ? 9 : 12) {
        box(c, x, -2, windowWidth, 5, type === 'kagayaki' ? 2 : 1); c.fill();
      }
    }
  }

  function steam(c, engine, wheelAngle) {
    // Side-like silhouettes keep the chimney and driving wheels legible from above.
    c.fillStyle = '#202b30';
    c.fillRect(-27, 5, 57, 5);
    for (const x of engine ? [-15, -2, 11] : [-18, 18]) {
      const r = engine ? 5.5 : 4;
      c.beginPath(); c.arc(x, 10, r, 0, Math.PI * 2); c.fillStyle = '#1c252a'; c.fill();
      c.strokeStyle = '#83949b'; c.lineWidth = 1.5; c.stroke();
      c.beginPath(); c.moveTo(x - Math.cos(wheelAngle) * (r - 1), 10 - Math.sin(wheelAngle) * (r - 1));
      c.lineTo(x + Math.cos(wheelAngle) * (r - 1), 10 + Math.sin(wheelAngle) * (r - 1)); c.stroke();
    }
    if (engine) {
      box(c, -11, -9, 38, 15, 5); c.fillStyle = '#28343b'; c.fill();
      c.strokeStyle = '#101b20'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#172127'; c.fillRect(-25, -15, 17, 20); c.fillRect(-28, -18, 23, 4);
      c.fillStyle = '#f4d995'; c.fillRect(-21, -11, 8, 8);
      c.fillStyle = '#172127'; c.fillRect(13, -19, 7, 12); c.fillRect(11, -21, 11, 4);
      c.fillStyle = '#b48b4d'; c.fillRect(0, -9, 2, 14); c.fillRect(22, -7, 2, 12);
      c.beginPath(); c.arc(28, -1, 3, 0, Math.PI * 2); c.fillStyle = '#ffdf89'; c.fill();
      c.strokeStyle = '#c6cdd0'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-15, 10); c.lineTo(11, 10); c.stroke();
    } else {
      box(c, -26, -12, 52, 19, 3); c.fillStyle = '#6d4537'; c.fill();
      c.strokeStyle = '#3e302c'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#39434a'; c.fillRect(-26, -13, 52, 4);
      c.fillStyle = '#ffe3a1';
      for (let x = -20; x <= 16; x += 12) c.fillRect(x, -5, 7, 7);
    }
  }

  function drawCar(c, type, role, wheelAngle = 0) {
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    if (type === 'd51') steam(c, role === 'engine', wheelAngle);
    else shinkansen(c, types[type] ? type : 'hayabusa', role === 'cab');
    c.restore();
  }
  window.TrainArt = Object.freeze({ types, drawCar });
})();
