// Copyright (C) 2025  HighLite

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// Read-only access to a local Jagex (JS5) game cache, such as the OSRS cache
// RuneLite keeps in ~/.runelite/jagexcache/oldschool/LIVE. Nothing from the
// cache ships with HighLite; the user points this at a cache they already
// have. Layout follows RuneLite's cache library (DiskStorage, DataFile,
// IndexFile, Container, IndexData, ArchiveFiles).

import { ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
// @ts-ignore - no type declarations
import Bunzip from 'seek-bzip';

const SECTOR_SIZE = 520;
const INDEX_ENTRY_LENGTH = 6;
const REFERENCE_INDEX = 255;
const Compression = { None: 0, BZip2: 1, GZip: 2 };

export const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.runelite', 'jagexcache', 'oldschool', 'LIVE');

interface ArchiveInfo {
    id: number;
    fileIds: number[];
}

class JagexCache {
    private readonly dataFd: number;
    private readonly indexFds = new Map<number, number>();
    private readonly referenceTables = new Map<number, Map<number, ArchiveInfo>>();

    constructor(readonly dir: string) {
        this.dataFd = fs.openSync(path.join(dir, 'main_file_cache.dat2'), 'r');
    }

    close() {
        fs.closeSync(this.dataFd);
        for (const fd of this.indexFds.values()) fs.closeSync(fd);
    }

    private indexFd(index: number): number | null {
        if (!this.indexFds.has(index)) {
            const file = path.join(this.dir, `main_file_cache.idx${index}`);
            if (!fs.existsSync(file)) return null;
            this.indexFds.set(index, fs.openSync(file, 'r'));
        }
        return this.indexFds.get(index)!;
    }

    // The raw (still compressed) container for one archive: its index entry
    // gives the length and first sector; sectors chain to the next.
    private readRaw(index: number, archive: number): Buffer | null {
        const fd = this.indexFd(index);
        if (fd === null) return null;
        const entry = Buffer.alloc(INDEX_ENTRY_LENGTH);
        if (fs.readSync(fd, entry, 0, INDEX_ENTRY_LENGTH, archive * INDEX_ENTRY_LENGTH) !== INDEX_ENTRY_LENGTH) return null;
        const length = entry.readUIntBE(0, 3);
        let sector = entry.readUIntBE(3, 3);
        if (length <= 0 || sector <= 0) return null;

        const output = Buffer.alloc(length);
        const block = Buffer.alloc(SECTOR_SIZE);
        const largeArchive = archive > 0xffff;
        const headerSize = largeArchive ? 10 : 8;
        let read = 0;
        for (let part = 0; read < length; part++) {
            const chunk = Math.min(length - read, SECTOR_SIZE - headerSize);
            fs.readSync(this.dataFd, block, 0, headerSize + chunk, sector * SECTOR_SIZE);
            const currentArchive = largeArchive ? block.readUInt32BE(0) : block.readUInt16BE(0);
            const currentPart = block.readUInt16BE(largeArchive ? 4 : 2);
            const nextSector = block.readUIntBE(largeArchive ? 6 : 4, 3);
            const currentIndex = block[largeArchive ? 9 : 7];
            if (currentArchive !== archive || currentPart !== part || currentIndex !== index) return null;
            block.copy(output, read, headerSize, headerSize + chunk);
            read += chunk;
            sector = nextSector;
        }
        return output;
    }

    // Unwraps a container: [compression:u8][length:u32] then the data, with a
    // decompressed length first when compressed.
    private static decompress(container: Buffer): Buffer {
        const compression = container[0];
        const length = container.readUInt32BE(1);
        if (compression === Compression.None) return container.subarray(5, 5 + length);
        const data = container.subarray(9, 9 + length);
        if (compression === Compression.GZip) return zlib.gunzipSync(data);
        if (compression === Compression.BZip2) {
            // The cache strips the bzip2 stream header; put it back.
            return Buffer.from(Bunzip.decode(Buffer.concat([Buffer.from('BZh1'), data])));
        }
        throw new Error(`Unknown compression type ${compression}`);
    }

    // Which archives an index has and which files each archive holds, from the
    // reference table stored in index 255 (RuneLite's IndexData.load).
    referenceTable(index: number): Map<number, ArchiveInfo> {
        const cached = this.referenceTables.get(index);
        if (cached) return cached;
        const raw = this.readRaw(REFERENCE_INDEX, index);
        if (!raw) throw new Error(`No reference table for index ${index}`);
        const data = JagexCache.decompress(raw);
        let offset = 0;
        const u8 = () => data[offset++];
        const u16 = () => ((offset += 2), data.readUInt16BE(offset - 2));
        const i32 = () => ((offset += 4), data.readInt32BE(offset - 4));
        const protocol = u8();
        if (protocol >= 6) i32();
        const flags = u8();
        const named = (flags & 1) !== 0, sized = (flags & 4) !== 0;
        const bigSmart = () => (data[offset] & 0x80 ? i32() & 0x7fffffff : u16());
        const count = protocol >= 7 ? bigSmart : u16;
        const archiveCount = count();
        const ids: number[] = [];
        let last = 0;
        for (let i = 0; i < archiveCount; i++) ids.push((last += count()));
        if (named) offset += archiveCount * 4;
        offset += archiveCount * 4; // crc
        if (sized) offset += archiveCount * 8;
        offset += archiveCount * 4; // revision
        const fileCounts = ids.map(() => count());
        const table = new Map<number, ArchiveInfo>();
        ids.forEach((id, i) => {
            const fileIds: number[] = [];
            let lastFile = 0;
            for (let f = 0; f < fileCounts[i]; f++) fileIds.push((lastFile += count()));
            table.set(id, { id, fileIds });
        });
        this.referenceTables.set(index, table);
        return table;
    }

    // All files in one archive, split as RuneLite's ArchiveFiles.loadContents.
    files(index: number, archive: number): { id: number; data: Uint8Array }[] | null {
        const info = this.referenceTable(index).get(archive);
        const raw = info && this.readRaw(index, archive);
        if (!info || !raw) return null;
        const data = JagexCache.decompress(raw);
        const count = info.fileIds.length;
        if (count === 1) return [{ id: info.fileIds[0], data: new Uint8Array(data) }];

        const chunks = data[data.length - 1];
        let offset = data.length - 1 - chunks * count * 4;
        const chunkSizes: number[][] = info.fileIds.map(() => []);
        const sizes = new Array(count).fill(0);
        for (let chunk = 0; chunk < chunks; chunk++) {
            let size = 0;
            for (let f = 0; f < count; f++) {
                size += data.readInt32BE(offset);
                offset += 4;
                chunkSizes[f][chunk] = size;
                sizes[f] += size;
            }
        }
        const contents = sizes.map((size) => new Uint8Array(size));
        const written = new Array(count).fill(0);
        let read = 0;
        for (let chunk = 0; chunk < chunks; chunk++) {
            for (let f = 0; f < count; f++) {
                const size = chunkSizes[f][chunk];
                contents[f].set(data.subarray(read, read + size), written[f]);
                written[f] += size;
                read += size;
            }
        }
        return info.fileIds.map((id, f) => ({ id, data: contents[f] }));
    }
}

let cache: JagexCache | null = null;

function openCache(dir?: string): JagexCache {
    const target = dir || DEFAULT_CACHE_DIR;
    if (!cache || cache.dir !== target) {
        cache?.close();
        cache = new JagexCache(target);
    }
    return cache;
}

export default function registerOsrsCacheIPC() {
    ipcMain.handle('osrs-cache:open', (_event, dir?: string) => {
        try {
            const opened = openCache(dir);
            return { ok: true, dir: opened.dir };
        } catch (error) {
            return { ok: false, error: String(error) };
        }
    });
    ipcMain.handle('osrs-cache:archives', (_event, index: number) => {
        return cache ? [...cache.referenceTable(index).keys()] : null;
    });
    ipcMain.handle('osrs-cache:files', (_event, index: number, archive: number) => {
        return cache ? cache.files(index, archive) : null;
    });
}
