const $ = id => document.getElementById(id);

function pt(x, y) { return { x, y }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function scale(v, s) { return { x: v.x * s, y: v.y * s }; }
function norm(v) { const l = Math.hypot(v.x, v.y); return l ? { x: v.x / l, y: v.y / l } : pt(0, 0); }
function rot(v, a) { const c = Math.cos(a), s = Math.sin(a); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }; }
function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
