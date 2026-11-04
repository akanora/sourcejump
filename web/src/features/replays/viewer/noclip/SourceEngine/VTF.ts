// @ts-nocheck

// Valve Texture File

import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxTexture, GfxDevice, GfxFormat, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxTextureDescriptor, GfxTextureDimension, GfxTextureUsage, GfxSamplerDescriptor } from "../gfx/platform/GfxPlatform";
import { readString, assert, nArray, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { decodeDXT, type DXTFormat } from "./DXT";

enum ImageFormat {
    RGBA8888      = 0x00,
    ABGR8888      = 0x01,
    RGB888        = 0x02,
    BGR888        = 0x03,
    I8            = 0x05,
    ARGB8888      = 0x0B,
    BGRA8888      = 0x0C,
    DXT1          = 0x0D,
    DXT3          = 0x0E,
    DXT5          = 0x0F,
    BGRX8888      = 0x10,
    BGRA5551      = 0x15,
    UV88          = 0x16,
    RGBA16161616F = 0x18,
}

function imageFormatIsBlockCompressed(fmt: ImageFormat): boolean {
    if (fmt === ImageFormat.DXT1)
        return true;
    if (fmt === ImageFormat.DXT3)
        return true;
    if (fmt === ImageFormat.DXT5)
        return true;

    return false;
}

function imageFormatGetBPP(fmt: ImageFormat): number {
    if (fmt === ImageFormat.RGBA16161616F)
        return 8;
    if (fmt === ImageFormat.RGBA8888)
        return 4;
    if (fmt === ImageFormat.ABGR8888)
        return 4;
    if (fmt === ImageFormat.ARGB8888)
        return 4;
    if (fmt === ImageFormat.BGRA8888)
        return 4;
    if (fmt === ImageFormat.BGRX8888)
        return 4;
    if (fmt === ImageFormat.RGB888)
        return 3;
    if (fmt === ImageFormat.BGR888)
        return 3;
    if (fmt === ImageFormat.BGRA5551)
        return 2;
    if (fmt === ImageFormat.UV88)
        return 2;
    if (fmt === ImageFormat.I8)
        return 1;
    throw "whoops";
}

function imageFormatCalcLevelSize(fmt: ImageFormat, width: number, height: number, depth: number): number {
    if (imageFormatIsBlockCompressed(fmt)) {
        width = Math.max(width, 4);
        height = Math.max(height, 4);
        const count = ((width * height) / 16) * depth;
        if (fmt === ImageFormat.DXT1)
            return count * 8;
        else if (fmt === ImageFormat.DXT3)
            return count * 16;
        else if (fmt === ImageFormat.DXT5)
            return count * 16;
        else
            throw "whoops";
    } else {
        return (width * height * depth) * imageFormatGetBPP(fmt);
    }
}

function imageFormatToGfxFormat(device: GfxDevice, fmt: ImageFormat, srgb: boolean): GfxFormat {
    if (fmt === ImageFormat.DXT1)
        return srgb ? GfxFormat.BC1_SRGB : GfxFormat.BC1;
    else if (fmt === ImageFormat.DXT3)
        return srgb ? GfxFormat.BC2_SRGB : GfxFormat.BC2;
    else if (fmt === ImageFormat.DXT5)
        return srgb ? GfxFormat.BC3_SRGB : GfxFormat.BC3;
    else if (fmt === ImageFormat.RGBA8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.RGB888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGR888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGRA8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.ABGR8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGRX8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGRA5551)
        return GfxFormat.U16_RGBA_5551; // TODO(jstpierre): sRGB?
    else if (fmt === ImageFormat.UV88)
        return GfxFormat.S8_RG_NORM;
    else if (fmt === ImageFormat.I8)
        return GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.RGBA16161616F)
        return GfxFormat.F16_RGBA;
    else
        throw "whoops";
}

function imageFormatConvertData(device: GfxDevice, fmt: ImageFormat, data: ArrayBufferSlice, width: number, height: number, depth: number): ArrayBufferView {
    if (fmt === ImageFormat.BGR888) {
        // BGR888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = 255;
            p += 3;
        }
        return dst;
    } else if (fmt === ImageFormat.RGB888) {
        // RGB888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = 255;
            p += 3;
        }
        return dst;
    } else if (fmt === ImageFormat.ABGR8888) {
        // ABGR8888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 3);
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            p += 4;
        }
        return dst;
    } else if (fmt === ImageFormat.BGRA8888) {
        // BGRA8888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = src.getUint8(p + 3);
            p += 4;
        }
        return dst;
    } else if (fmt === ImageFormat.BGRX8888) {
        // BGRX8888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = 0xFF;
            p += 4;
        }
        return dst;
    } else if (fmt === ImageFormat.UV88) {
        return data.createTypedArray(Int8Array);
    } else if (fmt === ImageFormat.BGRA5551 || fmt === ImageFormat.RGBA16161616F) {
        return data.createTypedArray(Uint16Array);
    } else if (fmt === ImageFormat.I8) {
        // I8 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            const m = src.getUint8(p++);
            dst[i++] = m;
            dst[i++] = m;
            dst[i++] = m;
            dst[i++] = 0xFF;
        }
        return dst;
    } else {
        return data.createTypedArray(Uint8Array);
    }
}

// A texture the GPU cannot take compressed is decoded to RGBA8, four to eight times the memory
// of DXT. Levels larger than this are left out, which on a phone screen costs no visible detail
// and keeps a big map's textures from running a phone out of memory.
const MAX_DECODED_SIZE = 512;

const DXT_FORMAT: Partial<Record<ImageFormat, DXTFormat>> = {
    [ImageFormat.DXT1]: 1,
    [ImageFormat.DXT3]: 3,
    [ImageFormat.DXT5]: 5,
};

export enum VTFFlags {
    NONE          = 0,
    POINTSAMPLE   = 1 << 0,
    TRILINEAR     = 1 << 1,
    CLAMPS        = 1 << 2,
    CLAMPT        = 1 << 3,
    SRGB          = 1 << 6,
    NOMIP         = 1 << 8,
    ONEBITALPHA   = 1 << 12,
    EIGHTBITALPHA = 1 << 13,
    ENVMAP        = 1 << 14,
}

interface VTFResourceEntry {
    rsrcID: number;
    data: ArrayBufferSlice;
}

export class VTF {
    public gfxTextures: GfxTexture[] = [];
    public gfxSampler: GfxSampler | null = null;
    // LOCAL: kept so a test cap (`setLevelCap`) can swap the sampler without uploading the texture again.
    private samplerDescriptor: GfxSamplerDescriptor | null = null;
    private uploadedWidth = 0;
    private uploadedHeight = 0;
    private uploadedLevels = 0;

    public declare format: ImageFormat;
    public flags: VTFFlags = VTFFlags.NONE;
    public width: number = 0;
    public height: number = 0;
    public depth: number = 1;
    public numFrames: number = 1;
    public numLevels: number = 1;

    public resources: VTFResourceEntry[] = [];

    private declare versionMajor: number;
    private declare versionMinor: number;

    constructor(device: GfxDevice, cache: GfxRenderCache, buffer: ArrayBufferSlice | null, private name: string, srgb: boolean, public lateBinding: string | undefined = undefined) {
        if (buffer === null)
            return;

        const view = buffer.createDataView();

        assert(readString(buffer, 0x00, 0x04, false) === 'VTF\0');
        this.versionMajor = view.getUint32(0x04, true);
        assert(this.versionMajor === 7);
        this.versionMinor = view.getUint32(0x08, true);
        assert(this.versionMinor >= 0 && this.versionMinor <= 5);
        const headerSize = view.getUint32(0x0C, true);

        let dataIdx: number;
        let imageDataIdx: number = 0;

        if (this.versionMajor === 0x07) {
            assert(this.versionMinor >= 0x00);

            this.width = view.getUint16(0x10, true);
            this.height = view.getUint16(0x12, true);
            this.flags = view.getUint32(0x14, true);
            this.numFrames = view.getUint16(0x18, true);
            const startFrame = view.getUint16(0x1A, true);
            const reflectivityR = view.getFloat32(0x20, true);
            const reflectivityG = view.getFloat32(0x24, true);
            const reflectivityB = view.getFloat32(0x28, true);
            const bumpScale = view.getFloat32(0x30, true);
            this.format = view.getUint32(0x34, true);
            this.numLevels = view.getUint8(0x38);
            const lowresImageFormat = view.getUint32(0x39, true);
            const lowresImageWidth = view.getUint8(0x3D);
            const lowresImageHeight = view.getUint8(0x3E);

            dataIdx = 0x40;

            if (this.versionMinor >= 0x02) {
                this.depth = Math.max(view.getUint16(0x41, true), 1);
                dataIdx = 0x50;
            } else {
                this.depth = 1;
            }

            const numResources = this.versionMinor >= 0x03 ? view.getUint32(0x44, true) : 0;
            if (numResources > 0) {
                for (let i = 0; i < numResources; i++, dataIdx += 0x08) {
                    const rsrcHeader = view.getUint32(dataIdx + 0x00, false);
                    const rsrcID = (rsrcHeader & 0xFFFFFF00);
                    const rsrcFlag = (rsrcHeader & 0x000000FF);
                    const dataOffs = view.getUint32(dataIdx + 0x04, true);

                    // RSRCFHAS_NO_DATA_CHUNK
                    if (rsrcFlag === 0x02)
                        continue;

                    // Legacy resources don't have a size tag.

                    if (rsrcID === 0x01000000) { // VTF_LEGACY_RSRC_LOW_RES_IMAGE
                        // Skip.
                        continue;
                    }

                    if (rsrcID === 0x30000000) { // VTF_LEGACY_RSRC_IMAGE
                        imageDataIdx = dataOffs;
                        continue;
                    }

                    const dataSize = view.getUint32(dataOffs + 0x00, true);
                    const data = buffer.subarray(dataOffs + 0x04, dataSize);
                    this.resources.push({ rsrcID, data });
                }
            } else {
                if (lowresImageFormat !== 0xFFFFFFFF) {
                    const lowresDataSize = imageFormatCalcLevelSize(lowresImageFormat, lowresImageWidth, lowresImageHeight, 1);
                    const lowresData = buffer.subarray(dataIdx, lowresDataSize);
                    dataIdx += lowresDataSize;
                }

                imageDataIdx = dataIdx;
            }
        } else {
            throw "whoops";
        }

        const isCube = !!(this.flags & VTFFlags.ENVMAP);
        // The srgb flag in the file does nothing :/, we have to know from the material system instead.
        // const srgb = !!(this.flags & VTFFlags.SRGB);
        const nativeFormat = imageFormatToGfxFormat(device, this.format, srgb);
        // GPUs without S3TC, most phones among them, cannot take DXT at all, and a texture whose
        // size is not a multiple of 4 cannot be DXT on any. Asking for one throws, and the map
        // never draws, so those are decoded here instead.
        const dxtFormat = imageFormatIsBlockCompressed(this.format) && !device.queryTextureFormatSupported(nativeFormat, this.width, this.height)
            ? DXT_FORMAT[this.format] : undefined;
        let skipLevels = 0;
        if (dxtFormat !== undefined) {
            while (skipLevels < this.numLevels - 1 && Math.max(this.width >>> skipLevels, this.height >>> skipLevels) > MAX_DECODED_SIZE)
                skipLevels++;
        }
        const pixelFormat = dxtFormat === undefined ? nativeFormat : (srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM);
        const dimension = isCube ? GfxTextureDimension.Cube : GfxTextureDimension.n2D;
        const faceCount = (isCube ? 6 : 1);
        const hasSpheremap = this.versionMinor < 5;
        const faceDataCount = (isCube ? (6 + (hasSpheremap ? 1 : 0)) : 1);
        this.uploadedWidth = Math.max(this.width >>> skipLevels, 1);
        this.uploadedHeight = Math.max(this.height >>> skipLevels, 1);
        this.uploadedLevels = this.numLevels - skipLevels;
        const descriptor: GfxTextureDescriptor = {
            dimension, pixelFormat,
            width: Math.max(this.width >>> skipLevels, 1),
            height: Math.max(this.height >>> skipLevels, 1),
            numLevels: this.numLevels - skipLevels,
            depthOrArrayLayers: this.depth * faceCount,
            usage: GfxTextureUsage.Sampled,
        };

        for (let i = 0; i < this.numFrames; i++) {
            const texture = device.createTexture(descriptor);
            if (this.numFrames === 1)
                device.setResourceName(texture, this.name);
            else
                device.setResourceName(texture, `${this.name} [${i}]`);
            this.gfxTextures.push(texture);
        }

        const levelDatas: ArrayBufferView[][] = nArray(this.gfxTextures.length, () => []);

        // Mipmaps are stored from smallest to largest.
        for (let i = this.numLevels - 1; i >= 0; i--) {
            const mipWidth = Math.max(this.width >>> i, 1);
            const mipHeight = Math.max(this.height >>> i, 1);
            const faceSize = this.calcMipSize(i);
            const size = faceSize * faceCount;
            for (let j = 0; j < this.gfxTextures.length; j++) {
                const levelSlice = buffer.subarray(imageDataIdx, size);
                imageDataIdx += faceSize * faceDataCount;
                if (i < skipLevels)
                    continue;
                const levelData = dxtFormat === undefined
                    ? imageFormatConvertData(device, this.format, levelSlice, mipWidth, mipHeight, this.depth * faceCount)
                    : decodeDXT(dxtFormat, levelSlice.createTypedArray(Uint8Array), mipWidth, mipHeight, this.depth * faceCount);
                levelDatas[j].unshift(levelData);
            }
        }

        for (let i = 0; i < this.gfxTextures.length; i++)
            device.uploadTextureData(this.gfxTextures[i], 0, levelDatas[i]);

        const wrapS = !!(this.flags & VTFFlags.CLAMPS) ? GfxWrapMode.Clamp : GfxWrapMode.Repeat;
        const wrapT = !!(this.flags & VTFFlags.CLAMPT) ? GfxWrapMode.Clamp : GfxWrapMode.Repeat;

        const texFilter = !!(this.flags & VTFFlags.POINTSAMPLE) ? GfxTexFilterMode.Point : GfxTexFilterMode.Bilinear;
        const minFilter = texFilter;
        const magFilter = texFilter;
        const nomip = !!(this.flags & VTFFlags.NOMIP);
        const maxLOD = nomip ? 0 : undefined;
        const forceTrilinear = true;
        const mipFilter = (!nomip && (forceTrilinear || !!(this.flags & VTFFlags.TRILINEAR))) ? GfxMipFilterMode.Linear : GfxMipFilterMode.Nearest;

        const canSupportAnisotropy = texFilter === GfxTexFilterMode.Bilinear && mipFilter === GfxMipFilterMode.Linear;
        const maxAnisotropy = canSupportAnisotropy ? 16 : 1;
        this.samplerDescriptor = {
            wrapS, wrapT, minFilter, magFilter, mipFilter,
            minLOD: 0, maxLOD, maxAnisotropy,
        };
        this.gfxSampler = cache.createSampler(this.samplerDescriptor);
    }

    /**
     * LOCAL: draws at most `cap` pixels a side (null for full detail), as if the larger mip levels weren't in the
     * file, to judge how a texture-size limit would look. The sampler's minimum LOD skips them; nothing is re-uploaded.
     */
    public setLevelCap(cache: GfxRenderCache, cap: number | null): void {
        if (this.samplerDescriptor === null || this.samplerDescriptor.maxLOD === 0)
            return;
        let skip = 0;
        if (cap !== null)
            while (skip < this.uploadedLevels - 1 && Math.max(this.uploadedWidth >>> skip, this.uploadedHeight >>> skip) > cap)
                skip++;
        this.gfxSampler = cache.createSampler({ ...this.samplerDescriptor, minLOD: skip });
    }

    private calcMipSize(i: number, depth: number = this.depth): number {
        const mipWidth = Math.max(this.width >>> i, 1);
        const mipHeight = Math.max(this.height >>> i, 1);
        const mipDepth = Math.max(depth >>> i, 1);
        return imageFormatCalcLevelSize(this.format, mipWidth, mipHeight, mipDepth);
    }

    public fillTextureMapping(m: TextureMapping, frame: number = 0): void {
        if (this.gfxTextures.length === 0) {
            m.gfxTexture = null;
        } else {
            if (frame < 0 || frame >= this.gfxTextures.length)
                frame = 0;
            m.gfxTexture = assertExists(this.gfxTextures[frame]);
        }
        m.gfxSampler = this.gfxSampler;
        m.lateBinding = this.lateBinding;
    }

    public isTranslucent(): boolean {
        return !!(this.flags & (VTFFlags.ONEBITALPHA | VTFFlags.EIGHTBITALPHA));
    }

    public isCubemap(): boolean {
        return !!(this.flags & VTFFlags.ENVMAP);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTextures.length; i++)
            device.destroyTexture(this.gfxTextures[i]);
        this.gfxTextures.length = 0;
    }
}
