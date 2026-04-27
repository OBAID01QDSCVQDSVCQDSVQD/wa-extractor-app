import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { numbers, message } = await req.json();

        if (!numbers || !message || numbers.length === 0) {
            return NextResponse.json({ success: false, error: "Missing numbers or message" }, { status: 400 });
        }

        const API_KEY = "fTUG90ao7SI0En1o4Bz0b6g2Xkl1KR4JRHSZJq6KsggzAJKSRXXMUy8Ld18x";
        const SENDER = "SdkBatimant";

        // Filter numbers to ensure they have the prefix
        const formattedNumbers = numbers.map((n: string) => {
            let clean = n.replace(/\D/g, '');
            if (clean.startsWith('00')) clean = clean.substring(2);
            if (clean.length === 8) clean = '216' + clean;
            return clean;
        });

        console.log(`Sending SMS to ${formattedNumbers.length} numbers via WinSMSPro...`);

        // New WinSMSPro API uses GET with parameters
        const url = new URL('https://www.winsmspro.com/sms/sms/api');
        url.searchParams.append('action', 'send-sms');
        url.searchParams.append('api_key', API_KEY);
        url.searchParams.append('to', formattedNumbers.join(','));
        url.searchParams.append('sms', message);
        url.searchParams.append('from', SENDER);

        const response = await fetch(url.toString());
        const text = await response.text();
        console.log('WinSMS Response Text:', text);

        // WinSMSPro often returns plain text or simple JSON, let's try to parse
        try {
            const data = JSON.parse(text);
            if (data.status === 'error' || !response.ok) {
                return NextResponse.json({ success: false, error: data.message || 'API Error' }, { status: 400 });
            }
            return NextResponse.json({ success: true, data });
        } catch (e) {
            // If it's not JSON, it might be a success ID or plain text error
            if (text.includes('OK') || text.match(/^\d+$/)) {
                return NextResponse.json({ success: true, message: text });
            }
            return NextResponse.json({ success: false, error: text }, { status: 400 });
        }
    } catch (error: any) {
        console.error('SMS Send Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
