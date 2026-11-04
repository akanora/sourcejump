// Draws zone boxes into the map as beams, the way the game draws shavit's zones (from daf's replay viewer,
// zoneRenderer.ts, without the shaded trigger volumes: only outlines are needed so far).
import { type ReadonlyVec3, vec3 } from "gl-matrix";
import { AABB } from "./noclip/Geometry";
import { fillMatrix4x4 } from "./noclip/gfx/helpers/UniformBufferHelpers";
import { GfxShaderLibrary } from "./noclip/gfx/helpers/GfxShaderLibrary";
import {
  type GfxBindingLayoutDescriptor,
  GfxBufferUsage,
  GfxCullMode,
  GfxFormat,
  type GfxInputLayout,
  type GfxMegaStateDescriptor,
  type GfxProgram,
  GfxVertexBufferFrequency,
} from "./noclip/gfx/platform/GfxPlatform";
import type { GfxRenderCache } from "./noclip/gfx/render/GfxRenderCache";
import type { GfxRenderInstManager } from "./noclip/gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "./noclip/Program";
import type { BSPFile } from "./noclip/SourceEngine/BSPFile";
import type { SourceEngineView } from "./noclip/SourceEngine/Main";

/** A box in Source units, with its colour as 0–1 RGB. */
export interface BoxSpec {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  color: readonly [number, number, number];
}

class ZoneProgram extends DeviceProgram {
  public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_ClipFromWorld;
};
`;

  public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;

out vec3 v_Color;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_Color = a_Color;
}
`;

  public override frag = `
in vec3 v_Color;

void main() {
    gl_FragColor = vec4(v_Color, 1.0);
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
  { numUniformBuffers: 1, numSamplers: 0 },
];
const EDGE_MEGA_STATE: Partial<GfxMegaStateDescriptor> = {
  cullMode: GfxCullMode.None,
};

const BEAM_HALF_WIDTH = 0.25;
/** Minimum on-screen half-width, in pixels, so an outline never thins away. */
const BEAM_MIN_HALF_PIXELS = 0.9;

const BOX_EDGES = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;
const FLOATS_PER_VERTEX = 6;
const VERTICES_PER_BOX = BOX_EDGES.length * 6;

interface ZoneBox {
  aabb: AABB;
  corners: vec3[];
  color: readonly [number, number, number];
}

const scratchMid = vec3.create();
const scratchToCam = vec3.create();
const scratchDir = vec3.create();
const scratchSide = vec3.create();
const scratchCorner = vec3.create();

export class ZoneRenderer {
  private readonly program: GfxProgram;
  private readonly inputLayout: GfxInputLayout;
  private boxes: ZoneBox[] = [];
  private vertexData = new Float32Array(0);
  private vertexCount = 0;

  constructor(private readonly cache: GfxRenderCache) {
    this.program = cache.createProgram(new ZoneProgram());
    this.inputLayout = cache.createInputLayout({
      indexBufferFormat: null,
      vertexAttributeDescriptors: [
        {
          location: 0,
          format: GfxFormat.F32_RGB,
          bufferIndex: 0,
          bufferByteOffset: 0,
        },
        {
          location: 1,
          format: GfxFormat.F32_RGB,
          bufferIndex: 0,
          bufferByteOffset: 3 * 4,
        },
      ],
      vertexBufferDescriptors: [
        {
          byteStride: FLOATS_PER_VERTEX * 4,
          frequency: GfxVertexBufferFrequency.PerVertex,
        },
      ],
    });
  }

  /** Everything drawn as a box, replacing what was there. Cheap enough to call on every change. */
  setBoxes(boxes: readonly BoxSpec[]): void {
    this.boxes = boxes.map(({ min, max, color }) => ({
      aabb: new AABB(min[0], min[1], min[2], max[0], max[1], max[2]),
      corners: Array.from({ length: 8 }, (_, i) =>
        vec3.fromValues(
          i & 1 ? min[0] : max[0],
          i & 2 ? min[1] : max[1],
          i & 4 ? min[2] : max[2],
        ),
      ),
      color,
    }));
    this.vertexData = new Float32Array(
      this.boxes.length * VERTICES_PER_BOX * FLOATS_PER_VERTEX,
    );
  }

  // Edges are quads facing the camera with a world-space width, like Source beams, but never thinner than one
  // pixel so distant zones don't dissolve. Beams leave no depth behind them, so the PVS is what stops a zone
  // showing through a wall.
  prepareToRender(
    renderInstManager: GfxRenderInstManager,
    view: SourceEngineView,
    bsp: BSPFile,
    pixelsPerUnitAtDist1: number,
  ): void {
    if (this.boxes.length === 0) return;
    this.vertexCount = 0;
    for (const box of this.boxes) {
      if (!view.frustum.contains(box.aabb)) continue;
      if (!bsp.pvsTouchesAABB(box.aabb, view.pvs)) continue;
      for (const [a, b] of BOX_EDGES)
        this.emitBeam(
          box.corners[a]!,
          box.corners[b]!,
          box.color,
          view.cameraPos,
          pixelsPerUnitAtDist1,
        );
    }
    if (this.vertexCount === 0) return;
    const renderInst = renderInstManager.newRenderInst();
    renderInst.setBindingLayouts(bindingLayouts);
    renderInst.setGfxProgram(this.program);
    const bytes = new Uint8Array(
      this.vertexData.buffer,
      0,
      this.vertexCount * FLOATS_PER_VERTEX * 4,
    );
    renderInst.setVertexInput(
      this.inputLayout,
      [
        this.cache.dynamicBufferCache.allocateData(
          GfxBufferUsage.Vertex,
          bytes,
        ),
      ],
      null,
    );
    renderInst.setMegaStateFlags(EDGE_MEGA_STATE);
    renderInst.setDrawCount(this.vertexCount);
    const offset = renderInst.allocateUniformBuffer(0, 16);
    fillMatrix4x4(
      renderInst.mapUniformBufferF32(0),
      offset,
      view.clipFromWorldMatrix,
    );
    view.mainList.submitRenderInst(renderInst);
  }

  private emitBeam(
    p0: ReadonlyVec3,
    p1: ReadonlyVec3,
    color: readonly [number, number, number],
    cameraPos: ReadonlyVec3,
    pixelsPerUnitAtDist1: number,
  ): void {
    vec3.lerp(scratchMid, p0, p1, 0.5);
    vec3.sub(scratchToCam, cameraPos, scratchMid);
    vec3.sub(scratchDir, p1, p0);
    vec3.cross(scratchSide, scratchDir, scratchToCam);
    const sideLength = vec3.len(scratchSide);
    if (sideLength === 0) return;
    const distance = vec3.len(scratchToCam);
    const halfWidth = Math.max(
      BEAM_HALF_WIDTH,
      (BEAM_MIN_HALF_PIXELS * distance) / pixelsPerUnitAtDist1,
    );
    vec3.scale(scratchSide, scratchSide, halfWidth / sideLength);
    this.emitVertex(p0, -1, color);
    this.emitVertex(p0, 1, color);
    this.emitVertex(p1, 1, color);
    this.emitVertex(p0, -1, color);
    this.emitVertex(p1, 1, color);
    this.emitVertex(p1, -1, color);
  }

  private emitVertex(
    p: ReadonlyVec3,
    sideSign: number,
    color: readonly [number, number, number],
  ): void {
    vec3.scaleAndAdd(scratchCorner, p, scratchSide, sideSign);
    const o = this.vertexCount * FLOATS_PER_VERTEX;
    this.vertexData.set(scratchCorner, o);
    this.vertexData.set(color, o + 3);
    this.vertexCount++;
  }
}
