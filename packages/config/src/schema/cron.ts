// Minimal cron support (tasks 0006/0076). V1 deliberately supports the
// realistic loop-schedule space instead of full cron semantics:
//   - friendly names: `hourly` | `daily` | `weekly`
//   - minute intervals: `*/N * * * *`
//   - fixed daily time: `M H * * *`
//   - fixed weekly time: `M H * * D` (D = 0-6, Sunday=0)
// Anything else fails validation with a clear error (recorded 0006 decision).

export interface CronCheck {
  ok: boolean;
  error?: string;
}

const FRIENDLY: Record<string, string> = {
  hourly: '0 * * * *',
  daily: '0 0 * * *',
  weekly: '0 0 * * 1',
};

export function normalizeCron(schedule: string): string {
  return FRIENDLY[schedule] ?? schedule;
}

export function validateCron(schedule: string): CronCheck {
  const expr = normalizeCron(schedule);
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ok: false, error: `'${schedule}' is not hourly/daily/weekly or a 5-field cron` };
  }
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  const minOk = min === '*' || /^\*\/([1-9]\d?)$/.test(min) || isField(min, 0, 59);
  const hourOk = hour === '*' || isField(hour, 0, 23);
  const domOk = dom === '*';
  const monOk = mon === '*';
  const dowOk = dow === '*' || isField(dow, 0, 6);
  if (!minOk || !hourOk || !domOk || !monOk || !dowOk) {
    return {
      ok: false,
      error:
        `'${schedule}' unsupported — V1 accepts hourly|daily|weekly, '*/N * * * *', ` +
        `'M H * * *', or 'M H * * D'`,
    };
  }
  return { ok: true };
}

/**
 * Was this schedule due within the window (minutes) ending at `now`?
 * The sweep calls this with its own interval so missed Actions ticks coalesce.
 */
export function isCronDue(schedule: string, now: Date, windowMinutes: number): boolean {
  const expr = normalizeCron(schedule);
  const [min, hour, , , dow] = expr.trim().split(/\s+/) as [string, string, string, string, string];

  for (let back = 0; back < windowMinutes; back++) {
    const t = new Date(now.getTime() - back * 60_000);
    if (
      matchesMinute(min, t.getUTCMinutes()) &&
      matchesField(hour, t.getUTCHours()) &&
      matchesField(dow, t.getUTCDay())
    ) {
      return true;
    }
  }
  return false;
}

function matchesMinute(field: string, minute: number): boolean {
  const step = field.match(/^\*\/([1-9]\d?)$/);
  if (step) return minute % Number(step[1]) === 0;
  return matchesField(field, minute);
}

function matchesField(field: string, value: number): boolean {
  if (field === '*') return true;
  return Number(field) === value;
}

function isField(field: string, lo: number, hi: number): boolean {
  if (!/^\d{1,2}$/.test(field)) return false;
  const n = Number(field);
  return n >= lo && n <= hi;
}
