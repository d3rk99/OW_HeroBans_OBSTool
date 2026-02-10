# OW2 Hero Bans OBS Tool

A static browser-source-friendly tool for Overwatch 2 custom match hero bans.

## Files

- `control.html`: Producer control panel with searchable hero selection for both teams.
- `team1.html`: Team 1 overlay card.
- `team2.html`: Team 2 overlay card.
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
  "updatedAt": 1234567890
}
```

- `control.html` writes state updates.
- `team1.html` and `team2.html` listen for storage events and also poll state every 500ms for robust updates in OBS/browser contexts.

## Desktop GUI mode (EXE)

1. Run `setup_windows_env.bat` (installs Python automatically if missing: tries `winget` first, then falls back to the official python.org installer; then creates `.venv` and installs dependencies).
2. Run `build_exe.bat`.
3. Launch `dist/OW2HeroBansGUI.exe`.
4. In OBS, add Browser Sources with URLs:
   - `http://127.0.0.1:8765/team1.html`
   - `http://127.0.0.1:8765/team2.html`

The GUI window replaces `control.html` as your producer control surface while still using the same `team1.html` and `team2.html` overlays.

## OBS dock setup (script mode)

1. Start `gui_tool.py` (or `OW2HeroBansGUI.exe`) so the control page is served at `http://127.0.0.1:8765/control.html`.
2. In OBS, open `Tools -> Scripts`.
3. Click `+` and add `obs_hero_bans_dock.py` from this repo.
4. Confirm the script settings:
   - `Dock Title`: `OW2 Hero Bans`
   - `Dock URL`: `http://127.0.0.1:8765/control.html`
5. Open `View -> Docks` and enable `OW2 Hero Bans` if it is not already visible.

This gives you the same producer panel inside OBS instead of a separate window/browser tab.

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

## Usage tips

- Type part of a hero name in either team search box to filter quickly.
- Press Arrow Up or Arrow Down to navigate results and Enter to commit a selection.
- Use per-team `Clear` to remove one ban.
- Use `Reset All` to clear both teams.
- Testing override: open `team1.html?hero=Ana` or `team2.html?hero=Reinhardt` to preview card styling without localStorage state.
