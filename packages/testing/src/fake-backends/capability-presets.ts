import type { BackendCapabilities } from '@loopdog/core';

/**
 * Capability presets (task 0084): the declared `Capabilities` shapes of the
 * three real backends (0019–0023), so tests can exercise the runner's
 * capability-driven branches (trigger mode, secret phase, ZDR, throughput cap)
 * without the real backends. Mirror the production values; if a real backend's
 * capabilities change, these drift — the live smoke (0087) catches that.
 */

export function claudeLike(over: Partial<BackendCapabilities> = {}): BackendCapabilities {
  return {
    triggerModes: ['api_fire'],
    runsSandbox: true,
    secretPhase: 'full',
    network: 'on',
    opensPr: true,
    supportsReview: true,
    zdrCompatible: false,
    throughput: { tasksPerHour: null },
    quotaNote: 'routine runs draw subscription usage; per-account daily cap',
    ...over,
  };
}

export function codexLike(over: Partial<BackendCapabilities> = {}): BackendCapabilities {
  return {
    triggerModes: ['mention'],
    runsSandbox: true,
    secretPhase: 'setup-only', // secrets STRIPPED before the agent phase
    network: 'on',
    opensPr: true,
    supportsReview: true,
    zdrCompatible: false,
    throughput: { tasksPerHour: 5 },
    quotaNote: 'Codex cloud ~5 tasks/hour per account',
    ...over,
  };
}

export function selfHostedLike(over: Partial<BackendCapabilities> = {}): BackendCapabilities {
  return {
    triggerModes: ['self_hosted_dispatch'],
    runsSandbox: true,
    secretPhase: 'full', // live secrets the whole run
    network: 'on',
    opensPr: true,
    supportsReview: true,
    zdrCompatible: true, // the differentiator: nothing leaves adopter compute
    throughput: { tasksPerHour: null }, // no provider cap
    quotaNote: 'self-hosted: no provider quota; bounded only by adopter compute',
    ...over,
  };
}
