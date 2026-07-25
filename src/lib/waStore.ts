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
        if (global.waClient !== client) return;
        console.log('✅ NEW QR CODE GENERATED');
        global.waStatus = 'connecting';
        global.waQrCode = await QRCode.toDataURL(qr);
    });

    client.on('ready', () => {
        if (global.waClient !== client) return;
        console.log('🚀 WHATSAPP READY!');
        global.waStatus = 'connected';
        global.waQrCode = null;
    });

    client.on('authenticated', () => {
        console.log('Authenticated successfully');
    });

    client.on('auth_failure', (msg) => {
        if (global.waClient !== client) return;
        console.error('Auth failure:', msg);
        global.waStatus = 'disconnected';
    });

    client.on('disconnected', (reason) => {
        if (global.waClient !== client) return;
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
    
    console.log('Extracting inbound individual leads...');
    
    let chats;
    let skippedChats = 0;
    try {
        chats = await global.waClient.getChats();
    } catch (error) {
        console.warn('Bulk chat loading failed, retrying individually:', error);
        try {
            const chatIds = await global.waClient.pupPage.evaluate(() => {
                const whatsappWindow = window as any;
                return whatsappWindow.require('WAWebCollections').Chat
                    .getModelsArray()
                    .map((chat: any) => chat.id._serialized);
            });
            chats = [];
            for (const chatId of chatIds) {
                try {
                    const chat = await global.waClient.getChatById(chatId);
                    if (chat) chats.push(chat);
                } catch {
                    skippedChats += 1;
                }
            }
        } catch (fallbackError) {
            console.error('Unable to read WhatsApp chats:', fallbackError);
            const staleClient = global.waClient;
            global.waClient = null;
            global.waStatus = 'disconnected';
            global.waQrCode = null;
            try {
                await staleClient.destroy();
            } catch {}
            throw new Error('Session WhatsApp indisponible. Déconnectez puis reconnectez le compte.');
        }
    }

    const leadsMap = new Map();

    // Only retain unsaved individual contacts who sent at least one message.
    // Groups, saved contacts and address-book-only contacts are not ad leads.
    for (const chat of chats) {
        if (chat.isGroup) continue;

        try {
            const messages = await chat.fetchMessages({ limit: 50 });
            const inboundMessages = messages.filter((message: any) => !message.fromMe);
            if (inboundMessages.length === 0) continue;

            const contact = await chat.getContact().catch(() => null);
            if (!contact || contact.isMyContact) continue;

            const contactId = contact?.id?._serialized;
            const chatId = chat.id?._serialized;
            let phoneId = [contactId, chatId].find((id) =>
                typeof id === 'string' && (id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net'))
            );

            if (!phoneId && chatId?.endsWith('@lid')) {
                const mappings = await global.waClient.getContactLidAndPhone([chatId]).catch(() => []);
                phoneId = mappings[0]?.pn;
            }

            if (!phoneId || (!phoneId.endsWith('@c.us') && !phoneId.endsWith('@s.whatsapp.net'))) {
                skippedChats += 1;
                continue;
            }

            const realNumber = phoneId.split('@')[0];
            if (!/^\d{7,15}$/.test(realNumber)) continue;

            const latestInboundTimestamp = Math.max(
                ...inboundMessages.map((message: any) => Number(message.timestamp || 0) * 1000)
            );
            leadsMap.set(realNumber, {
                id: chat.id._serialized,
                name: contact?.name || contact?.pushname || chat.name || 'Unknown',
                number: realNumber,
                timestamp: latestInboundTimestamp || Date.now(),
                source: 'INDIVIDUAL CHAT',
                inbound: true,
                isSaved: !!contact?.isMyContact,
            });
        } catch {
            skippedChats += 1;
        }
    }

    const uniqueLeads = Array.from(leadsMap.values());
    if (skippedChats > 0) console.warn(`Skipped ${skippedChats} unreadable WhatsApp chat(s)`);
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
