// Marble Maze on the web. The Rive file does the 3D, physics and controls;
// this page fills the screen with it and hands it the device's tilt.
//
//   first tap   turns on tilt control (iOS asks for motion access here)
//   double tap  restarts, and levels the tilt to however the device is held
//   drag        turns the sphere (or, with tilt on, looks around it)
//
// Tilt works like a joystick: tip the device and the sphere keeps turning
// that way, faster the further it's tipped; back to level and it stops.
// Tilt comes from the accelerometer's gravity direction, not the
// orientation angles, which jump near upright (gimbal lock).
//
// The file's "Motion" view model takes the device's turn since it was last
// levelled, as a quaternion in the screen's frame (x right, y up the
// screen, z out of the screen), plus counters that re-level and restart.

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
let gNow = null;            // smoothed gravity, screen frame
let gLevel = null;          // gravity when last levelled
let tiltOn = false;
let recenterCount = 0;
let restartCount = 0;

const r = new rive.Rive({
  src: "mazeball.riv?v=5",
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
  resizeTimer = setTimeout(() => { fit(); gLevel = gNow; }, 200);
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

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  const g = toScreen(norm([a.x, a.y, a.z]));
  if (!isFinite(g[0] + g[1] + g[2])) return;
  // a very light low-pass: takes the edge off hand shake without lag
  gNow = gNow ? norm([gNow[0] * 0.55 + g[0] * 0.45, gNow[1] * 0.55 + g[1] * 0.45, gNow[2] * 0.55 + g[2] * 0.45]) : g;
  if (!gLevel) gLevel = gNow;
  if (!tiltOn && vm) {
    // the first real reading switches the sphere over to the device
    tiltOn = true;
    vm.number("recenter").value = ++recenterCount;
    vm.boolean("motionActive").value = true;
  }
  // the device's turn since levelling: gravity, seen from the screen, has
  // swung from where it was to where it is now
  if (tiltOn) send(fromTo(gNow, gLevel));
}

// iOS shows the motion prompt only from a finished tap (touchend / click),
// and only when that tap's handler calls it directly.
let listening = false;
let pending = false;
function enableTilt() {
  if (listening || pending) return;
  const D = window.DeviceMotionEvent;
  if (!D) return;
  if (typeof D.requestPermission !== "function") {        // Android, desktop
    listening = true;
    window.addEventListener("devicemotion", onMotion);
    return;
  }
  pending = true;
  D.requestPermission()                                   // called inside the tap
    .then((answer) => {
      if (answer === "granted") {
        listening = true;
        window.addEventListener("devicemotion", onMotion);
      }
    })
    .catch(() => {})                                      // not a gesture: try on the next tap
    .finally(() => { pending = false; });
}

function restart() {
  gLevel = gNow;              // however it's held now counts as level
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
