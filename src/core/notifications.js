// Desktop notifications shown in the notch (PLAN.md §4.8). The platform hands over each
// notification as an `info` object (see platform.interceptNotifications); this keeps the live
// list for the Notifications tab and an optional local history file.
const { Emitter } = require('./emitter');
const { initStore, dataPath, readJson, writeJson } = require('./store');

const LIVE_MAX = 50;
const HISTORY_MAX = 500;
const BODY_MAX = 500;

// Chromium-based browsers (WhatsApp Web, etc.) XML-escape the title they send ("Ya&apos;kub"),
// but the spec makes the title plain text, so the desktop shows the entity as typed. Decode
// once: named XML entities, &nbsp; and numeric references; anything else is left as written.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
        if (e[0] !== '#')
            return NAMED[e.toLowerCase()] !== undefined ? NAMED[e.toLowerCase()] : m;
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
    });
}

var NotificationService = class NotificationService extends Emitter {
    // cfg: { history: bool }
    constructor(platform, cfg) {
        super();
        initStore(platform.gi);
        this.cfg = cfg;
        this.items = []; // newest first: info + { time }
        this._history = null;
        this._file = dataPath('notifications.json');
    }

    start() {
        if (this.cfg.history)
            readJson(this._file, (list, broken) => {
                // A damaged history is simply restarted; it is a log, not user-made data.
                this._history = Array.isArray(list) && !broken ? list : [];
            });
    }

    stop() {
        this.items = [];
    }

    // New or updated notification. Returns the live item.
    receive(info) {
        info = { ...info, title: decodeEntities(info.title || '') };
        let item = this.items.find(i => i.key === info.key);
        if (item) {
            Object.assign(item, info, { time: Date.now() }); // e.g. a progress notification updating
        } else {
            item = { ...info, time: Date.now() };
            this.items.unshift(item);
            this.items.length = Math.min(this.items.length, LIVE_MAX);
            info.onClosed(() => this._remove(info.key));
            this._record(item);
        }
        this._emit();
        return item;
    }

    dismiss(key) {
        const item = this.items.find(i => i.key === key);
        if (item)
            item.dismiss(); // closes it everywhere (applet too); onClosed removes it here
    }

    clear() {
        [...this.items].forEach(i => i.dismiss());
    }

    _remove(key) {
        const before = this.items.length;
        this.items = this.items.filter(i => i.key !== key);
        if (this.items.length !== before)
            this._emit();
    }

    _record(item) {
        if (!this.cfg.history || !this._history)
            return;
        this._history.push({ app: item.app, title: item.title, body: item.body.slice(0, BODY_MAX), time: item.time });
        if (this._history.length > HISTORY_MAX)
            this._history.splice(0, this._history.length - HISTORY_MAX);
        writeJson(this._file, this._history);
    }
};

module.exports = { NotificationService, decodeEntities };
