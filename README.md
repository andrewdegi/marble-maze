# Marble Maze

A clear sphere full of interlocking labyrinths and track: turn it to roll the
marble from the launch cup to the finish cup. Built with the
[Rive CLI](https://rive.app/docs/cli/overview): the 3D rendering, physics and
controls all live in the Rive file (`mazeball.riv`), written in AnimaScript
with WGSL shaders, and the model was built in Blender.

**On a phone or iPad:** tap once to turn on tilt control; however you're
holding the device at that moment counts as level. Tilting turns the toy
with it, 2.5x as far, and the marble rolls under ordinary gravity. Tip past
30 degrees and the toy keeps rolling that way (faster up to 45), so it can go
right round without turning the device over; come back inside 30 and it
eases upright again. Drag to look around; double tap to restart and
re-level. Tune from the address, e.g. `?gain=3&edge=25&spin=250&dead=3`.

**On a computer:** drag the sphere to turn it, drag around it (or Shift-drag)
to orbit the view, scroll to zoom, arrows/WASD to tilt, Q/E to twist,
R or double-click to restart.

The page (`index.html`, `app.js`) loads the file with `@rive-app/webgl2` and
writes the device's rotation into the file's `Motion` view model.
