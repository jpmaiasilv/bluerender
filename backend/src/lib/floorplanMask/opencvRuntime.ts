/**
 * Singleton loader for @techstark/opencv-js (WASM build of OpenCV) — chosen
 * over a native binding (e.g. opencv4nodejs) because this repo has no
 * deployment configuration at all (no Dockerfile, no CI, no documented
 * host — see the Planta Humanizada Fill audit), so there is no evidence a
 * production host would even have a C++ toolchain to compile a native
 * module against. WASM runs identically everywhere plain Node runs.
 *
 * Initialization takes ~60-100ms (measured locally) and only needs to
 * happen once per process — every caller awaits the same cached promise.
 */
import type * as CvNamespace from '@techstark/opencv-js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cvModule = require('@techstark/opencv-js');

export type OpenCv = typeof CvNamespace;

let readyPromise: Promise<OpenCv> | null = null;

export function getOpenCv(): Promise<OpenCv> {
  if (!readyPromise) {
    readyPromise = new Promise<OpenCv>((resolve) => {
      if (cvModule instanceof Promise) {
        cvModule.then(resolve);
      } else if (cvModule.Mat) {
        resolve(cvModule);
      } else {
        cvModule.onRuntimeInitialized = () => resolve(cvModule);
      }
    });
  }
  return readyPromise;
}
