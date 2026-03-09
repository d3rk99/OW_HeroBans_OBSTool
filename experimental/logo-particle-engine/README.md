# Logo Particle Engine (Experimental)

This standalone demo turns any uploaded logo image into animated particles.

## Run locally

From the repository root:

```bash
python3 -m http.server 4173
```

Then open:

- `http://localhost:4173/experimental/logo-particle-engine/`

## Controls

- **Upload Logo (PNG):** hot-swap to a new school/team logo.
- **Particle Density:** controls how many points are sampled from the image.
- **Particle Size:** changes dot radius.
- **Settle Speed:** controls how quickly particles reform.
- **Burst + Reform:** explodes particles, then they return to target.
- **Load Default:** restores the built-in demo mark.

## Notes

- This folder is intentionally isolated and does not modify the existing OBS tool flow.
- To use in OBS, add this page as a Browser Source once hosted locally or on your stream machine.
