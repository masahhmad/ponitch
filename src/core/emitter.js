// Minimal change notification shared by the services: subscribe(cb) -> unsubscribe.
var Emitter = class Emitter {
    constructor() {
        this._listeners = new Set();
    }

    subscribe(cb) {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    _emit() {
        for (const cb of this._listeners) {
            try {
                cb(this);
            } catch (e) {
                console.warn(`ponitch: listener failed: ${e.message}`);
            }
        }
    }
};

// Disconnect signal handlers through GObject itself: some GI classes define their own
// disconnect() with another meaning (NM.Device.disconnect() takes the device off the network).
function disconnectAll(gi, obj, ids) {
    if (obj)
        ids.forEach(id => gi.GObject.signal_handler_disconnect(obj, id));
}

// Async D-Bus proxy that calls onChange when its properties change or its owner (dis)appears.
// get() returns null while the service is not running, so callers can hide what is missing.
function watchProxy(gi, busType, name, path, iface, onChange) {
    const { Gio, GLib } = gi;
    const h = { proxy: null, ids: [], cancel: new Gio.Cancellable() };
    const done = (p, r) => {
        try {
            p.call_finish(r);
        } catch (e) {
            console.warn(`ponitch: ${iface}: ${e.message}`);
        }
    };
    Gio.DBusProxy.new_for_bus(busType, Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES, null, name, path, iface, h.cancel, (_o, res) => {
        try {
            h.proxy = Gio.DBusProxy.new_for_bus_finish(res);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`ponitch: ${name} unavailable: ${e.message}`);
            return;
        }
        h.ids.push(h.proxy.connect('g-properties-changed', () => onChange()));
        h.ids.push(h.proxy.connect('notify::g-name-owner', () => onChange()));
        onChange();
    });
    h.available = () => !!(h.proxy && h.proxy.g_name_owner);
    h.get = key => {
        if (!h.available())
            return null;
        const v = h.proxy.get_cached_property(key);
        return v ? v.recursiveUnpack() : null;
    };
    // cb(result unpacked) is optional.
    h.call = (method, args, cb) => {
        if (!h.available())
            return;
        h.proxy.call(method, args, Gio.DBusCallFlags.NONE, -1, null, (p, r) => {
            if (!cb)
                return done(p, r);
            try {
                cb(p.call_finish(r).recursiveUnpack());
            } catch (e) {
                console.warn(`ponitch: ${iface}.${method}: ${e.message}`);
            }
        });
    };
    h.setProp = (key, variant) => {
        if (!h.available())
            return;
        h.proxy.call('org.freedesktop.DBus.Properties.Set', new GLib.Variant('(ssv)', [iface, key, variant]),
            Gio.DBusCallFlags.NONE, -1, null, done);
    };
    h.destroy = () => {
        h.cancel.cancel();
        disconnectAll(gi, h.proxy, h.ids);
        h.proxy = null;
    };
    return h;
}

module.exports = { Emitter, watchProxy, disconnectAll };
