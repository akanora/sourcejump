// Draws a Source map into a canvas with noclip's renderer, from a view matrix in Source space, with zone boxes
// over it (from daf's replay viewer, noclipRenderer.ts; his asset fallback route comes with a later slice).
import { mat4 } from "gl-matrix";
import { Camera as NoclipCamera } from "./noclip/Camera";
import { DataFetcher } from "./noclip/DataFetcher";
import { DataShare } from "./noclip/DataShare";
import { AntialiasingMode } from "./noclip/gfx/helpers/RenderGraphHelpers";
import type {
  GfxDevice,
  GfxSwapChain,
  GfxTexture,
} from "./noclip/gfx/platform/GfxPlatform";
import {
  createSwapChainForWebGL2,
  GfxPlatformWebGL2Config,
} from "./noclip/gfx/platform/GfxPlatformWebGL2";
import type { SceneContext } from "./noclip/SceneBase";
import type { BSPFile } from "./noclip/SourceEngine/BSPFile";
import {
  BSPRenderer,
  SkyboxRenderer,
  SourceLoadContext,
  SourceRenderContext,
  SourceRenderer,
} from "./noclip/SourceEngine/Main";
import type { ViewerRenderInput } from "./noclip/viewer";
import {
  probeDevice,
  resolutionFor,
  type DeviceProfile,
  type ResolutionPolicy,
} from "./resolution";
import { PathRenderer, type PathSpec } from "./pathRenderer";
import { type BoxSpec, ZoneRenderer } from "./zoneRenderer";
import { loadMap } from "./loadMap";
import { measureMapLoad } from "./loadTiming";

// Source: +X forward, +Y left, +Z up. noclip: +X right, +Y up, -Z forward.
const NOCLIP_FROM_SOURCE = mat4.fromValues(
  0,
  0,
  -1,
  0,
  -1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
);
/** The vertical field of view, in radians. */
export const FOV_Y = (75 * Math.PI) / 180;

/** The scrubber's hover preview, in canvas pixels. */
export const PREVIEW_WIDTH = 240;
export const PREVIEW_HEIGHT = 135;

// Adaptive resolution: react to the p90 of a rolling window, not to one frame, with a wide dead band so the
// scale doesn't oscillate. The target is 4 ms over a 60 Hz frame: on a 60 Hz screen p90 always lands just
// past 16.7 ms even when every frame is on time, and one missed refresh takes it to 33.
const ADAPTIVE_WINDOW = 90;
const ADAPTIVE_INTERVAL_MS = 1000;
const ADAPTIVE_TARGET_MS = 1000 / 60 + 4;
const ADAPTIVE_RELAX_MS = 1000 / 90;
const ADAPTIVE_MIN_SCALE = 0.5;

class NoInput {
  isKeyDownEventTriggered(): boolean {
    return false;
  }
  isKeyDown(): boolean {
    return false;
  }
  dx = 0;
  dy = 0;
  dz = 0;
  button = 0;
}

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly swapChain: GfxSwapChain;
  private readonly device: GfxDevice;
  private readonly camera = new NoclipCamera();
  private readonly dataFetcher = new DataFetcher();
  private readonly lifetime = new AbortController();
  private readonly destroyablePool: { destroy: (device: GfxDevice) => void }[] =
    [];
  private readonly deviceProfile: DeviceProfile;
  private readonly viewerInput: ViewerRenderInput;
  private renderer: SourceRenderer | null = null;
  private renderContext: SourceRenderContext | null = null;
  private zoneRenderer: ZoneRenderer | null = null;
  private markerRenderer: ZoneRenderer | null = null;
  private pathRenderer: PathRenderer | null = null;
  private bspFile: BSPFile | null = null;
  private boxes: readonly BoxSpec[] = [];
  private markers: readonly BoxSpec[] = [];
  private paths: readonly PathSpec[] = [];
  private fullbright = false;
  private textureCap: number | null = null;
  private disposed = false;

  private readonly startTime = performance.now();
  private lastTime = this.startTime;

  // Resizing reconfigures the swap chain and the projection, so it happens only when something changed.
  private resolution: ResolutionPolicy = {
    renderScale: 1,
    dprCap: 2,
    adaptive: true,
  };
  private lastCss = { width: -1, height: -1, dpr: -1 };
  private lastPixels = { width: -1, height: -1 };
  private resizeDirty = true;

  private readonly frameTimes = new Float32Array(ADAPTIVE_WINDOW);
  private readonly sortScratch = new Float32Array(ADAPTIVE_WINDOW);
  private frameTimeCount = 0;
  private frameTimeIndex = 0;
  private adaptiveScale = 1;
  private lastAdaptiveCheck = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly stockContentUrl: string,
  ) {
    // antialias off: noclip renders to its own target and blits the resolve to the default framebuffer, which
    // a multisampled default framebuffer would make invalid. high-performance keeps Safari off the low-power
    // GPU path.
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!gl)
      throw new Error("This browser can't show replays: it has no WebGL2.");
    this.gl = gl;
    this.swapChain = createSwapChainForWebGL2(
      gl,
      new GfxPlatformWebGL2Config(),
    );
    this.device = this.swapChain.getDevice();
    this.camera.clipSpaceNearZ = this.device.queryVendorInfo().clipSpaceNearZ;
    // An infinite far plane: the skybox is drawn as a cube a million units out, and any finite far plane clips
    // it away.
    this.camera.setPerspective(FOV_Y, 1, 1, Infinity);
    this.deviceProfile = probeDevice(gl);
    // Left null, noclip's first fetch of an absolute URL throws; its own request cache (what init() would set
    // up) isn't wanted, since the browser's HTTP cache already keeps these files.
    this.dataFetcher.useDevelopmentStorage = false;
    this.viewerInput = {
      camera: this.camera,
      time: 0,
      deltaTime: 0,
      backbufferWidth: 1,
      backbufferHeight: 1,
      onscreenTexture: null as unknown as GfxTexture,
      antialiasingMode: AntialiasingMode.MSAAx4,
      mouseLocation: { mouseX: 0, mouseY: 0 },
      debugConsole: { addInfoLine: () => {} },
    } as ViewerRenderInput;
  }

  /** Downloads the map and stock indexes together, then builds the scene. */
  async load(
    mapUrl: string,
    mapName: string,
    signal: AbortSignal,
  ): Promise<void> {
    const loading = AbortSignal.any([signal, this.lifetime.signal]);
    loading.throwIfAborted();
    const abort = () => this.dataFetcher.abort();
    loading.addEventListener("abort", abort, { once: true });
    try {
      await measureMapLoad("map-ready", mapName, () =>
        this.loadScene(mapUrl, mapName, loading),
      );
    } finally {
      loading.removeEventListener("abort", abort);
    }
  }

  private async loadScene(
    mapUrl: string,
    mapName: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { bsp: bspFile, filesystem } = await loadMap(
      mapUrl,
      mapName,
      this.stockContentUrl,
      this.dataFetcher,
      signal,
    );
    signal.throwIfAborted();

    const renderContext = new SourceRenderContext(
      this.device,
      new SourceLoadContext(filesystem),
    );
    renderContext.worldLightingState.update(0);
    // Bloom and fog get in the way of reading a replay. Auto-exposure needs occlusion queries, which stall
    // Firefox (about 75% of frame time in daf's testing); the WebGL2 backend says when to avoid them.
    renderContext.enableBloom = false;
    renderContext.enableFog = false;
    renderContext.enableAutoExposure =
      this.device.queryLimits().occlusionQueriesRecommended;
    renderContext.toneMapParams.toneMapScale = 1.0;
    renderContext.toneMapParams.fullbright = this.fullbright ? 1 : 0;
    renderContext.materialCache.setTextureLevelCap(this.textureCap);
    this.renderContext = renderContext;

    const sceneContext = {
      device: this.device,
      dataFetcher: this.dataFetcher,
      dataShare: new DataShare(),
      uiContainer: document.createElement("div"),
      destroyablePool: this.destroyablePool,
      inputManager: new NoInput(),
      viewerInput: this.viewerInput,
      initialSceneTime: 0,
    } as unknown as SceneContext;
    const renderer = new SourceRenderer(sceneContext, renderContext);
    this.renderer = renderer;
    const zoneRenderer = new ZoneRenderer(renderContext.renderCache);
    zoneRenderer.setBoxes(this.boxes);
    this.zoneRenderer = zoneRenderer;
    const markerRenderer = new ZoneRenderer(renderContext.renderCache);
    markerRenderer.setBoxes(this.markers);
    this.markerRenderer = markerRenderer;
    const pathRenderer = new PathRenderer(
      this.device,
      renderContext.renderCache,
    );
    pathRenderer.setPaths(this.paths);
    this.pathRenderer = pathRenderer;
    renderer.prepareToRenderExtra = (renderInstManager, view) => {
      const bsp = renderer.bspRenderers[0]?.bsp;
      if (!bsp) return;
      const pixelsPerUnitAtDist1 =
        this.canvas.height / (2 * Math.tan(FOV_Y / 2));
      pathRenderer.prepareToRender(
        renderInstManager,
        view,
        pixelsPerUnitAtDist1,
      );
      for (const boxes of [zoneRenderer, markerRenderer])
        boxes.prepareToRender(
          renderInstManager,
          view,
          bsp,
          pixelsPerUnitAtDist1,
        );
    };

    if (bspFile.cubemaps[0] !== undefined)
      await renderContext.materialCache.bindLocalCubemap(bspFile.cubemaps[0]);
    signal.throwIfAborted();

    const bspRenderer = new BSPRenderer(renderContext, bspFile);
    // Own it before awaiting materials so a failed replay or cancellation also frees its GPU buffers.
    renderer.bspRenderers.push(bspRenderer);
    const skyname = bspRenderer.getWorldSpawn().skyname;
    if (skyname)
      renderer.skyboxRenderer = new SkyboxRenderer(renderContext, skyname);
    await measureMapLoad("materials", mapName, () =>
      bspRenderer.materialsLoaded(),
    );
    signal.throwIfAborted();
    this.bspFile = bspFile;
  }

  /** The loaded map's BSP, for tracing against its geometry; null until `load` finishes. */
  get bsp(): BSPFile | null {
    return this.bspFile;
  }

  /** Draws every surface fully lit, as `mat_fullbright 1` does, for maps too dark to read; from the next frame on. */
  setFullbright(on: boolean): void {
    this.fullbright = on;
    if (this.renderContext)
      this.renderContext.toneMapParams.fullbright = on ? 1 : 0;
  }

  /** Test only: draws textures at most `cap` pixels a side (null for full detail), to judge a size limit by eye. */
  setTextureCap(cap: number | null): void {
    this.textureCap = cap;
    this.renderContext?.materialCache.setTextureLevelCap(cap);
  }

  /** The boxes drawn over the map from the next frame on, replacing any before. */
  setBoxes(boxes: readonly BoxSpec[]): void {
    this.boxes = boxes;
    this.zoneRenderer?.setBoxes(boxes);
  }

  /** Boxes that move, such as the players in a replay, drawn apart from `setBoxes`; cheap to call every frame. */
  setMarkers(markers: readonly BoxSpec[]): void {
    this.markers = markers;
    this.markerRenderer?.setBoxes(markers);
  }

  /** Runs' routes drawn into the map, replacing any before (`pathRenderer.ts`). */
  setPaths(paths: readonly PathSpec[]): void {
    this.paths = paths;
    this.pathRenderer?.setPaths(paths);
  }

  /** Each route's playhead, in its own ticks and in `setPaths`' order; ticks before it are drawn as played. */
  setPathTicks(ticks: readonly number[]): void {
    this.pathRenderer?.setTicks(ticks);
  }

  /** Draws one frame from `viewMatrix`, a Source-space view matrix. */
  render(viewMatrix: mat4): void {
    if (!this.renderer || !this.renderContext || this.disposed) return;
    const now = performance.now();
    const time = (now - this.startTime) / 1000;
    const deltaTime = (now - this.lastTime) / 1000;
    this.updateAdaptiveScale(now, now - this.lastTime);
    this.lastTime = now;
    this.updateSize();

    this.applyViewMatrix(viewMatrix);
    this.renderContext.globalTime = time;
    this.renderContext.globalDeltaTime = deltaTime;
    const input = this.viewerInput;
    input.time = time * 1000;
    input.deltaTime = deltaTime * 1000;
    input.backbufferWidth = this.canvas.width;
    input.backbufferHeight = this.canvas.height;
    this.swapChain.configureSwapChain(this.canvas.width, this.canvas.height);
    input.onscreenTexture = this.swapChain.getOnscreenTexture();
    this.renderer.render(this.device, input);
  }

  /**
   * Draws the scrubber's hover preview into `target`, at PREVIEW_WIDTH x PREVIEW_HEIGHT. WebGL2's onscreen
   * texture only describes the default framebuffer, so shrinking it makes this pass land in a corner of the
   * canvas; the corner is copied out, and the main pass that follows draws over it. That costs one small
   * pass instead of a second full frame. Call it just before `render`.
   */
  renderPreview(viewMatrix: mat4, target: HTMLCanvasElement): void {
    if (!this.renderer || !this.renderContext || this.disposed) return;
    const context2d = target.getContext("2d");
    if (!context2d) return;
    const context = this.renderContext;
    const input = this.viewerInput;
    const saved = {
      autoExposure: context.enableAutoExposure,
      antialiasing: input.antialiasingMode,
      aspect: this.camera.aspect,
      deltaTime: input.deltaTime,
    };
    // A thumbnail needs no MSAA, and auto-exposure sampling it would pull the main view's exposure toward
    // whatever the preview shows. deltaTime 0 keeps animated materials owned by the main pass.
    context.enableAutoExposure = false;
    input.antialiasingMode = AntialiasingMode.None;
    input.deltaTime = 0;
    try {
      this.applyViewMatrix(viewMatrix);
      this.camera.setPerspective(
        FOV_Y,
        PREVIEW_WIDTH / PREVIEW_HEIGHT,
        1,
        Infinity,
      );
      input.backbufferWidth = PREVIEW_WIDTH;
      input.backbufferHeight = PREVIEW_HEIGHT;
      this.swapChain.configureSwapChain(PREVIEW_WIDTH, PREVIEW_HEIGHT);
      input.onscreenTexture = this.swapChain.getOnscreenTexture();
      this.renderer.render(this.device, input);
      // GL draws from the bottom-left corner of the default framebuffer.
      context2d.drawImage(
        this.canvas,
        0,
        Math.max(0, this.canvas.height - PREVIEW_HEIGHT),
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT,
        0,
        0,
        target.width,
        target.height,
      );
    } finally {
      context.enableAutoExposure = saved.autoExposure;
      input.antialiasingMode = saved.antialiasing;
      input.deltaTime = saved.deltaTime;
      this.camera.setPerspective(FOV_Y, saved.aspect, 1, Infinity);
    }
  }

  private applyViewMatrix(viewMatrix: mat4): void {
    mat4.invert(this.camera.worldMatrix, viewMatrix);
    mat4.mul(
      this.camera.worldMatrix,
      NOCLIP_FROM_SOURCE,
      this.camera.worldMatrix,
    );
    this.camera.worldMatrixUpdated();
  }

  private updateSize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const devicePixels = width * height * (window.devicePixelRatio || 1) ** 2;
    const policy = resolutionFor(this.deviceProfile, devicePixels);
    if (
      policy.renderScale !== this.resolution.renderScale ||
      policy.dprCap !== this.resolution.dprCap
    ) {
      this.resolution = policy;
      this.adaptiveScale = 1;
      this.resizeDirty = true;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, this.resolution.dprCap);
    const last = this.lastCss;
    if (
      !this.resizeDirty &&
      width === last.width &&
      height === last.height &&
      dpr === last.dpr
    )
      return;
    this.lastCss = { width, height, dpr };
    this.resizeDirty = false;

    const scale = dpr * this.resolution.renderScale * this.adaptiveScale;
    const pixelWidth = Math.max(1, Math.round(width * scale));
    const pixelHeight = Math.max(1, Math.round(height * scale));
    if (
      pixelWidth === this.lastPixels.width &&
      pixelHeight === this.lastPixels.height
    )
      return;
    this.lastPixels = { width: pixelWidth, height: pixelHeight };
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.camera.setPerspective(FOV_Y, pixelWidth / pixelHeight, 1, Infinity);
  }

  private updateAdaptiveScale(now: number, frameMs: number): void {
    this.frameTimes[this.frameTimeIndex] = frameMs;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % ADAPTIVE_WINDOW;
    if (this.frameTimeCount < ADAPTIVE_WINDOW) this.frameTimeCount++;
    if (!this.resolution.adaptive || this.frameTimeCount < ADAPTIVE_WINDOW)
      return;
    if (now - this.lastAdaptiveCheck < ADAPTIVE_INTERVAL_MS) return;
    this.lastAdaptiveCheck = now;

    this.sortScratch.set(this.frameTimes);
    this.sortScratch.sort();
    const p90 = this.sortScratch[Math.floor(ADAPTIVE_WINDOW * 0.9)]!;
    const previous = this.adaptiveScale;
    if (p90 > ADAPTIVE_TARGET_MS)
      this.adaptiveScale = Math.max(ADAPTIVE_MIN_SCALE, previous - 0.1);
    else if (p90 < ADAPTIVE_RELAX_MS)
      this.adaptiveScale = Math.min(1, previous + 0.05);
    if (this.adaptiveScale !== previous) {
      this.resizeDirty = true;
      this.frameTimeCount = 0;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    this.dataFetcher.abort();
    this.pathRenderer?.dispose();
    this.pathRenderer = null;
    this.renderer?.destroy(this.device);
    this.renderer = null;
    for (const destroyable of this.destroyablePool)
      destroyable.destroy(this.device);
    this.destroyablePool.length = 0;
    this.renderContext = null;
    // Frees the GPU memory now rather than whenever the canvas is collected.
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
