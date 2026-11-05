// Output volume and microphone through the desktop's mixer library (Cvc on Cinnamon, Gvc on GNOME;
// same API), injected as platform.gi.Mixer.
const { Emitter, disconnectAll } = require('./emitter');

var AudioService = class AudioService extends Emitter {
    constructor(platform) {
        super();
        this._gi = platform.gi;
        this._streams = []; // [stream, ids]
    }

    start() {
        const { Mixer } = this._gi;
        this._control = new Mixer.MixerControl({ name: 'ponitch' });
        this._ids = ['state-changed', 'default-sink-changed', 'default-source-changed']
            .map(s => this._control.connect(s, () => this._bind()));
        this._control.open();
    }

    stop() {
        this._unbindStreams();
        if (this._control) {
            disconnectAll(this._gi, this._control, this._ids);
            this._control.close();
        }
        this._control = null;
    }

    _unbindStreams() {
        this._streams.forEach(([s, ids]) => disconnectAll(this._gi, s, ids));
        this._streams = [];
    }

    _bind() {
        this._unbindStreams();
        for (const s of [this._sink(), this._source()].filter(Boolean))
            this._streams.push([s, ['notify::volume', 'notify::is-muted'].map(n => s.connect(n, () => this._emit()))]);
        this._emit();
    }

    _ready() {
        return this._control && this._control.get_state() === this._gi.Mixer.MixerControlState.READY;
    }

    _sink() {
        return this._ready() ? this._control.get_default_sink() : null;
    }

    _source() {
        return this._ready() ? this._control.get_default_source() : null;
    }

    _read(s) {
        return s ? { volume: s.volume / this._control.get_vol_max_norm(), muted: s.is_muted } : null;
    }

    // { volume 0..1, muted } or null.
    get output() { return this._read(this._sink()); }
    get input() { return this._read(this._source()); }

    setVolume(which, v) {
        const s = which === 'input' ? this._source() : this._sink();
        if (!s)
            return;
        s.volume = Math.round(Math.max(0, Math.min(1, v)) * this._control.get_vol_max_norm());
        s.push_volume();
        if (s.is_muted && v > 0)
            s.change_is_muted(false);
    }

    toggleMute(which) {
        const s = which === 'input' ? this._source() : this._sink();
        if (s)
            s.change_is_muted(!s.is_muted);
    }
};

module.exports = { AudioService };
