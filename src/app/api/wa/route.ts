import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getWAState, connectWA, extractLeads, logoutWA } from '../../../lib/waStore';
import { validateSession, SESSION_COOKIE } from '../../../lib/authStore';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    if (!validateSession(cookies().get(SESSION_COOKIE)?.value)) {
        return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    try {
        if (action === 'status') {
            return NextResponse.json(getWAState());
        }
        
        if (action === 'connect') {
            await connectWA();
            return NextResponse.json({ success: true, message: "Connection process started" });
        }
        
        if (action === 'extract') {
            const leads = await extractLeads();
            return NextResponse.json({ success: true, count: leads.length, leads });
        }
        
        if (action === 'logout') {
            await logoutWA();
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
