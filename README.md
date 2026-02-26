# OW2 Hero Bans OBS Tool

A static browser-source-friendly tool for Overwatch 2 custom match hero bans.

## Files

- `control.html`: Producer control panel with tabbed tools for Hero Bans and Scoreboard control.
- `team1.html`: Team 1 overlay card.
- `team2.html`: Team 2 overlay card.
- `scoreboard-team1-name.html` / `scoreboard-team2-name.html`: Team name overlays for scoreboard scenes.
- `scoreboard-team1-logo.html` / `scoreboard-team2-logo.html`: Team logo overlays for scoreboard scenes.
- `scoreboard-team1-score.html` / `scoreboard-team2-score.html`: Team score overlays for scoreboard scenes.
- `gui_tool.py`: Desktop GUI controller + local bridge server (`http://127.0.0.1:8765`).
- `obs_hero_bans_dock.py`: OBS Python script that embeds `control.html` as a native OBS dock panel (written for broad OBS Python compatibility).
- `setup_windows_env.bat`: Windows setup helper that installs Python (via `winget` if needed), creates `.venv`, and installs dependencies.
- `build_exe.bat`: Windows helper script to build `OW2HeroBansGUI.exe` with PyInstaller.
- `requirements.txt`: Python dependencies used by the GUI/EXE build workflow (PyInstaller + Pillow for hero icons in suggestions).
- `data/heroes.json`: Hero metadata mapping hero names to expected image filenames.
- `assets/hero/`: Place hero icon images here (current expected path).

## How it works

- Shared state is stored in localStorage under key `ow2_bans_state`.
- If the desktop GUI bridge is running, pages also sync via `http://127.0.0.1:8765/api/state`.
- State shape:

```json
{
  "team1": { "ban": "Ana" },
  "team2": { "ban": "Reinhardt" },
  "scoreboard": {
    "team1": { "name": "Team Alpha", "nameUsePng": false, "namePng": "", "namePngScale": 0, "logo": "./assets/team-alpha.png", "score": 1, "nameColor": "#e9eefc", "bevelColor": "#7dd3fc", "nameFont": "varsity" },
    "team2": { "name": "Team Bravo", "nameUsePng": false, "namePng": "", "namePngScale": 0, "logo": "./assets/team-bravo.png", "score": 2, "nameColor": "#e9eefc", "bevelColor": "#7dd3fc", "nameFont": "varsity" }
  },
  "updatedAt": 1234567890
}
```

- `control.html` writes both hero-ban and scoreboard state updates.
- Bridge state is cached to `data/controller_state_cache.json` so controller values are restored after restarting OBS/GUI.
- `team1.html` and `team2.html` read hero-ban state.
- Scoreboard overlay HTML files read scoreboard state (team names, optional team-name PNGs with size, logos, scores, and team-name style settings).
- The controller has a dedicated **Score** tab with large +/- controls that automatically publish score updates (no manual update click needed).
- Overlay pages listen for storage events and also poll state every 500ms for robust updates in OBS/browser contexts.

## Desktop GUI mode (EXE)

1. Run `setup_windows_env.bat` (installs Python automatically if missing: tries `winget` first, then falls back to the official python.org installer; then creates `.venv` and installs dependencies).
2. Run `build_exe.bat`.
3. Launch `dist/OW2HeroBansGUI.exe`.
4. In OBS, add Browser Sources with URLs:
   - `http://127.0.0.1:8765/team1.html`
   - `http://127.0.0.1:8765/team2.html`

The GUI window replaces `control.html` as your producer control surface while still using the same `team1.html` and `team2.html` overlays.

## OBS dock setup (script mode)

1. In OBS, open `Tools -> Scripts`.
2. Click `+` and add `obs_hero_bans_dock.py` from this repo.
3. Leave `Auto-start local headless server` enabled (default).
4. Open `View -> Docks` and enable `OW2 Hero Bans` if it is not already visible.

When enabled, the script automatically starts a local headless server at `http://127.0.0.1:8765` for `control.html`, `team1.html`, `team2.html`, `/api/state`, and `/api/fonts`. When OBS unloads the script (or exits), that script-owned server is shut down automatically.

If OBS script logs report missing Qt WebEngine modules, install a supported binding into the Python runtime used by OBS scripting, then reload the script.

- Python 3.6 (common in older OBS installs): use `PyQt5` or `PySide2` and their QtWebEngine package.
- Python 3.7+: `PyQt6`, `PySide6`, `PyQt5`, or `PySide2` can work.

If you cannot install Qt packages into the OBS scripting Python, use OBS-native fallback (no script required):
1. `View -> Docks -> Custom Browser Docks...`
2. Name: `OW2 Hero Bans`
3. URL: `http://127.0.0.1:8765/control.html`

## OBS setup (browser file mode)

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
5. Recommended source options:
   - Keep `Refresh browser when scene becomes active` disabled unless you need hard resets.
   - Keep `Shutdown source when not visible` disabled if you want instant resume state.
   - Enable hardware acceleration if your OBS setup benefits from it.

## Adding hero images

1. Add image files into `assets/hero/` matching `.webp` names in `data/heroes.json`.
   - Example: `assets/hero/Icon-Ana.webp`.
2. If you prefer different filenames, update the matching hero entry in `data/heroes.json`.
3. If an image is missing, overlays automatically show a placeholder state while still showing the selected hero name.

## Adding Valorant map images

1. Add map images into `assets/maps/`.
2. Recommended filenames are exact map names, for example `Ascent.png`, `Bind.png`, and `Haven.png`.
3. The overlay also accepts legacy slug names like `ascent.png` and supports `.png`, `.jpg`, or `.webp`.
4. If a map image is missing, the overlay keeps the map label visible and hides the image.

## Usage tips

- Type part of a hero name in either team search box to filter quickly.
- Press Arrow Up or Arrow Down to navigate results and Enter to commit a selection.
- Use per-team `Clear` to remove one ban.
- Use `Reset All` to clear both teams.
- In the Scoreboard tab, choose a team-name font style (including jersey-like option) and name color for each team.
- Testing override: open `team1.html?hero=Ana` or `team2.html?hero=Reinhardt` to preview card styling without localStorage state.


## Custom scoreboard fonts
- Drop `.ttf`, `.otf`, `.woff`, or `.woff2` files under `assets/Fonts/`.
- The controller automatically loads available files (via `/api/fonts`) into the Team Name font selectors.
- Selected custom font files are stored in state as `file:<relative-path>` and loaded dynamically by the scoreboard name overlays.
