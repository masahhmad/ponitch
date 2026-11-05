// Damped spring with closed-form solution, matching notchy.dev (PLAN.md §4A.1).
// Pure JS (no gi imports) so tests/test_spring.js can run it under node.

const DEFAULTS = { stiffness: 380, damping: 34, mass: 0.9, restDelta: 0.4 };

class Spring {
    constructor(value, params = DEFAULTS) {
        this.value = value;
        this.target = value;
        this.velocity = 0;
        const { stiffness, damping, mass } = params;
        this._w0 = Math.sqrt(stiffness / mass);
        // shortcut: only the underdamped case is solved, so zeta is clamped below 1; add the critically/overdamped forms if params ever change.
        this._zeta = Math.min(damping / (2 * Math.sqrt(stiffness * mass)), 0.999);
        this._wd = this._w0 * Math.sqrt(1 - this._zeta * this._zeta);
        this._restDelta = params.restDelta;
        this._x0 = 0;
        this._v0 = 0;
        this._t = 0;
    }

    // Retarget keeps the current value and velocity, so a mid-flight change stays smooth.
    setTarget(target) {
        this.target = target;
        this._x0 = this.value - target;
        this._v0 = this.velocity;
        this._t = 0;
    }

    jump(value) {
        this.value = this.target = value;
        this.velocity = this._x0 = this._v0 = this._t = 0;
    }

    // dt in seconds. Returns true while still moving.
    step(dt) {
        if (this.isAtRest())
            return false;
        this._t += dt;
        const a = this._zeta * this._w0, wd = this._wd, t = this._t;
        const decay = Math.exp(-a * t), c = Math.cos(wd * t), s = Math.sin(wd * t);
        const x = decay * (this._x0 * c + ((this._v0 + a * this._x0) / wd) * s);
        this.velocity = decay * (this._v0 * c - ((this._w0 * this._w0 * this._x0 + a * this._v0) / wd) * s);
        this.value = this.target + x;
        if (this.isAtRest()) {
            this.value = this.target;
            this.velocity = 0;
            return false;
        }
        return true;
    }

    isAtRest() {
        return Math.abs(this.value - this.target) < this._restDelta && Math.abs(this.velocity) < this._restDelta * 10;
    }
}

module.exports = { Spring, DEFAULTS };
