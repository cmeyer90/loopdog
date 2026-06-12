/**
 * The secret-backend port (M07): resolves the project secrets a work cell
 * needs on the **self-hosted** path, and provides the leak guard every path
 * uses. On the primary (provider-cloud) path looper never resolves secret
 * values — they live in the provider's environment — so `resolve` is only
 * implemented by self-hosted backends.
 */
export interface SecretBackend {
  readonly id: SecretBackendId;
  /** Where secrets resolved by this backend reside (for the trust docs, 0032). */
  residency(): string;
  /** Whether this backend can produce values in the current environment. */
  available(): Promise<boolean>;
  /**
   * Resolve named secrets to values for injection into the adopter's own
   * runner/container. Implementations must never log values.
   */
  resolve(names: string[]): Promise<ResolvedSecrets>;
}

export type SecretBackendId = 'actions-env' | 'process-env' | (string & {});

export interface ResolvedSecrets {
  values: Record<string, string>;
  /** Names that could not be resolved (caller decides whether that's fatal). */
  missing: string[];
}

/**
 * Leak guard (0031): scrubs known secret values from any text looper is about
 * to serialize into a model-visible artifact (briefs, comments, plans, run
 * records). Pure function — safe to use everywhere.
 */
export function scrubSecrets(text: string, values: Iterable<string>): string {
  let out = text;
  for (const value of values) {
    if (value.length < 4) continue; // too short to scrub without mangling text
    out = out.split(value).join('[secret-redacted]');
  }
  return out;
}
