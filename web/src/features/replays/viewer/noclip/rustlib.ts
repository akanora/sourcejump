// @ts-nocheck
// Stub for noclip's Rust/WASM helper library.
// We don't ship the noclip-rust-support WASM bundle — instead we provide JS
// implementations for the few entry points the vendored Source engine actually
// hits at runtime. loadRustLib is a no-op so callers don't break.

import { inflate, inflateRaw } from "pako";
import { decompress as lzmaDecompress } from "lzma1";

// IntersectionState in Geometry.ts: Inside=0, Outside=1, Intersection=2.
const ISTATE_INSIDE = 0;
const ISTATE_OUTSIDE = 1;
const ISTATE_INTERSECTION = 2;

/**
 * Pure-JS implementation of noclip's Rust ConvexHull, sufficient for camera
 * frustum culling. A convex hull is stored as a flat array of plane
 * coefficients (a, b, c, d), where a point (x, y, z) is "inside" the half-
 * space defined by a plane iff a*x + b*y + c*z + d >= 0.
 *
 * Implements the surface that Geometry.ts/Frustum uses:
 *   clear, push_plane, free, copy,
 *   js_intersect_aabb, js_contains_aabb, js_contains_sphere,
 *   js_contains_point, js_transform.
 */
class JsConvexHull {
    private planes: number[] = [];

    public clear(): void {
        this.planes.length = 0;
    }

    public push_plane(a: number, b: number, c: number, d: number): void {
        // Normalize so half-space tests behave as Euclidean distances.
        const inv = 1 / Math.hypot(a, b, c);
        this.planes.push(a * inv, b * inv, c * inv, d * inv);
    }

    public free(): void {
        this.planes.length = 0;
    }

    public copy(): JsConvexHull {
        const out = new JsConvexHull();
        out.planes = this.planes.slice();
        return out;
    }

    public js_contains_point(v: Float32Array): boolean {
        const p = this.planes;
        for (let i = 0; i < p.length; i += 4) {
            if (p[i] * v[0] + p[i + 1] * v[1] + p[i + 2] * v[2] + p[i + 3] < 0)
                return false;
        }
        return true;
    }

    public js_contains_sphere(x: number, y: number, z: number, r: number): boolean {
        const p = this.planes;
        for (let i = 0; i < p.length; i += 4) {
            if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -r)
                return false;
        }
        return true;
    }

    public js_intersect_aabb(
        minX: number, minY: number, minZ: number,
        maxX: number, maxY: number, maxZ: number,
    ): number {
        // Per-plane test:
        //   - p-vertex = AABB corner that MAXIMIZES a*x + b*y + c*z (farthest
        //     in +normal direction; pick max coord when coeff is positive).
        //     If even the p-vertex is on the wrong side (< 0), the entire
        //     AABB is outside this half-space ⇒ outside hull.
        //   - n-vertex = corner that MINIMIZES the value (pick min coord when
        //     coeff positive). If n-vertex is on the wrong side, the AABB
        //     straddles the plane ⇒ intersection.
        const p = this.planes;
        let result = ISTATE_INSIDE;
        for (let i = 0; i < p.length; i += 4) {
            const a = p[i], b = p[i + 1], c = p[i + 2], d = p[i + 3];
            const px = a >= 0 ? maxX : minX;
            const py = b >= 0 ? maxY : minY;
            const pz = c >= 0 ? maxZ : minZ;
            if (a * px + b * py + c * pz + d < 0) return ISTATE_OUTSIDE;
            const nx = a >= 0 ? minX : maxX;
            const ny = b >= 0 ? minY : maxY;
            const nz = c >= 0 ? minZ : maxZ;
            if (a * nx + b * ny + c * nz + d < 0) result = ISTATE_INTERSECTION;
        }
        return result;
    }

    public js_contains_aabb(
        minX: number, minY: number, minZ: number,
        maxX: number, maxY: number, maxZ: number,
    ): boolean {
        return this.js_intersect_aabb(minX, minY, minZ, maxX, maxY, maxZ) !== ISTATE_OUTSIDE;
    }

    /**
     * Transform planes by a 4x4 matrix `m` (column-major, gl-matrix layout).
     * If points transform by M, planes transform by (M^-1)^T. We don't have
     * a matrix inverse here without pulling in gl-matrix, so we use the
     * canonical formula on the homogeneous plane vector: p' = p · M^-1.
     * Practically Frustum.transform is rare on the render path; for now we
     * compute the inverse inline.
     */
    public js_transform(m: Float32Array): void {
        const inv = invertMat4(m);
        if (!inv) return;
        const planes = this.planes;
        for (let i = 0; i < planes.length; i += 4) {
            const a = planes[i], b = planes[i + 1], c = planes[i + 2], d = planes[i + 3];
            // p' = p · M^-1, where p is a row vector (a, b, c, d) and M^-1
            // is the inverse of the world transform applied to points.
            const na = a * inv[0]  + b * inv[1]  + c * inv[2]  + d * inv[3];
            const nb = a * inv[4]  + b * inv[5]  + c * inv[6]  + d * inv[7];
            const nc = a * inv[8]  + b * inv[9]  + c * inv[10] + d * inv[11];
            const nd = a * inv[12] + b * inv[13] + c * inv[14] + d * inv[15];
            planes[i] = na;
            planes[i + 1] = nb;
            planes[i + 2] = nc;
            planes[i + 3] = nd;
        }
    }
}

// Inline 4x4 inverse to avoid pulling gl-matrix into this stub.
// Returns null if the matrix is singular.
function invertMat4(m: Float32Array | number[]): Float32Array | null {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;
    const out = new Float32Array(16);
    out[0]  = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1]  = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2]  = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3]  = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4]  = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5]  = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6]  = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7]  = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8]  = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9]  = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
}

export const rust = {
    deflate_decompress(src: Uint8Array): Uint8Array {
        return inflate(src);
    },
    deflate_raw_decompress(src: Uint8Array): Uint8Array {
        return inflateRaw(src);
    },
    lzma_decompress(
        src: Uint8Array,
        lc: number,
        lp: number,
        pb: number,
        dictSize: number,
        maxSize: bigint,
    ): Uint8Array {
        // The LZMA module hands us a parsed properties triple (lc/lp/pb)
        // plus the raw bitstream, but lzma1 expects the full "LZMA Alone"
        // .lzma format: 1 properties byte, 4 dict-size bytes, 8 uncompressed
        // -size bytes, then the stream. Reconstruct that header and forward.
        const propertiesByte = (pb * 5 + lp) * 9 + lc;
        const header = new Uint8Array(13);
        header[0] = propertiesByte;
        for (let i = 0; i < 4; i++)
            header[1 + i] = (dictSize >>> (i * 8)) & 0xff;
        for (let i = 0; i < 8; i++)
            header[5 + i] = Number((maxSize >> BigInt(i * 8)) & 0xffn);
        const framed = new Uint8Array(13 + src.length);
        framed.set(header, 0);
        framed.set(src, 13);
        return lzmaDecompress(framed);
    },
    decode_texture(): Uint8Array {
        throw new Error("GX texture decode is not used by the Source engine path");
    },
    ConvexHull: JsConvexHull,
};

export async function loadRustLib(): Promise<void> {
    // No-op: pako handles deflate, JsConvexHull handles frustum culling,
    // LZMA throws lazily if a map needs it.
}
