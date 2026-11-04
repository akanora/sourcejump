"use client";
// The home header's depth effect: the picture leans with the mouse, near things moving more than far ones, read
// from a depth map of it (header-depth.webp, made by scripts/header-depth.py), dust drifts in the light shaft, and
// a click sends traces crawling over the surfaces.
import { useEffect, useRef, type CSSProperties } from "react";
import { createTraces, MOST_TRAIL_POINTS, type Traces } from "./headerTraces";

// How far the nearest parts move at full lean, in the picture's pixels.
const STRENGTH = 13;
// The depth that stays still (0 is farthest, 1 nearest): about the back wall, so the room swings around it.
const PIVOT = 0.25;
// Up-down lean as a share of side-to-side.
const VERTICAL = 0.5;
// The share of the way to the mouse covered each 60th of a second.
const EASE = 0.07;
// Specks of dust in the shaft. Few enough that the eye catches single ones rather than a haze.
const DUST = 160;

// Each pixel looks back along the lean for the surface that lands on it. A few fixed-point steps settle on it;
// one plain lookup would smear the jumper's outline across the wall behind him. The dust uses the same search to
// find what is in front of a speck.
const FIND_SURFACE = `
vec2 surface(vec2 uv) {
  vec2 at = uv;
  for (int i = 0; i < 5; i++) at = uv + lean * (texture2D(depth, at).r - ${PIVOT.toFixed(2)});
  return at;
}`;

const PICTURE_VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = vec2(p.x, -p.y) * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const PICTURE_FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform sampler2D picture, depth;
uniform vec2 lean;
${FIND_SURFACE}
void main() { gl_FragColor = texture2D(picture, surface(uv)); }`;

// A speck is placed by its seed alone (across the shaft, height, depth, a phase), so nothing is stored between
// frames: it sinks slowly down the shaft and sways, wrapping from the floor back to the skylight. The shaft is a
// cone from the skylight (x ≈ 0.48 at the top) widening to the lit patch on the floor. Depth spans just behind
// the jumper to just in front of him, so some specks pass behind him and some in front. On first showing they
// fade in one by one over a few seconds rather than all appearing at once.
const DUST_VERTEX = `
attribute vec4 seed;
uniform float time, shown, pixelRatio;
uniform vec2 lean;
varying vec2 uv;
varying float z, fade, twinkle;
void main() {
  float t = time + seed.w * 500.0;
  float y = fract(seed.y + t * (0.003 + 0.004 * seed.w));
  float across = seed.x * 2.0 - 1.0 + 0.18 * sin(t * (0.15 + 0.1 * seed.z) + seed.w * 6.28);
  vec2 at = vec2(0.48 + 0.05 * y + across * (0.05 + 0.2 * y), y * 0.85 + 0.01 * sin(t * 0.3 + seed.x * 6.28));
  z = 0.27 + 0.17 * seed.z;
  uv = at - lean * (z - ${PIVOT.toFixed(2)});
  fade = smoothstep(0.0, 0.12, y) * smoothstep(1.0, 0.8, y) * smoothstep(1.0, 0.6, abs(across));
  fade *= smoothstep(0.5 + 2.5 * seed.w, 2.5 + 2.5 * seed.w, shown);
  twinkle = 0.5 + 0.5 * sin(time * (0.5 + seed.w) + seed.w * 40.0);
  gl_PointSize = (1.5 + 3.0 * seed.z * seed.z) * pixelRatio;
  gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}`;

// A speck shows only where the light is (brighter haze behind it) and fades out behind anything nearer than it.
// Drawn premultiplied, so where the picture isn't drawn the canvas stays see-through around the specks.
const DUST_FRAGMENT = `
precision highp float;
varying vec2 uv;
varying float z, fade, twinkle;
uniform sampler2D picture, depth;
uniform vec2 lean;
${FIND_SURFACE}
void main() {
  vec2 at = surface(uv);
  float behind = smoothstep(z - 0.005, z + 0.02, texture2D(depth, at).r);
  float light = smoothstep(0.06, 0.4, dot(texture2D(picture, at).rgb, vec3(0.3, 0.59, 0.11)));
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-3.0 * dot(c, c)) * (1.0 - behind) * light * fade * (0.3 + 0.7 * twinkle);
  gl_FragColor = vec4(vec3(0.86, 0.93, 1.0) * a, a);
}`;

// A trace point sits on a surface, so it leans with that surface's depth. Its last number is its brightness, plus
// 2 for a spark's head, which is drawn larger and whiter. Farther surfaces get thinner trails. The trail's cyan
// matches the streaks behind the jumper.
const TRACE_VERTEX = `
attribute vec4 point;
uniform float pixelRatio;
uniform vec2 lean;
varying float brightness, head;
void main() {
  head = step(1.5, point.w);
  brightness = point.w - 2.0 * head;
  vec2 uv = point.xy - lean * (point.z - ${PIVOT.toFixed(2)});
  gl_PointSize = mix(3.0, 7.0, head) * (0.7 + 0.8 * point.z) * pixelRatio;
  gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}`;

const TRACE_FRAGMENT = `
precision highp float;
varying float brightness, head;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  float a = mix(0.4 * exp(-5.0 * r), 0.8 * exp(-4.0 * r), head) * brightness;
  gl_FragColor = vec4(mix(vec3(0.3, 0.85, 1.0), vec3(0.85, 1.0, 1.0), head) * a, a);
}`;

/**
 * A canvas placed exactly over the header's `<img>`, which must come right before it. It draws from the file the
 * browser already chose for that image, so nothing is downloaded twice. At rest it draws only the dust over the
 * plain image, which shows through pixel for pixel; it draws the picture itself only while it leans. It runs only
 * while the header is on screen. Off for touch, reduced motion and no WebGL.
 */
export function HeaderDepth({
  depth,
  className,
  style,
}: {
  depth: string;
  className: string;
  style: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = canvas?.previousElementSibling;
    const header = canvas?.closest("header");
    if (!canvas || !(image instanceof HTMLImageElement) || !header) return;
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      return;
    }
    const gl = canvas.getContext("webgl");
    if (!gl) return;

    let frame = 0;
    let lastTime = 0;
    let scene: Scene | null = null;
    let traces: Traces | null = null;
    let depthPixels: ImageData | null = null;
    let onScreen = false;
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    // Eases toward the mouse; the picture is drawn only while it leans, the dust always.
    function tick(time: number) {
      const k =
        1 - (1 - EASE) ** (Math.min(time - lastTime, 100) / (1000 / 60));
      lastTime = time;
      current.x += (target.x - current.x) * k;
      current.y += (target.y - current.y) * k;
      if (
        Math.abs(target.x - current.x) < 0.001 &&
        Math.abs(target.y - current.y) < 0.001
      ) {
        Object.assign(current, target);
      }
      fit();
      traces?.step(time / 1000);
      scene!.draw(
        time / 1000,
        lean(),
        current.x !== 0 || current.y !== 0,
        traces,
      );
      frame = requestAnimationFrame(tick);
    }

    // How far the picture leans now, as a share of its size.
    function lean() {
      return {
        x: (current.x * STRENGTH) / canvas!.clientWidth,
        y: (current.y * STRENGTH * VERTICAL) / canvas!.clientHeight,
      };
    }

    // Runs while the header is on screen in a visible tab (on a narrow window the canvas isn't shown, so never).
    function run() {
      const go = scene && onScreen && !document.hidden;
      if (go && !frame) {
        canvas!.style.visibility = "visible";
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      } else if (!go && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    // Sized as it starts rather than once: on a narrow window the canvas isn't shown and measures nothing.
    // One canvas pixel per screen pixel keeps it sharp on high-density screens.
    function fit() {
      const width = Math.round(canvas!.clientWidth * devicePixelRatio);
      const height = Math.round(canvas!.clientHeight * devicePixelRatio);
      if (width === canvas!.width && height === canvas!.height) return;
      canvas!.width = width;
      canvas!.height = height;
      gl!.viewport(0, 0, width, height);
    }

    function onMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      const box = header!.getBoundingClientRect();
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      target.x = clamp(((event.clientX - box.left) / box.width) * 2 - 1);
      target.y = clamp(((event.clientY - box.top) / box.height) * 2 - 1);
    }
    const onLeave = () => Object.assign(target, { x: 0, y: 0 });

    // A click on the picture (not on the header's links) sends traces out from the surface under the mouse. The
    // picture may be leaning, so this finds which surface landed there the way the picture shader does.
    function onDown(event: PointerEvent) {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      if (!traces || !depthPixels || !frame) return;
      if (event.target instanceof Element && event.target.closest("a, button"))
        return;
      const box = canvas!.getBoundingClientRect();
      const uv = {
        x: (event.clientX - box.left) / box.width,
        y: (event.clientY - box.top) / box.height,
      };
      const { width, height, data } = depthPixels;
      const by = lean();
      const at = { ...uv };
      for (let i = 0; i < 5; i++) {
        const ix = Math.max(0, Math.min(width - 1, Math.round(at.x * width)));
        const iy = Math.max(0, Math.min(height - 1, Math.round(at.y * height)));
        const d = data[(iy * width + ix) * 4]! / 255 - PIVOT;
        at.x = uv.x + by.x * d;
        at.y = uv.y + by.y * d;
      }
      traces.spark(at.x * width, at.y * height, performance.now() / 1000);
    }
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerleave", onLeave);
    header.addEventListener("pointerdown", onDown);
    document.addEventListener("visibilitychange", run);
    const observer = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      run();
    });
    observer.observe(canvas);

    let cancelled = false;
    const depthImage = new Image();
    depthImage.src = depth;
    Promise.all([image.decode(), depthImage.decode()])
      .then(() => {
        if (cancelled) return;
        scene = setUp(gl, image, depthImage);
        depthPixels = readPixels(depthImage);
        if (depthPixels) {
          const { data, width, height } = depthPixels;
          traces = createTraces(data, width, height);
        }
        run();
      })
      .catch(() => {
        // The image or depth map failed to load: the plain picture stays, which is all this was on top of.
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerleave", onLeave);
      header.removeEventListener("pointerdown", onDown);
      document.removeEventListener("visibilitychange", run);
      // The context is left to go with the canvas: a canvas hands back the same context when asked again (as
      // React's development double run does), so losing it here would leave the next run nothing to draw with.
    };
  }, [depth]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ ...style, visibility: "hidden" }}
    />
  );
}

type Scene = {
  draw(
    time: number,
    lean: { x: number; y: number },
    leaning: boolean,
    traces: Traces | null,
  ): void;
};

/** The depth map's pixels, for the traces to steer by on the CPU; null if the browser won't hand them over. */
function readPixels(image: HTMLImageElement): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Uploads both pictures and builds the three programs; null if this GPU refuses the shaders. */
function setUp(
  gl: WebGLRenderingContext,
  image: HTMLImageElement,
  depthImage: HTMLImageElement,
): Scene | null {
  const picture = link(gl, PICTURE_VERTEX, PICTURE_FRAGMENT);
  const dust = link(gl, DUST_VERTEX, DUST_FRAGMENT);
  const trace = link(gl, TRACE_VERTEX, TRACE_FRAGMENT);
  if (!picture || !dust || !trace) return null;
  upload(gl, 0, image);
  upload(gl, 1, depthImage);

  const rectangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rectangle);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const seeds = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, seeds);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(Array.from({ length: DUST * 4 }, Math.random)),
    gl.STATIC_DRAW,
  );
  // Rewritten each frame while traces are out.
  const tracePoints = new Float32Array(MOST_TRAIL_POINTS * 4);
  const traceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, traceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, tracePoints.byteLength, gl.DYNAMIC_DRAW);

  const uniforms = (program: WebGLProgram) => {
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "picture"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "depth"), 1);
    return (name: string) => gl.getUniformLocation(program, name);
  };
  const pictureAt = uniforms(picture);
  const dustAt = uniforms(dust);
  const pictureLean = pictureAt("lean");
  const dustLean = dustAt("lean");
  const dustTime = dustAt("time");
  const dustShown = dustAt("shown");
  const dustPixelRatio = dustAt("pixelRatio");
  let firstDrawn = -1;
  const traceAt = uniforms(trace);
  const traceLean = traceAt("lean");
  const tracePixelRatio = traceAt("pixelRatio");

  // Each program reads one attribute, so they share slot 0 and point it at their own buffer before drawing.
  function attribute(
    program: WebGLProgram,
    name: string,
    buffer: WebGLBuffer | null,
    size: number,
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const at = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, size, gl.FLOAT, false, 0, 0);
  }

  return {
    draw(time, lean, leaning, traces) {
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (leaning) {
        gl.useProgram(picture);
        attribute(picture, "p", rectangle, 2);
        gl.uniform2f(pictureLean, lean.x, lean.y);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.useProgram(dust);
      attribute(dust, "seed", seeds, 4);
      gl.uniform2f(dustLean, lean.x, lean.y);
      // Kept small: a float's precision runs out over hours of page time and the drift would start to step.
      gl.uniform1f(dustTime, time % 10000);
      if (firstDrawn < 0) firstDrawn = time;
      // Capped once all have faded in, for the same reason.
      gl.uniform1f(dustShown, Math.min(time - firstDrawn, 10));
      gl.uniform1f(dustPixelRatio, devicePixelRatio);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, DUST);

      if (!traces?.alive()) return;
      const count = traces.write(tracePoints, time);
      gl.useProgram(trace);
      attribute(trace, "point", traceBuffer, 4);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, tracePoints.subarray(0, count * 4));
      gl.uniform2f(traceLean, lean.x, lean.y);
      gl.uniform1f(tracePixelRatio, devicePixelRatio);
      // Added rather than laid over, so overlapping trail glows brighter, as light does.
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, count);
    },
  };
}

function link(
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function upload(
  gl: WebGLRenderingContext,
  unit: number,
  image: HTMLImageElement,
) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  // No mipmaps (the picture's size needn't be a power of two), and edges held rather than repeated.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
