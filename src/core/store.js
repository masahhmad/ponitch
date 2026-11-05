// JSON files under ~/.local/share/ponitch (data) and ~/.cache/ponitch (cache). Async, and writes
// are atomic (replace_contents writes a temp file and renames), so a shell crash mid-write
// can't leave a half-written todo list.
let Gio, GLib;

function initStore(gi) {
    ({ Gio, GLib } = gi);
}

function dataPath(name) {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'ponitch', name]);
}

function cachePath(name) {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), 'ponitch', name]);
}

// cb(value, broken): value is the parsed JSON or null; broken is true when the file exists
// but could not be read or parsed (so callers must not overwrite it blindly).
function readJson(path, cb) {
    Gio.File.new_for_path(path).load_contents_async(null, (f, res) => {
        let value = null, broken = false;
        try {
            const [, bytes] = f.load_contents_finish(res);
            value = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            broken = !(e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND));
            if (broken)
                console.warn(`ponitch: could not read ${path}: ${e.message}`);
        }
        cb(value, broken);
    });
}

// Keep a damaged data file as <name>.broken-<time> instead of overwriting it.
function setAside(path) {
    const f = Gio.File.new_for_path(path);
    try {
        f.move(Gio.File.new_for_path(`${path}.broken-${Date.now()}`), Gio.FileCopyFlags.NONE, null, null);
    } catch (e) {
        console.warn(`ponitch: could not set aside ${path}: ${e.message}`);
    }
}

// One write per file at a time: overlapping async writes can finish out of order, letting an
// older list overwrite a newer one (lost a todo in M3 testing). While a write runs, only the
// latest value is kept and written next.
const writing = new Map(); // path -> latest value waiting, or undefined while idle-but-busy

function writeJson(path, value) {
    if (writing.has(path)) {
        writing.set(path, value);
        return;
    }
    writing.set(path, undefined);
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(value, null, 1)));
    Gio.File.new_for_path(path).replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (f, res) => {
        try {
            f.replace_contents_finish(res);
        } catch (e) {
            console.warn(`ponitch: could not write ${path}: ${e.message}`);
        }
        const next = writing.get(path);
        writing.delete(path);
        if (next !== undefined)
            writeJson(path, next);
    });
}

// GLib timers don't advance while the machine sleeps; services re-plan when it wakes up.
// Returns an unsubscribe function.
function onResume(cb) {
    const id = Gio.DBus.system.signal_subscribe('org.freedesktop.login1', 'org.freedesktop.login1.Manager', 'PrepareForSleep',
        '/org/freedesktop/login1', null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => {
            if (!params.deep_unpack()[0]) // false = waking up
                cb();
        });
    return () => Gio.DBus.system.signal_unsubscribe(id);
}

// One-shot timer at an absolute time (ms since epoch). Returns a cancel function.
function at(ms, cb) {
    const delay = Math.max(0, Math.min(ms - Date.now(), 24 * 3600 * 1000)); // re-planned daily anyway
    let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        id = 0;
        cb();
        return GLib.SOURCE_REMOVE;
    });
    return () => {
        if (id)
            GLib.source_remove(id);
        id = 0;
    };
}

module.exports = { initStore, dataPath, cachePath, readJson, writeJson, setAside, onResume, at };
