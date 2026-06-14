/**
 * Minimal ANSI styling for human CLI output. Auto-disables when stdout is not a
 * TTY or `NO_COLOR` is set (https://no-color.org), so piped/redirected output
 * and tests get clean plain text. Pad to width on the RAW string before calling
 * a style fn — the escape codes are zero-width and would otherwise break
 * alignment.
 */
const enabled = process.env.NO_COLOR === undefined && process.stdout.isTTY === true;

type Style = (s: string) => string;
const sgr = (open: number, close: number): Style =>
  enabled ? (s) => `\x1b[${open}m${s}\x1b[${close}m` : (s) => s;

export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const red = sgr(31, 39);
export const green = sgr(32, 39);
export const yellow = sgr(33, 39);
export const magenta = sgr(35, 39);
export const cyan = sgr(36, 39);

export const colorEnabled = enabled;
