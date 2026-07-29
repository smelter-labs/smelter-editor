Howdy fellas.

Welcome back to the "Smelter Workshop" series by Software Mansion, me, and this time - a pistol built out of a saw handle.

Because this episode is Duck Hunt. On a live stream. With real birds.

The machinery you already know: the side channel hands decoded frames to a Python sidecar running YOLO - this time tuned to spot birds. Every bird it finds on the stream spawns a NES-style duck sprite right on top of the real one. The duck holds still for a beat, then takes off at forty-five degrees toward the top-right corner - straight out of 1984.

Your phone is the gun. It opens a web page, joins the room, and shows the live stream - and since the gyroscope API only wakes up over HTTPS, the whole thing hides behind one tunnel.

Aiming is a gyro-mouse: I integrate the gyroscope's angular velocity, so the crosshair moves by how much the phone rotated. The obvious approach - orientation angles - gimbal-locks the moment you hold the phone upright, which is, you know, how you hold a gun.

There's also a calibration screen to pick which axis drives what, flip it, tune the sensitivity - because no two people hold an imaginary pistol the same way.

And the hit-test has one neat trick: a duck's flight is a pure function of time, computed by the server and the renderer from the same spawn point - so a shot always lands exactly on the sprite you see.

Then, the hardware. Grip: the handle of a saw. Barrel: a tube that used to hold fluorescent glow sticks. There's a beer opener in there too - every serious build has one. A bike phone mount holds the phone up top, and the trigger is a bluetooth button - which speaks keyboard, not touch, so it had to be remapped into a tap landing exactly on the on-screen FIRE button.

Then a round of visual polish: upscaled sprites, and the full NES death beat - a white flash on the hit, the scene dims, the duck hangs for half a second while the whole flock freezes mid-air, then drops off the bottom. Bag two ducks inside two seconds and the dog pops up, holding both. And somewhere along the way the pistol gained a stick of DDR2 RAM as a heat sink. Does it cool anything? No. Does it look like it does? Absolutely.

And then Patryk walked in with his own pistol. Nothing to add code-wise - the game was multiplayer from the start: every phone gets its own crosshair color, the scoreboard lives on the broadcast, and the operator sets the magazine size and reload time so nobody just sprays. So we duelled.

And to show off Smelter a little more: flip on your phone's camera, and your face lands on the broadcast right next to your score. Nothing here is couch-only either - the phone just needs the stream and a socket, so you could join the hunt from the other end of the internet, out of the box.

So: YOLO finds the birds, Smelter draws the ducks, and a saw handle with a phone on top shoots them down - all one live stream, broadcast over WebRTC while it happens.

Thanks for watching - see you in the next one.
