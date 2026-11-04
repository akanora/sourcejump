// @ts-nocheck
// Slimmed-down stub of noclip's viewer.ts.
// We don't use noclip's full Viewer class — only the type interfaces that
// SourceEngine modules import. The render loop is driven externally from
// ReplayViewerOverlay.vue.
import { mat4 } from "gl-matrix";
import { Camera, CameraController } from "./Camera";
import { GfxDevice, GfxTexture } from "./gfx/platform/GfxPlatform";
import { AntialiasingMode } from "./gfx/helpers/RenderGraphHelpers";
import * as UI from "./ui";

export interface Texture {
    gfxTexture: GfxTexture;
    extraInfo?: Map<string, string> | null;
}

interface MouseLocation {
    mouseX: number;
    mouseY: number;
}

export interface DebugConsole {
    addInfoLine(line: string): void;
}

export interface ViewerRenderInput {
    camera: Camera;
    time: number;
    deltaTime: number;
    backbufferWidth: number;
    backbufferHeight: number;
    onscreenTexture: GfxTexture;
    antialiasingMode: AntialiasingMode;
    mouseLocation: MouseLocation;
    debugConsole: DebugConsole;
}

export interface SceneGfx {
    textureHolder?: UI.TextureListHolder;
    createPanels?(): UI.Panel[];
    createCameraController?(): CameraController;
    adjustCameraController?(c: CameraController): void;
    getDefaultWorldMatrix?(dst: mat4): void;
    serializeSaveState?(dst: ArrayBuffer, offs: number): number;
    deserializeSaveState?(src: ArrayBuffer, offs: number, byteLength: number): number;
    onstatechanged?: () => void;
    render(device: GfxDevice, renderInput: ViewerRenderInput): void;
    destroy(device: GfxDevice): void;
}

export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, devicePixelRatio: number): void {
    const nw = width * devicePixelRatio;
    const nh = height * devicePixelRatio;
    if (canvas.width === nw && canvas.height === nh) return;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = nw;
    canvas.height = nh;
}
