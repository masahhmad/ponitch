// node tests/test_i18n.js: placeholder filling and the gettext hook in core/i18n.js.
const assert = require('assert');
const { _, N_, setGettext } = require('../src/core/i18n');

assert.strictEqual(_('Done'), 'Done');
assert.strictEqual(_('in %s', '4:05'), 'in 4:05');
assert.strictEqual(_('Session %s · long break every %s', 2, 4), 'Session 2 · long break every 4');
assert.strictEqual(_('100%'), '100%'); // no arguments: % is left alone
assert.strictEqual(N_('Focus'), 'Focus');

setGettext(s => ({ 'in %s': '%s lagi', Done: 'Selesai' })[s] || s);
assert.strictEqual(_('Done'), 'Selesai');
assert.strictEqual(_('in %s', '4:05'), '4:05 lagi');
assert.strictEqual(_('Untranslated'), 'Untranslated');
setGettext(null);
assert.strictEqual(_('Done'), 'Done');
console.log('test_i18n: ok');
