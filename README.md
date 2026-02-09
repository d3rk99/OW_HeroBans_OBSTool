# OW2 Hero Bans OBS Tool

A static browser-source-friendly tool for Overwatch 2 custom match hero bans.

## Files

- `control.html`: Producer control panel with searchable hero selection for both teams.
- `team1.html`: Team 1 overlay card.
- `team2.html`: Team 2 overlay card.
- `data/heroes.json`: Hero metadata mapping hero names to expected image filenames.
- `assets/hero/`: Place hero icon images here (current expected path).

## How it works

- Shared state is stored in localStorage under key `ow2_bans_state`.
- State shape:

```json
{
  "team1": { "ban": "Ana" },
  "team2": { "ban": "Reinhardt" },
  "updatedAt": 1234567890
}
```

- `control.html` writes state updates.
- `team1.html` and `team2.html` listen for storage events and also poll state every 500ms for robust updates in OBS/browser contexts.

## OBS setup

1. Put this folder somewhere stable on disk.
2. Add Browser Source for Team 1 overlay:
   - Check `Local file`.
   - File: `team1.html`.
   - Width: `600`.
   - Height: `300`.
3. Add Browser Source for Team 2 overlay:
   - Check `Local file`.
   - File: `team2.html`.
   - Width: `600`.
   - Height: `300`.
4. Add Browser Source or local browser window for producer panel:
   - File: `control.html`.
   - Use a larger size such as `1280x720`.
5. (Optional) Add a custom browser dock in OBS:
   - Go to `View` → `Docks` → `Custom Browser Docks`.
   - Add a new dock pointing to the local file `dock.html`.
   - Dock it near your scene/source list so controls stay visible while you work.
6. Recommended source options:
   - Keep `Refresh browser when scene becomes active` disabled unless you need hard resets.
   - Keep `Shutdown source when not visible` disabled if you want instant resume state.
   - Enable hardware acceleration if your OBS setup benefits from it.

## Adding hero images

1. Add image files into `assets/hero/` matching `.webp` names in `data/heroes.json`.
   - Example: `assets/hero/Icon-Ana.webp`.
2. If you prefer different filenames, update the matching hero entry in `data/heroes.json`.
3. If an image is missing, overlays automatically show a placeholder state while still showing the selected hero name.

## Usage tips

- Type part of a hero name in either team search box to filter quickly.
- Press Arrow Up or Arrow Down to navigate results and Enter to commit a selection.
- Use per-team `Clear` to remove one ban.
- Use `Reset All` to clear both teams.
- Testing override: open `team1.html?hero=Ana` or `team2.html?hero=Reinhardt` to preview card styling without localStorage state.
