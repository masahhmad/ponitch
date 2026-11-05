#!/usr/bin/env python3
"""Build one extension folder per desktop from src/ (PLAN.md §2A).

  python3 build.py [cinnamon|gnome|all]

Output is flat (dist/<desktop>/<uuid>/*): Cinnamon resolves relative require()
paths from the extension root, so core files must sit next to extension.js.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
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
    if (out / "schemas").is_dir():
        # A symlinked (not zip-installed) GNOME extension needs the compiled schema to load.
        subprocess.run(["glib-compile-schemas", "--strict", str(out / "schemas")], check=True)
    return out


def main(argv):
    target = argv[1] if len(argv) > 1 else "all"
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
