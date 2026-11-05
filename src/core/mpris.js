// MPRIS players on the session bus (PLAN.md §4.2). Event-driven: NameOwnerChanged for players
// appearing/leaving, PropertiesChanged/Seeked per player. Nothing runs while no player exists.
const { dominantColor } = require('./color');

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const ART_CACHE_MAX = 50;

let Gio, GLib, GdkPixbuf, GObject;

var MprisService = class MprisService {
    constructor(platform) {
        ({ Gio, GLib, GdkPixbuf, GObject } = platform.gi);
        this._players = new Map(); // bus name -> player record
        this._listeners = new Set();
        this._art = new Map();     // artUrl -> { path, accent } once resolved
        this._artDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ponitch', 'art']);
        this.current = null;       // snapshot of the active player, see _snapshot()
    }

    // cb(current) on every change; returns an unsubscribe function.
    subscribe(cb) {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    start() {
        this._bus = Gio.DBus.session;
        this._cancel = new Gio.Cancellable();
        this._nameSub = this._bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _sig, params) => {
                const [name, oldOwner, newOwner] = params.deep_unpack();
                if (!name.startsWith(PREFIX))
                    return;
                if (oldOwner)
                    this._remove(name);
                if (newOwner)
                    this._add(name);
            });
        this._bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, this._cancel, (bus, res) => {
                try {
                    const [names] = bus.call_finish(res).deep_unpack();
                    names.filter(n => n.startsWith(PREFIX)).forEach(n => this._add(n));
                } catch (e) {
                    this._log('ListNames failed', e);
                }
            });
        GLib.mkdir_with_parents(this._artDir, 0o700);
    }

    stop() {
        if (!this._bus)
            return;
        this._cancel.cancel();
        this._bus.signal_unsubscribe(this._nameSub);
        [...this._players.keys()].forEach(n => this._remove(n, true));
        this._bus = null;
        this.current = null;
    }

    // --- controls (no-ops when there is no active player) ---

    playPause() { this._callActive('PlayPause'); }
    next() { this._callActive('Next'); }
    previous() { this._callActive('Previous'); }

    // Seek to an absolute position in microseconds.
    setPosition(us) {
        const p = this._activePlayer();
        if (!p || !p.proxy)
            return;
        const s = this._snapshot(p);
        us = Math.max(0, Math.min(Math.round(us), s.length || us));
        if (s.trackId && s.trackId.startsWith('/')) {
            this._call(p, 'SetPosition', new GLib.Variant('(ox)', [s.trackId, us]));
        } else {
            // No usable track id (some browsers): fall back to a relative Seek.
            this._call(p, 'Seek', new GLib.Variant('(x)', [us - this.position()]));
        }
        p.pos = { us, at: GLib.get_monotonic_time() };
    }

    // Best estimate of the active player's position in µs, without a D-Bus round trip
    // (MPRIS does not signal Position changes; it is extrapolated from the last known value).
    position() {
        const p = this._activePlayer();
        if (!p || !p.pos)
            return 0;
        const s = this._snapshot(p);
        if (s.status !== 'Playing')
            return p.pos.us;
        const rate = s.rate || 1;
        const us = p.pos.us + (GLib.get_monotonic_time() - p.pos.at) * rate;
        return s.length ? Math.min(us, s.length) : us;
    }

    // Re-read Position from the active player (call when a progress view opens).
    refreshPosition() {
        const p = this._activePlayer();
        if (p && p.proxy)
            this._fetchPosition(p);
    }

    // Make the next player (in discovery order) the active one.
    cyclePlayer() {
        const names = [...this._players.keys()].filter(n => this._players.get(n).proxy);
        if (names.length < 2)
            return;
        const i = names.indexOf(this._activeName);
        this._activeName = names[(i + 1) % names.length];
        this._emit();
    }

    // --- internals ---

    _add(name) {
        if (this._players.has(name))
            return;
        const p = { name, proxy: null, identity: name.slice(PREFIX.length).split('.')[0], playedAt: 0, pos: null, cancel: new Gio.Cancellable() };
        this._players.set(name, p);
        Gio.DBusProxy.new(this._bus, Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES, null, name, PATH, PLAYER_IFACE,
            p.cancel, (_o, res) => {
                try {
                    p.proxy = Gio.DBusProxy.new_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._log(`proxy for ${name} failed`, e);
                    return;
                }
                p.propsId = p.proxy.connect('g-properties-changed', (_px, changed) => {
                    const keys = Object.keys(changed.deep_unpack());
                    if (keys.includes('PlaybackStatus') || keys.includes('Metadata'))
                        this._fetchPosition(p);
                    this._onPlayerChanged(p);
                });
                p.signalId = p.proxy.connect('g-signal', (_px, _sender, signal, params) => {
                    if (signal === 'Seeked') {
                        p.pos = { us: params.deep_unpack()[0], at: GLib.get_monotonic_time() };
                        this._emit();
                    }
                });
                this._fetchIdentity(p);
                this._fetchPosition(p);
                this._onPlayerChanged(p);
            });
    }

    _remove(name, quiet = false) {
        const p = this._players.get(name);
        if (!p)
            return;
        p.cancel.cancel();
        if (p.proxy) {
            GObject.signal_handler_disconnect(p.proxy, p.propsId);
            GObject.signal_handler_disconnect(p.proxy, p.signalId);
        }
        this._players.delete(name);
        if (this._activeName === name)
            this._activeName = null;
        if (!quiet)
            this._emit();
    }

    _onPlayerChanged(p) {
        const s = this._snapshot(p);
        if (s.status === 'Playing') {
            if (!p.playedAt)
                p.playedAt = GLib.get_monotonic_time();
            // The player that most recently started playing becomes active.
            const active = this._activePlayer();
            if (!active || active === p || this._snapshot(active).status !== 'Playing' || p.playedAt > active.playedAt)
                this._activeName = p.name;
        } else {
            p.playedAt = 0;
        }
        if (s.artUrl)
            this._resolveArt(s.artUrl);
        this._emit();
    }

    _activePlayer() {
        let p = this._activeName && this._players.get(this._activeName);
        if (p && p.proxy)
            return p;
        // Fallback: any playing player, else any player that has a track loaded.
        const ready = [...this._players.values()].filter(x => x.proxy);
        p = ready.find(x => this._snapshot(x).status === 'Playing') || ready.find(x => this._snapshot(x).title);
        this._activeName = p ? p.name : null;
        return p || null;
    }

    _prop(p, key) {
        const v = p.proxy.get_cached_property(key);
        return v ? v.recursiveUnpack() : null;
    }

    // Metadata entries unpacked one by one: browsers report live streams with mpris:length =
    // INT64_MAX, which can't be a JS number (GJS warns on every read). Such values become 0.
    _metadata(p) {
        const v = p.proxy.get_cached_property('Metadata');
        const md = {};
        for (let i = 0; v && i < v.n_children(); i++) {
            const [key, val] = v.get_child_value(i).deep_unpack();
            if (['x', 't'].includes(val.get_type_string())) {
                const n = Number(val.print(false).replace(/^(u?int64|uint64)\s+/, ''));
                md[key] = Number.isSafeInteger(n) ? n : 0;
            } else {
                md[key] = val.recursiveUnpack();
            }
        }
        return md;
    }

    _snapshot(p) {
        const md = this._metadata(p);
        const artist = md['xesam:artist'];
        const artUrl = md['mpris:artUrl'] || null;
        const art = artUrl && this._art.get(artUrl);
        return {
            name: p.name,
            identity: p.identity,
            status: this._prop(p, 'PlaybackStatus') || 'Stopped',
            title: md['xesam:title'] || '',
            artist: Array.isArray(artist) ? artist.join(', ') : (artist || ''),
            album: md['xesam:album'] || '',
            trackId: md['mpris:trackid'] || null,
            length: Number(md['mpris:length']) || 0,
            artUrl,
            artPath: art ? art.path : null,
            accent: art ? art.accent : null,
            rate: Number(this._prop(p, 'Rate')) || 1,
            canNext: this._prop(p, 'CanGoNext') !== false,
            canPrevious: this._prop(p, 'CanGoPrevious') !== false,
            canSeek: this._prop(p, 'CanSeek') === true,
            players: [...this._players.values()].filter(x => x.proxy).length,
        };
    }

    _emit() {
        const p = this._activePlayer();
        this.current = p ? this._snapshot(p) : null;
        for (const cb of this._listeners) {
            try {
                cb(this.current);
            } catch (e) {
                this._log('listener failed', e);
            }
        }
    }

    _callActive(method) {
        const p = this._activePlayer();
        if (p && p.proxy)
            this._call(p, method, null);
    }

    _call(p, method, args) {
        p.proxy.call(method, args, Gio.DBusCallFlags.NONE, -1, null, (px, res) => {
            try {
                px.call_finish(res);
            } catch (e) {
                this._log(`${method} on ${p.name} failed`, e);
            }
        });
    }

    _getProp(p, iface, key, cb) {
        this._bus.call(p.name, PATH, 'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', [iface, key]),
            null, Gio.DBusCallFlags.NONE, -1, p.cancel, (bus, res) => {
                try {
                    cb(bus.call_finish(res).deep_unpack()[0].recursiveUnpack());
                } catch (e) {
                    // Players may not implement optional properties; nothing to do.
                }
            });
    }

    _fetchPosition(p) {
        this._getProp(p, PLAYER_IFACE, 'Position', us => {
            p.pos = { us: Number(us) || 0, at: GLib.get_monotonic_time() };
            if (this._activeName === p.name)
                this._emit();
        });
    }

    _fetchIdentity(p) {
        this._getProp(p, 'org.mpris.MediaPlayer2', 'Identity', id => {
            if (typeof id === 'string' && id)
                p.identity = id;
        });
    }

    // Local copy of the cover (http(s) through GVfs, file:// as is) plus its accent colour.
    _resolveArt(url) {
        if (this._art.has(url))
            return;
        this._art.set(url, null); // in flight
        const src = Gio.File.new_for_uri(url);
        const done = (path, downloaded = false) => this._accentOf(path, accent => {
            this._art.set(url, { path, accent });
            this._emit();
            // Prune only after recording the new cover as in use, so it can't be the one deleted.
            if (downloaded)
                this._pruneArt();
        });
        if (src.get_uri_scheme() === 'file') {
            // A missing local cover would make St retry (and warn) on every restyle; show none.
            if (!src.query_exists(null))
                return this._art.set(url, { path: null, accent: null });
            return done(src.get_path());
        }
        if (!['http', 'https'].includes(src.get_uri_scheme())) {
            this._art.delete(url);
            return;
        }
        const dest = Gio.File.new_for_path(GLib.build_filenamev([this._artDir, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)]));
        if (dest.query_exists(null))
            return done(dest.get_path());
        src.copy_async(dest, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_LOW, this._cancel, null, (f, res) => {
            try {
                f.copy_finish(res);
                done(dest.get_path(), true);
            } catch (e) {
                this._art.delete(url); // retry on the next change
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    this._log(`cover download failed (${url.split('?')[0]})`, e);
            }
        });
    }

    _accentOf(path, cb) {
        Gio.File.new_for_path(path).read_async(GLib.PRIORITY_LOW, this._cancel, (f, res) => {
            try {
                const stream = f.read_finish(res);
                GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 16, 16, false, this._cancel, (_s, r) => {
                    try {
                        const pb = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                        cb(dominantColor(pb.get_pixels(), pb.get_width(), pb.get_height(), pb.get_rowstride(), pb.get_n_channels()));
                    } catch (e) {
                        cb(null); // not an image we can decode; keep the cover, no accent
                    }
                    stream.close_async(GLib.PRIORITY_LOW, null, null);
                });
            } catch (e) {
                cb(null);
            }
        });
    }

    // Keep at most ART_CACHE_MAX downloaded covers, newest first. Sorted by ctime: a download can
    // carry the server's Last-Modified as mtime, but ctime is always when the file landed here.
    _pruneArt() {
        const dir = Gio.File.new_for_path(this._artDir);
        dir.enumerate_children_async('standard::name,time::changed', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, this._cancel, (d, res) => {
            let en;
            try {
                en = d.enumerate_children_finish(res);
            } catch (e) {
                return;
            }
            en.next_files_async(1000, GLib.PRIORITY_LOW, this._cancel, (e2, r2) => {
                let infos = [];
                try {
                    infos = e2.next_files_finish(r2);
                } catch (e) {
                    return;
                }
                infos.sort((a, b) => b.get_attribute_uint64('time::changed') - a.get_attribute_uint64('time::changed'));
                // Never delete a cover that is in use: it may be the oldest file and still on screen.
                const inUse = new Set([...this._art.values()].filter(Boolean).map(a => a.path));
                for (const info of infos.slice(ART_CACHE_MAX)) {
                    const f = dir.get_child(info.get_name());
                    if (!inUse.has(f.get_path()))
                        f.delete_async(GLib.PRIORITY_LOW, null, null);
                }
                e2.close_async(GLib.PRIORITY_LOW, null, null);
            });
        });
    }

    _log(msg, e) {
        console.warn(`ponitch: mpris: ${msg}: ${e && e.message}`);
    }
};

module.exports = { MprisService };
