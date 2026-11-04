// Picks the canvas's starting resolution from the device, before adaptive scaling trims it (from daf's replay viewer).
// Integrated and mobile parts are the ones that fall over at native 4K with
// MSAA. Matched against the unmasked WebGL renderer string.
const WEAK_GPU =
  /(intel|uhd graphics|hd graphics|iris|adreno|mali|powervr|apple gpu|llvmpipe|swiftshader|software)/i;

export interface DeviceProfile {
  gpu: string;
  weakGpu: boolean;
  cores: number;
  devicePixelRatio: number;
}

/** Resolution policy, derived from the device rather than configured. */
export interface ResolutionPolicy {
  /** Fraction of the CSS size rendered before upscaling. */
  renderScale: number;
  /** Upper bound on devicePixelRatio. The single biggest cost on 4K/Retina. */
  dprCap: number;
  /** Trades resolution for frame pacing using a rolling p90 frame time. */
  adaptive: boolean;
}

export function probeDevice(gl: WebGL2RenderingContext): DeviceProfile {
  let gpu = "";
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    gpu =
      info === null
        ? ""
        : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  } catch {
    gpu = "";
  }
  return {
    gpu,
    weakGpu: WEAK_GPU.test(gpu),
    cores: navigator.hardwareConcurrency || 4,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

/**
 * Picks a starting resolution for this machine.
 *
 * Rendering at the full device pixel ratio is what makes the viewer expensive:
 * a 2x display quadruples the pixel count for the same window. Rather than ask
 * the user, start from what the hardware looks like and let the adaptive
 * controller correct from there.
 */
export function resolutionFor(
  profile: DeviceProfile,
  cssPixels: number,
): ResolutionPolicy {
  if (profile.weakGpu || profile.cores <= 4) {
    // cssPixels is the window in device pixels. Phones match as weak, and at one pixel per
    // CSS pixel a 3x screen shows the replay stretched and soft, yet the screen is small
    // enough to afford more: aim for about 1080p worth of pixels. Laptops the rule was
    // written for land at 1 or a little over, as before.
    const dpr = profile.devicePixelRatio;
    const dprCap = Math.min(
      2,
      Math.max(1, dpr * Math.sqrt(2_100_000 / cssPixels)),
    );
    return { renderScale: 0.85, dprCap, adaptive: true };
  }
  // Above roughly 1440p worth of CSS pixels, supersampling past 1.5x buys very
  // little and costs a lot.
  const dprCap = cssPixels > 3_600_000 ? 1 : cssPixels > 2_200_000 ? 1.5 : 2;
  return { renderScale: 1, dprCap, adaptive: true };
}
