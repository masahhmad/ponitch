// node tests/test_color.js
const assert = require('assert');
const { dominantColor, rgba, parseColor } = require('../src/core/color.js');

function image(w, h, nChannels, pixelAt) {
    const rowstride = w * nChannels + 3; // padded rows, like GdkPixbuf can have
    const px = new Uint8Array(rowstride * h);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            px.set(pixelAt(x, y), y * rowstride + x * nChannels);
    return [px, w, h, rowstride, nChannels];
}

// Solid colour comes back as itself (RGB and RGBA layouts).
assert.deepStrictEqual(dominantColor(...image(4, 4, 3, () => [200, 40, 60])), [200, 40, 60]);
assert.deepStrictEqual(dominantColor(...image(4, 4, 4, () => [30, 120, 220, 255])), [30, 120, 220]);

// Greyscale / black / white covers have no accent.
assert.strictEqual(dominantColor(...image(4, 4, 3, (x) => [x * 60, x * 60, x * 60])), null);

// A mostly black cover with a red logo picks the red, not the black.
const red = dominantColor(...image(8, 8, 3, (x, y) => (x < 2 && y < 2 ? [220, 30, 30] : [5, 5, 5])));
assert.deepStrictEqual(red, [220, 30, 30]);

// Mixed: the more saturated colour dominates.
const mix = dominantColor(...image(2, 1, 3, (x) => (x === 0 ? [255, 0, 0] : [150, 120, 110])));
assert(mix[0] > 220 && mix[1] < 40, `saturated colour should dominate, got ${mix}`);

assert.strictEqual(rgba([1, 2, 3], 0.3), 'rgba(1, 2, 3, 0.3)');
assert.strictEqual(rgba(null, 1), 'rgba(255, 255, 255, 1)');

// Colour chooser values.
assert.deepStrictEqual(parseColor('rgb(0,0,0)'), [0, 0, 0]);
assert.deepStrictEqual(parseColor('rgba(10, 132, 255, 0.5)'), [10, 132, 255]);
assert.deepStrictEqual(parseColor('#0a84ff'), [10, 132, 255]);
assert.deepStrictEqual(parseColor('#fff'), [255, 255, 255]);
for (const bad of ['', 'red', 'rgb(300,0,0)', '#12345', 'rgb(1,2)', null, 'rgb(1,2,3); background: url(x)'])
    assert.strictEqual(parseColor(bad), null, String(bad));

console.log('test_color: ok');
