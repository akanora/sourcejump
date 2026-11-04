// Where the viewer looks from: the player's own eye, or a free camera flown with the mouse and WASD (from daf's
// replay viewer, camera.ts).
import { mat4, type vec3 } from "gl-matrix";
import type { PlaybackState } from "./playback";

// Plain numbers, not a Float32Array: this far from the origin float32 rounds the target by up to 0.001 units,
// and the view direction taken from it wobbles by that much every frame.
const eye: vec3 = [0, 0, 0];
const lookTarget: vec3 = [0, 0, 0];
const UP: vec3 = [0, 0, 1];

/**
 * Writes the Source-space view matrix for an eye `eyeHeight` above `position`, looking along recorded
 * `angles` (pitch, yaw in degrees; positive pitch looks down), into `out`.
 */
export function followViewMatrix(
  out: mat4,
  position: Float32Array,
  eyeHeight: number,
  angles: Float32Array,
): mat4 {
  eye[0] = position[0]!;
  eye[1] = position[1]!;
  eye[2] = position[2]! + eyeHeight;
  return lookAlong(
    out,
    (-angles[0]! * Math.PI) / 180,
    (angles[1]! * Math.PI) / 180,
  );
}

/** Looks from `eye` along pitch and yaw in radians (positive pitch looks up). */
function lookAlong(out: mat4, pitch: number, yaw: number): mat4 {
  const cosPitch = Math.cos(pitch);
  lookTarget[0] = eye[0] + Math.cos(yaw) * cosPitch;
  lookTarget[1] = eye[1] + Math.sin(yaw) * cosPitch;
  lookTarget[2] = eye[2] + Math.sin(pitch);
  return mat4.lookAt(out, eye, lookTarget, UP);
}

const FREECAM_SPEED = 800;
const FREECAM_SPRINT = 3;
const MOUSE_SENSITIVITY = 0.002;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

/**
 * Follows the replay until freecam is switched on. Freecam starts from the view the replay was showing and
 * captures the mouse; losing the capture (Escape, switching windows) drops back to following, since a freecam
 * with no mouse look and no obvious way out is the worse outcome. Where the browser refuses the capture
 * (embedded pages, some Safari and Firefox setups), freecam stays on and the view turns by dragging instead.
 */
export class Camera {
  readonly viewMatrix = mat4.create();
  /** Fired when freecam switches on or off, so the controls don't poll for it every frame. */
  onModeChange: (() => void) | null = null;

  private freecam = false;
  private captured = false;
  private readonly position: vec3 = [0, 0, 0];
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private readonly abort = new AbortController();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const signal = this.abort.signal;
    document.addEventListener(
      "keydown",
      (event) => {
        if (this.freecam) this.keys.add(event.key.toLowerCase());
      },
      { signal },
    );
    document.addEventListener(
      "keyup",
      (event) => this.keys.delete(event.key.toLowerCase()),
      { signal },
    );
    // A keyup never arrives if the window loses focus mid-press, which would leave the camera drifting.
    window.addEventListener("blur", () => this.keys.clear(), { signal });
    canvas.addEventListener(
      "mousemove",
      (event) => {
        const captured = document.pointerLockElement === canvas;
        if (!this.freecam || (!captured && (event.buttons & 1) === 0)) return;
        this.yaw -= event.movementX * MOUSE_SENSITIVITY;
        this.pitch -= event.movementY * MOUSE_SENSITIVITY;
        this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
      },
      { signal },
    );
    document.addEventListener(
      "pointerlockchange",
      () => {
        const captured = document.pointerLockElement === canvas;
        // The browser swallows Escape to release the lock, so this is the only place we hear about it.
        if (this.captured && !captured && this.freecam) this.setFreecam(false);
        this.captured = captured;
      },
      { signal },
    );
  }

  get isFreecam(): boolean {
    return this.freecam;
  }

  /** Must run inside a click or key press: browsers only capture the mouse for one. */
  setFreecam(enabled: boolean): void {
    if (enabled === this.freecam) return;
    this.freecam = enabled;
    this.keys.clear();
    if (enabled) {
      // A refused capture leaves drag-to-look. Safari returns nothing rather than a promise.
      const capture = this.canvas.requestPointerLock() as unknown;
      if (capture instanceof Promise) capture.catch(() => {});
    } else if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    this.onModeChange?.();
  }

  /** Moves the camera for a frame `seconds` long and returns its view matrix. */
  update(seconds: number, state: PlaybackState): mat4 {
    if (!this.freecam) {
      this.position[0] = state.position[0]!;
      this.position[1] = state.position[1]!;
      this.position[2] = state.position[2]! + state.eyeHeight;
      // Kept up to date so freecam starts from the recorded view rather than snapping to yaw 0.
      this.yaw = (state.angles[1]! * Math.PI) / 180;
      this.pitch = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, (-state.angles[0]! * Math.PI) / 180),
      );
      return followViewMatrix(
        this.viewMatrix,
        state.position,
        state.eyeHeight,
        state.angles,
      );
    }

    const distance =
      (this.keys.has("shift")
        ? FREECAM_SPEED * FREECAM_SPRINT
        : FREECAM_SPEED) * seconds;
    const cosPitch = Math.cos(this.pitch);
    const forward = [
      Math.cos(this.yaw) * cosPitch,
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
    ] as const;
    const right = [
      Math.cos(this.yaw - Math.PI / 2),
      Math.sin(this.yaw - Math.PI / 2),
    ] as const;
    const ahead = (this.keys.has("w") ? 1 : 0) - (this.keys.has("s") ? 1 : 0);
    const side = (this.keys.has("d") ? 1 : 0) - (this.keys.has("a") ? 1 : 0);
    this.position[0] += (forward[0] * ahead + right[0] * side) * distance;
    this.position[1] += (forward[1] * ahead + right[1] * side) * distance;
    this.position[2] += forward[2] * ahead * distance;

    eye[0] = this.position[0];
    eye[1] = this.position[1];
    eye[2] = this.position[2];
    return lookAlong(this.viewMatrix, this.pitch, this.yaw);
  }

  dispose(): void {
    this.abort.abort();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
