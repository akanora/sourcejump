// @ts-nocheck
// Stub of noclip's top-level Studio module (camera animation recorder + UI).
// We never instantiate the StudioPanel or recorder, so we only need to expose
// the symbols Camera.ts imports for type/value references. Replaces the
// full file (which depends on webm-muxer, an unwanted bundle dep).
//
// NOTE: This is *unrelated* to SourceEngine/Studio.ts (which loads MDL/VVD
// models — kept intact).

import { vec3 } from "gl-matrix";

export const CLAPBOARD_ICON = "";

export class InterpolationStep {
    public pos: vec3 = vec3.create();
    public lookAtPos: vec3 = vec3.create();
    public bank: number = 0;
}

export class CameraAnimationManager {
    public isAnimationPlaying = false;
}

export class StudioPanel {
    public elem: HTMLElement = document.createElement("div");
}
