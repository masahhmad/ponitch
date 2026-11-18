// node tests/test_notifications.js: titles from Chromium-based browsers arrive XML-escaped.
const assert = require('assert');
const { decodeEntities } = require('../src/core/notifications');

assert.strictEqual(decodeEntities('Ya&apos;kub IDN'), "Ya'kub IDN");
assert.strictEqual(decodeEntities('Tom &amp; Jerry &lt;3 &quot;hi&quot;'), 'Tom & Jerry <3 "hi"');
assert.strictEqual(decodeEntities('a&nbsp;b &#39;x&#x27; &#x1F600;'), "a b 'x' 😀");
// Decoded once only: an escaped ampersand stays a literal entity.
assert.strictEqual(decodeEntities('&amp;apos;'), '&apos;');
// Not entities, or not valid code points: left as written.
assert.strictEqual(decodeEntities('R&D & co; &foo; &#0; &#xD800; &#1114112;'), 'R&D & co; &foo; &#0; &#xD800; &#1114112;');
assert.strictEqual(decodeEntities('plain title'), 'plain title');
console.log('test_notifications: ok');
