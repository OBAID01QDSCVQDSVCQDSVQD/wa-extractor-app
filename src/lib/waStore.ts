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
    const contacts = await global.waClient.getContacts();
    
    const contactMap = new Map();
    contacts.forEach((c: any) => contactMap.set(c.id._serialized, c));

    const leadsMap = new Map();

    // 1. Process Chats
    for (const chat of chats) {
        if (chat.isGroup) continue;

        const contact = contactMap.get(chat.id._serialized);
        let realNumber = contact?.number;
        
        // If number is still missing, try to extract from name if it's formatted like a number
        if (!realNumber) {
            if (chat.name && chat.name.startsWith('+')) {
                realNumber = chat.name.replace(/\D/g, '');
            } else {
                // Fallback to user ID, but remove any suffix
                realNumber = chat.id.user.split(':')[0];
            }
        }

        if (realNumber) {
            leadsMap.set(realNumber, {
                id: chat.id._serialized,
                name: contact?.name || chat.name || 'Unknown',
                number: realNumber,
                timestamp: chat.timestamp ? chat.timestamp * 1000 : Date.now(),
                source: 'INDIVIDUAL CHAT',
                isSaved: !!contact?.isMyContact
            });
        }
    }

    // 2. Process Address Book Contacts
    for (const contact of contacts) {
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
