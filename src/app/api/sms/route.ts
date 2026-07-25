import { NextResponse } from 'next/server';

export async function POST() {
    return NextResponse.json(
        { success: false, error: 'Envoi désactivé : les campagnes sont gérées depuis le CRM après consentement.' },
        { status: 403 }
    );
}
