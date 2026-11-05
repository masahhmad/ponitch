// Battery (UPower), power profile (power-profiles-daemon) and keep-awake (session inhibitor).
const { Emitter, watchProxy } = require('./emitter');

const INHIBIT_SUSPEND_AND_IDLE = 4 | 8;

var PowerService = class PowerService extends Emitter {
    constructor(platform) {
        super();
        this._gi = platform.gi;
        this._cookie = 0;
    }

    start() {
        const { Gio } = this._gi;
        const changed = () => this._emit();
        this._battery = watchProxy(this._gi, Gio.BusType.SYSTEM, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', 'org.freedesktop.UPower.Device', changed);
        // Legacy name; still provided by current power-profiles-daemon. Re-check on GNOME 49 (MG).
        this._profiles = watchProxy(this._gi, Gio.BusType.SYSTEM, 'net.hadess.PowerProfiles',
            '/net/hadess/PowerProfiles', 'net.hadess.PowerProfiles', changed);
        this._session = watchProxy(this._gi, Gio.BusType.SESSION, 'org.gnome.SessionManager',
            '/org/gnome/SessionManager', 'org.gnome.SessionManager', changed);
    }

    stop() {
        this.setKeepAwake(false);
        [this._battery, this._profiles, this._session].forEach(h => h && h.destroy());
    }

    // { percent, charging } or null when there is no battery (desktop PC).
    get battery() {
        if (!this._battery || !this._battery.get('IsPresent'))
            return null;
        const state = this._battery.get('State'); // 1 charging, 4 fully charged
        return { percent: Math.round(this._battery.get('Percentage') || 0), charging: state === 1 || state === 4, icon: this._battery.get('IconName') };
    }

    // { active, available: ['power-saver', 'balanced', 'performance'] } or null.
    get profile() {
        const active = this._profiles && this._profiles.get('ActiveProfile');
        if (!active)
            return null;
        return { active, available: (this._profiles.get('Profiles') || []).map(p => p.Profile) };
    }

    setProfile(name) {
        this._profiles.setProp('ActiveProfile', new this._gi.GLib.Variant('s', name));
    }

    get keepAwake() {
        return this._want === true;
    }

    // The inhibitor lives on our D-Bus connection, so it also ends if the shell restarts.
    setKeepAwake(on) {
        const { GLib } = this._gi;
        this._want = on;
        if (on && !this._cookie && !this._pending && this._session && this._session.available()) {
            this._pending = true;
            this._session.call('Inhibit', new GLib.Variant('(susu)', ['ponitch', 0, 'Keep awake (ponitch)', INHIBIT_SUSPEND_AND_IDLE]), ([cookie]) => {
                this._pending = false;
                this._cookie = cookie;
                if (!this._want) // switched off while the request was in flight
                    this.setKeepAwake(false);
                this._emit();
            });
        } else if (!on && this._cookie) {
            this._session.call('Uninhibit', new GLib.Variant('(u)', [this._cookie]));
            this._cookie = 0;
        }
        this._emit();
    }
};

module.exports = { PowerService };
