// The zone editor's 3D view: the map as the replay viewer draws it, flown with WASD and a right-drag, with the
// zones and the box being placed drawn over it. The cursor aims: a left click reports the floor point under it.
// The page imports this only when the editor opens, so the renderer stays out of every other page's bundle.
import { mat4, vec3 } from "gl-matrix";
import { tokenColor } from "@/features/replays/viewer/colors";
import { FOV_Y, Renderer } from "@/features/replays/viewer/renderer";
import { traceSolid } from "@/features/replays/viewer/trace";
import type { BoxSpec } from "@/features/replays/viewer/zoneRenderer";
import {
  type Box,
  type Placing,
  type Point,
  previewBox,
  snapPoint,
  zoneBox,
} from "./zoneTool";
import { startView } from "./zoneEditorStart";
import type { Zone } from "./zones";

export interface ZoneEditorSource {
  mapName: string;
  mapUrl: string;
  stockContentUrl: string;
}

export interface ZoneEditorEvents {
  /** A left click on the map, at the snapped floor point under the cursor. */
  onPlace: (point: Point) => void;
  /** The mouse wheel turned while a box's height is being set: steps up (positive) or down. */
  onHeight: (steps: number) => void;
}

/** What the view draws; the editor's panel owns it and hands over each change. */
export interface ZoneScene {
  zones: Zone[];
  selected: Zone | null;
  placing: Placing;
  /** A zone is being drawn, so the point under the cursor is marked. */
  drawing: boolean;
  grid: number;
}

export interface ZoneEditorSession {
  setScene(scene: ZoneScene): void;
  /** Flies to a zone, looking at it from above and to one side. */
  lookAt(zone: Zone): void;
  setFullbright(on: boolean): void;
  /** Test only (`?texcap=`): textures at most `cap` pixels a side, null for full detail. */
  setTextureCap(cap: number | null): void;
  dispose(): void;
}

const SPEED = 600;
const SPRINT = 3;
const LOOK_SENSITIVITY = 0.004;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
/** How far the camera moves along its view for one notch of the wheel. */
const WHEEL_STEP = 64;
/** Farther than any map is wide. */
const AIM_RANGE = 65536;
const UP: vec3 = [0, 0, 1];
/** How far short of a wall the camera stops when it flies to a zone. */
const WALL_GAP = 16;
/** How far the aim's cross reaches along the floor each way, for lining a corner up with walls and zones. */
const CROSS_REACH = 96;
/** The post standing up from the aimed point, so it can be seen against the floor from any angle. */
const POST_HEIGHT = 48;
/** A standing player's height, for the post at a teleport's destination or a spawn. */
const PLAYER_HEIGHT = 72;

/** Loads the map and starts the view. */
export async function startZoneEditor(
  canvas: HTMLCanvasElement,
  source: ZoneEditorSource,
  events: ZoneEditorEvents,
  signal: AbortSignal,
): Promise<ZoneEditorSession> {
  const renderer = new Renderer(canvas, source.stockContentUrl);
  const input = new AbortController();
  try {
    await renderer.load(source.mapUrl, source.mapName, signal);
    const bsp = renderer.bsp;
    if (!bsp) throw new Error("The map couldn't be read.");

    // The same colours as the plan on the Manage view: start green, end red, anything else amber.
    const colors = {
      start: tokenColor("--color-success"),
      end: tokenColor("--color-danger"),
      other: tokenColor("--color-warning"),
      selected: tokenColor("--color-accent"),
    };

    const start = startView(bsp);
    const eye = start.eye;
    let yaw = start.yaw;
    let pitch = 0;

    let scene: ZoneScene = {
      zones: [],
      selected: null,
      placing: { step: "first" },
      drawing: false,
      grid: 16,
    };
    let cursor: { x: number; y: number } | null = null;
    let aim: Point | null = null;
    let drawnKey = "";
    const keys = new Set<string>();
    const listen = { signal: input.signal };

    // Keys are heard on the canvas's container, so typing a note elsewhere on the page never flies the camera.
    const keyTarget = canvas.parentElement ?? canvas;
    keyTarget.addEventListener(
      "keydown",
      (event) => {
        const key = event.key.toLowerCase();
        if ("wasdqe".includes(key) || key === "shift") keys.add(key);
      },
      listen,
    );
    keyTarget.addEventListener(
      "keyup",
      (event) => keys.delete(event.key.toLowerCase()),
      listen,
    );
    window.addEventListener("blur", () => keys.clear(), listen);
    canvas.addEventListener(
      "contextmenu",
      (event) => event.preventDefault(),
      listen,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        const bounds = canvas.getBoundingClientRect();
        cursor = {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        };
        // The right button turns the view; the left is for placing.
        if ((event.buttons & 2) === 0) return;
        yaw -= event.movementX * LOOK_SENSITIVITY;
        pitch -= event.movementY * LOOK_SENSITIVITY;
        pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
      },
      listen,
    );
    canvas.addEventListener("pointerleave", () => (cursor = null), listen);
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button === 2) canvas.setPointerCapture(event.pointerId);
        if (event.button === 0 && aim) events.onPlace(aim);
      },
      listen,
    );
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const steps = -Math.sign(event.deltaY);
        if (scene.placing.step === "height") events.onHeight(steps);
        else vec3.scaleAndAdd(eye, eye, forward(), steps * WHEEL_STEP);
      },
      { ...listen, passive: false },
    );

    const forward = (): vec3 => [
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
    ];

    /** The floor point under the cursor: a ray from the eye through it, traced into the map. */
    const aimAt = (): Point | null => {
      if (!cursor || canvas.clientWidth === 0) return null;
      const f = forward();
      const right = vec3.fromValues(Math.sin(yaw), -Math.cos(yaw), 0);
      const up = vec3.cross(vec3.create(), right, f);
      const tanY = Math.tan(FOV_Y / 2);
      const tanX = tanY * (canvas.clientWidth / canvas.clientHeight);
      const nx = (cursor.x / canvas.clientWidth) * 2 - 1;
      const ny = 1 - (cursor.y / canvas.clientHeight) * 2;
      const direction = vec3.clone(f);
      vec3.scaleAndAdd(direction, direction, right, nx * tanX);
      vec3.scaleAndAdd(direction, direction, up, ny * tanY);
      vec3.normalize(direction, direction);
      const end = vec3.scaleAndAdd(vec3.create(), eye, direction, AIM_RANGE);
      const hit = traceSolid(bsp, eye, end);
      return hit
        ? snapPoint([hit.point[0], hit.point[1], hit.point[2]], scene.grid)
        : null;
    };

    const draw = () => {
      const boxes: BoxSpec[] = [];
      const add = (box: Box, color: [number, number, number]) =>
        boxes.push({ min: box.min, max: box.max, color });
      for (const zone of scene.zones) {
        const box = zoneBox(zone);
        if (!box) continue;
        const color =
          zone === scene.selected
            ? colors.selected
            : zone.type === "start" || zone.type === "end"
              ? colors[zone.type]
              : colors.other;
        add(box, color);
      }
      // Where a teleport sends players, or a spawn: a post the height of a player.
      for (const zone of scene.zones) {
        const [x, y, z] = zone.dest ?? [];
        if (x === undefined || y === undefined || z === undefined) continue;
        add(
          { min: [x, y, z], max: [x, y, z + PLAYER_HEIGHT] },
          zone === scene.selected ? colors.selected : colors.other,
        );
      }
      // A corner is a point, so it's marked as one: a cross on the floor through it and a post up from it.
      // Each line is a box with no width, which the renderer draws as a single beam.
      const mark = (point: Point) => {
        const [x, y, z] = point;
        add(
          { min: [x - CROSS_REACH, y, z], max: [x + CROSS_REACH, y, z] },
          colors.selected,
        );
        add(
          { min: [x, y - CROSS_REACH, z], max: [x, y + CROSS_REACH, z] },
          colors.selected,
        );
        add({ min: [x, y, z], max: [x, y, z + POST_HEIGHT] }, colors.selected);
      };
      if (scene.placing.step === "second") mark(scene.placing.first);
      if (aim && scene.drawing && scene.placing.step !== "height") mark(aim);
      const preview = previewBox(scene.placing, aim);
      if (preview) add(preview, colors.selected);
      renderer.setBoxes(boxes);
    };

    const view = mat4.create();
    const target = vec3.create();
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const seconds = Math.min((now - last) / 1000, 0.1);
      last = now;
      const distance = SPEED * (keys.has("shift") ? SPRINT : 1) * seconds;
      const f = forward();
      const ahead = (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0);
      const side = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
      const rise = (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0);
      vec3.scaleAndAdd(eye, eye, f, ahead * distance);
      eye[0] += Math.sin(yaw) * side * distance;
      eye[1] -= Math.cos(yaw) * side * distance;
      eye[2] += rise * distance;

      aim = aimAt();
      // Rebuilding the boxes is cheap, but there's no reason to do it on frames where nothing moved.
      const key = `${aim?.join()}|${scene.placing.step}|${scene.drawing}`;
      if (key !== drawnKey) {
        drawnKey = key;
        draw();
      }
      vec3.add(target, eye, f);
      renderer.render(mat4.lookAt(view, eye, target, UP));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return {
      setScene(next) {
        scene = next;
        draw();
      },
      setFullbright(on) {
        renderer.setFullbright(on);
      },
      setTextureCap(cap) {
        renderer.setTextureCap(cap);
      },
      lookAt(zone) {
        const [dx, dy, dz] = zone.dest ?? [];
        const box =
          zoneBox(zone) ??
          (dx !== undefined && dy !== undefined && dz !== undefined
            ? { min: [dx, dy, dz], max: [dx, dy, dz + PLAYER_HEIGHT] }
            : null);
        if (!box) return;
        const centre = vec3.fromValues(
          (box.min[0] + box.max[0]) / 2,
          (box.min[1] + box.max[1]) / 2,
          (box.min[2] + box.max[2]) / 2,
        );
        // Back off from the zone the way the view already faces, and up a little, but no further than the
        // first wall: bhop maps are corridors, and a camera behind a wall sees nothing of the zone.
        const size = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]);
        const back = Math.max(192, size * 1.2);
        const wanted = vec3.fromValues(
          centre[0] - Math.cos(yaw) * back,
          centre[1] - Math.sin(yaw) * back,
          centre[2] + back * 0.6,
        );
        const hit = traceSolid(bsp, centre, wanted);
        if (hit) {
          const towards = vec3.sub(vec3.create(), centre, hit.point);
          vec3.normalize(towards, towards);
          vec3.scaleAndAdd(eye, hit.point, towards, WALL_GAP);
        } else vec3.copy(eye, wanted);
        const to = vec3.sub(vec3.create(), centre, eye);
        yaw = Math.atan2(to[1], to[0]);
        pitch = Math.atan2(to[2], Math.hypot(to[0], to[1]));
      },
      dispose() {
        cancelAnimationFrame(frame);
        input.abort();
        renderer.dispose();
      },
    };
  } catch (error) {
    input.abort();
    renderer.dispose();
    throw error;
  }
}
