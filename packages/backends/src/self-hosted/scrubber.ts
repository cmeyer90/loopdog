/**
 * The leak guard (task 0031): redacts registered secret VALUES (including
 * base64/URL/JSON-escaped encodings) and pattern-matched tokens from every
 * model- or GitHub-facing egress path (run-record details, surfaced logs,
 * comment bodies, CLI output). Fail-closed: a scrubber error withholds the
 * artifact rather than emitting it raw.
 */

const PATTERNS: Array<[name: string, re: RegExp]> = [
  ['github-pat', /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['github-fine-pat', /github_pat_[A-Za-z0-9_]{20,}/g],
  ['anthropic-key', /sk-ant-[A-Za-z0-9-]{8,}/g],
  ['openai-key', /sk-[A-Za-z0-9]{20,}/g],
  ['aws-key', /AKIA[0-9A-Z]{16}/g],
  ['slack-token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['pem-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['cred-query-param', /([?&](?:password|token|secret|api_key)=)[^&\s'"]+/gi],
];

export class Scrubber {
  private readonly values = new Map<string, string>(); // value -> name

  /** Feed every resolved secret value to the deny-list (0031). */
  registerScrubTargets(secrets: Iterable<{ name: string; value: string }>): void {
    for (const { name, value } of secrets) {
      if (value.length < 4) continue;
      this.values.set(value, name);
      // common encodings of the same value
      this.values.set(Buffer.from(value, 'utf8').toString('base64'), name);
      this.values.set(encodeURIComponent(value), name);
      this.values.set(JSON.stringify(value).slice(1, -1), name);
    }
  }

  scrub(text: string): string {
    let out = text;
    for (const [value, name] of this.values) {
      if (value.length < 4) continue;
      out = out.split(value).join(`«redacted:${name}»`);
    }
    for (const [name, re] of PATTERNS) {
      out = out.replace(re, (match, prefix?: string) =>
        typeof prefix === 'string' && match.startsWith(prefix)
          ? `${prefix}«redacted:${name}»`
          : `«redacted:${name}»`,
      );
    }
    return out;
  }

  /** Fail-closed wrapper: on any scrub error the artifact is withheld. */
  scrubOrWithhold(text: string): string {
    try {
      return this.scrub(text);
    } catch {
      return '«artifact withheld: scrubber failure (fail-closed)»';
    }
  }
}
