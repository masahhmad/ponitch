// Wi-Fi through libnm (NM.Client): radio switch, current network, scan + connect.
const { Emitter, disconnectAll } = require('./emitter');

var NetworkService = class NetworkService extends Emitter {
    constructor(platform) {
        super();
        this._gi = platform.gi;
        this._client = null;
        this._devIds = new Map(); // device -> signal ids
    }

    start() {
        const { NM, Gio } = this._gi;
        this._cancel = new Gio.Cancellable();
        NM.Client.new_async(this._cancel, (_o, res) => {
            try {
                this._client = NM.Client.new_finish(res);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`ponitch: NetworkManager unavailable: ${e.message}`);
                return;
            }
            const changed = () => this._emit();
            this._ids = ['notify::wireless-enabled', 'notify::wireless-hardware-enabled', 'notify::nm-running',
                'notify::primary-connection'].map(s => this._client.connect(s, changed));
            this._ids.push(this._client.connect('device-added', () => this._watchDevices()));
            this._ids.push(this._client.connect('device-removed', () => this._watchDevices()));
            this._watchDevices();
        });
    }

    stop() {
        this._cancel.cancel();
        if (this._client) {
            disconnectAll(this._gi, this._client, this._ids);
            this._devIds.forEach((ids, dev) => disconnectAll(this._gi, dev, ids));
        }
        if (this._apId)
            disconnectAll(this._gi, this._ap, [this._apId]);
        this._ap = null;
        this._devIds.clear();
        this._client = null;
    }

    _wifiDevices() {
        const { NM } = this._gi;
        return this._client ? this._client.get_devices().filter(d => d.get_device_type() === NM.DeviceType.WIFI) : [];
    }

    _watchDevices() {
        this._devIds.forEach((ids, dev) => disconnectAll(this._gi, dev, ids));
        this._devIds.clear();
        const changed = () => this._emit();
        for (const dev of this._wifiDevices()) {
            this._devIds.set(dev, ['notify::active-access-point', 'notify::state', 'access-point-added', 'access-point-removed']
                .map(s => dev.connect(s, changed)));
        }
        this._watchActiveAp();
        this._emit();
    }

    _watchActiveAp() {
        if (this._apId)
            disconnectAll(this._gi, this._ap, [this._apId]);
        const dev = this._wifiDevices()[0];
        this._ap = dev ? dev.get_active_access_point() : null;
        this._apId = this._ap ? this._ap.connect('notify::strength', () => this._emit()) : 0;
    }

    _emit() {
        const dev = this._wifiDevices()[0];
        if ((dev ? dev.get_active_access_point() : null) !== this._ap)
            this._watchActiveAp();
        super._emit();
    }

    _ssid(ap) {
        const bytes = ap && ap.get_ssid();
        return bytes ? this._gi.NM.utils_ssid_to_utf8(bytes.get_data()) : '';
    }

    // null: no Wi-Fi hardware. Otherwise { enabled, hardware, ssid, strength }.
    get wifi() {
        const dev = this._wifiDevices()[0];
        if (!this._client || !dev)
            return null;
        const ap = dev.get_active_access_point();
        return {
            enabled: this._client.wireless_enabled,
            hardware: this._client.wireless_hardware_enabled,
            ssid: this._ssid(ap),
            strength: ap ? ap.get_strength() : 0,
        };
    }

    // Visible networks, strongest first, one entry per SSID.
    get networks() {
        const dev = this._wifiDevices()[0];
        if (!dev)
            return [];
        const active = this._ssid(dev.get_active_access_point());
        const best = new Map();
        for (const ap of dev.get_access_points()) {
            const ssid = this._ssid(ap);
            if (ssid && (!best.has(ssid) || ap.get_strength() > best.get(ssid).get_strength()))
                best.set(ssid, ap);
        }
        return [...best.entries()].map(([ssid, ap]) => ({
            ssid, strength: ap.get_strength(), active: ssid === active,
            secure: ap.get_wpa_flags() !== 0 || ap.get_rsn_flags() !== 0,
        })).sort((a, b) => (b.active - a.active) || (b.strength - a.strength));
    }

    setEnabled(on) {
        const { NM, GLib } = this._gi;
        if (!this._client)
            return;
        this._client.dbus_set_property(NM.DBUS_PATH, NM.DBUS_INTERFACE, 'WirelessEnabled', new GLib.Variant('b', on), -1, null, (c, r) => {
            try {
                c.dbus_set_property_finish(r);
            } catch (e) {
                console.warn(`ponitch: wifi switch: ${e.message}`);
            }
        });
    }

    // Only while the Wi-Fi list is visible (PLAN.md §4.3); results arrive as access-point-added.
    scan() {
        const dev = this._wifiDevices()[0];
        if (dev)
            dev.request_scan_async(null, (d, r) => {
                try {
                    d.request_scan_finish(r);
                } catch (e) {
                    // NM rate-limits scans; an "in progress"/"not allowed" error is harmless.
                }
            });
    }

    // Saved network: activate it. New network: add-and-activate; the desktop's own secret
    // agent asks for the password.
    connect(ssid) {
        const dev = this._wifiDevices()[0];
        if (!this._client || !dev)
            return;
        const ap = dev.get_access_points().filter(a => this._ssid(a) === ssid)
            .sort((a, b) => b.get_strength() - a.get_strength())[0];
        if (!ap)
            return;
        const saved = this._client.get_connections().find(c => {
            const w = c.get_setting_wireless();
            return w && w.get_ssid() && this._gi.NM.utils_ssid_to_utf8(w.get_ssid().get_data()) === ssid;
        });
        const report = (c, r, finish) => {
            try {
                c[finish](r);
            } catch (e) {
                console.warn(`ponitch: connect to wifi failed: ${e.message}`);
            }
        };
        if (saved)
            this._client.activate_connection_async(saved, dev, ap.get_path(), null, (c, r) => report(c, r, 'activate_connection_finish'));
        else
            this._client.add_and_activate_connection_async(null, dev, ap.get_path(), null, (c, r) => report(c, r, 'add_and_activate_connection_finish'));
    }
};

module.exports = { NetworkService };
