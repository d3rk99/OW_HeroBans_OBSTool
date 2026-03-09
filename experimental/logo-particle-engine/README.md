# Logo Particle Engine (Experimental)

This standalone demo turns two team logos into animated particles that cycle in sequence.

## Run locally

From the repository root:

```bash
python3 -m http.server 4173
```

Then open:

- `http://localhost:4173/experimental/logo-particle-engine/`

## Sequence behavior

- Particles form **Team 1 logo**, then transition into **Team 2 logo** after your configured hold time.
- The sequence continuously loops.
- Once particles settle into a logo, they slowly rotate with perspective for a 3D-style look.
- Burst/reform now uses a softer, more graceful transition with smoothed color blending between logo states.
- Team 1 can either restart at your selected start angle (0–359°) or continue rotation, based on the reset toggle; Team 2 continues from the current rotation.
- Uploading a new image for either team updates that logo on the fly.

## Controls

- **Team 1 Logo / Team 2 Logo:** hot-swap each team image.
- **Particle Density:** controls how many points are sampled from the image.
- **Particle Size:** changes dot radius.
- **Settle Speed:** controls how quickly particles reform.
- **Depth Amount:** controls how much front/back depth is applied to the logo shape.
- **Team 1 Start Angle (°):** sets the reset angle for Team 1 (0–359).
- **Team 1 Reset Mode:** toggle whether Team 1 resets to the selected angle or keeps continuous rotation.
- **Logo Hold Time (seconds):** controls how long each logo remains before switching (live-adjustable).
- **Burst Force:** controls how strong the burst impulse is (0 = minimal movement, 2 = strong).
- **Start Sequence:** force-restart the timed logo cycle.
- **Burst + Reform:** explodes particles, then they return to target.
- **Load Defaults:** restores the built-in default team marks.

## Notes

- This folder is intentionally isolated and does not modify the existing OBS tool flow.
- To use in OBS, add this page as a Browser Source once hosted locally or on your stream machine.
