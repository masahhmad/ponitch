// BlueZ adapter power and paired devices (with battery when the device reports it).
const { Emitter, disconnectAll } = require('./emitter');

var BluetoothService = class BluetoothService extends Emitter {
    constructor(platform) {
        super();
        this._gi = platform.gi;
        this._manager = null;
    }

    start() {
        const { Gio } = this._gi;
        this._cancel = new Gio.Cancellable();
        Gio.DBusObjectManagerClient.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusObjectManagerClientFlags.NONE,
            'org.bluez', '/', null, this._cancel, (_o, res) => {
                try {
                    this._manager = Gio.DBusObjectManagerClient.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`ponitch: bluez unavailable: ${e.message}`);
                    return;
                }
                const changed = () => this._emit();
                this._ids = ['object-added', 'object-removed', 'interface-added', 'interface-removed',
                    'interface-proxy-properties-changed', 'notify::name-owner'].map(s => this._manager.connect(s, changed));
                this._emit();
            });
    }

    stop() {
        this._cancel.cancel();
        disconnectAll(this._gi, this._manager, this._ids || []);
        this._manager = null;
    }

    _ifaces(name) {
        if (!this._manager || !this._manager.name_owner)
            return [];
        return this._manager.get_objects().map(o => o.get_interface(name)).filter(Boolean);
    }

    _adapter() {
        return this._ifaces('org.bluez.Adapter1')[0] || null;
    }

    // null: no adapter (hide the tile). Otherwise { powered, devices: [{ path, name, icon, connected, battery }] }.
    get state() {
        const adapter = this._adapter();
        if (!adapter)
            return null;
        const prop = (p, k) => {
            const v = p.get_cached_property(k);
            return v ? v.recursiveUnpack() : null;
        };
        const devices = this._ifaces('org.bluez.Device1').filter(d => prop(d, 'Paired')).map(d => {
            const obj = this._manager.get_object(d.get_object_path());
            const bat = obj && obj.get_interface('org.bluez.Battery1');
            return {
                path: d.get_object_path(),
                name: prop(d, 'Alias') || prop(d, 'Name') || '?',
                icon: prop(d, 'Icon') || 'bluetooth',
                connected: !!prop(d, 'Connected'),
                battery: bat ? prop(bat, 'Percentage') : null,
            };
        });
        devices.sort((a, b) => (b.connected - a.connected) || a.name.localeCompare(b.name));
        return { powered: !!prop(adapter, 'Powered'), devices };
    }

    setPowered(on) {
        const adapter = this._adapter();
        if (adapter)
            this._call(adapter, 'org.freedesktop.DBus.Properties.Set', new this._gi.GLib.Variant('(ssv)', ['org.bluez.Adapter1', 'Powered', new this._gi.GLib.Variant('b', on)]));
    }

    toggleDevice(path) {
        const d = this._ifaces('org.bluez.Device1').find(x => x.get_object_path() === path);
        if (d) {
            const connected = d.get_cached_property('Connected');
            this._call(d, connected && connected.unpack() ? 'Disconnect' : 'Connect', null);
        }
    }

    _call(proxy, method, args) {
        // Connect can take tens of seconds; the result arrives as property changes anyway.
        proxy.call(method, args, this._gi.Gio.DBusCallFlags.NONE, 60000, null, (p, r) => {
            try {
                p.call_finish(r);
            } catch (e) {
                console.warn(`ponitch: bluez ${method}: ${e.message}`);
            }
        });
    }
};

module.exports = { BluetoothService };
