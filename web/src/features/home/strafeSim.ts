// The home page's bhop demo, simulated: a player chaining hops and strafing, moved by Source's air rules.

// Source's movement constants as CS:S ships them. The air acceleration and the turn rate aren't any server's
// setting or a real player's input; they're picked so the demo's path weaves visibly at a readable pace.
const TICK = 1 / 100;
const GRAVITY = 800;
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * 57);
const MAX_SPEED = 250;
const AIR_WISH_CAP = 30;
const AIR_ACCELERATE = 100;
const TURN_RATE = (100 * Math.PI) / 180;

/** One tick of the demo, in Source units (x forward, y left, z up) and seconds. */
export interface StrafeTick {
  x: number;
  y: number;
  z: number;
  /** Horizontal speed, the number a speedometer shows. */
  speed: number;
  /** Where the player looks, in radians. */
  yaw: number;
  /** The strafe key held: A turns left, D right. */
  key: "A" | "D";
  /** True on the tick the player lands and jumps again. */
  jump: boolean;
}

/**
 * Runs `seconds` of perfect hops from running speed. Each hop is one strafe: the player holds A and turns the
 * mouse left, lands, jumps on the same tick, then holds D and turns right. Speed is never set, only gained:
 * it comes out of Source's air acceleration (PM_AirAccelerate), the same rule the game runs.
 */
export function simulateStrafes(seconds: number): StrafeTick[] {
  const ticks: StrafeTick[] = [];
  // Facing a quarter turn right of the way forward, so the alternating strafes weave around the x axis.
  let yaw = -TURN_RATE * airTime() * 0.5;
  let vx = MAX_SPEED * Math.cos(yaw);
  let vy = MAX_SPEED * Math.sin(yaw);
  let vz = JUMP_SPEED;
  let x = 0;
  let y = 0;
  let z = 0;
  let left = true;

  for (let tick = 0; tick * TICK < seconds; tick++) {
    let jump = tick === 0;
    if (z <= 0 && vz < 0) {
      // Jumping on the landing tick skips ground friction, so no speed is lost between hops.
      z = 0;
      vz = JUMP_SPEED;
      left = !left;
      jump = true;
    }

    yaw += (left ? 1 : -1) * TURN_RATE * TICK;
    // A or D alone: the wanted direction is square to the view, to the side being turned towards.
    const wishX = Math.cos(yaw + (left ? 1 : -1) * (Math.PI / 2));
    const wishY = Math.sin(yaw + (left ? 1 : -1) * (Math.PI / 2));
    // The air cap is what makes strafing work: only speed along the wanted direction is limited, so steering
    // keeps that projection low and every tick adds a little speed sideways.
    const current = vx * wishX + vy * wishY;
    const add = Math.min(
      AIR_WISH_CAP - current,
      AIR_ACCELERATE * MAX_SPEED * TICK,
    );
    if (add > 0) {
      vx += add * wishX;
      vy += add * wishY;
    }

    vz -= GRAVITY * TICK;
    x += vx * TICK;
    y += vy * TICK;
    z = Math.max(z + vz * TICK, 0);
    ticks.push({
      x,
      y,
      z,
      speed: Math.hypot(vx, vy),
      yaw,
      key: left ? "A" : "D",
      jump,
    });
  }
  return ticks;
}

function airTime(): number {
  return (2 * JUMP_SPEED) / GRAVITY;
}

/** How long one tick lasts, for playing the ticks back in real time. */
export const tickSeconds = TICK;
