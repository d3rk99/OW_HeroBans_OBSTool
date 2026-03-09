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

- Particles form **Team 1 logo**, then after **3 seconds** transition into **Team 2 logo**.
- The sequence continuously loops.
- Uploading a new image for either team updates that logo on the fly.

## Controls

- **Team 1 Logo / Team 2 Logo:** hot-swap each team image.
- **Particle Density:** controls how many points are sampled from the image.
- **Particle Size:** changes dot radius.
- **Settle Speed:** controls how quickly particles reform.
- **Start Sequence:** force-restart the timed logo cycle.
- **Burst + Reform:** explodes particles, then they return to target.
- **Load Defaults:** restores the built-in default team marks.

## Notes

- This folder is intentionally isolated and does not modify the existing OBS tool flow.
- To use in OBS, add this page as a Browser Source once hosted locally or on your stream machine.
