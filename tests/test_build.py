#!/usr/bin/env python3
"""python3 tests/test_build.py: checks the core/adapter split and the GNOME ESM conversion."""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402

core = sorted((ROOT / "src" / "core").glob("*.js"))
assert core, "no core modules found"

# Core must stay platform-neutral: shell objects come in through `platform`.
for p in core:
    hits = re.findall(r"\bimports\.|\bMain\.|\bglobal\b", p.read_text())
    assert not hits, f"{p.name} uses shell-specific {hits}"

# Every core module converts to ESM, and node accepts the result as a module.
with tempfile.TemporaryDirectory() as tmp:
    for p in core:
        esm = build.to_esm(p.read_text(), p.name)
        assert "export {" in esm and "require(" not in esm, p.name
        mjs = Path(tmp) / (p.stem + ".mjs")
        mjs.write_text(esm)
        r = subprocess.run(["node", "--check", str(mjs)], capture_output=True, text=True)
        assert r.returncode == 0, f"{p.name} is not valid ESM:\n{r.stderr}"

# Imports are rewritten with the .js suffix GNOME's loader needs.
assert build.to_esm("const { A } = require('./a');\nmodule.exports = { B };", "x") == \
    "import { A } from './a.js';\nexport { B };"

# Forms the converter doesn't understand must fail loudly instead of shipping broken GNOME code.
for bad in ("const a = require('./a').a;\nmodule.exports = { a };",
            "module.exports = { a };\nmodule.exports = { b };",
            "const { a } = require('../up');\nmodule.exports = { a };",
            "exports.a = 1;"):
    try:
        build.to_esm(bad, "bad.js")
    except build.BuildError:
        pass
    else:
        raise AssertionError(f"accepted unsupported form: {bad!r}")

# Cinnamon build is flat and its metadata matches the uuid the build uses.
out = build.build("cinnamon")
names = {p.name for p in out.iterdir()}
assert {"extension.js", "platform.js", "metadata.json", "stylesheet.css"} <= names, names
assert {p.name for p in core} <= names, names
assert json.loads((out / "metadata.json").read_text())["uuid"] == build.UUID

# GNOME build: ESM everywhere, compiled schema, and the same setting keys on both desktops.
out = build.build("gnome")
names = {p.name for p in out.iterdir()}
assert {"extension.js", "platform.js", "prefs.js", "metadata.json", "stylesheet.css", "schemas"} <= names, names
assert (out / "schemas" / "gschemas.compiled").exists()
with tempfile.TemporaryDirectory() as tmp:
    for p in out.glob("*.js"):
        js = p.read_text()
        assert "require(" not in js and "module.exports" not in js and "imports." not in js, p.name
        mjs = Path(tmp) / (p.stem + ".mjs")
        mjs.write_text(js)
        r = subprocess.run(["node", "--check", str(mjs)], capture_output=True, text=True)
        assert r.returncode == 0, f"gnome/{p.name} is not valid ESM:\n{r.stderr}"
meta = json.loads((out / "metadata.json").read_text())
assert meta["uuid"] == build.UUID and meta["settings-schema"] == "org.gnome.shell.extensions.ponitch"

cinnamon_keys = {k for k, v in json.loads((ROOT / "src/cinnamon/settings-schema.json").read_text()).items() if v["type"] != "header"}
gnome_keys = set(re.findall(r'<key name="([a-z-]+)"', (ROOT / "src/gnome/schemas/org.gnome.shell.extensions.ponitch.gschema.xml").read_text()))
assert cinnamon_keys == gnome_keys, f"schemas differ: {cinnamon_keys ^ gnome_keys}"
app_keys = set(re.findall(r"\['([a-z-]+)', '[A-Za-z]+', ", (ROOT / "src/core/app.js").read_text()))
assert app_keys | {"toggle-key"} == cinnamon_keys, f"App SETTINGS vs schema: {app_keys ^ (cinnamon_keys - {'toggle-key'})}"
# Translations: both builds ship the compiled catalogues; the template lists every string the
# core marks, and each .po translates all of them (msgcmp fails on a missing msgid).
pot = (ROOT / "po" / "ponitch.pot").read_text().replace('"\n"', "").replace('\\"', '"')  # join wrapped lines, unescape
for p in sorted((ROOT / "src").rglob("*.js")):
    for msgid in re.findall(r"\bN?_\('((?:[^'\\]|\\.)+)'", p.read_text()):
        assert f'msgid "{msgid}"' in pot, \
            f"{p.name}: {msgid!r} missing from po/ponitch.pot (run python3 build.py pot, then msgmerge)"
for po in (ROOT / "po").glob("*.po"):
    subprocess.run(["msgcmp", str(po), str(ROOT / "po" / "ponitch.pot")], check=True)
    for desktop in build.DESKTOPS:
        assert (build.DIST / desktop / build.UUID / "locale" / po.stem / "LC_MESSAGES" / f"{build.UUID}.mo").exists(), (desktop, po)
assert 'gettext-domain="ponitch@masahhmad"' in (ROOT / "src/gnome/schemas/org.gnome.shell.extensions.ponitch.gschema.xml").read_text()

print("test_build: ok")
