/**
 * Math-library thread caps for python sidecars. On CPU, torch/OpenMP default
 * to one thread per core, so a single inference saturates the machine and
 * starves the smelter render/encode threads. Explicit operator env vars win
 * over the shared AI_SIDECAR_NUM_THREADS default.
 */
export function sidecarThreadCapEnv(): Record<string, string> {
  const threads = process.env.AI_SIDECAR_NUM_THREADS ?? '4';
  return {
    OMP_NUM_THREADS: process.env.OMP_NUM_THREADS ?? threads,
    MKL_NUM_THREADS: process.env.MKL_NUM_THREADS ?? threads,
    OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS ?? threads,
    NUMEXPR_NUM_THREADS: process.env.NUMEXPR_NUM_THREADS ?? threads,
    TORCH_NUM_THREADS: process.env.TORCH_NUM_THREADS ?? threads,
  };
}
