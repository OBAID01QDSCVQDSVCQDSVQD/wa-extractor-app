import { NextResponse } from 'next/server';
import { WinSMS } from '@/lib/winsms';

export async function POST(req: Request) {
    try {
        const { numbers, message } = await req.json();

        if (!numbers || !message || numbers.length === 0) {
            return NextResponse.json({ success: false, error: "Missing numbers or message" }, { status: 400 });
        }

        const result = await WinSMS.sendBulkSMS(numbers, message);

        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }
        
        return NextResponse.json({ success: true, data: result });
    } catch (error: any) {
        console.error('SMS Send Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
