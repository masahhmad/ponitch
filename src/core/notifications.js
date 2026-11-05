// Desktop notifications shown in the notch (PLAN.md §4.8). The platform hands over each
// notification as an `info` object (see platform.interceptNotifications); this keeps the live
// list for the Notifications tab and an optional local history file.
const { Emitter } = require('./emitter');
const { initStore, dataPath, readJson, writeJson } = require('./store');

const LIVE_MAX = 50;
const HISTORY_MAX = 500;
const BODY_MAX = 500;

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

module.exports = { NotificationService };
