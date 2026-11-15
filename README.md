# ponitch

An interactive Dynamic Island-style notch for Linux desktops running **Cinnamon** (Linux Mint) and **GNOME Shell 46+** (Ubuntu 24.04).
Music, a volume/brightness HUD, notifications, prayer times, Pomodoro, a work stopwatch, todo and quick controls, all in a black pill at the top of the screen.
Full plan (in Indonesian): [PLAN.md](PLAN.md).

License: GPL-3.0-or-later.

## Install

```sh
./install.sh   # detects the desktop, builds, symlinks the extension + ~/.local/bin/notchctl
```

Then enable **ponitch** in your desktop's Extensions settings. The notch appears on the primary monitor.

- Cinnamon: move your panel to the bottom first; the notch takes the top centre.
- GNOME: the notch covers the middle of the top bar and the clock moves to the right. It moves back when ponitch is disabled.

Needs `python3`, `glib-compile-schemas` and `msgfmt` (package `gettext`) to build.

## Use

- Hover to peek. Click or press `Alt+N` to open the panel. Move the pointer away to close it.
- `notchctl toggle|open [tab]|close|tuck|untuck|pin|unpin|state`, e.g. `notchctl open pomodoro`.
  Tabs: `home`, `music`, `prayer`, `todo`, `pomodoro`, `stopwatch`, `notifications`, `control`.

Prayer times: inside Indonesia, set your city to use the official Kemenag schedule (downloaded once a month from api.myquran.com). Elsewhere, leave the city empty and set latitude, longitude and a calculation method; times are then computed offline.

Privacy: no telemetry. Network use is limited to the prayer schedule and `http(s)` cover art that media players announce.

## Translations

The UI is in English with an Indonesian translation. Gettext domain: `ponitch@masahhmad`.

- `python3 build.py pot` regenerates `po/ponitch.pot` from the sources and both settings schemas.
- Update a translation: `msgmerge --update po/id.po po/ponitch.pot`, then fill in the new strings.
- New language: `msginit -i po/ponitch.pot -o po/<lang>.po -l <lang>`.
- Try it without changing your locale (GNOME nested shell): `LANGUAGE=id dbus-run-session -- gnome-shell --nested --wayland`.

`build.py` compiles every `po/*.po` into the extension's `locale/`. On Cinnamon, `install.sh` also links them into `~/.local/share/locale`, where Cinnamon and its settings window look for them.

## Layout

- `src/core/`: shared, platform-neutral code (no `imports.*`, `Main` or `global`).
- `src/cinnamon/`, `src/gnome/`: one thin adapter per desktop.
- `python3 build.py [cinnamon|gnome|all]` → `dist/<desktop>/ponitch@masahhmad/`. For GNOME the core modules are converted to ES modules.

## Tests

```sh
for t in tests/test_*.js; do node "$t"; done
python3 tests/test_build.py
```

To test music without a real player: `python3 tests/fake_mpris.py` runs a scriptable MPRIS player (`dev.ponitch.Test.SetTrack/SetStatus`, see its docstring).

## Development notes

- After changing code: `./install.sh`, then disable and re-enable the extension. GNOME caches ES modules, so on GNOME you need to log out and back in, or test in a nested shell (`dbus-run-session -- gnome-shell --nested --wayland`).
- Cinnamon caches stylesheets. After changing `stylesheet.css`, run `Main.themeManager._changeTheme()` in Looking Glass (`Alt+F2` → `lg`) or restart Cinnamon. **Don't** use `Main.loadTheme()`: it drops every applet/extension stylesheet from the active theme.
- Logs: `~/.xsession-errors` (Cinnamon), `journalctl --user -b` (GNOME).
- Don't put `box-shadow` on the notch: St re-blurs it on the CPU on every size change (PLAN.md §4A.6).
- GNOME notifications and the extension preferences window run under `gjs`. If the `gjs` package is missing (it can be, on a Mint machine with GNOME added), GNOME shows no notifications at all.

## Uninstall

```sh
./uninstall.sh
```
