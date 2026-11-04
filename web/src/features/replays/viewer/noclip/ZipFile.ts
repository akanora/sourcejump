// @ts-nocheck

// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

import ArrayBufferSlice from './ArrayBufferSlice';
import { readString, assert } from './util';
import * as Deflate from './Common/Compression/Deflate';
import * as LZMA from './Common/Compression/LZMA';

export enum ZipCompressionMethod {
    None = 0,
    DEFLATE = 8,
    LZMA = 14,
}

export interface ZipFileEntry {
    filename: string;
    data: ArrayBufferSlice;
    uncompressedSize?: number;
    compressionMethod?: ZipCompressionMethod;
}

export type ZipFile = ZipFileEntry[];

export function parseZipFile(buffer: ArrayBufferSlice): ZipFile {
    const view = buffer.createDataView();

    // Search for central directory.
    let centralDirectoryEndOffs = buffer.byteLength - 0x16;
    for (; centralDirectoryEndOffs > buffer.byteLength - 0x40; centralDirectoryEndOffs--) {
        const magic = 0x504B0506; // PK\x05\x06
        if (view.getUint32(centralDirectoryEndOffs, false) === magic)
            break;
    }
    assert(readString(buffer, centralDirectoryEndOffs + 0x00, 0x04) === 'PK\x05\x06');

    const numEntries = view.getUint16(centralDirectoryEndOffs + 0x08, true);
    const cdOffs = view.getUint32(centralDirectoryEndOffs + 0x10, true);

    const entries: ZipFileEntry[] = [];

    let cdIdx = cdOffs;
    for (let i = 0; i < numEntries; i++) {
        assert(readString(buffer, cdIdx + 0x00, 0x04) === 'PK\x01\x02');
        const compressionMethod = view.getUint16(cdIdx + 0x0A, true);
        const dataSize = view.getUint32(cdIdx + 0x14, true);
        const uncompressedSize = view.getUint32(cdIdx + 0x18, true);
        const filenameSize = view.getUint16(cdIdx + 0x1C, true);
        const extraSize = view.getUint16(cdIdx + 0x1E, true);
        const commentSize = view.getUint16(cdIdx + 0x20, true);
        const localHeaderOffset = view.getUint32(cdIdx + 0x2A, true);
        const filename = readString(buffer, cdIdx + 0x2E, filenameSize);
        cdIdx += 0x2E + filenameSize + extraSize + commentSize;

        assert(readString(buffer, localHeaderOffset + 0x00, 0x04) === 'PK\x03\x04');
        const filenameSize2 = view.getUint16(localHeaderOffset + 0x1A, true);
        assert(filenameSize === filenameSize2);
        const extraSize2 = view.getUint16(localHeaderOffset + 0x1C, true);
        const data = buffer.subarray(localHeaderOffset + 0x1E + filenameSize + extraSize2, dataSize);
        entries.push({ filename, data, uncompressedSize, compressionMethod });
    }

    return entries;
}

export function decompressZipFileEntry(entry: ZipFileEntry): ArrayBufferSlice {
    if (entry.compressionMethod === ZipCompressionMethod.None) {
        return entry.data;
    } else if (entry.compressionMethod === ZipCompressionMethod.DEFLATE) {
        return Deflate.decompress_raw(entry.data);
    } else if (entry.compressionMethod === ZipCompressionMethod.LZMA) {
        // Parse out the ZIP-style LZMA header. See APPNOTE.txt section 5.8.8
        const view = entry.data.createDataView();

        // First two bytes are LZMA version.
        // const versionMajor = view.getUint8(0x00);
        // const versionMinor = view.getUint8(0x00);
        // Next two bytes are "properties size", which should be 5 in all valid files.
        const propertiesSize = view.getUint16(0x02, true);
        assert(propertiesSize === 5);

        const properties = LZMA.decodeLZMAProperties(entry.data.subarray(0x04, propertiesSize));
        // Compressed data comes immediately after the properties.
        const compressedData = entry.data.slice(0x04 + propertiesSize);
        return LZMA.decompress(compressedData, properties, entry.uncompressedSize!);
    } else {
        throw "whoops";
    }
}
