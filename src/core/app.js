// The whole extension minus what is shell-specific: notch, services, HUD/notification
// interception and the notchctl socket. Adapters (cinnamon/, gnome/) only map their settings
// into `cfg`, call changed(group) when a setting changes, and register the toggle shortcut.
const { Notch } = require('./notch');
const { IpcServer } = require('./ipc');
const { MprisService } = require('./mpris');
const { PowerService } = require('./power');
const { AudioService } = require('./audio');
const { NetworkService } = require('./network');
const { BluetoothService } = require('./bluetooth');
const { PrayerService } = require('./prayer');
const { PomodoroService } = require('./pomodoro');
const { TodoService } = require('./todo');
const { NotificationService } = require('./notifications');
const { stopSound } = require('./sound');

// [settings key, cfg property, what to redo when it changes]. Same keys on both desktops
// (Cinnamon settings-schema.json, GNOME gschema). The toggle shortcut is the adapter's job.
const SETTINGS = [
    ['shape', 'shape', 'look'],
    ['look-color', 'color', 'look'],
    ['look-opacity', 'opacity', 'look'],
    ['panel-width', 'panelWidth', 'look'],
    ['music-animate-eq', 'musicAnimateEq', 'look'],
    ['hover-opens-panel', 'hoverOpensPanel', null], // read live
    ['close-delay', 'closeDelay', null],
    ['hud-enabled', 'hudEnabled', 'hud'],
    ['music-enabled', 'musicEnabled', 'music'],
    ['control-enabled', 'controlEnabled', 'control'],
    ['prayer-enabled', 'prayerEnabled', 'features'],
    ['pomodoro-enabled', 'pomodoroEnabled', 'features'],
    ['todo-enabled', 'todoEnabled', 'features'],
    ['notifications-enabled', 'notificationsEnabled', 'features'],
    ['notifications-history', 'notificationsHistory', 'features'],
    ['prayer-city', 'prayerCity', 'prayer'],
    ['prayer-lat', 'prayerLat', 'prayer'],
    ['prayer-lon', 'prayerLon', 'prayer'],
    ['prayer-method', 'prayerMethod', 'prayer'],
    ['prayer-asr', 'prayerAsr', 'prayer'],
    ['prayer-adzan-file', 'prayerAdzanFile', 'prayer'],
];

var App = class App {
    constructor(platform, cfg) {
        this._platform = platform;
        this.cfg = cfg;
        this.notch = null;
    }

    enable() {
        this.notch = new Notch(this._platform, this.cfg);
        this._bindHud();
        this._bindMusic();
        this._bindControl();
        this._bindFeatures();
        this._ipc = new IpcServer(this._platform, req => this._handleRequest(req));
        try {
            this._ipc.start();
        } catch (e) {
            // The notch still works without notchctl; don't fail the whole extension.
            console.warn(`ponitch: IPC disabled: ${e.message}`);
            this._ipc = null;
        }
    }

    // Each step runs even if an earlier one throws; a half-done teardown leaves a second notch,
    // a chained OSD/notification patch and a stale socket behind on the next enable.
    disable() {
        const steps = [
            () => this._stopControl(),
            () => this._stopFeatures(),
            stopSound, // the adhan must not outlive the extension
            () => this._music && this._music.stop(),
            () => this._undoOsd && this._undoOsd(),
            () => this._ipc && this._ipc.stop(),
            () => this.notch && this.notch.destroy(),
        ];
        for (const step of steps) {
            try {
                step();
            } catch (e) {
                console.warn(`ponitch: disable step failed: ${e}`);
            }
        }
        this._control = this._features = this._music = this._undoOsd = this._ipc = this.notch = null;
    }

    toggle() {
        this.notch.toggle();
    }

    changed(group) {
        switch (group) {
        case 'look': return this.notch.applyConfig();
        case 'hud': return this._bindHud();
        case 'music': return this._bindMusic();
        case 'control': return this._bindControl();
        case 'features': return this._bindFeatures();
        case 'prayer': return this._applyPrayerConfig();
        }
    }

    _bindHud() {
        if (this._undoOsd)
            this._undoOsd();
        this._undoOsd = this.cfg.hudEnabled ? this._platform.interceptOsd(info => this.notch.showHud(info)) : null;
    }

    // Music off means no D-Bus subscription at all (PLAN.md §3, services).
    _bindMusic() {
        if (this._music) {
            this.notch.setMusic(null);
            this._music.stop();
            this._music = null;
        }
        if (!this.cfg.musicEnabled)
            return;
        this._music = new MprisService(this._platform);
        this._music.start();
        this.notch.setMusic(this._music);
    }

    // Prayer, pomodoro, todo and notifications run while enabled: they drive the closed notch.
    _bindFeatures() {
        this._stopFeatures();
        const c = this.cfg, p = this._platform;
        this._features = {
            prayer: c.prayerEnabled ? new PrayerService(p, this._prayerConfig()) : null,
            pomodoro: c.pomodoroEnabled ? new PomodoroService(p) : null,
            todo: c.todoEnabled ? new TodoService(p) : null,
            notifications: c.notificationsEnabled ? new NotificationService(p, { history: c.notificationsHistory }) : null,
        };
        Object.values(this._features).forEach(svc => svc && svc.start());
        this.notch.setFeatures(this._features);
        const notifs = this._features.notifications;
        if (notifs)
            this._undoNotifications = p.interceptNotifications(info => {
                const item = notifs.receive(info);
                // Do not disturb hides banners but keeps the notification (tab + desktop list).
                if (p.dnd.get() && info.urgency !== 'critical')
                    return true;
                return this.notch.showBanner(item);
            });
    }

    _stopFeatures() {
        if (this._undoNotifications)
            this._undoNotifications();
        this._undoNotifications = null;
        if (this._features)
            Object.values(this._features).forEach(svc => svc && svc.stop());
        this._features = null;
    }

    _prayerConfig() {
        const c = this.cfg;
        // A file chooser may store a file:// URI or a plain path.
        const file = c.prayerAdzanFile ? this._platform.gi.Gio.File.new_for_commandline_arg(String(c.prayerAdzanFile)).get_path() || '' : '';
        return { city: (c.prayerCity || '').trim(), lat: Number(c.prayerLat), lon: Number(c.prayerLon), method: c.prayerMethod, asr: c.prayerAsr, adzanFile: file };
    }

    _applyPrayerConfig() {
        if (this._features && this._features.prayer) {
            this._features.prayer.cfg = this._prayerConfig();
            this._features.prayer.refresh();
        }
    }

    // Control services start the first time the panel opens, then stay (they are event-driven).
    _bindControl() {
        this._stopControl();
        this.notch.setControl(this.cfg.controlEnabled ? () => this._ensureControl() : null);
    }

    _ensureControl() {
        if (!this._control) {
            const p = this._platform;
            this._control = { power: new PowerService(p), audio: new AudioService(p), network: new NetworkService(p), bluetooth: new BluetoothService(p) };
            Object.values(this._control).forEach(svc => svc.start());
        }
        return this._control;
    }

    _stopControl() {
        if (this._control)
            Object.values(this._control).forEach(svc => svc.stop());
        this._control = null;
    }

    _handleRequest(req) {
        const n = this.notch;
        switch (req.cmd) {
        case 'toggle': n.toggle(); break;
        case 'open': case 'close': case 'tuck': case 'untuck':
            n.setState({ open: 'open', close: 'closed', tuck: 'tucked', untuck: 'closed' }[req.cmd]);
            break;
        case 'pin': case 'unpin':
            n.setPinned(req.cmd === 'pin');
            break;
        case 'state': break;
        default: return { ok: false, error: `unknown cmd: ${req.cmd}` };
        }
        return { ok: true, state: n.state };
    }
};

module.exports = { App, SETTINGS };
