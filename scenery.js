(() => {
  'use strict';
  const specs = {
    mountain: { label: 'やま', ratio: 1.4 }, flower: { label: 'はな', ratio: .7 },
    tree: { label: 'き', ratio: .8 }, house: { label: 'おうち', ratio: 1 },
    station: { label: 'えき', ratio: 1.9 }, pond: { label: 'いけ', ratio: 1.5 }
  };
  function create(result, id) {
    const { type, bounds: b } = result, ratio = specs[type].ratio;
    const height = Math.max(30, Math.min(650 / Math.max(1, ratio), Math.max(b.height, b.width / ratio)));
    const width = height * ratio;
    return { id, type, x: Math.max(width/2, Math.min(5000-width/2,b.x)),
      y: Math.max(height/2, Math.min(5000-height/2,b.y)), width, height, age: 0 };
  }
  function draw(c, object, dt) {
    object.age = Math.min(.4, object.age + dt);
    const pop = 1 + .12 * Math.sin(object.age / .4 * Math.PI);
    c.save(); c.translate(object.x, object.y); c.scale(object.width/100*pop, object.height/100*pop); c.translate(-50,-50);
    c.lineJoin = 'round'; c.lineCap = 'round';
    const polygon = (points, color) => { c.beginPath(); points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y)); c.closePath();c.fillStyle=color;c.fill(); };
    const ellipse = (x,y,rx,ry,color) => { c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill(); };
    const rect = (x,y,w,h,color) => { c.fillStyle=color;c.fillRect(x,y,w,h); };
    switch (object.type) {
      case 'mountain':
        polygon([[2,96],[50,4],[98,96]],'#67af79');polygon([[33,37],[50,4],[68,38],[55,32],[48,39],[41,31]],'#fffdf4');break;
      case 'pond':
        ellipse(50,52,49,45,'#8cc98b');ellipse(50,51,43,37,'#6ac8e5');
        ellipse(34,40,17,3,'#b9eff5');ellipse(65,64,18,3,'#b9eff5');break;
      case 'flower':
        rect(47,42,6,55,'#59a46c');ellipse(34,76,17,7,'#76bc71');ellipse(65,67,17,7,'#76bc71');
        for(let i=0;i<6;i++){const a=i*Math.PI/3;ellipse(50+Math.cos(a)*23,31+Math.sin(a)*16,17,13,'#f28cac');}
        ellipse(50,31,14,11,'#ffd66b');break;
      case 'tree':
        rect(43,42,14,55,'#ab7952');ellipse(30,35,28,25,'#7ebf70');ellipse(68,35,30,27,'#64ad68');ellipse(50,25,29,23,'#82c77a');break;
      case 'house':
        rect(14,40,72,57,'#f9dfaa');polygon([[3,43],[50,3],[97,43]],'#df8670');
        rect(24,56,19,20,'#81bfce');rect(57,60,17,37,'#ac805a');ellipse(61,80,2,2,'#ffdf83');break;
      case 'station':
        rect(9,32,82,64,'#f4dfa9');polygon([[1,33],[13,6],[87,6],[99,33]],'#63a4a1');
        rect(40,62,20,34,'#6d999e');rect(16,58,17,20,'#a1d3df');rect(67,58,17,20,'#a1d3df');
        rect(32,36,36,21,'#fffdf3');c.fillStyle='#456f65';c.font='bold 15px sans-serif';c.textAlign='center';c.fillText('えき',50,52);break;
    }
    c.restore();
  }
  const contains = (p, o) => Math.abs(p.x-o.x)<=o.width/2 && Math.abs(p.y-o.y)<=o.height/2;
  window.Scenery = Object.freeze({ specs, create, draw, contains });
})();
