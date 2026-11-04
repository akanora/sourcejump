// @ts-nocheck
// Software decode for DXT1, DXT3 and DXT5 (BC1 to BC3), for GPUs without S3TC, which is most
// phones. Each 4x4 block has two RGB565 colours and a 2-bit index per pixel into those two
// and the colours between them. DXT3 adds a 4-bit alpha per pixel; DXT5 two alpha end points
// and a 3-bit index per pixel into the alphas between them. Output is RGBA8, slice by slice.

export type DXTFormat = 1 | 3 | 5;

function expand565(c: number, out: Uint8Array, at: number): void {
    const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    out[at] = (r << 3) | (r >> 2);
    out[at + 1] = (g << 2) | (g >> 4);
    out[at + 2] = (b << 3) | (b >> 2);
    out[at + 3] = 255;
}

// DXT1 has a second mode, taken when the first colour is not the larger: three colours and
// transparent black. DXT3 and DXT5 carry alpha separately and always use four colours.
function readColors(src: Uint8Array, at: number, dxt1: boolean, out: Uint8Array): void {
    const c0 = src[at] | (src[at + 1] << 8);
    const c1 = src[at + 2] | (src[at + 3] << 8);
    expand565(c0, out, 0);
    expand565(c1, out, 4);
    const fourColors = !dxt1 || c0 > c1;
    for (let k = 0; k < 3; k++) {
        const a = out[k], b = out[4 + k];
        if (fourColors) {
            out[8 + k] = ((2 * a + b) / 3 + 0.5) | 0;
            out[12 + k] = ((a + 2 * b) / 3 + 0.5) | 0;
        } else {
            out[8 + k] = ((a + b) / 2 + 0.5) | 0;
            out[12 + k] = 0;
        }
    }
    out[11] = 255;
    out[15] = fourColors ? 255 : 0;
}

function readAlphas(src: Uint8Array, at: number, out: Uint8Array): void {
    const a0 = src[at], a1 = src[at + 1];
    out[0] = a0;
    out[1] = a1;
    if (a0 > a1) {
        for (let k = 1; k <= 6; k++)
            out[k + 1] = (((7 - k) * a0 + k * a1) / 7 + 0.5) | 0;
    } else {
        for (let k = 1; k <= 4; k++)
            out[k + 1] = (((5 - k) * a0 + k * a1) / 5 + 0.5) | 0;
        out[6] = 0;
        out[7] = 255;
    }
}

export function decodeDXT(format: DXTFormat, src: Uint8Array, width: number, height: number, depth: number): Uint8Array {
    const blockBytes = format === 1 ? 8 : 16;
    const blocksX = Math.max(1, (width + 3) >> 2);
    const blocksY = Math.max(1, (height + 3) >> 2);
    const dst = new Uint8Array(width * height * depth * 4);
    const colors = new Uint8Array(16);
    const alphas = new Uint8Array(8);
    let s = 0;
    for (let z = 0; z < depth; z++) {
        const slice = z * width * height * 4;
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++, s += blockBytes) {
                const colorAt = format === 1 ? s : s + 8;
                readColors(src, colorAt, format === 1, colors);
                const indices = (src[colorAt + 4] | (src[colorAt + 5] << 8) | (src[colorAt + 6] << 16) | (src[colorAt + 7] << 24)) >>> 0;
                let alphaLow = 0, alphaHigh = 0;
                if (format === 5) {
                    readAlphas(src, s, alphas);
                    alphaLow = src[s + 2] | (src[s + 3] << 8) | (src[s + 4] << 16);
                    alphaHigh = src[s + 5] | (src[s + 6] << 8) | (src[s + 7] << 16);
                }
                for (let py = 0; py < 4; py++) {
                    const y = by * 4 + py;
                    if (y >= height) break;
                    for (let px = 0; px < 4; px++) {
                        const x = bx * 4 + px;
                        if (x >= width) break;
                        const i = py * 4 + px;
                        const c = ((indices >>> (i * 2)) & 3) * 4;
                        const o = slice + (y * width + x) * 4;
                        dst[o] = colors[c];
                        dst[o + 1] = colors[c + 1];
                        dst[o + 2] = colors[c + 2];
                        if (format === 1)
                            dst[o + 3] = colors[c + 3];
                        else if (format === 3)
                            dst[o + 3] = ((src[s + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
                        else
                            dst[o + 3] = alphas[i < 8 ? (alphaLow >> (i * 3)) & 7 : (alphaHigh >> ((i - 8) * 3)) & 7];
                    }
                }
            }
        }
    }
    return dst;
}
