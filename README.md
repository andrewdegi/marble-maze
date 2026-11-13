# Marble Maze

A clear sphere full of interlocking labyrinths and track: turn it to roll the
marble from the launch cup to the finish cup. Built with the
[Rive CLI](https://rive.app/docs/cli/overview): the 3D rendering, physics and
controls all live in the Rive file (`mazeball.riv`), written in AnimaScript
with WGSL shaders, and the model was built in Blender.

**On a phone or iPad:** tap once to turn on tilt control, then tilt the device
to roll the marble. Drag to look around. Double tap to restart (it also
re-levels to however you're holding the device).

**On a computer:** drag the sphere to turn it, drag around it (or Shift-drag)
to orbit the view, scroll to zoom, arrows/WASD to tilt, Q/E to twist,
R or double-click to restart.

The page (`index.html`, `app.js`) loads the file with `@rive-app/webgl2` and
writes the device's rotation into the file's `Motion` view model.
