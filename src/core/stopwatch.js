// Work stopwatch: play / pause / reset. Saved with an absolute start time, so a running stopwatch
// keeps counting across a shell restart, suspend or power-off (wall-clock time, user's choice).
// No timer of its own: the tab and the closed notch tick only while they are on screen.
const { Emitter } = require('./emitter');
const { initStore, dataPath, readJson, writeJson } = require('./store');

const EMPTY = { running: false, startedAt: null, elapsed: 0 };

// Total ms at `now`. A clock set back before startedAt counts as 0, never negative.
const elapsedAt = (s, now) => s.elapsed + (s.running ? Math.max(0, now - s.startedAt) : 0);

const valid = s => s && typeof s.running === 'boolean' && Number.isFinite(s.elapsed) && s.elapsed >= 0 &&
    (!s.running || Number.isFinite(s.startedAt));

var StopwatchService = class StopwatchService extends Emitter {
    constructor(platform) {
        super();
        initStore(platform.gi);
        this.state = { ...EMPTY };
        this._file = dataPath('stopwatch.json');
    }

    start() {
        readJson(this._file, s => {
            if (valid(s))
                this.state = { running: s.running, startedAt: s.running ? s.startedAt : null, elapsed: s.elapsed };
            this._emit();
        });
    }

    stop() {}

    // { running, elapsed (ms now), since (ms: the instant it would have started from 0) }
    get view() {
        const now = Date.now(), elapsed = elapsedAt(this.state, now);
        return { running: this.state.running, elapsed, since: now - elapsed };
    }

    toggle() {
        const now = Date.now(), s = this.state;
        this._set(s.running ? { running: false, startedAt: null, elapsed: elapsedAt(s, now) } : { running: true, startedAt: now });
    }

    reset() {
        this._set({ ...EMPTY });
    }

    _set(patch) {
        this.state = { ...this.state, ...patch };
        writeJson(this._file, this.state);
        this._emit();
    }
};

module.exports = { StopwatchService, elapsedAt };
