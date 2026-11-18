// Cinnamon side of the platform interface used by core (PLAN.md §2A).
const { Clutter, St, GLib, Gio, GObject, GdkPixbuf, NM, Cvc, Pango } = imports.gi;

const POWER = ['org.cinnamon.SettingsDaemon.Power', '/org/cinnamon/SettingsDaemon/Power', 'org.cinnamon.SettingsDaemon.Power.Screen'];
const NOTIF_SCHEMA = 'org.cinnamon.desktop.notifications';
const Main = imports.ui.main;

var platform = {
    // Mixer: Cinnamon's fork of libgvc; same API as GNOME's Gvc.
    gi: { Clutter, St, GLib, Gio, GObject, GdkPixbuf, NM, Mixer: Cvc },

    addChrome(actor) {
        Main.layoutManager.addChrome(actor, { visibleInFullscreen: false, affectsInputRegion: true, affectsStruts: false });
    },

    removeChrome(actor) {
        Main.layoutManager.removeChrome(actor);
    },

    primaryMonitor() {
        return Main.layoutManager.primaryMonitor;
    },

    connectMonitorsChanged(cb) {
        const id = Main.layoutManager.connect('monitors-changed', cb);
        return () => Main.layoutManager.disconnect(id);
    },

    uiScale() {
        return global.ui_scale;
    },

    connectScaleChanged(cb) {
        const id = global.connect('notify::ui-scale', cb);
        return () => global.disconnect(id);
    },

    // Routes Cinnamon's OSD (media keys, volume gestures, inhibit applet, ...) to `handler`.
    // handler({icon, label, level 0..1+|null}) returns true when it showed the OSD itself;
    // otherwise the original OSD runs. Returns a function that undoes the patch.
    interceptOsd(handler) {
        const mgr = Main.osdWindowManager;
        if (!mgr || typeof mgr.show !== 'function') {
            global.logError('ponitch: osdWindowManager.show not found; HUD disabled');
            return () => {};
        }
        const hadOwn = Object.prototype.hasOwnProperty.call(mgr, 'show');
        const original = mgr.show;
        const patched = function (monitorIndex, icon, label, level, ...rest) {
            let handled = false;
            try {
                // Cinnamon passes level as 0..100 (and above 100 for over-amplified volume).
                handled = handler({
                    icon: icon || null,
                    label: label == null ? null : String(label),
                    level: typeof level === 'number' ? level / 100 : null,
                });
            } catch (e) {
                global.logError(`ponitch: HUD failed, using the default OSD: ${e}`);
            }
            if (!handled)
                return original.call(this, monitorIndex, icon, label, level, ...rest);
        };
        mgr.show = patched;
        return () => {
            if (mgr.show !== patched) {
                global.logError('ponitch: osdWindowManager.show was re-patched by someone else; leaving it');
                return;
            }
            // Restore exactly: delete our own property when the method originally came from the prototype.
            if (hadOwn)
                mgr.show = original;
            else
                delete mgr.show;
        };
    },

    // Screen brightness 0..100 via csd-power. On Cinnamon it is methods plus a Changed signal
    // (GNOME 46 has a Brightness property instead). cb(null) when there is no backlight.
    brightness: {
        get(cb) {
            Gio.DBus.session.call(POWER[0], POWER[1], POWER[2], 'GetPercentage', null, null, Gio.DBusCallFlags.NONE, -1, null, (bus, res) => {
                try {
                    cb(bus.call_finish(res).deep_unpack()[0]);
                } catch (e) {
                    cb(null);
                }
            });
        },
        set(pct) {
            Gio.DBus.session.call(POWER[0], POWER[1], POWER[2], 'SetPercentage', new GLib.Variant('(u)', [Math.round(pct)]),
                null, Gio.DBusCallFlags.NONE, -1, null, (bus, res) => {
                    try {
                        bus.call_finish(res);
                    } catch (e) {
                        global.logError(`ponitch: brightness: ${e.message}`);
                    }
                });
        },
        watch(cb) {
            const id = Gio.DBus.session.signal_subscribe(POWER[0], POWER[2], 'Changed', POWER[1], null, Gio.DBusSignalFlags.NONE, () => cb());
            return () => Gio.DBus.session.signal_unsubscribe(id);
        },
    },

    // A file path, or (path null) a freedesktop theme sound name such as 'complete'.
    playSound(path, themeName) {
        const player = global.display.get_sound_player();
        if (path)
            player.play_from_file(Gio.File.new_for_path(path), 'ponitch', null);
        else
            player.play_from_theme(themeName, 'ponitch', null);
    },

    // Keyboard focus for a text entry inside shell chrome. Returns a release function.
    // Cinnamon's pushModal also pops itself if the actor is destroyed.
    // Global shortcut held only until the returned function is called (e.g. Esc while the
    // pomodoro is expanded). Unlike grabKeyboard it leaves every other key and the pointer alone.
    grabKey(accel, cb) {
        const name = `ponitch-key-${accel}`;
        Main.keybindingManager.addHotKey(name, accel, () => cb());
        return () => Main.keybindingManager.removeHotKey(name);
    },

    grabKeyboard(actor) {
        if (!Main.pushModal(actor))
            return () => {};
        actor.grab_key_focus();
        let released = false;
        return () => {
            // popModal() on an actor that is not on the stack ends *any* active modal and throws,
            // so only pop if ours is still there (it is gone if the actor was destroyed).
            if (!released && Main.modalActorFocusStack.some(r => r.actor === actor))
                Main.popModal(actor);
            released = true;
        };
    },

    // Routes new/updated desktop notifications to `handler(info)`. When it returns true the
    // banner is skipped, and the notification goes straight to the notifications applet the way
    // a banner does after hiding (messageTray._hideNotificationCompleted), so history stays complete.
    // info: { key, app, title, body, gicon, urgency: 'low'|'normal'|'critical', transient,
    //         actions: [{ label, invoke }], activate(), dismiss(), onClosed(cb) }
    // Returns a function that undoes the patch.
    interceptNotifications(handler) {
        const MessageTray = imports.ui.messageTray;
        const tray = Main.messageTray;
        if (!tray || !MessageTray.Source || typeof MessageTray.Source.prototype.notify !== 'function') {
            global.logError('ponitch: MessageTray.Source.notify not found; notifications stay as banners');
            return () => {};
        }
        const keys = new WeakMap();
        let nextKey = 1;
        // Cinnamon keeps the title as Pango markup (it shows it with set_markup), e.g. a browser's
        // "Ya&apos;kub"; ponitch shows plain text, so decode it the same way Cinnamon does.
        const plain = markup => {
            try {
                return Pango.parse_markup(markup, -1, '')[2];
            } catch (e) {
                return markup;
            }
        };
        const toInfo = n => {
            if (!keys.has(n))
                keys.set(n, nextKey++);
            const icon = n._icon;
            const actions = (n._actionArea ? n._actionArea.get_children() : []).map(b => ({
                label: b.label || (b.child && b.child.icon_name) || '',
                invoke: () => b.emit('clicked', 1), // the button carries the action id
            }));
            return {
                key: keys.get(n),
                app: (n.source && n.source.title) || '',
                title: plain(n.title || ''),
                body: n._bodyUrlHighlighter ? n._bodyUrlHighlighter.actor.clutter_text.get_text() : '',
                gicon: icon && (icon.gicon || (icon.icon_name ? Gio.ThemedIcon.new(icon.icon_name) : null)) || null,
                urgency: n.urgency >= MessageTray.Urgency.CRITICAL ? 'critical' : n.urgency <= MessageTray.Urgency.LOW ? 'low' : 'normal',
                transient: n.isTransient,
                actions,
                activate: () => n._onClicked(),
                dismiss: () => n.destroy(MessageTray.NotificationDestroyedReason.DISMISSED),
                onClosed: cb => n.connect('destroy', () => cb()),
            };
        };
        // Patch Source.notify, not tray._onNotify: the tray binds _onNotify per source when the
        // source is added, so sources that existed before enable() would bypass a tray patch.
        const proto = MessageTray.Source.prototype;
        const original = proto.notify;
        const patched = function (notification) {
            let handled = false;
            try {
                handled = handler(toInfo(notification));
            } catch (e) {
                global.logError(`ponitch: notification failed, using the banner: ${e}`);
            }
            if (!handled)
                return original.call(this, notification);
            this.pushNotification(notification); // what the original does before emitting 'notify'
            if (MessageTray.extensionsHandlingNotifications > 0)
                tray.emit('notify-applet-update', notification);
            else if (notification.isTransient)
                notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
        };
        proto.notify = patched;
        return () => {
            if (proto.notify === patched)
                proto.notify = original;
            else
                global.logError('ponitch: Source.notify was re-patched by someone else; leaving it');
        };
    },

    lock() {
        Gio.DBus.session.call('org.cinnamon.ScreenSaver', '/org/cinnamon/ScreenSaver', 'org.cinnamon.ScreenSaver', 'Lock',
            new GLib.Variant('(s)', ['']), null, Gio.DBusCallFlags.NONE, -1, null, null);
    },

    // Do not disturb = the desktop's own "don't show notification banners" switch.
    dnd: {
        _settings: null,
        _s() {
            return this._settings || (this._settings = new Gio.Settings({ schema_id: NOTIF_SCHEMA }));
        },
        get() {
            return !this._s().get_boolean('display-notifications');
        },
        set(on) {
            this._s().set_boolean('display-notifications', !on);
        },
        watch(cb) {
            const s = this._s();
            const id = s.connect('changed::display-notifications', () => cb());
            return () => s.disconnect(id);
        },
    },

    // Cinnamon's Clutter.Timeline has no `actor` property (checked on 6.6); the long duration is
    // "until stopped", the same pattern as Cinnamon's own tweener.
    newTimeline(_actor) {
        return new Clutter.Timeline({ duration: 1000 * 1000 });
    },
};

module.exports = { platform };
