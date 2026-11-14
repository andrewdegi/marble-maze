# Marble Maze

A clear sphere full of interlocking labyrinths and track: turn it to roll the
marble from the launch cup to the finish cup. Built with the
[Rive CLI](https://rive.app/docs/cli/overview): the 3D rendering, physics and
controls all live in the Rive file (`mazeball.riv`), written in AnimaScript
with WGSL shaders, and the model was built in Blender.

**At the finish** the whole toy shrinks, twirls and silvers over into a
marble, a fresh copy of the puzzle grows up around it, and it drops into the
start: the puzzle never ends.

**On a phone or iPad:** tap once to turn on tilt control; however you're
holding the device at that moment counts as level. Tilting steers gravity,
3x as far as you tip, so about 60 degrees in any direction turns it right
over; the toy itself only tips a little, as a cue. Drag to look around;
double tap to restart and re-level. Tune from the address, e.g.
`?gain=4&show=0.2&dead=3`.

**On a computer:** drag the sphere to turn it, drag around it (or Shift-drag)
to orbit the view, scroll to zoom, arrows/WASD to tilt, Q/E to twist,
R or double-click to restart.

The page (`index.html`, `app.js`) loads the file with `@rive-app/webgl2` and
writes the device's rotation into the file's `Motion` view model.
