// Pomodoro (PLAN.md §4.10). Loops focus -> break -> focus ... by itself until paused or reset,
// with a long break every `cycles` focus sessions. State (incl. the durations, edited in the
// Pomodoro tab) is saved with an absolute end time, so a running session survives a shell restart.
const { Emitter } = require('./emitter');
const { initStore, dataPath, readJson, writeJson, onResume, at } = require('./store');

const LABELS = { focus: 'Focus', short: 'Short break', long: 'Long break' };
// Allowed values (minutes, or sessions for cycles) for the steppers in the tab.
const LIMITS = { focus: [1, 180], short: [1, 60], long: [1, 120], cycles: [1, 12] };
const DEFAULTS = { focus: 25, short: 5, long: 15, cycles: 4 };

const validConfig = c => c && Object.keys(LIMITS).every(k => Number.isInteger(c[k]) && c[k] >= LIMITS[k][0] && c[k] <= LIMITS[k][1]);

var PomodoroService = class PomodoroService extends Emitter {
    constructor(platform) {
        super();
        initStore(platform.gi);
        this._platform = platform;
        this.state = { phase: 'focus', round: 0, running: false, endsAt: null, remaining: null, config: { ...DEFAULTS } };
        this._cancelTimer = () => {};
        this._file = dataPath('pomodoro.json');
    }

    start() {
        this._unResume = onResume(() => this._tick());
        readJson(this._file, s => {
            if (s && LABELS[s.phase] && typeof s.running === 'boolean' && Number.isInteger(s.round))
                this.state = { ...s, config: validConfig(s.config) ? s.config : { ...DEFAULTS } };
            this._tick();
        });
    }

    stop() {
        this._cancelTimer();
        this._unResume();
    }

    get config() {
        return this.state.config;
    }

    // Change a duration / cycle count; applies from the next session (the running one keeps its end).
    setConfig(key, value) {
        const [min, max] = LIMITS[key];
        this._set({ config: { ...this.state.config, [key]: Math.max(min, Math.min(max, Math.round(value))) } });
    }

    _duration(phase) {
        return this.state.config[phase] * 60000;
    }

    // { phase, label, running, remaining (ms), total (ms), endsAt, round, config, ended }
    // ended: { at, to } when a session last ran out by itself (not skip/reset); the notch alerts on it.
    get view() {
        const s = this.state;
        const total = this._duration(s.phase);
        const remaining = s.running ? Math.max(0, s.endsAt - Date.now()) : (s.remaining || total);
        return { ...s, label: LABELS[s.phase], total, remaining, ended: this._ended || null };
    }

    toggle() {
        const s = this.state;
        if (s.running)
            this._set({ running: false, remaining: Math.max(0, s.endsAt - Date.now()), endsAt: null });
        else
            this._set({ running: true, endsAt: Date.now() + (s.remaining || this._duration(s.phase)), remaining: null });
    }

    skip() {
        this._advance(this.state.running);
    }

    reset() {
        this._set({ phase: 'focus', round: 0, running: false, endsAt: null, remaining: null });
    }

    _set(patch) {
        this.state = { ...this.state, ...patch };
        writeJson(this._file, this.state);
        this._tick();
    }

    // Next phase: focus -> short (or long every `cycles` sessions) -> focus -> ...
    // `run`: start it right away (the loop) or leave it waiting (skip while paused).
    _advance(run) {
        const s = this.state;
        let phase = 'focus', round = s.round;
        if (s.phase === 'focus') {
            round += 1;
            phase = round % s.config.cycles === 0 ? 'long' : 'short';
        }
        this._set({ phase, round, running: run, endsAt: run ? Date.now() + this._duration(phase) : null, remaining: null });
    }

    // Finish a session whose end time has passed, then plan the next wake-up.
    _tick() {
        this._cancelTimer();
        const s = this.state, now = Date.now();
        if (s.running && s.endsAt <= now) {
            // Don't chime for a session that ended long ago (shell was down / machine asleep).
            if (now - s.endsAt < 60000 && !this._platform.dnd.get())
                this._platform.playSound(null, 'complete');
            this._advance(true);
            this._ended = { at: now, to: this.state.phase };
            return this._emit();
        }
        if (s.running)
            this._cancelTimer = at(s.endsAt, () => this._tick());
        this._emit();
    }
};

module.exports = { PomodoroService };
