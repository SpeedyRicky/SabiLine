// Places a real outbound phone call reminding a patient of their scheduled
// appointment, via Twilio's REST API. Follows the same honest-configuration
// pattern as the ASR providers: isConfigured() reflects whatever credentials
// are actually set, and an unconfigured or failed call reports that plainly
// rather than pretending a call went out. Twilio's built-in <Say> voice only
// speaks English, so the reminder is deliberately English-only regardless of
// the language the intake itself was conducted in — callers should not
// assume this covers the other five languages the intake supports.
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

export interface ReminderCallResult {
  success: boolean;
  callSid?: string;
  notConfigured?: boolean;
  error?: string;
}

export function isTwilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

function escapeForTwiml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Places an outbound call to `toNumber` that speaks `message` aloud via
 * Twilio's <Say>, using an inline TwiML document so no separate webhook
 * endpoint is needed to answer the call.
 */
export async function placeReminderCall(toNumber: string, message: string): Promise<ReminderCallResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return {
      success: false,
      notConfigured: true,
      error: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER must all be set to place reminder calls.',
    };
  }

  const twiml = `<Response><Say voice="Polly.Joanna">${escapeForTwiml(message)}</Say></Response>`;
  const body = new URLSearchParams({
    To: toNumber,
    From: fromNumber,
    Twiml: twiml,
  });

  try {
    const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Calls.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || `Twilio returned status ${response.status}.`);
    }

    if (!data.sid) {
      throw new Error('Twilio response did not include a call SID.');
    }

    return { success: true, callSid: data.sid };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Placing the reminder call failed.',
    };
  }
}
