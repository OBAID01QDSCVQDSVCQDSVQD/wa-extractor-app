import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { WinSMS } from './winsms';

// Auth par OTP SMS : le code est TOUJOURS envoyé au numéro admin fixe,
// jamais à un numéro fourni par le client.
const ADMIN_PHONE = process.env.AUTH_ADMIN_PHONE || '21653520222';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_REQUEST_COOLDOWN_MS = 60 * 1000; // 1 requête / minute max
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

declare global {
    // eslint-disable-next-line no-var
    var waAuthSecret: string | undefined;
    // eslint-disable-next-line no-var
    var waOtpState: {
        codeHash: string;
        expiresAt: number;
        attempts: number;
        lastRequestAt: number;
    } | null | undefined;
}

// Secret de signature des sessions : env si fourni, sinon généré au démarrage
// (les sessions sont alors invalidées à chaque redéploiement — acceptable).
function getSecret(): string {
    if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
    if (!global.waAuthSecret) global.waAuthSecret = randomBytes(32).toString('hex');
    return global.waAuthSecret;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function sign(payload: string): string {
    return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

// --- Cloudflare Turnstile ---------------------------------------------------

export async function verifyTurnstile(token: string | undefined | null): Promise<{ ok: boolean; error?: string }> {
    const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
    // Si aucune clé n'est configurée, la vérification est désactivée.
    if (!secretKey) return { ok: true };

    if (!token) return { ok: false, error: 'Vérification anti-bot requise.' };

    try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: secretKey, response: token }),
        });
        const data = await response.json();
        if (data?.success === true) return { ok: true };
        return { ok: false, error: 'Échec de la vérification anti-bot.' };
    } catch {
        return { ok: false, error: 'Vérification anti-bot indisponible. Réessayez.' };
    }
}

// --- OTP ---------------------------------------------------------------------

export async function requestOtp(): Promise<{ success: boolean; error?: string }> {
    const now = Date.now();
    const state = global.waOtpState;

    if (state && now - state.lastRequestAt < OTP_REQUEST_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_REQUEST_COOLDOWN_MS - (now - state.lastRequestAt)) / 1000);
        return { success: false, error: `Patientez ${waitSec}s avant de redemander un code.` };
    }

    const code = String(randomInt(100000, 1000000)); // 6 chiffres
    const result = await WinSMS.sendBulkSMS([ADMIN_PHONE], `Code SDK Extractor: ${code} (valide 5 min)`);
    if (!result.success) {
        return { success: false, error: result.error || 'Envoi du SMS impossible.' };
    }

    global.waOtpState = {
        codeHash: sha256(code),
        expiresAt: now + OTP_TTL_MS,
        attempts: 0,
        lastRequestAt: now,
    };

    return { success: true };
}

export function verifyOtp(code: string): { success: boolean; token?: string; error?: string } {
    const state = global.waOtpState;
    if (!state) return { success: false, error: 'Aucun code en attente. Demandez un code.' };

    if (Date.now() > state.expiresAt) {
        global.waOtpState = null;
        return { success: false, error: 'Code expiré. Demandez un nouveau code.' };
    }
    if (state.attempts >= OTP_MAX_ATTEMPTS) {
        global.waOtpState = null;
        return { success: false, error: 'Trop de tentatives. Demandez un nouveau code.' };
    }
    state.attempts += 1;

    const providedHash = Buffer.from(sha256(String(code || '').trim()), 'hex');
    const expectedHash = Buffer.from(state.codeHash, 'hex');
    if (providedHash.length !== expectedHash.length || !timingSafeEqual(providedHash, expectedHash)) {
        return { success: false, error: 'Code incorrect.' };
    }

    // Succès : OTP à usage unique, session signée
    global.waOtpState = null;
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const payload = `wa:${expiresAt}`;
    const token = `${expiresAt}.${sign(payload)}`;
    return { success: true, token };
}

// --- Session -------------------------------------------------------------------

export function validateSession(token: string | undefined | null): boolean {
    if (!token) return false;
    const [expiresAtStr, signature] = String(token).split('.');
    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

    const expected = sign(`wa:${expiresAt}`);
    const a = Buffer.from(String(signature || ''), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_COOKIE = 'wa_session';
export const SESSION_MAX_AGE_S = Math.floor(SESSION_TTL_MS / 1000);
