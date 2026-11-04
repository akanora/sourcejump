// Draws runs' routes into the map as beams: the stretch already played bright, the rest muted. A route can be
// tens of thousands of segments, so it's uploaded once and each segment is turned to face the camera on the GPU;
// a frame only sets where the playhead is.
import {
  fillMatrix4x4,
  fillVec4,
} from "./noclip/gfx/helpers/UniformBufferHelpers";
import { GfxShaderLibrary } from "./noclip/gfx/helpers/GfxShaderLibrary";
import { createBufferFromData } from "./noclip/gfx/helpers/BufferHelpers";
import {
  type GfxBindingLayoutDescriptor,
  type GfxBuffer,
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  GfxCullMode,
  type GfxDevice,
  GfxFormat,
  type GfxInputLayout,
  type GfxProgram,
  GfxVertexBufferFrequency,
} from "./noclip/gfx/platform/GfxPlatform";
import type { GfxRenderCache } from "./noclip/gfx/render/GfxRenderCache";
import type { GfxRenderInstManager } from "./noclip/gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "./noclip/Program";
import type { SourceEngineView } from "./noclip/SourceEngine/Main";

/** A run's route: positions per tick, split where it teleports, with where its playhead is. */
export interface PathSpec {
  /** x, y, z per tick. */
  positions: Float32Array;
  /** 1 where the step arriving at a tick is a teleport. */
  teleports: Uint8Array;
  /** The ticks drawn: the run, without the time before its start and after its finish. */
  from: number;
  to: number;
  /** 0–1 RGB. */
  color: readonly [number, number, number];
}

class PathProgram extends DeviceProgram {
  public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_ClipFromWorld;
    // xyz: the camera; w: the playhead, in ticks.
    vec4 u_CameraTick;
    // x: half width in units; y: the least half width per unit of distance, so far beams stay a pixel wide.
    vec4 u_Width;
    vec4 u_Played;
    vec4 u_Ahead;
};
`;

  public override vert = `
layout(location = 0) in vec3 a_From;
layout(location = 1) in vec3 a_To;
// x: which side of the beam (-1 or 1); y: which end (0 at a_From, 1 at a_To); z: the tick at this end.
layout(location = 2) in vec3 a_Corner;

out float v_Tick;

void main() {
    vec3 p = mix(a_From, a_To, a_Corner.y);
    vec3 side = cross(a_To - a_From, u_CameraTick.xyz - p);
    float len = length(side);
    float halfWidth = max(u_Width.x, u_Width.y * distance(u_CameraTick.xyz, p));
    p += len > 0.0 ? side / len * halfWidth * a_Corner.x : vec3(0.0);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(p, 1.0);
    v_Tick = a_Corner.z;
}
`;

  public override frag = `
in float v_Tick;

void main() {
    gl_FragColor = v_Tick <= u_CameraTick.w ? u_Played : u_Ahead;
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
  { numUniformBuffers: 1, numSamplers: 0 },
];

const HALF_WIDTH = 0.6;
const MIN_HALF_PIXELS = 1.1;
/** Points closer than this to the last one kept are skipped: a long run stays a few thousand segments. */
const MIN_STEP = 6;
/** The muted stretch ahead: the colour darkened towards the map. */
const AHEAD_SHADE = 0.4;
const FLOATS_PER_VERTEX = 9;

interface Path {
  buffer: GfxBuffer;
  vertexCount: number;
  color: readonly [number, number, number];
  tick: number;
}

/** The vertices of a route's beams: six per segment, two triangles. */
export function pathVertices(spec: PathSpec): Float32Array {
  const { positions, teleports, from, to } = spec;
  const segments: [number, number][] = [];
  let last = -1;
  for (let tick = from; tick <= to; tick++) {
    if (last >= 0 && teleports[tick]) last = -1;
    if (last < 0) {
      last = tick;
      continue;
    }
    const dx = positions[tick * 3]! - positions[last * 3]!;
    const dy = positions[tick * 3 + 1]! - positions[last * 3 + 1]!;
    const dz = positions[tick * 3 + 2]! - positions[last * 3 + 2]!;
    if (tick !== to && dx * dx + dy * dy + dz * dz < MIN_STEP * MIN_STEP)
      continue;
    segments.push([last, tick]);
    last = tick;
  }
  const out = new Float32Array(segments.length * 6 * FLOATS_PER_VERTEX);
  let o = 0;
  for (const [a, b] of segments) {
    // Two triangles: (a-, a+, b+) and (a-, b+, b-).
    for (const [side, end] of [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 0],
      [1, 1],
      [-1, 1],
    ] as const) {
      out.set(positions.subarray(a * 3, a * 3 + 3), o);
      out.set(positions.subarray(b * 3, b * 3 + 3), o + 3);
      out[o + 6] = side;
      out[o + 7] = end;
      out[o + 8] = end === 0 ? a : b;
      o += FLOATS_PER_VERTEX;
    }
  }
  return out;
}

export class PathRenderer {
  private readonly program: GfxProgram;
  private readonly inputLayout: GfxInputLayout;
  private paths: Path[] = [];

  constructor(
    private readonly device: GfxDevice,
    private readonly cache: GfxRenderCache,
  ) {
    this.program = cache.createProgram(new PathProgram());
    const attribute = (location: number, floats: number) => ({
      location,
      format: GfxFormat.F32_RGB,
      bufferIndex: 0,
      bufferByteOffset: floats * 4,
    });
    this.inputLayout = cache.createInputLayout({
      indexBufferFormat: null,
      vertexAttributeDescriptors: [
        attribute(0, 0),
        attribute(1, 3),
        attribute(2, 6),
      ],
      vertexBufferDescriptors: [
        {
          byteStride: FLOATS_PER_VERTEX * 4,
          frequency: GfxVertexBufferFrequency.PerVertex,
        },
      ],
    });
  }

  /** The routes drawn, replacing any before. Building one takes a few milliseconds; call it when they change. */
  setPaths(specs: readonly PathSpec[]): void {
    this.destroyPaths();
    this.paths = specs.flatMap((spec) => {
      const vertices = pathVertices(spec);
      if (vertices.length === 0) return [];
      return [
        {
          buffer: createBufferFromData(
            this.device,
            GfxBufferUsage.Vertex,
            GfxBufferFrequencyHint.Static,
            vertices.buffer,
          ),
          vertexCount: vertices.length / FLOATS_PER_VERTEX,
          color: spec.color,
          tick: 0,
        },
      ];
    });
  }

  /** Where each route's playhead is, in its own ticks, in the order the routes were set. */
  setTicks(ticks: readonly number[]): void {
    this.paths.forEach((path, index) => (path.tick = ticks[index] ?? 0));
  }

  prepareToRender(
    renderInstManager: GfxRenderInstManager,
    view: SourceEngineView,
    pixelsPerUnitAtDist1: number,
  ): void {
    // Last to first, so where routes overlap the first (the run being watched) is drawn over the others.
    for (const path of [...this.paths].reverse()) {
      const renderInst = renderInstManager.newRenderInst();
      renderInst.setBindingLayouts(bindingLayouts);
      renderInst.setGfxProgram(this.program);
      renderInst.setVertexInput(
        this.inputLayout,
        [{ buffer: path.buffer, byteOffset: 0 }],
        null,
      );
      renderInst.setMegaStateFlags({ cullMode: GfxCullMode.None });
      renderInst.setDrawCount(path.vertexCount);
      let offset = renderInst.allocateUniformBuffer(0, 16 + 4 * 4);
      const d = renderInst.mapUniformBufferF32(0);
      offset += fillMatrix4x4(d, offset, view.clipFromWorldMatrix);
      const [x, y, z] = view.cameraPos;
      offset += fillVec4(d, offset, x!, y!, z!, path.tick);
      offset += fillVec4(
        d,
        offset,
        HALF_WIDTH,
        MIN_HALF_PIXELS / pixelsPerUnitAtDist1,
      );
      const [r, g, b] = path.color;
      offset += fillVec4(d, offset, r, g, b, 1);
      fillVec4(d, offset, r * AHEAD_SHADE, g * AHEAD_SHADE, b * AHEAD_SHADE, 1);
      view.mainList.submitRenderInst(renderInst);
    }
  }

  dispose(): void {
    this.destroyPaths();
  }

  private destroyPaths(): void {
    for (const path of this.paths) this.device.destroyBuffer(path.buffer);
    this.paths = [];
  }
}
