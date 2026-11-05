// Dominant accent colour of a (tiny, e.g. 16×16) cover thumbnail. Pure JS so node can test it.

// pixels: byte array of rows (rowstride bytes each, nChannels per pixel, RGB first).
// Returns [r, g, b] weighted toward saturated, mid-bright pixels, or null if the image is greyscale.
function dominantColor(pixels, width, height, rowstride, nChannels) {
    let r = 0, g = 0, b = 0, total = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * rowstride + x * nChannels;
            const pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2];
            const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
            const sat = max === 0 ? 0 : (max - min) / max;
            // Near-black, near-white and grey pixels say little about the cover's colour.
            if (sat < 0.25 || max < 40 || min > 225)
                continue;
            const w = sat * sat;
            r += pr * w; g += pg * w; b += pb * w; total += w;
        }
    }
    if (total === 0)
        return null;
    return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
}

// CSS rgba() for an [r, g, b] colour; white when there is no colour.
function rgba(rgb, alpha) {
    const [r, g, b] = rgb || [255, 255, 255];
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// CSS colour from a settings colour chooser ("rgb(1,2,3)", "rgba(1,2,3,0.5)", "#abc", "#aabbcc")
// -> [r, g, b] (alpha ignored; opacity is its own setting), or null if unreadable.
function parseColor(text) {
    const s = String(text || '').trim();
    let m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i);
    if (m)
        return m.slice(1, 4).map(Number).every(v => v <= 255) ? m.slice(1, 4).map(Number) : null;
    m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m)
        return null;
    const hex = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}

module.exports = { dominantColor, rgba, parseColor };
