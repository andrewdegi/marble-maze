// Marble Maze on the web. The Rive file does the 3D, physics and controls;
// this page fills the screen with it and hands it the device's rotation.
//
//   first tap   turns on tilt control (iOS asks for motion access here)
//   double tap  restarts, and levels the tilt to however the device is held
//   drag        turns the sphere (or, with tilt on, looks around it)
//
// The file's "Motion" view model takes the device's rotation since it was
// last levelled, as a quaternion in the device's own frame (x right, y up the
// screen, z out of the screen), plus counters that re-level and restart.

const canvas = document.getElementById("maze");

function sharpLayout() {
  return new rive.Layout({ fit: rive.Fit.Layout, layoutScaleFactor: 1 / (window.devicePixelRatio || 1) });
}


let vm = null;
let levelQ = null;          // device attitude when last levelled
let latest = null;          // latest device attitude
let tiltOn = false;
let recenterCount = 0;
let restartCount = 0;

const r = new rive.Rive({
  src: "mazeball.riv",
  canvas,
  autoplay: true,
  stateMachine: "State Machine 1",
  autoBind: true,
  enableGPUCanvas: true,
  useOffscreenRenderer: false,
  // the artboard takes the window's shape, in device pixels, so the 3D is
  // drawn at the screen's full resolution
  layout: sharpLayout(),
  onLoad: () => {
    r.resizeDrawingSurfaceToCanvas();
    vm = r.viewModelInstance;
  },
  onLoadError: (e) => console.error("Couldn't load the maze", e),
});

function fit() {
  r.layout = sharpLayout();
  r.resizeDrawingSurfaceToCanvas();
}
window.addEventListener("resize", fit);
window.addEventListener("orientationchange", () => setTimeout(fit, 250));

// --- quaternions [x, y, z, w] ---------------------------------------------
const mul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
const aboutZ = (rad) => [0, 0, Math.sin(rad / 2), Math.cos(rad / 2)];

// The device's attitude (device frame -> earth frame) from the W3C
// deviceorientation angles, intrinsic Z-X'-Y'', turned so its axes are the
// screen's when the page is in landscape.
function attitude(alpha, beta, gamma) {
  const d = Math.PI / 180;
  const x = (beta || 0) * d / 2, y = (gamma || 0) * d / 2, z = (alpha || 0) * d / 2;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z);
  const sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  const q = [
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  ];
  const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  return mul(q, aboutZ(-angle * d));
}

function send(q) {
  if (!vm) return;
  vm.number("qx").value = q[0];
  vm.number("qy").value = q[1];
  vm.number("qz").value = q[2];
  vm.number("qw").value = q[3];
}

function onOrientation(e) {
  if (e.alpha == null && e.beta == null) return;   // no real sensor
  latest = attitude(e.alpha, e.beta, e.gamma);
  if (!levelQ) levelQ = latest;
  if (!tiltOn && vm) {
    // the first real reading switches the sphere over to the device
    tiltOn = true;
    vm.number("recenter").value = ++recenterCount;
    vm.boolean("motionActive").value = true;
  }
  if (tiltOn) send(mul(conj(levelQ), latest));      // turn since levelling, device frame
}

// iOS shows the motion prompt only from a finished tap (touchend / click),
// not from touch-down, and only once that tap's handler calls it directly.
let listening = false;
let pending = false;
function enableTilt() {
  if (listening || pending) return;
  const D = window.DeviceOrientationEvent;
  if (!D) return;
  if (typeof D.requestPermission !== "function") {        // Android, desktop
    listening = true;
    window.addEventListener("deviceorientation", onOrientation);
    return;
  }
  pending = true;
  D.requestPermission()                                   // called inside the tap
    .then((answer) => {
      if (answer === "granted") {
        listening = true;
        window.addEventListener("deviceorientation", onOrientation);
      }
    })
    .catch(() => {})                                      // not a gesture: try on the next tap
    .finally(() => { pending = false; });
}

function restart() {
  levelQ = latest;            // however it's held now counts as level
  send([0, 0, 0, 1]);
  if (vm) vm.number("restart").value = ++restartCount;
}

// first tap: tilt on. double tap: restart.
let lastTap = 0, lastX = 0, lastY = 0, downX = 0, downY = 0;
canvas.addEventListener("pointerdown", (e) => {
  downX = e.clientX; downY = e.clientY;
});
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
