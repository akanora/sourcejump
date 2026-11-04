// Packs a map file for the viewer in a worker (`viewerPack.worker.ts`), reporting progress as it goes.

export type PackRequest = { file: File };

export type PackReply =
  /** `stage`: 0 unpacking the .bz2, 1 stripping, 2 compressing (`done` of `total` bytes). */
  | { type: "progress"; stage: number; done: number; total: number }
  | {
      type: "done";
      file: ArrayBuffer;
      hash: string;
      sourceBytes: number;
      strippedBytes: number;
    }
  | { type: "failed"; reason: string };

export type Packed = Extract<PackReply, { type: "done" }>;

/** Where packing is, from 0 to 1. Compressing takes nearly all the time, so it fills most of the bar. */
export function packProgress(
  reply: Extract<PackReply, { type: "progress" }>,
): number {
  if (reply.stage < 2) return reply.stage === 0 ? 0 : 0.03;
  return 0.05 + 0.95 * (reply.total > 0 ? reply.done / reply.total : 0);
}

/** Packs `file`; `signal` stops the worker. Rejects with why the file couldn't be packed. */
export function packMap(
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Packed> {
  const worker = new Worker(
    new URL("./viewerPack.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  return new Promise<Packed>((resolve, reject) => {
    signal.addEventListener("abort", () => {
      worker.terminate();
      reject(new Error("Stopped."));
    });
    worker.onmessage = ({ data }: MessageEvent<PackReply>) => {
      if (data.type === "progress") return onProgress(packProgress(data));
      worker.terminate();
      if (data.type === "done") resolve(data);
      else reject(new Error(data.reason));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The packer stopped."));
    };
    worker.postMessage({ file } satisfies PackRequest);
  });
}
