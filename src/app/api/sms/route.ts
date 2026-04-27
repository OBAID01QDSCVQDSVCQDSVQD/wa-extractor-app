import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { numbers, message } = await req.json();

        if (!numbers || !message || numbers.length === 0) {
            return NextResponse.json({ success: false, error: "Missing numbers or message" }, { status: 400 });
        }

        const API_KEY = "fTUG90ao7SI0En1o4Bz0b6g2Xkl1KR4JRHSZJq6KsggzAJKSRXXMUy8Ld18x";
        const SENDER = "SdkBatimant";

        // Filter numbers to ensure they have the prefix (WinSMS requires full number with prefix, usually 216)
        const formattedNumbers = numbers.map((n: string) => {
            let clean = n.replace(/\D/g, '');
            // If it starts with 00, replace with prefix
            if (clean.startsWith('00')) clean = clean.substring(2);
            // If it's 8 digits, add 216
            if (clean.length === 8) clean = '216' + clean;
            return clean;
        });

        console.log(`Sending SMS to ${formattedNumbers.length} numbers via WinSMS...`);

        // WinSMS API usually expects a POST request
        const response = await fetch('https://www.winsms.tn/api/sms/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                sender: SENDER,
                numbers: formattedNumbers.join(','),
                message: message
            })
        });

        const data = await response.json();
        
        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('SMS Send Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
