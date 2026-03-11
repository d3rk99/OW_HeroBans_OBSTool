# Logo Particle Engine (Experimental)

This setup now uses **one controller page** and **one separate alpha output page**.

## Run locally

From the repository root:

```bash
python3 -m http.server 4173
```

Then open:

- `http://localhost:4173/experimental/logo-particle-engine/` (**controller only**)
- `http://localhost:4173/experimental/logo-particle-engine/alpha-output.html` (**transparent particles output**)

## Required workflow

1. Open the controller page (`index.html`) in a normal browser.
2. Open `alpha-output.html` as a separate page (or directly in OBS Browser Source).
3. Adjust controls/uploads on the controller page.
4. The alpha output page reads controller state from `localStorage` key `logoParticleEngineStateV1` and updates live.

## Controls

- **Team 1 Logo / Team 2 Logo:** hot-swap each team image.
- **Particle Density:** controls how many points are sampled from the image.
- **Particle Size:** changes dot radius.
- **Settle Speed:** controls how quickly particles reform.
- **Depth Amount:** controls front/back depth applied to the logo shape.
- **Team 1 Start Angle (°):** sets Team 1 reset angle (0–359).
- **Team 1 Reset Mode:** choose reset-to-angle or continuous rotation.
- **Logo Hold Time (seconds):** controls how long each logo remains before switching.
- **Burst Force:** controls burst impulse strength.
- **Start Sequence / Burst + Reform / Load Defaults:** send command events to alpha output.

## Notes

- This folder is intentionally isolated and does not modify the existing OBS tool flow.
- If opened from local files (`file://`), browser storage sync can be inconsistent. Use the local server command above.
