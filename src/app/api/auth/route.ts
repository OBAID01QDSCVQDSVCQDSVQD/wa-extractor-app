import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
    requestOtp,
    verifyOtp,
    verifyTurnstile,
    validateSession,
    SESSION_COOKIE,
    SESSION_MAX_AGE_S,
} from '../../../lib/authStore';

export const dynamic = 'force-dynamic';

export async function GET() {
    const token = cookies().get(SESSION_COOKIE)?.value;
    return NextResponse.json({ authenticated: validateSession(token) });
}

export async function POST(req: Request) {
    let body: any = {};
    try {
        body = await req.json();
    } catch {}

    const action = body?.action;

    if (action === 'request') {
        const turnstile = await verifyTurnstile(body?.turnstileToken);
        if (!turnstile.ok) {
            return NextResponse.json({ success: false, error: turnstile.error }, { status: 403 });
        }
        const result = await requestOtp();
        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 429 });
        }
        return NextResponse.json({ success: true });
    }

    if (action === 'verify') {
        const result = verifyOtp(String(body?.code || ''));
        if (!result.success || !result.token) {
            return NextResponse.json({ success: false, error: result.error }, { status: 401 });
        }
        const response = NextResponse.json({ success: true });
        response.cookies.set(SESSION_COOKIE, result.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: SESSION_MAX_AGE_S,
        });
        return response;
    }

    if (action === 'logout') {
        const response = NextResponse.json({ success: true });
        response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
        return response;
    }

    return NextResponse.json({ success: false, error: 'Action invalide' }, { status: 400 });
}
