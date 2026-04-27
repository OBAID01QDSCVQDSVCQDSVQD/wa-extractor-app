import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeInMemoryStore } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';

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
    if (global.waStatus === 'connecting' || global.waStatus === 'connected') return;
    
    global.waStatus = 'connecting';
    global.waQrCode = null;

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys_app');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        syncFullHistory: true,
        browser: ['SDK Extractor', 'Chrome', '1.0.0']
    });

    global.waStore.bind(sock.ev);
    global.waSocket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            // Convert QR to Data URL for frontend
            global.waQrCode = await QRCode.toDataURL(qr);
        }

        if (connection === 'close') {
            global.waStatus = 'disconnected';
            global.waSocket = null;
            global.waQrCode = null;
        } else if (connection === 'open') {
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
    if (global.waSocket) {
        global.waSocket.logout();
        global.waSocket = null;
    }
    global.waStatus = 'disconnected';
    global.waQrCode = null;
    global.waLeads = [];
}
