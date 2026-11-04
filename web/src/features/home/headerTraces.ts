// Traces for the home header: a click sends a few sparks crawling over the picture's surfaces, steered by its
// depth map so they run along the floor, up walls and around edges, leaving short fading trails.

// Sparks a click sends out, and the most alive at once (counting the branches they split into).
const SPARKS = 5;
const MOST_SPARKS = 16;
// A spark's speed in the picture's pixels per second, before its bursts speed it up or slow it down.
const SPEED = 320;
// Each step a spark takes, in pixels; it is steered after every one, and each leaves one trail point.
const STEP = 1.5;
// How long a trail point takes to fade, in seconds.
const TRAIL = 1.2;
// A depth change this big in one step is a ledge or an outline, which a spark follows instead of crossing.
const LEDGE = 0.035;

type Spark = {
  x: number;
  y: number;
  // Heading, as a unit vector.
  dx: number;
  dy: number;
  dies: number;
  speed: number;
  // When the spark next changes pace or might turn sharply: what makes it move in fits rather than glide.
  nextBurst: number;
  // Distance covered toward the next step.
  carry: number;
};

type TrailPoint = { x: number; y: number; depth: number; born: number };

export type Traces = {
  /** Sends sparks out from a point on the picture, in its pixels. */
  spark(x: number, y: number, now: number): void;
  /** Moves the sparks on to `now` (seconds) and drops faded trail. */
  step(now: number): void;
  /**
   * The trail as points for drawing, four numbers each: x and y as a share of the picture, the depth there, and
   * the brightness, plus 2 for a spark's head. Returns how many points were written.
   */
  write(into: Float32Array, now: number): number;
  /** True while anything is left to draw. */
  alive(): boolean;
};

export const MOST_TRAIL_POINTS = 4096;

/** `depth` is the depth map's pixels (RGBA, its red channel 0 far to 255 near), `width` by `height`. */
export function createTraces(
  depth: Uint8ClampedArray,
  width: number,
  height: number,
): Traces {
  const sparks: Spark[] = [];
  const trail: TrailPoint[] = [];
  let lastStep = 0;

  function depthAt(x: number, y: number) {
    const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
    return depth[(iy * width + ix) * 4]! / 255;
  }

  function launch(
    x: number,
    y: number,
    angle: number,
    life: number,
    now: number,
  ) {
    if (sparks.length >= MOST_SPARKS) return;
    sparks.push({
      x,
      y,
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      dies: now + life,
      speed: SPEED,
      nextBurst: now,
      carry: 0,
    });
  }

  // One step along the surface. The direction that keeps depth level runs along a floor or wall, so the spark
  // leans toward it, more where the surface slopes steeply (a wall's edge, an outline). It never steps over a
  // ledge: it turns to run along it.
  function advance(s: Spark, wander: number) {
    const here = depthAt(s.x, s.y);
    const gx = (depthAt(s.x + 3, s.y) - depthAt(s.x - 3, s.y)) / 6;
    const gy = (depthAt(s.x, s.y + 3) - depthAt(s.x, s.y - 3)) / 6;
    const slope = Math.hypot(gx, gy);
    let along = { x: 0, y: 0 };
    if (slope > 1e-5) {
      along = { x: -gy / slope, y: gx / slope };
      if (along.x * s.dx + along.y * s.dy < 0)
        along = { x: -along.x, y: -along.y };
      const pull = 0.25 * smoothstep(0.0005, 0.006, slope);
      turnToward(s, along, pull);
    }
    rotate(s, wander);
    const nx = s.x + s.dx * STEP;
    const ny = s.y + s.dy * STEP;
    if (Math.abs(depthAt(nx, ny) - here) > LEDGE && slope > 1e-5) {
      s.dx = along.x;
      s.dy = along.y;
    }
    s.x += s.dx * STEP;
    s.y += s.dy * STEP;
  }

  return {
    spark(x, y, now) {
      const turn = Math.random() * Math.PI * 2;
      for (let i = 0; i < SPARKS; i++) {
        launch(
          x,
          y,
          turn + (i / SPARKS) * Math.PI * 2,
          1.2 + 1.2 * Math.random(),
          now,
        );
      }
      lastStep = Math.max(lastStep, now);
    },

    step(now) {
      // Capped so a stalled tab doesn't fling sparks across the picture in one go.
      const elapsed = Math.min(now - lastStep, 0.1);
      lastStep = now;
      for (const s of [...sparks]) {
        if (now >= s.nextBurst) {
          s.speed = SPEED * (0.15 + 1.5 * Math.random() ** 2);
          s.nextBurst = now + 0.08 + Math.random() * 0.3;
          if (Math.random() < 0.3)
            rotate(s, (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random()));
          // Now and then a spark splits, the branch heading off at an angle for a shorter life.
          if (Math.random() < 0.12) {
            const side = Math.random() < 0.5 ? -1 : 1;
            launch(
              s.x,
              s.y,
              Math.atan2(s.dy, s.dx) + side * 0.7,
              0.5 + Math.random() * 0.6,
              now,
            );
          }
        }
        s.carry += s.speed * elapsed * (0.5 + depthAt(s.x, s.y));
        while (s.carry >= STEP) {
          s.carry -= STEP;
          advance(s, (Math.random() - 0.5) * 0.12);
          trail.push({ x: s.x, y: s.y, depth: depthAt(s.x, s.y), born: now });
        }
        const outside = s.x < 0 || s.y < 0 || s.x >= width || s.y >= height;
        if (now >= s.dies || outside) sparks.splice(sparks.indexOf(s), 1);
      }
      while (trail.length > 0 && now - trail[0]!.born > TRAIL) trail.shift();
      while (trail.length > MOST_TRAIL_POINTS - MOST_SPARKS) trail.shift();
    },

    write(into, now) {
      let n = 0;
      const put = (p: TrailPoint, brightness: number) => {
        into.set([p.x / width, p.y / height, p.depth, brightness], n * 4);
        n++;
      };
      for (const p of trail) put(p, (1 - (now - p.born) / TRAIL) ** 2);
      for (const s of sparks) {
        const left = Math.min(1, (s.dies - now) / 0.3);
        put({ x: s.x, y: s.y, depth: depthAt(s.x, s.y), born: now }, 2 + left);
      }
      return n;
    },

    alive() {
      return sparks.length > 0 || trail.length > 0;
    },
  };
}

function turnToward(s: Spark, to: { x: number; y: number }, amount: number) {
  const x = s.dx + (to.x - s.dx) * amount;
  const y = s.dy + (to.y - s.dy) * amount;
  const length = Math.hypot(x, y) || 1;
  s.dx = x / length;
  s.dy = y / length;
}

function rotate(s: Spark, angle: number) {
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  [s.dx, s.dy] = [s.dx * c - s.dy * n, s.dx * n + s.dy * c];
}

function smoothstep(from: number, to: number, v: number) {
  const t = Math.max(0, Math.min(1, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
