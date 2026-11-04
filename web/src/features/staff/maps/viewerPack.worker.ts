// Packs a map for the viewer off the page's thread: SourceJump's Rust packer built for WebAssembly
// (`api/crates/viewer-pack-web`, served as /viewer-pack.wasm by `just wasm`). One worker packs one map, so its
// memory goes when it ends.
import type { PackReply, PackRequest } from "./viewerPack";

interface Packer {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  pack(ptr: number, len: number): number;
  output_ptr(): number;
  output_len(): number;
  text_ptr(): number;
  text_len(): number;
  source_bytes(): number;
  stripped_bytes(): number;
}

const reply = (message: PackReply, transfer: Transferable[] = []) =>
  self.postMessage(message, { transfer });

self.onmessage = async ({ data }: MessageEvent<PackRequest>) => {
  try {
    const [{ instance }, input] = await Promise.all([
      WebAssembly.instantiateStreaming(fetch("/viewer-pack.wasm"), {
        env: {
          progress: (stage: number, done: number, total: number) =>
            reply({ type: "progress", stage, done, total }),
        },
      }),
      data.file.arrayBuffer(),
    ]);
    const packer = instance.exports as unknown as Packer;
    const ptr = packer.alloc(input.byteLength);
    new Uint8Array(packer.memory.buffer, ptr, input.byteLength).set(
      new Uint8Array(input),
    );
    const ok = packer.pack(ptr, input.byteLength) === 1;
    // Read after packing: memory may have grown, which replaces its buffer.
    const text = new TextDecoder().decode(
      new Uint8Array(
        packer.memory.buffer,
        packer.text_ptr(),
        packer.text_len(),
      ),
    );
    if (!ok) {
      reply({ type: "failed", reason: text });
      return;
    }
    const file = new Uint8Array(
      packer.memory.buffer,
      packer.output_ptr(),
      packer.output_len(),
    ).slice().buffer;
    reply(
      {
        type: "done",
        file,
        hash: text,
        sourceBytes: packer.source_bytes(),
        strippedBytes: packer.stripped_bytes(),
      },
      [file],
    );
  } catch (error) {
    reply({
      type: "failed",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};
