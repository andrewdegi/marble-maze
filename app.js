// Marble Maze on the web. The Rive file does the 3D, physics and controls;
// this page fills the screen with it and hands it the device's tilt.
//
//   first tap   turns on tilt control (iOS asks for motion access here)
//   double tap  restarts, and levels the tilt to however the device is held
//   drag        looks around the toy
//
// Tilt steers gravity: the toy stays put (it only tips a little, so you can
// see which way you're leaning) and "down" swings GAIN times as far as you
// tip the device. The shaping follows the usual numbers for tilt controls:
//
//   neutral   however you're holding it just before you tap (people hold a
//             tablet tipped ~20-45 deg toward them), else 25 deg toward you
//   deadzone  3 deg, so a resting hand doesn't wobble it
//   position  gravity swings GAIN times your tilt, right over (180 deg) at
//             3 + 180/GAIN deg, so every direction is in reach
//   spin      tip further still and it keeps turning that way; back inside,
//             that extra turn eases off
//   show      the toy itself tips SHOW of the way, as a cue
//
// Tune from the address: ?gain=3&dead=3&show=0.12&spin=200&ramp=15&curve=1&ret=1.2
//
// The file's "Motion" view model takes the whole turn (qx..qw) and the part
// to show by tipping the toy (tx..tw), both as quaternions in a tray frame
// (x right, y away from you, z up), plus counters that re-level and restart.

const params = new URLSearchParams(location.search);
const num = (k, d, lo, hi) => { const v = parseFloat(params.get(k)); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const DEG = Math.PI / 180;
const GAIN = num("gain", 3, 0.5, 8);                // gravity turn per degree of tilt
const DEAD = num("dead", 3, 0, 15) * DEG;
const EDGE = num("edge", DEAD / DEG + 180 / GAIN, 5, 90) * DEG;   // position control inside this
const SHOW = num("show", 0.12, 0, 1);               // share of the turn the toy shows
const SPIN = num("spin", 200, 0, 720) * DEG;        // rad/s at full push past the edge
const RAMP = num("ramp", 15, 1, 60) * DEG;          // push past the edge for full spin
const CURVE = num("curve", 1, 0.5, 3);              // >1: finer near neutral
const RETURN = num("ret", 1.2, 0, 10);              // s for extra spin to ease off inside the edge (0: keep it)
const NEUTRAL_BETA = num("neutral", 25, -30, 80);   // used when there's no pose to go by

const canvas = document.getElementById("maze");

// Draw the 3D in device pixels, but keep the buffers within a budget so a
// large iPad doesn't run the GPU out of memory.
const PIXEL_BUDGET = 3.2e6;
function renderScale() {
  const dpr = window.devicePixelRatio || 1;
  const css = Math.max(1, canvas.clientWidth * canvas.clientHeight);
  return Math.min(dpr, Math.sqrt(PIXEL_BUDGET / css));
}
function sharpLayout() {
  return new rive.Layout({ fit: rive.Fit.Layout, layoutScaleFactor: 1 / renderScale() });
}

let vm = null;
let uLevel = null;          // "up" in the screen's frame at level
let spun = [0, 0, 0, 1];    // turn built up by pushing past the edge
let lastT = 0;
let tiltOn = false;
let fused = false;          // orientation events arriving
let recenterCount = 0;
let restartCount = 0;
const recent = [];          // the last second of "up" readings, for levelling

const r = new rive.Rive({
  src: "mazeball.riv?v=11",
  canvas,
  autoplay: true,
  stateMachine: "State Machine 1",
  autoBind: true,
  enableGPUCanvas: true,
  useOffscreenRenderer: false,
  layout: sharpLayout(),
  onLoad: () => {
    fit();
    vm = r.viewModelInstance;
    if (tiltOn) switchOn();
  },
  onLoadError: (e) => console.error("Couldn't load the maze", e),
});

function fit() {
  r.layout = sharpLayout();
  r.resizeDrawingSurfaceToCanvas(renderScale());
}
// resize once the window has settled, not on every intermediate size
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fit, 200);
});

// --- vectors and quaternions [x, y, z, w] -----------------------------------
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// shortest rotation taking unit vector a onto unit vector b
function fromTo(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.9999) return [1, 0, 0, 0];
  const q = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], 1 + d];
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// device axes -> screen axes when the page is in landscape
function toScreen(v) {
  const a = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

function send(q, t = [0, 0, 0, 1]) {
  if (!vm) return;
  vm.number("qx").value = q[0];
  vm.number("qy").value = q[1];
  vm.number("qz").value = q[2];
  vm.number("qw").value = q[3];
  vm.number("tx").value = t[0];
  vm.number("ty").value = t[1];
  vm.number("tz").value = t[2];
  vm.number("tw").value = t[3];
}

// q applied to v
function rot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
function mul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
          a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
          a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
          a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function fromRotVec(x, y, z) {
  const a = Math.hypot(x, y, z);
  if (a < 1e-9) return [0, 0, 0, 1];
  const s = Math.sin(a / 2) / a;
  return [x * s, y * s, z * s, Math.cos(a / 2)];
}
// q eased a fraction k of the way back to no turn (by the short way round)
function towardLevel(q, k) {
  const sg = q[3] < 0 ? -1 : 1;
  const ang = 2 * Math.acos(Math.min(1, q[3] * sg));
  const s = Math.sin(ang / 2);
  if (s < 1e-6) return [0, 0, 0, 1];
  const a2 = ang * (1 - k), f = Math.sin(a2 / 2) / s * sg;
  return [q[0] * f, q[1] * f, q[2] * f, Math.cos(a2 / 2)];
}
function upFrom(beta, gamma) {
  const b = beta * DEG, g = gamma * DEG;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

// Level from how the device was held over the moment before t (a tap): the
// hand holds still to tap. With nothing to go by, a typical hold.
function poseBefore(t) {
  const v = recent.filter((r) => r.t <= t && r.t > t - 450);
  if (v.length < 5) return null;
  const m = [0, 0, 0];
  for (const r of v) { m[0] += r.u[0]; m[1] += r.u[1]; m[2] += r.u[2]; }
  return norm(m);
}
function level(t) {
  uLevel = poseBefore(t) || toScreen(upFrom(NEUTRAL_BETA, 0));
  spun = [0, 0, 0, 1];
  if (vm) vm.number("recenter").value = ++recenterCount;
  send([0, 0, 0, 1]);
}

function update(u) {
  if (!isFinite(u[0] + u[1] + u[2])) return;
  const t = performance.now();
  recent.push({ t, u });
  while (recent.length && recent[0].t < t - 1000) recent.shift();
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  if (!tiltOn || !uLevel) return;
  // tilt from neutral, as a turn about a level axis in the tray frame
  const L = fromTo(uLevel, [0, 0, 1]);
  const v = rot(L, u);
  const ax = -v[1], ay = v[0];                       // axis z x v: up swings from z toward v
  const s = Math.hypot(ax, ay);
  const tilt = Math.atan2(s, v[2]);
  let turn = [0, 0, 0, 1], shown = [0, 0, 0, 1];
  if (s > 1e-6 && tilt > DEAD) {
    const nx = ax / s, ny = ay / s;
    const span = EDGE - DEAD;
    const inside = Math.min(tilt - DEAD, span) / span;  // 0..1 across the position zone
    const pos = Math.pow(inside, CURVE) * span * GAIN;
    // past the edge: keep turning that way, faster the further you push
    const push = Math.max(0, tilt - EDGE) / RAMP;
    if (push > 0) spun = mul(fromRotVec(nx * SPIN * Math.min(1, push) * dt, ny * SPIN * Math.min(1, push) * dt, 0), spun);
    turn = fromRotVec(nx * pos, ny * pos, 0);
    shown = fromRotVec(nx * pos * SHOW, ny * pos * SHOW, 0);
  }
  if (tilt <= EDGE && RETURN > 0) spun = towardLevel(spun, 1 - Math.exp(-dt / RETURN));
  // sent as the turn that brings "up" back to level, which is the way the
  // toy's world turns: tip the device's right edge down and the marble
  // rolls right
  const q = mul(turn, spun);
  send([-q[0], -q[1], -q[2], q[3]], [-shown[0], -shown[1], -shown[2], shown[3]]);
}

// "up" in the device's frame from the W3C angles (Z-X'-Y''): it depends only
// on beta and gamma, and stays continuous through upright
function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  fused = true;
  update(toScreen(upFrom(e.beta, e.gamma)));
}

// fallback when there's no fused orientation: the accelerometer, lightly
// smoothed (it also picks up the hand's own movement)
let gAcc = null;
function onMotion(e) {
  if (fused) return;
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  const g = toScreen(norm([a.x, a.y, a.z]));
  gAcc = gAcc ? norm([gAcc[0] * 0.5 + g[0] * 0.5, gAcc[1] * 0.5 + g[1] * 0.5, gAcc[2] * 0.5 + g[2] * 0.5]) : g;
  update(gAcc);
}

// iOS shows the motion prompt only from a finished tap (touchend / click),
// and only when that tap's handler calls it directly; both requests are
// made right here, inside the tap. If access was already given, readings
// flow from the start, and the pose before the first tap is there to level
// from.
let listening = false;
let pending = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("deviceorientation", onOrientation);
  window.addEventListener("devicemotion", onMotion);
}
listen();
function askForMotion() {
  if (pending || fused) return;
  const O = window.DeviceOrientationEvent, M = window.DeviceMotionEvent;
  const asks = [];
  if (O && typeof O.requestPermission === "function") asks.push(O.requestPermission());
  if (M && typeof M.requestPermission === "function") asks.push(M.requestPermission());
  if (!asks.length) return;
  pending = true;
  Promise.allSettled(asks).finally(() => { pending = false; });
}

function switchOn() {
  if (!vm) return;
  vm.number("recenter").value = ++recenterCount;
  vm.boolean("motionActive").value = true;
}

// first tap: tilt on, level as held. double tap: restart and level again.
let lastTap = 0, lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0, prevDownT = 0;
canvas.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; prevDownT = downT; downT = performance.now(); });
canvas.addEventListener("touchend", askForMotion, { passive: true });
canvas.addEventListener("click", askForMotion);
canvas.addEventListener("pointerup", (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;   // that was a drag
  const now = performance.now();
  if (!tiltOn) {
    tiltOn = true;
    level(downT);
    switchOn();
    lastTap = 0;
    return;
  }
  if (now - lastTap < 320 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 40) {
    level(prevDownT);
    if (vm) vm.number("restart").value = ++restartCount;
    lastTap = 0;
    return;
  }
  lastTap = now; lastX = e.clientX; lastY = e.clientY;
});
