import type { BackendCapabilities, LoopDefinition } from '@looper/core';

/**
 * Capability-mismatch check (task 0021, shared by 0074): a loop whose work
 * needs live secrets or agent-phase network cannot run on a backend that
 * strips them. Surfaced at `looper config validate` time and re-checked at
 * dispatch pre-flight so a misconfigured loop fails loud before spending a
 * cloud task.
 */
export interface CapabilityMismatch {
  need: 'live-secrets' | 'network';
  have: string;
  directive: string;
}

export function checkCompatibility(
  loop: Pick<LoopDefinition, 'requires'>,
  capabilities: BackendCapabilities,
): CapabilityMismatch[] {
  const mismatches: CapabilityMismatch[] = [];
  if (loop.requires?.liveSecrets && capabilities.secretPhase !== 'full') {
    mismatches.push({
      need: 'live-secrets',
      have: `secret_phase: ${capabilities.secretPhase}`,
      directive:
        'route this gate to the adopter’s CI (the trustworthy gate runs regardless of backend) ' +
        'or select the self-hosted backend',
    });
  }
  if (loop.requires?.network && capabilities.network !== 'on') {
    mismatches.push({
      need: 'network',
      have: `network: ${capabilities.network}`,
      directive: 'agent-phase network is off on this backend — use the self-hosted backend',
    });
  }
  return mismatches;
}
