import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeInMemoryStore, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';

// Next.js hot-reloading safe globals
declare global {
  var waSocket: any;
  var waQrCode: string | null;
  var waStatus: 'disconnected' | 'connecting' | 'connected';
  var waStore: any;
  var waLeads: any[];
}

// Initialize globals
if (!global.waStatus) global.waStatus = 'disconnected';
if (!global.waQrCode) global.waQrCode = null;
if (!global.waLeads) global.waLeads = [];
if (!global.waStore) {
    global.waStore = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
}

export const getWAState = () => {
    return {
        status: global.waStatus,
        qrCode: global.waQrCode,
        leadsCount: global.waLeads.length
    }
}

export const connectWA = async () => {
    console.log('--- Attempting to Connect WhatsApp ---');
    
    // Force cleanup of session folder to avoid 401 errors
    const sessionDir = 'auth_session_data';
    if (fs.existsSync(sessionDir)) {
        console.log('Cleaning up old session directory...');
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Failed to delete session dir:', e);
        }
    }

    global.waStatus = 'connecting';
    global.waQrCode = null;

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    console.log('Creating WASocket...');
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'info' }),
        printQRInTerminal: false,
        auth: state,
        syncFullHistory: true,
        browser: ['Windows', 'Chrome', '122.0.6261.112'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000
    });

    global.waStore.bind(sock.ev);
    global.waSocket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log('Connection Update:', connection);
        
        if (qr) {
            console.log('✅ NEW QR CODE GENERATED');
            global.waQrCode = await QRCode.toDataURL(qr);
        }

        if (connection === 'close') {
            const reason = (lastDisconnect?.error as any)?.output?.statusCode;
            console.log('❌ Connection Closed. Reason:', reason);
            
            global.waStatus = 'disconnected';
            global.waSocket = null;
            global.waQrCode = null;
        } else if (connection === 'open') {
            console.log('🚀 WHATSAPP CONNECTED SUCCESSFULLY!');
            global.waStatus = 'connected';
            global.waQrCode = null;
        }
    });
}

export const extractLeads = async () => {
    if (global.waStatus !== 'connected' || !global.waSocket) throw new Error("Not connected");
    
    let leads: any[] = [];
    const chats = global.waStore.chats.all();
    
    for (const chat of chats) {
        if (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@c.us')) {
            leads.push({
                source: 'Personal Chat',
                id: chat.id,
                name: chat.name || 'Unknown',
                number: chat.id.split('@')[0]
            });
        } else if (chat.id.endsWith('@g.us')) {
            try {
                const groupMetadata = await global.waSocket.groupMetadata(chat.id);
                for (const participant of groupMetadata.participants) {
                    leads.push({
                        source: `Group: ${groupMetadata.subject || chat.name || chat.id}`,
                        id: participant.id,
                        name: 'Unknown',
                        number: participant.id.split('@')[0]
                    });
                }
            } catch (error) {
               // ignore
            }
        }
    }
    
    const contacts = global.waStore.contacts;
    for (const jid of Object.keys(contacts)) {
        const contact = contacts[jid];
        if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
            leads.push({
                source: 'Address Book',
                id: jid,
                name: contact.name || contact.notify || contact.verifiedName || 'Unknown',
                number: jid.split('@')[0]
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
    try {
        if (global.waSocket) {
            await global.waSocket.logout();
            global.waSocket = null;
        }
    } catch (err) {
        console.error('Logout error:', err);
    }
    
    global.waStatus = 'disconnected';
    global.waQrCode = null;
    global.waLeads = [];

    const sessionDir = 'auth_session_data';
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
}
