// Marble Maze on the web. The Rive file does the 3D, physics and controls;
// this page fills the screen with it and hands it the device's tilt.
//
//   first tap   turns on tilt control (iOS asks for motion access here)
//   double tap  restarts, and levels the tilt to however the device is held
//   drag        looks around the toy
//
// Tilt steers gravity. The device's tilt away from level is multiplied by
// GAIN, so a 10 degree tip swings down by 40 degrees and a 45 degree tip in
// any direction turns gravity right over: full 360 degree control without
// turning the device over. Try ?gain=5 or ?gain=3 in the address.
//
// The tilt comes from the gyro-fused orientation (fast and steady), turned
// into the direction of "up" so the angles' blind spot near upright never
// matters; the raw accelerometer is the fallback.
//
// The file's "Motion" view model takes the (amplified) turn since levelling
// as a quaternion in the screen's frame (x right, y up the screen, z out of
// the screen), plus counters that re-level and restart.

const GAIN = Math.max(1, Math.min(8, parseFloat(new URLSearchParams(location.search).get("gain")) || 4));

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
let uNow = null;            // "up" in the screen's frame
let uLevel = null;          // "up" when last levelled
let tiltOn = false;
let fused = false;          // orientation events arriving
let recenterCount = 0;
let restartCount = 0;

const r = new rive.Rive({
  src: "mazeball.riv?v=6",
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
  resizeTimer = setTimeout(() => { fit(); uLevel = uNow; }, 200);
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

function send(q) {
  if (!vm) return;
  vm.number("qx").value = q[0];
  vm.number("qy").value = q[1];
  vm.number("qz").value = q[2];
  vm.number("qw").value = q[3];
}

// the same turn, about the same axis, GAIN times as far (at most right over)
function amplify(q) {
  const w = Math.max(-1, Math.min(1, q[3]));
  const ang = 2 * Math.acos(w);
  const s = Math.sin(ang / 2);
  if (s < 1e-6) return [0, 0, 0, 1];
  const a2 = Math.min(ang * GAIN, Math.PI);
  const k = Math.sin(a2 / 2) / s;
  return [q[0] * k, q[1] * k, q[2] * k, Math.cos(a2 / 2)];
}

function update(u) {
  if (!isFinite(u[0] + u[1] + u[2])) return;
  uNow = u;
  if (!uLevel) uLevel = u;
  if (!tiltOn && vm) {
    // the first real reading switches the toy over to the device
    tiltOn = true;
    vm.number("recenter").value = ++recenterCount;
    vm.boolean("motionActive").value = true;
  }
  // the device's tilt since levelling: "up", seen from the screen, has
  // swung from where it was to where it is now
  if (tiltOn) send(amplify(fromTo(u, uLevel)));
}

// "up" in the device's frame from the W3C angles (Z-X'-Y''): it depends only
// on beta and gamma, and stays continuous through upright
function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  fused = true;
  const d = Math.PI / 180, b = e.beta * d, g = e.gamma * d;
  update(toScreen([-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)]));
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
// made right here, inside the tap.
let listening = false;
let pending = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("deviceorientation", onOrientation);
  window.addEventListener("devicemotion", onMotion);
}
function enableTilt() {
  if (listening || pending) return;
  const O = window.DeviceOrientationEvent, M = window.DeviceMotionEvent;
  const asks = [];
  if (O && typeof O.requestPermission === "function") asks.push(O.requestPermission());
  if (M && typeof M.requestPermission === "function") asks.push(M.requestPermission());
  if (!asks.length) { listen(); return; }               // Android, desktop
  pending = true;
  Promise.allSettled(asks)
    .then((rs) => { if (rs.some((r) => r.status === "fulfilled" && r.value === "granted")) listen(); })
    .finally(() => { pending = false; });
}

function restart() {
  uLevel = uNow;              // however it's held now counts as level
  send([0, 0, 0, 1]);
  if (vm) vm.number("restart").value = ++restartCount;
}

// first tap: tilt on. double tap: restart.
let lastTap = 0, lastX = 0, lastY = 0, downX = 0, downY = 0;
canvas.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
canvas.addEventListener("touchend", enableTilt, { passive: true });
canvas.addEventListener("click", enableTilt);
canvas.addEventListener("pointerup", (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;   // that was a drag
  const now = performance.now();
  if (now - lastTap < 320 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 40) {
    restart();
    lastTap = 0;
    return;
  }
  lastTap = now; lastX = e.clientX; lastY = e.clientY;
});
