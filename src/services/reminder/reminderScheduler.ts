// Server-only. Automatically places the two outbound Twilio reminder calls
// SabiLine promises a patient during intake — one ~2 days before their
// appointment, one ~2 hours before — without anyone needing to press the
// manual "Send reminder call" button. Reminders are computed from a real
// ISO appointment timestamp (see `appointmentSlotIso` in the intake
// conversation) rather than a display label like "Mon Jan 5, 10:30am",
// which has no year and can't be scheduled against reliably.
//
// Implementation note (see README "Known limitations"): this uses in-memory
// `setTimeout`s persisted to a local JSON file so a normal restart of a
// long-running `npm start` process can recover pending reminders. On a
// serverless platform (e.g. Vercel) the process does not stay alive between
// requests, so timers this far in the future will NOT reliably fire —
// that environment needs an external cron/scheduler hitting
// `POST /api/intake/reminders/run-due` instead (already wired up below),
// or the manual "Send reminder call" button as a guaranteed fallback.
import fs from 'node:fs';
import path from 'node:path';
import { placeReminderCall, isTwilioConfigured } from './twilioReminder';

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1; // setTimeout's max delay before it fires immediately

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'scheduled-reminders.json');

export interface ScheduledReminder {
  id: string;
  phoneNumber: string;
  department: string | null;
  appointmentSlot: string | null;
  appointmentSlotIso: string;
  kind: '2-day' | '2-hour';
  fireAtIso: string;
  firedAt?: string;
  result?: 'sent' | 'failed' | 'skipped-past';
  error?: string;
}

const activeTimers = new Map<string, NodeJS.Timeout>();

function loadStore(): ScheduledReminder[] {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveStore(reminders: ScheduledReminder[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(reminders, null, 2));
  } catch {
    // Best-effort persistence only — an unwritable filesystem (e.g. a
    // read-only serverless deployment) shouldn't crash the intake flow.
  }
}

function upsert(reminder: ScheduledReminder): void {
  const all = loadStore();
  const idx = all.findIndex((r) => r.id === reminder.id);
  if (idx >= 0) all[idx] = reminder;
  else all.push(reminder);
  saveStore(all);
}

async function fireReminder(reminder: ScheduledReminder): Promise<void> {
  activeTimers.delete(reminder.id);
  if (!isTwilioConfigured()) {
    upsert({ ...reminder, firedAt: new Date().toISOString(), result: 'failed', error: 'Twilio not configured.' });
    return;
  }
  const when = reminder.kind === '2-day' ? 'in about 2 days' : 'in about 2 hours';
  const departmentPart = reminder.department ? ` at ${reminder.department}` : '';
  const slotPart = reminder.appointmentSlot ? ` on ${reminder.appointmentSlot}` : '';
  const message = `Hello, this is a reminder from SabiLine. Your appointment${departmentPart}${slotPart} is coming up ${when}. Please arrive a few minutes early. Thank you.`;
  const result = await placeReminderCall(reminder.phoneNumber, message);
  upsert({
    ...reminder,
    firedAt: new Date().toISOString(),
    result: result.success ? 'sent' : 'failed',
    error: result.error,
  });
}

function scheduleTimer(reminder: ScheduledReminder): void {
  const delayMs = new Date(reminder.fireAtIso).getTime() - Date.now();
  if (delayMs <= 0) {
    upsert({ ...reminder, firedAt: new Date().toISOString(), result: 'skipped-past', error: 'Fire time already passed.' });
    return;
  }
  if (delayMs > MAX_TIMEOUT_MS) {
    // Too far out for a single setTimeout (>~24.8 days); the periodic
    // run-due sweep (see runDueReminders) will pick it up as it gets closer.
    return;
  }
  const timer = setTimeout(() => {
    void fireReminder(reminder);
  }, delayMs);
  activeTimers.set(reminder.id, timer);
}

/**
 * Schedules the 2-day-before and 2-hour-before reminder calls for a
 * just-confirmed appointment. Safe to call even when Twilio isn't
 * configured or the appointment has no phone number — it simply records
 * nothing in that case, same "not configured" honesty as everywhere else.
 */
export function scheduleAppointmentReminders(params: {
  visitId: string;
  phoneNumber: string | null;
  department: string | null;
  appointmentSlot: string | null;
  appointmentSlotIso: string | null;
}): { scheduled: boolean; reason?: string } {
  const { visitId, phoneNumber, department, appointmentSlot, appointmentSlotIso } = params;

  if (!phoneNumber) return { scheduled: false, reason: 'No phone number on file.' };
  if (!appointmentSlotIso) return { scheduled: false, reason: 'No confirmed appointment timestamp.' };

  const apptTime = new Date(appointmentSlotIso).getTime();
  if (Number.isNaN(apptTime)) return { scheduled: false, reason: 'Appointment timestamp could not be parsed.' };

  const candidates: Array<{ kind: ScheduledReminder['kind']; fireAt: number }> = [
    { kind: '2-day', fireAt: apptTime - TWO_DAYS_MS },
    { kind: '2-hour', fireAt: apptTime - TWO_HOURS_MS },
  ];

  for (const { kind, fireAt } of candidates) {
    if (fireAt <= Date.now()) continue; // appointment too soon for this lead time — skip silently
    const reminder: ScheduledReminder = {
      id: `${visitId}:${kind}`,
      phoneNumber,
      department,
      appointmentSlot,
      appointmentSlotIso,
      kind,
      fireAtIso: new Date(fireAt).toISOString(),
    };
    upsert(reminder);
    scheduleTimer(reminder);
  }

  return { scheduled: true };
}

/**
 * Re-arms every still-pending reminder from disk. Call once at server
 * startup so a process restart doesn't silently drop reminders that were
 * scheduled before the restart (best-effort — see the serverless caveat
 * in this file's header comment).
 */
export function rehydratePendingReminders(): void {
  const all = loadStore();
  for (const reminder of all) {
    if (reminder.firedAt) continue;
    scheduleTimer(reminder);
  }
}

/**
 * Sweeps for any reminder whose fire time has arrived but hasn't fired yet
 * — the fallback path for serverless deployments (no long-lived process to
 * hold a `setTimeout`) where an external cron hits this on a schedule
 * (e.g. every 10-15 minutes) via `POST /api/intake/reminders/run-due`.
 */
export async function runDueReminders(): Promise<{ fired: number }> {
  const all = loadStore();
  const due = all.filter((r) => !r.firedAt && new Date(r.fireAtIso).getTime() <= Date.now());
  for (const reminder of due) {
    await fireReminder(reminder);
  }
  return { fired: due.length };
}

export function listScheduledReminders(): ScheduledReminder[] {
  return loadStore();
}
