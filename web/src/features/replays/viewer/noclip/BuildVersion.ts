// @ts-nocheck
// Build-time constants stub. noclip's build pipeline injects __COMMIT_HASH;
// we don't.

export const GIT_REVISION: string = "(vendored)";
export const GIT_SHORT_REVISION = GIT_REVISION.slice(0, 8);
export const GITHUB_URL = "https://github.com/magcius/noclip.website";
export const GITHUB_REVISION_URL = GITHUB_URL;
// Force false even under `vite dev`. noclip's debug code paths (entity
// message debugger, world-space point overlay, etc.) reach into
// `window.main.viewer` which doesn't exist in our embedded usage; flipping
// this flag keeps them dormant.
export const IS_DEVELOPMENT: boolean = false;
