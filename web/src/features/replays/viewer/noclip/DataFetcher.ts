// @ts-nocheck

import ArrayBufferSlice from './ArrayBufferSlice';
import { assert, assertExists } from './util';
import { IS_DEVELOPMENT } from './BuildVersion';
import { ProgressMeter } from './SceneBase';

export interface NamedArrayBufferSlice extends ArrayBufferSlice {
    name: string;
}

function getDataStorageBaseURL(isDevelopment: boolean): string {
    if (isDevelopment)
        return `/data`;
    return import.meta.env.PUBLIC_STORAGE_URL;
}

function getDataURLForPath(url: string, isDevelopment: boolean): string {
    if (url.startsWith('https://') || url.startsWith('http://'))
        return url;

    assert(!url.startsWith(`data/`));
    return `${getDataStorageBaseURL(isDevelopment)}/${url}`;
}

export type AbortedCallback = () => void;

class DataFetcherRequest {
    public declare promise: Promise<NamedArrayBufferSlice>;
    public progress: number = 0;
    public ondone: (() => void) | null = null;
    public onprogress: (() => void) | null = null;

    private started = false;
    private declare request: Request;
    private response: Response | null = null;
    private abortController = new AbortController();
    private declare resolve: (slice: NamedArrayBufferSlice) => void;
    private declare reject: (e: Error | null) => void;
    private retriesLeft = 2;
    private rateLimitWaits = 0;

    constructor(private cache: Cache | null, public url: string, private options: DataFetcherOptions) {
        this.request = new Request(this.url, { signal: this.abortController.signal });

        if (this.options.rangeStart !== undefined && this.options.rangeSize !== undefined) {
            const rangeStart = Number(this.options.rangeStart);
            const rangeSize = Number(this.options.rangeSize);
            let rangeEnd = rangeStart + rangeSize - Number(1);
            // LOCAL: Chrome keeps one HTTP cache entry per URL, and range requests that overlap in time on one
            // entry go to the network uncached, so every visit re-downloaded the stock textures. Naming the range
            // in the query gives each its own entry; storage ignores the parameter.
            const rangeUrl = new URL(this.url, globalThis.location?.href);
            rangeUrl.searchParams.set('range', `${rangeStart}-${rangeEnd}`);
            this.request = new Request(rangeUrl, { signal: this.abortController.signal });
            this.request.headers.set('range', `bytes=${rangeStart}-${rangeEnd}`);

            // Partial responses are unsupported with Cache, for some lovely reason.
            this.cache = null;
        }

        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    public inFlight(): boolean {
        return this.started;
    }

    private isConsidered404Error(): boolean {
        const response = this.response;

        if (response === null)
            return false;

        // In production environments, 404s sometimes show up as CORS errors, which come back as status 200.
        if (response.status === 404)
            return true;

        return false;
    }

    private resolveError(): boolean {
        const allow404 = !!this.options.allow404;
        if ((allow404 && this.isConsidered404Error()) || this.abortController.signal.aborted) {
            const emptySlice = new ArrayBufferSlice(new ArrayBuffer(0)) as NamedArrayBufferSlice;
            emptySlice.name = this.url;
            this.resolve(emptySlice);
            this.done();
            return true;
        }

        const response = this.response;
        let status = 999;
        if (response !== null) {
            status = response.status;
            if (status === 200 || status === 206)
                return false;
        }

        // A 429 is the replay API limiting how many requests one client has open. It clears as
        // this client's other requests finish, so wait for that rather than spend the retries
        // at once and lose the file.
        if (status === 429 && this.rateLimitWaits < 8) {
            this.rateLimitWaits++;
            this.response = null;
            setTimeout(() => this.start(), Math.min(250 * 2 ** this.rateLimitWaits, 2000));
            return true;
        }

        if (this.retriesLeft > 0) {
            this.retriesLeft--;
            this.response = null;
            this.start();
            return true;
        } else {
            console.error(`DataFetcherRequest: Received non-success status code ${status} when fetching file ${this.url}.`);
            this.reject(null);
            this.done();
            return true;
        }
    }

    private resolveArrayBuffer(buffer: ArrayBufferLike) {
        const slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
        slice.name = this.url;
        this.resolve(slice);
        this.done();
    }

    public async start() {
        // LOCAL: a scheduled retry must not restart work after its owner was closed.
        if (this.abortController.signal.aborted)
            return;
        this.started = true;

        if (this.cache !== null) {
            const match = await this.cache.match(this.request).catch(error => {
                console.error("Cache error:", error);
            });
            
            if (match !== undefined) {
                const arrayBuffer = await match.arrayBuffer();
                this.resolveArrayBuffer(arrayBuffer);
                return;
            }
        }

        assert(this.response === null);
        try {
            this.response = await fetch(this.request);
        } catch (e: unknown) {
            // Error handling below.
        }

        if (this.resolveError())
            return;

        const response = this.response!;

        if (response.status === 206) {
            // Partial responses are unsupported with Cache, for some lovely reason.
            this.cache = null;
        }

        // LOCAL: HTTP caching needs no extra response body. Clone only for noclip's optional Cache API store.
        const responseClone = this.cache !== null ? response.clone() : null;

        let contentLengthStr = response.headers.get('content-length');
        if (contentLengthStr === null)
            contentLengthStr = '1';

        // XXX(jstpierre): There's no way to correctly compute progress in fetch()
        // under the duress of Content-Encoding compression:
        // https://github.com/whatwg/fetch/issues/1358
        const contentLength = parseInt(contentLengthStr, 10);

        const reader = response.body!.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytesReceived = 0;
        while (true) {
            try {
                const { done, value } = await reader.read();
                if (done)
                    break;

                chunks.push(value!);
                totalBytesReceived += value!.byteLength;
                this.progress = Math.min(totalBytesReceived / contentLength, 1);

                if (this.onprogress !== null)
                    this.onprogress();
            } catch (e) {
                // LOCAL: a failed body is not a successful partial asset; use the normal retry path.
                this.response = null;
                break;
            }
        }

        if (this.resolveError())
            return;

        // LOCAL: assemble the bytes already read for progress instead of buffering and reading a second stream.
        // A lone chunk can be a view into a larger buffer, so only reuse buffers that match the body exactly.
        const first = chunks[0];
        let arrayBuffer: ArrayBuffer;
        if (chunks.length === 1 && first.byteOffset === 0 && first.byteLength === first.buffer.byteLength) {
            arrayBuffer = first.buffer as ArrayBuffer;
        } else {
            const bytes = new Uint8Array(totalBytesReceived);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            arrayBuffer = bytes.buffer;
        }

        // LOCAL: Chrome's HTTP cache can answer one of two concurrent range requests on the same file with the
        // other's bytes (a 900-byte texture header read and the full texture, both from one offset, came back
        // as 900 bytes each). A short body is the tell; fetch it again past the cache rather than hand the
        // parser a truncated file (the intermittent StudioModelData RangeError on bhop_maze's sofa_chair).
        const rangeSize = this.options.rangeSize !== undefined ? Number(this.options.rangeSize) : null;
        if (response.status === 206 && rangeSize !== null && arrayBuffer.byteLength !== rangeSize && this.retriesLeft > 0) {
            console.warn(`[replay] ${this.url}: asked for ${rangeSize} bytes, got ${arrayBuffer.byteLength}; fetching again`);
            this.retriesLeft--;
            this.response = null;
            this.request = new Request(this.request, { cache: 'no-store' });
            this.start();
            return;
        }

        this.resolveArrayBuffer(arrayBuffer);

        if (this.cache !== null && responseClone !== null)
            await this.cache.put(this.request, responseClone);

        this.response = null;
    }

    private done(): void {
        this.progress = 1.0;
        if (this.onprogress !== null)
            this.onprogress();
        if (this.ondone !== null)
            this.ondone();
    }

    public destroy(): void {
        this.response = null;
        this.onprogress = null;
        this.ondone = null;
    }

    public abort(): void {
        if (this.abortController.signal.aborted)
            return;
        this.abortController.abort();
        if (this.options.abortedCallback !== undefined)
            this.options.abortedCallback();
        this.destroy();
        // LOCAL: queued requests have no running fetch to settle them; do not strand materialsLoaded().
        this.resolveError();
    }
}

interface DataFetcherOptions {
    debugName?: string;
    allow404?: boolean;
    abortedCallback?: AbortedCallback;
    /**
     * rangeStart: 0-based byte index for the range Header. Use to request part of a file.
     * Must be specified in tandem with rangeSize.
     */
    rangeStart?: number | bigint;
    /**
     * rangeSize: Length for the range header.
     * Must be specified together with rangeStart.
     */
    rangeSize?: number | bigint;
}

class DataFetcherMount {
    constructor(private mount: FileSystemDirectoryHandle) {
    }

    private async getFileHandle(path: string): Promise<FileSystemFileHandle | null> {
        let directory: FileSystemDirectoryHandle | undefined = this.mount;
        const parts = path.split('/');
        while (parts.length > 1) {
            try {
                directory = await directory!.getDirectoryHandle(parts.shift()!);
            } catch(e) {
                return null;
            }
        }

        try {
            return await directory!.getFileHandle(parts.shift()!);
        } catch(e) {
            return null;
        }
    }

    public async fetchData(path: string, options: DataFetcherOptions): Promise<NamedArrayBufferSlice | null> {
        const fileHandle = await this.getFileHandle(path);
        if (fileHandle === null)
            return null;

        let blob: Blob = await fileHandle.getFile();
        if (options.rangeStart !== undefined && options.rangeSize !== undefined)
            blob = blob.slice(Number(options.rangeStart), Number(options.rangeSize));

        const arrayBuffer = await blob.arrayBuffer();
        const arrayBufferSlice = new ArrayBufferSlice(arrayBuffer) as NamedArrayBufferSlice;
        arrayBufferSlice.name = path;
        return arrayBufferSlice;
    }
}

declare global {
    interface Window {
        showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
    }
}

export class DataFetcher {
    public requests: DataFetcherRequest[] = [];
    public doneRequestCount: number = 0;
    public maxParallelRequests: number = 10;
    public aborted: boolean = false;
    public useDevelopmentStorage: boolean | null = null;
    private cache: Cache | null = null;
    private mounts: DataFetcherMount[] = [];
    public debug = IS_DEVELOPMENT;

    constructor(public progressMeter: ProgressMeter | null = null) {
    }

    public async init() {
        if (IS_DEVELOPMENT) {
            // Check for the existence of a /data directory.
            // TODO(jstpierre): Put back this fix for rsbuild.
            this.useDevelopmentStorage = true;
        } else {
            this.useDevelopmentStorage = false;
        }

        const REQUEST_CACHE_NAME = `request-cache-v1`;
        try {
            this.cache = await caches.open(REQUEST_CACHE_NAME);
        } catch(e) {
            // Cache failed to open. That's OK, just don't use it.
        }
    }

    public async clearCache() {
        if (this.cache !== null) {
            for (const key of await this.cache.keys())
                this.cache.delete(key);
        }
    }

    public async mount() {
        let directory: FileSystemDirectoryHandle;

        try {
            directory = await window.showDirectoryPicker();
        } catch(e) {
            // AbortError, likely.
            return;
        }

        const mount = new DataFetcherMount(directory);
        this.mounts.push(mount);
    }

    private manageCache(): void {
    }

    public abort(): void {
        this.aborted = true;
        for (let i = 0; i < this.requests.length; i++)
            this.requests[i].abort();
        this.requests = [];
    }

    public reset(): void {
        this.aborted = false;
        this.doneRequestCount = 0;
    }

    public waitForLoad(): Promise<void> {
        return Promise.all(this.requests.map((request) => request.promise)) as Promise<any>;
    }

    private debugDisplay: HTMLElement | null = null;
    private debugCalcProgress(): void {
        if (!this.debug) {
            if (this.debugDisplay !== null)
                this.debugDisplay.parentElement!.removeChild(this.debugDisplay)

            return;
        }

        if (this.debugDisplay === null) {
            this.debugDisplay = document.createElement('div');
            this.debugDisplay.style.position = 'absolute';
            this.debugDisplay.style.bottom = '16px';
            this.debugDisplay.style.right = '16px';
            this.debugDisplay.style.color = 'white';
            this.debugDisplay.style.textShadow = '1px 1px 2px black';
            this.debugDisplay.style.font = '12pt monospace';
            this.debugDisplay.style.whiteSpace = `pre`;
            this.debugDisplay.style.textAlign = `right`;
            this.debugDisplay.style.pointerEvents = `none`;
            window.main.ui.elem.appendChild(this.debugDisplay);
        }

        let S = '';
        for (let i = 0; i < this.requests.length; i++)
            S += `${this.requests[i].url} ${(this.requests[i].progress * 100) | 0}%\n`;
        this.debugDisplay.textContent = S;
    }

    private calcProgress(): number {
        if (this.requests.length === 0)
            return 1;

        let n = 0;
        for (let i = 0; i < this.requests.length; i++)
            n += this.requests[i].progress;
        n += this.doneRequestCount;
        return n / (this.requests.length + this.doneRequestCount);
    }

    public setProgress(): void {
        if (this.progressMeter !== null)
            this.progressMeter.setProgress(this.calcProgress());
    }

    private pump(): void {
        for (let i = 0; i < Math.min(this.requests.length, this.maxParallelRequests); i++) {
            if (!this.requests[i].inFlight())
                this.requests[i].start();
        }
    }

    public fetchURL(url: string, options: DataFetcherOptions = {}): Promise<NamedArrayBufferSlice> {
        if (this.aborted)
            throw new Error("Tried to fetch new data while aborted; should not happen");

        const request = new DataFetcherRequest(this.cache, url, options);
        this.requests.push(request);
        request.ondone = () => {
            this.doneRequestCount++;
            request.destroy();
            this.requests.splice(this.requests.indexOf(request), 1);
            this.pump();
            this.manageCache();
            this.debugCalcProgress();
        };
        request.onprogress = () => {
            this.debugCalcProgress();
            this.setProgress();
        };
        this.pump();
        return request.promise!;
    }

    public getDataURLForPath(path: string): string {
        return getDataURLForPath(path, assertExists(this.useDevelopmentStorage));
    }

    public async fetchData(path: string, options: DataFetcherOptions = {}): Promise<NamedArrayBufferSlice> {
        for (let i = 0; i < this.mounts.length; i++) {
            const mount = this.mounts[i];
            const fileData = await mount.fetchData(path, options);
            if (fileData !== null)
                return fileData;
        }

        const url = this.getDataURLForPath(path);
        return await this.fetchURL(url, options);
    }
}
