#!/usr/bin/env python3
"""Build one extension folder per desktop from src/ (PLAN.md §2A).

  python3 build.py [cinnamon|gnome|all]
  python3 build.py pot     regenerate po/ponitch.pot from the sources

Output is flat (dist/<desktop>/<uuid>/*): Cinnamon resolves relative require()
paths from the extension root, so core files must sit next to extension.js.
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
PO = ROOT / "po"
UUID = "ponitch@masahhmad"
DESKTOPS = ("cinnamon", "gnome")

# Core modules use exactly these two CommonJS forms; anything else fails the build.
REQUIRE = re.compile(r"^const (\{[\w\s,]+\}) = require\('\./([\w-]+)'\);$", re.M)
EXPORTS = re.compile(r"^module\.exports = (\{[\w\s,]+\});$", re.M)


class BuildError(Exception):
    pass


def to_esm(js, name):
    js = REQUIRE.sub(lambda m: f"import {m.group(1)} from './{m.group(2)}.js';", js)
    js, n = EXPORTS.subn(lambda m: f"export {m.group(1)};", js)
    if n != 1:
        raise BuildError(f"{name}: expected exactly one 'module.exports = {{ ... }};' line, found {n}")
    if "require(" in js or "module.exports" in js:
        raise BuildError(f"{name}: unsupported require/module.exports form for GNOME (ESM)")
    return js


def build(desktop):
    adapter_dir = SRC / desktop
    if not adapter_dir.is_dir():
        raise BuildError(f"no adapter for {desktop} yet (src/{desktop} missing)")
    core = sorted((SRC / "core").glob("*.js"))
    adapter = sorted(adapter_dir.iterdir())
    clash = {p.name for p in core} & {p.name for p in adapter}
    if clash:
        raise BuildError(f"core and {desktop} adapter both define: {', '.join(sorted(clash))}")

    out = DIST / desktop / UUID
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    for p in core:
        text = p.read_text()
        (out / p.name).write_text(to_esm(text, p.name) if desktop == "gnome" else text)
    for p in adapter:
        if p.is_dir():
            shutil.copytree(p, out / p.name)
        else:
            shutil.copy2(p, out / p.name)
    shutil.copy2(SRC / "stylesheet.css", out / "stylesheet.css")
    for po in sorted(PO.glob("*.po")):
        mo = out / "locale" / po.stem / "LC_MESSAGES" / f"{UUID}.mo"
        mo.parent.mkdir(parents=True)
        subprocess.run(["msgfmt", "--check", "-o", str(mo), str(po)], check=True)
    if (out / "schemas").is_dir():
        # A symlinked (not zip-installed) GNOME extension needs the compiled schema to load.
        subprocess.run(["glib-compile-schemas", "--strict", str(out / "schemas")], check=True)
    return out


def make_pot():
    """po/ponitch.pot from the JS sources, the GSettings schema and the Cinnamon settings schema."""
    cinnamon = json.loads((SRC / "cinnamon" / "settings-schema.json").read_text())
    texts = []
    for v in cinnamon.values():
        texts += [v[f] for f in ("description", "tooltip") if f in v] + list(v.get("options") or {})
    with tempfile.TemporaryDirectory() as tmp:
        # xgettext has no reader for Cinnamon's JSON, so feed its strings in as JS.
        fake = Path(tmp) / "settings-schema.json.js"
        # They are plain text, never format strings ("3% of" is not a placeholder).
        fake.write_text("".join(f"/* xgettext:no-javascript-format */ _({json.dumps(t)});\n" for t in dict.fromkeys(texts)))
        sources = sorted((SRC / "core").glob("*.js")) + [SRC / "gnome" / "prefs.js"]
        out = PO / "ponitch.pot"
        subprocess.run(["xgettext", "--from-code=UTF-8", "--language=JavaScript", "--keyword=_", "--keyword=N_",
                        "--add-comments=Translators", "--package-name=ponitch", "--sort-by-file",
                        "-o", str(out), *(str(p.relative_to(ROOT)) for p in sources), str(fake)], check=True, cwd=ROOT)
        subprocess.run(["xgettext", "--join-existing", "--from-code=UTF-8", "-o", str(out),
                        *(str(p.relative_to(ROOT)) for p in (SRC / "gnome" / "schemas").glob("*.gschema.xml"))], check=True, cwd=ROOT)
        # The temp file's path is meaningless to translators.
        text = re.sub(r"\S*settings-schema\.json\.js:\d+", "src/cinnamon/settings-schema.json", out.read_text())
        out.write_text(text)
    return out


def main(argv):
    target = argv[1] if len(argv) > 1 else "all"
    if target == "pot":
        print(make_pot())
        return 0
    if target not in DESKTOPS + ("all",):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    targets = [d for d in DESKTOPS if (SRC / d).is_dir()] if target == "all" else [target]
    try:
        for d in targets:
            print(build(d))
    except BuildError as e:
        print(f"build: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
