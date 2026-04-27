import { Client, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'fs';

// Next.js hot-reloading safe globals
declare global {
  var waClient: any;
  var waQrCode: string | null;
  var waStatus: 'disconnected' | 'connecting' | 'connected';
  var waLeads: any[];
}

// Initialize globals
if (!global.waStatus) global.waStatus = 'disconnected';
if (!global.waQrCode) global.waQrCode = null;
if (!global.waLeads) global.waLeads = [];

export const getWAState = () => {
    return {
        status: global.waStatus,
        qrCode: global.waQrCode,
        leadsCount: global.waLeads.length
    }
}

export const connectWA = async () => {
    if (global.waStatus === 'connected' || global.waStatus === 'connecting') return;

    console.log('--- Initializing WhatsApp Web Engine ---');
    global.waStatus = 'connecting';
    global.waQrCode = null;

    const username = process.env.USERNAME || process.env.USER || 'OBAID';
    const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `C:\\Users\\${username}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    
    console.log('Searching for Chrome/Edge in:', possiblePaths);
    let executablePath = '';
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            executablePath = p;
            console.log('Found executable at:', p);
            break;
        }
    }

    if (!executablePath) {
        console.warn('⚠️ No Chrome or Edge found in common paths. Trying default puppeteer...');
    }

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: "sdk-final"
        }),
        puppeteer: {
            executablePath: executablePath || undefined,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    global.waClient = client;

    client.on('qr', async (qr) => {
        console.log('✅ NEW QR CODE GENERATED');
        global.waQrCode = await QRCode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log('🚀 WHATSAPP READY!');
        global.waStatus = 'connected';
        global.waQrCode = null;
    });

    client.on('authenticated', () => {
        console.log('Authenticated successfully');
    });

    client.on('auth_failure', (msg) => {
        console.error('Auth failure:', msg);
        global.waStatus = 'disconnected';
    });

    client.on('disconnected', (reason) => {
        console.log('Client disconnected:', reason);
        global.waStatus = 'disconnected';
        global.waClient = null;
    });

    try {
        await client.initialize();
    } catch (err) {
        console.error('Initialization error:', err);
        global.waStatus = 'disconnected';
    }
}

export const extractLeads = async () => {
    if (global.waStatus !== 'connected' || !global.waClient) throw new Error("Not connected");
    
    console.log('Extracting leads...');
    let leads: any[] = [];
    
    const chats = await global.waClient.getChats();
    console.log(`Found ${chats.length} chats.`);

    for (const chat of chats) {
        const timestamp = chat.timestamp * 1000; // Convert to ms
        if (chat.isGroup) {
            // Group participants
            for (const participant of chat.participants) {
                leads.push({
                    source: `Group: ${chat.name}`,
                    id: participant.id._serialized,
                    name: 'Unknown',
                    number: participant.id.user,
                    timestamp: timestamp
                });
            }
        } else {
            // Individual chat
            leads.push({
                source: 'Individual Chat',
                id: chat.id._serialized,
                name: chat.name || 'Unknown',
                number: chat.id.user,
                timestamp: timestamp
            });
        }
    }
    
    const contacts = await global.waClient.getContacts();
    for (const contact of contacts) {
        if (!contact.isGroup) {
            leads.push({
                source: 'Address Book',
                id: contact.id._serialized,
                name: contact.name || contact.pushname || 'Unknown',
                number: contact.id.user,
                timestamp: 0 
            });
        }
    }

    const uniqueLeads: any[] = [];
    const seenIds = new Set();
    
    for (const lead of leads) {
        if (!seenIds.has(lead.id)) {
            seenIds.add(lead.id);
            uniqueLeads.push(lead);
        } else {
            const existing = uniqueLeads.find(l => l.id === lead.id);
            if (existing) {
                if (existing.name === 'Unknown' && lead.name !== 'Unknown') {
                    existing.name = lead.name;
                }
                if (existing.timestamp < lead.timestamp) {
                    existing.timestamp = lead.timestamp;
                }
                if (lead.source.startsWith('Group:') && !existing.source.includes(lead.source)) {
                    existing.source += ` | ${lead.source}`;
                }
            }
        }
    }

    global.waLeads = uniqueLeads;
    return uniqueLeads;
}

export const logoutWA = async () => {
    console.log('Logging out...');
    if (global.waClient) {
        try {
            await global.waClient.logout();
            await global.waClient.destroy();
        } catch (e) {}
        global.waClient = null;
    }
    global.waStatus = 'disconnected';
    global.waQrCode = null;
    global.waLeads = [];
    
    const authPath = './.wwebjs_auth';
    if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
    }
}
