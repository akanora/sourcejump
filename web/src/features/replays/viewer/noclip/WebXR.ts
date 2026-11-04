// @ts-nocheck
// Stub for VR support. We don't render to XR sessions — these are imported
// by InputManager.ts and Camera.ts. Keep just the symbols referenced.

export class WebXRContext {
    public xrSession: XRSession | null = null;
    public isSupported = false;
    public onsupportedchanged: (() => void) | null = null;
    public onstart: (() => void) | null = null;
    public onend: (() => void) | null = null;
    public currentFrame: XRFrame | null = null;
}

export class WebXRInputManager {
    public update(): boolean { return false; }
}
