// Reads an SJR replay (api/crates/api/src/replays/sjr.rs) into the per-tick arrays playback indexes into.
// The browser gunzips it natively; this undoes the byte planes and delta coding and reads the shavit header.

export interface Replay {
  /** x, y, z per tick, in Source units. */
  positions: Float32Array;
  /** pitch, yaw per tick, in degrees. */
  angles: Float32Array;
  buttons: Int32Array;
  flags: Int32Array;
  tickCount: number;
  tickRate: number;
  /** The run's time in seconds. */
  time: number;
  /** Ticks before the run started and after it finished; the run is [preFrames, tickCount - postFrames]. */
  preFrames: number;
  postFrames: number;
}

const MAGIC = "SJR\x01";
const FIRST_LINE = "12:{SHAVITREPLAYFORMAT}{FINAL}\n";
// Shavit format 12's frame: x, y, z, pitch, yaw, buttons, flags, move type, mouse movement, movement keys.
const WORDS = 10;

export async function loadReplay(
  url: string,
  signal: AbortSignal,
): Promise<Replay> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`The replay didn't load (${response.status}).`);
  const sjr = new Uint8Array(await response.arrayBuffer());
  const view = new DataView(sjr.buffer);
  if (String.fromCharCode(...sjr.subarray(0, 4)) !== MAGIC || sjr[12] !== WORDS)
    throw new Error("The replay file isn't one this viewer reads.");
  const headerLength = view.getUint32(4, true);
  const ticks = view.getUint32(8, true);
  const deltaOrders = sjr.subarray(13, 13 + WORDS);

  const gunzipped = new Blob([sjr.subarray(13 + WORDS)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const payload = new Uint8Array(await new Response(gunzipped).arrayBuffer());
  if (payload.length !== headerLength + ticks * WORDS * 4)
    throw new Error("The replay file is damaged.");

  const words = Array.from({ length: WORDS }, (_, word) =>
    readColumn(
      payload,
      headerLength + word * 4 * ticks,
      ticks,
      deltaOrders[word]!,
    ),
  );
  const [x, y, z, pitch, yaw] = words
    .slice(0, 5)
    .map((w) => new Float32Array(w.buffer));
  const positions = new Float32Array(ticks * 3);
  const angles = new Float32Array(ticks * 2);
  for (let tick = 0; tick < ticks; tick++) {
    positions[tick * 3] = x![tick]!;
    positions[tick * 3 + 1] = y![tick]!;
    positions[tick * 3 + 2] = z![tick]!;
    angles[tick * 2] = pitch![tick]!;
    angles[tick * 2 + 1] = yaw![tick]!;
  }
  const header = readHeader(payload.subarray(0, headerLength));
  return {
    positions,
    angles,
    buttons: new Int32Array(words[5]!.buffer),
    flags: new Int32Array(words[6]!.buffer),
    tickCount: ticks,
    ...header,
  };
}

/** One word's column: four byte planes, lowest first, then undo `deltaOrder` rounds of differences. */
function readColumn(
  payload: Uint8Array,
  start: number,
  ticks: number,
  deltaOrder: number,
): Uint32Array {
  const column = new Uint32Array(ticks);
  for (let i = 0; i < ticks; i++)
    column[i] =
      (payload[start + i]! |
        (payload[start + ticks + i]! << 8) |
        (payload[start + 2 * ticks + i]! << 16) |
        (payload[start + 3 * ticks + i]! << 24)) >>>
      0;
  for (let round = 0; round < deltaOrder; round++)
    for (let i = 1; i < ticks; i++)
      column[i] = (column[i]! + column[i - 1]!) >>> 0;
  return column;
}

/** The fields of shavit's header playback needs (layout in api/crates/api/src/replays/header.rs). */
function readHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The map name, NUL-terminated, then style and track (one byte each).
  let at = bytes.indexOf(0, FIRST_LINE.length) + 1 + 2;
  const field = (read: (offset: number) => number) => {
    const value = read(at);
    at += 4;
    return value;
  };
  const preFrames = field((o) => view.getInt32(o, true));
  field((o) => view.getInt32(o, true)); // run frames
  const time = field((o) => view.getFloat32(o, true));
  field((o) => view.getUint32(o, true)); // account ID
  const postFrames = field((o) => view.getInt32(o, true));
  const tickRate = field((o) => view.getFloat32(o, true));
  if (!(tickRate > 0 && tickRate <= 1000))
    throw new Error("The replay file is damaged.");
  return { preFrames, postFrames, time, tickRate };
}
