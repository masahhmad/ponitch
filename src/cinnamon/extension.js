// Cinnamon entry point: settings-schema.json -> cfg, the toggle shortcut, and App (core/app.js).
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const { platform } = require('./platform');
const { App, SETTINGS } = require('./app');
const { setGettext } = require('./i18n');

const HOTKEY = 'ponitch-toggle';

let uuid, cfg, settings, app;

function init(meta) {
    uuid = meta.uuid;
    // Where Cinnamon Spices and cinnamon-settings look for an xlet's translations (install.sh links them).
    Gettext.bindtextdomain(uuid, GLib.get_home_dir() + '/.local/share/locale');
    setGettext(s => Gettext.dgettext(uuid, s));
}

function enable() {
    cfg = {};
    settings = new Settings.ExtensionSettings(cfg, uuid);
    app = new App(platform, cfg);
    for (const [key, prop, group] of SETTINGS)
        settings.bind(key, prop, () => group && app.changed(group));
    settings.bind('toggle-key', 'toggleKey', bindHotkey);
    app.enable();
    bindHotkey();
}

function disable() {
    for (const step of [() => Main.keybindingManager.removeHotKey(HOTKEY), () => app.disable(), () => settings.finalize()]) {
        try {
            step();
        } catch (e) {
            global.logError(`ponitch: disable step failed: ${e}`);
        }
    }
    app = settings = cfg = null;
}

function bindHotkey() {
    Main.keybindingManager.removeHotKey(HOTKEY);
    if (cfg.toggleKey)
        Main.keybindingManager.addHotKey(HOTKEY, cfg.toggleKey, () => app.toggle());
}
