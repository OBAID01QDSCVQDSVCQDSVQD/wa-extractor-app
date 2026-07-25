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

const AUTH_PATH = './.wwebjs_auth';

const wipeAuthFolder = () => {
    try {
        if (fs.existsSync(AUTH_PATH)) {
            fs.rmSync(AUTH_PATH, { recursive: true, force: true });
            console.log('Wiped stale WhatsApp auth folder');
        }
    } catch (e) {
        console.warn('Unable to wipe auth folder:', e);
    }
};

export const connectWA = async () => {
    if (global.waStatus === 'connected' || global.waStatus === 'connecting') return;

    console.log('--- Initializing WhatsApp Web Engine ---');
    global.waStatus = 'connecting';
    global.waQrCode = null;

    // Clean up any leftover client from a previous failed attempt
    if (global.waClient) {
        const leftover = global.waClient;
        global.waClient = null;
        try {
            await leftover.destroy();
        } catch {}
    }

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

    // Watchdog: if neither a QR code nor a ready event arrives within 90s,
    // the saved session is likely corrupt — destroy it and wipe auth so the
    // next connect starts fresh with a new QR code.
    const watchdog = setTimeout(async () => {
        if (global.waClient !== client) return;
        if (global.waStatus === 'connecting' && !global.waQrCode) {
            console.warn('Connection stuck without QR — resetting session');
            global.waClient = null;
            global.waStatus = 'disconnected';
            global.waQrCode = null;
            try {
                await client.destroy();
            } catch {}
            wipeAuthFolder();
        }
    }, 90_000);

    client.on('qr', async (qr) => {
        if (global.waClient !== client) return;
        console.log('✅ NEW QR CODE GENERATED');
        global.waStatus = 'connecting';
        global.waQrCode = await QRCode.toDataURL(qr);
    });

    client.on('ready', () => {
        if (global.waClient !== client) return;
        clearTimeout(watchdog);
        console.log('🚀 WHATSAPP READY!');
        global.waStatus = 'connected';
        global.waQrCode = null;
    });

    client.on('authenticated', () => {
        console.log('Authenticated successfully');
    });

    client.on('auth_failure', (msg) => {
        if (global.waClient !== client) return;
        clearTimeout(watchdog);
        console.error('Auth failure:', msg);
        global.waClient = null;
        global.waStatus = 'disconnected';
        global.waQrCode = null;
        wipeAuthFolder();
    });

    client.on('disconnected', (reason) => {
        if (global.waClient !== client) return;
        clearTimeout(watchdog);
        console.log('Client disconnected:', reason);
        global.waStatus = 'disconnected';
        global.waClient = null;
    });

    try {
        await client.initialize();
    } catch (err) {
        console.error('Initialization error:', err);
        if (global.waClient === client) {
            clearTimeout(watchdog);
            global.waClient = null;
            global.waStatus = 'disconnected';
            global.waQrCode = null;
            try {
                await client.destroy();
            } catch {}
        }
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
    const lidPhoneCache = new Map<string, string | null>();

    const resolvePhoneId = async (ids: string[]) => {
        const directId = ids.find((id) => id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net'));
        if (directId) return directId;

        const lidIds = Array.from(new Set(ids.filter((id) => id.endsWith('@lid'))));
        const uncachedLidIds = lidIds.filter((id) => !lidPhoneCache.has(id));

        if (uncachedLidIds.length > 0) {
            const mappings = await global.waClient.getContactLidAndPhone(uncachedLidIds).catch(() => []);
            for (const id of uncachedLidIds) lidPhoneCache.set(id, null);
            for (const mapping of mappings) {
                if (mapping?.lid) lidPhoneCache.set(mapping.lid, mapping.pn || null);
            }
        }

        for (const lidId of lidIds) {
            const cached = lidPhoneCache.get(lidId);
            if (cached) return cached;
        }

        return null;
    };

    const mergeLead = (realNumber: string, sourceLabel: string, lead: any) => {
        const existingLead = leadsMap.get(realNumber);
        if (existingLead) {
            if (!String(existingLead.source).includes(sourceLabel)) {
                existingLead.source = `${existingLead.source} + ${sourceLabel}`;
            }
            if (lead.timestamp > (existingLead.timestamp || 0)) {
                existingLead.timestamp = lead.timestamp;
            }
            if (existingLead.isSaved === null && lead.isSaved !== null) {
                existingLead.isSaved = lead.isSaved;
            }
            if (existingLead.name === 'Unknown' && lead.name !== 'Unknown') {
                existingLead.name = lead.name;
            }
        } else {
            leadsMap.set(realNumber, lead);
        }
    };

    // Retain every individual chat with a resolvable phone number. Users can
    // filter later by date and saved/unsaved status in the UI.
    for (const chat of chats) {
        if (chat.isGroup) continue;

        try {
            const contact = await chat.getContact().catch(() => null);
            const contactId = contact?.id?._serialized;
            const chatId = chat.id?._serialized;
            const ids = [contactId, chatId].filter((id): id is string => typeof id === 'string');
            const phoneId = await resolvePhoneId(ids);

            const fallbackNumber = String(contact?.number || '').replace(/\D/g, '');
            const realNumber = phoneId
                ? phoneId.split('@')[0]
                : fallbackNumber;

            if (!/^\d{7,15}$/.test(realNumber)) continue;

            const chatTimestampMs = Number(chat.timestamp || 0) > 0
                ? Number(chat.timestamp) * 1000
                : Date.now();
            mergeLead(realNumber, 'INDIVIDUAL CHAT', {
                id: chat.id._serialized,
                name: contact?.name || contact?.pushname || chat.name || 'Unknown',
                number: realNumber,
                timestamp: chatTimestampMs,
                source: 'INDIVIDUAL CHAT',
                inbound: true,
                isSaved: contact ? !!contact.isMyContact : null,
            });
        } catch {
            skippedChats += 1;
        }
    }

    // Group participants: everyone in every group you're a member of. Not
    // necessarily people who contacted you directly, kept as an opt-in source
    // filterable in the UI.
    let skippedGroupMembers = 0;
    for (const chat of chats) {
        if (!chat.isGroup) continue;

        try {
            const participants = chat.participants || chat.groupMetadata?.participants || [];
            for (const participant of participants) {
                try {
                    const participantId = participant?.id?._serialized;
                    if (!participantId) continue;

                    const phoneId = await resolvePhoneId([participantId]);
                    const realNumber = phoneId ? phoneId.split('@')[0] : '';
                    if (!/^\d{7,15}$/.test(realNumber)) continue;

                    mergeLead(realNumber, `GROUP: ${chat.name || 'Unknown'}`, {
                        id: participantId,
                        name: 'Unknown',
                        number: realNumber,
                        timestamp: 0,
                        source: `GROUP: ${chat.name || 'Unknown'}`,
                        inbound: false,
                        isSaved: null,
                    });
                } catch {
                    skippedGroupMembers += 1;
                }
            }
        } catch {
            skippedGroupMembers += 1;
        }
    }

    // Full address book: every saved contact, regardless of whether they ever
    // messaged you. Kept as an opt-in source filterable in the UI.
    let skippedContacts = 0;
    try {
        const contacts = await global.waClient.getContacts();
        for (const contact of contacts) {
            try {
                if (contact.isGroup || contact.isMe) continue;

                const contactId = contact?.id?._serialized;
                if (!contactId) continue;

                const phoneId = await resolvePhoneId([contactId]);
                const fallbackNumber = String(contact?.number || '').replace(/\D/g, '');
                const realNumber = phoneId ? phoneId.split('@')[0] : fallbackNumber;
                if (!/^\d{7,15}$/.test(realNumber)) continue;

                mergeLead(realNumber, 'ADDRESS BOOK', {
                    id: contactId,
                    name: contact.name || contact.pushname || 'Unknown',
                    number: realNumber,
                    timestamp: 0,
                    source: 'ADDRESS BOOK',
                    inbound: false,
                    isSaved: !!contact.isMyContact,
                });
            } catch {
                skippedContacts += 1;
            }
        }
    } catch {
        skippedContacts += 1;
    }

    let skippedCalls = 0;
    try {
        const callEntries = await global.waClient.pupPage.evaluate(() => {
            const whatsappWindow = window as any;
            const callCollection = whatsappWindow.require('WAWebCallCollection');
            if (!callCollection) return [];

            const mapKey = Object.keys(callCollection).find(
                (key) => callCollection[key] instanceof Map,
            );
            if (!mapKey) return [];

            const callMap = callCollection[mapKey] as Map<any, any>;
            return Array.from(callMap.values()).map((call: any) => ({
                peerJid:
                    call?.peerJid?._serialized ||
                    call?.peerJid?.toString?.() ||
                    '',
                isGroup: !!call?.isGroup,
                outgoing: !!call?.outgoing,
                offerTime: Number(
                    call?.offerTime || call?.senderEpochTimestampMs || call?.t || 0,
                ),
            }));
        });

        for (const call of callEntries) {
            if (!call || call.isGroup || call.outgoing) continue;

            try {
                const callIds = [call.peerJid].filter((id): id is string => typeof id === 'string' && id.length > 0);
                if (callIds.length === 0) continue;

                const phoneId = await resolvePhoneId(callIds);
                const realNumber = phoneId ? phoneId.split('@')[0] : '';
                if (!/^\d{7,15}$/.test(realNumber)) continue;

                const callTimestampMs = call.offerTime > 0 ? call.offerTime * 1000 : Date.now();
                mergeLead(realNumber, 'CALL LOG', {
                    id: call.peerJid || `call-${realNumber}`,
                    name: 'Unknown',
                    number: realNumber,
                    timestamp: callTimestampMs,
                    source: 'CALL LOG',
                    inbound: true,
                    isSaved: null,
                });
            } catch {
                skippedCalls += 1;
            }
        }
    } catch {
        skippedCalls += 1;
    }

    const uniqueLeads = Array.from(leadsMap.values());
    if (skippedChats > 0) console.warn(`Skipped ${skippedChats} unreadable WhatsApp chat(s)`);
    if (skippedGroupMembers > 0) console.warn(`Skipped ${skippedGroupMembers} unresolved group member(s)`);
    if (skippedContacts > 0) console.warn(`Skipped ${skippedContacts} unresolved address book contact(s)`);
    if (skippedCalls > 0) console.warn(`Skipped ${skippedCalls} WhatsApp call log item(s)`);
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
    
    wipeAuthFolder();
}
