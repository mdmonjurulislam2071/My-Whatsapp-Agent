require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    WAMessageStubType
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { exec } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');

// ১. এপিআই কী চেক
if (!config.geminiApiKey || config.geminiApiKey === 'your_gemini_api_key_here') {
    console.error('\n❌ [ভুল] GEMINI_API_KEY পাওয়া যায়নি!');
    console.error('অনুগ্রহ করে .env ফাইলে আপনার সঠিক Gemini API Key বসান।\n');
    process.exit(1);
}

// ২. Gemini এআই মডেল ইনিশিয়ালাইজেশন
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const systemInstruction = `
তুমি ${config.ownerName}-এর অত্যন্ত স্মার্ট, বুদ্ধিমান, প্রফেশনাল এবং বাস্তবসম্মত পার্সোনাল AI অ্যাসিস্ট্যান্ট।
তোমার মূল দায়িত্ব হলো যখন ${config.ownerName} ব্যস্ত থাকেন, তখন তার WhatsApp চ্যাটে অত্যন্ত প্রাসঙ্গিকভাবে (Most Relevant) ও স্বাভাবিক মানুষের মতো মেসেজের উত্তর দেওয়া।

গুরুত্বপূর্ণ নিয়মাবলী:
১. সালামের সঠিক ব্যবহার:
   - প্রেরক যদি সালাম দেয় (যেমন: Salam, Assalamu Alaikum, slm, আসসালামু আলাইকুম), কেবল তখনই সালামের উত্তর হিসেবে "ওয়ালাইকুম আসসালাম" বলবে।
   - প্রেরক সালাম না দিলে নিজে থেকে কখনো সালামের উত্তর ("ওয়ালাইকুম আসসালাম") দেবে না। তবে তুমি চাইলে কথপোকথনের শুরুতে সৌজন্য হিসেবে "আসসালামু আলাইকুম" বলতে পারো। কখনোই "নমস্কার" বা অনৈসলামিক সম্ভাষণ ব্যবহার করবে না।
২. সর্বোচ্চ প্রাসঙ্গিকতা (Extreme Relevance):
   - প্রেরক ঠিক যে কথা বলেছে বা প্রশ্ন করেছে, হুবহু সেই বিষয়ের ওপর টু-দ্য-পয়েন্ট উত্তর দাও। কোনো অপ্রাসঙ্গিক বা মুখস্থ কথা বলবে না।
   - প্রতিটি মেসেজে বারবার নিজেকে অ্যাসিস্ট্যান্ট হিসেবে পরিচয় দেওয়ার দরকার নেই। পরিচয় শুধু তখনই দেবে যখন প্রেরক জানতে চাইবে বা প্রথম পরিচয়ে প্রয়োজন হবে। চ্যাট যেন একজন রক্ত-মাংসের বুদ্ধিমান সহকারীর মতো অত্যন্ত স্বাভাবিক মনে হয়।
   - কেউ স্যারের খোঁজ করলে বা কথা বলতে চাইলে বলবে: "স্যার বর্তমানে একটু ব্যস্ত আছেন, ফ্রি হয়েই আপনার সাথে যোগাযোগ করবেন। আপনার কোনো জরুরি বার্তা থাকলে আমাকে বলতে পারেন, আমি স্যারকে পৌঁছে দেব।"
৩. পূর্ণ কথোপকথন মেমোরি (Full Conversation Memory & Context):
   - তোমার কাছে এই প্রেরকের সাথে অতীতের পুরো চ্যাট হিস্ট্রি রয়েছে। প্রেরক অতীতে নিজের কী পরিচয় দিয়েছিল, কী নিয়ে কথা হয়েছিল বা কোনো তথ্য দিয়েছিল কি না—সবকিছু মনে রাখবে।
   - তবে উত্তর তৈরি করার সময় প্রেরকের সবচেয়ে সাম্প্রতিক (Recent/Latest) মেসেজটিকে প্রধান ফোকাস করবে, যেন উত্তরটি তাৎক্ষণিক ও পুরোপুরি প্রাসঙ্গিক মনে হয়।
৪. ভাষা ও স্টাইল:
   - প্রেরক যেভাবে মেসেজ দিয়েছে (বাংলা, ইংরেজি অথবা বাংলিশ), ঠিক সেই ভাষাতেই স্বাভাবিক মিষ্টি টোনে উত্তর দাও।
   - উত্তর সবসময় সংক্ষিপ্ত, অর্থপূর্ণ ও টু-দ্য-পয়েন্ট (১-২ বাক্যে) রাখো।
`;

const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: systemInstruction,
});

// ৩. স্থায়ী চ্যাট হিস্ট্রি মেমোরি (লোকাল ফাইলে সেভ থাকবে, বট রিস্টার্ট হলেও মুছবে না)
const MEMORY_DIR = path.join(__dirname, 'chat_memory');
if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function getMemoryFilePath(chatId) {
    const safeFileName = chatId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    return path.join(MEMORY_DIR, safeFileName);
}

function getChatHistory(chatId) {
    const filePath = getMemoryFilePath(chatId);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (_) {
            return [];
        }
    }
    return [];
}

function saveChatHistory(chatId, history) {
    const filePath = getMemoryFilePath(chatId);
    const maxItems = config.maxHistoryLength * 2;
    const trimmed = history.slice(-maxItems);
    try {
        fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2), 'utf8');
    } catch (e) {
        console.error('মেমোরি সেভ করতে সমস্যা:', e.message);
    }
}

function addToHistory(chatId, role, text) {
    const history = getChatHistory(chatId);
    history.push({ role, parts: [{ text }] });
    saveChatHistory(chatId, history);
}

function clearChatHistory(chatId) {
    const filePath = getMemoryFilePath(chatId);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (_) {}
    }
}

// নির্দিষ্ট নম্বর ইগনোর করার ফাংশন (ব্লকলিস্ট)
function isIgnoredContact(jid, participant = null) {
    if (!jid && !participant) return false;
    const list = config.ignoredNumbers || [];
    return list.some(num => (jid && jid.includes(num)) || (participant && participant.includes(num)));
}

// ৪. এজেন্ট স্টেট (অন / অফ টগল) ও লাইভ লগস
let isAgentActive = config.defaultActive;
let isConnected = false;
let currentQrDataUrl = null;
let repliedCount = 0;
const startTime = new Date();
const recentLogs = ['🟢 সিস্টেম প্রস্তুত এবং সক্রিয়। ইনকামিং মেসেজের অপেক্ষায়...'];

function addLog(msg) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: true });
    recentLogs.unshift(`[${time}] ${msg}`);
    if (recentLogs.length > 20) recentLogs.pop();
}

// ৫. Express Web Dashboard সেটআপ (মোবাইল ও ল্যাপটপের জন্য)
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    res.json({
        isConnected,
        qrCode: currentQrDataUrl,
        isActive: isAgentActive,
        ownerName: config.ownerName,
        repliedCount: repliedCount,
        uptimeMinutes: Math.floor((new Date() - startTime) / 60000),
        model: config.geminiModel,
        recentLogs: recentLogs
    });
});

app.post('/api/toggle', (req, res) => {
    isAgentActive = !isAgentActive;
    addLog(`🔄 ড্যাশবোর্ড থেকে এজেন্ট স্ট্যাটাস পরিবর্তন: ${isAgentActive ? '🟢 ACTIVE' : '🔴 OFF'}`);
    res.json({
        isConnected,
        qrCode: currentQrDataUrl,
        isActive: isAgentActive,
        ownerName: config.ownerName,
        repliedCount: repliedCount,
        uptimeMinutes: Math.floor((new Date() - startTime) / 60000),
        model: config.geminiModel,
        recentLogs: recentLogs
    });
});

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log('\n======================================================');
    console.log('🌐 Web Dashboard Controller চালু হয়েছে!');
    console.log(`💻 ল্যাপটপ থেকে ওপেন করুন: http://localhost:${PORT}`);
    console.log(`📱 মোবাইল থেকে ওপেন করুন:  http://${localIp}:${PORT}`);
    console.log('======================================================\n');
});

// 24/7 Keep-Alive Self Ping (ক্লাউড স্লিপ প্রতিরোধ)
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
if (SERVER_URL) {
    console.log(`📡 24/7 Keep-Alive স্বয়ংক্রিয় সচল রাখার ফিচার সক্রিয়: ${SERVER_URL}`);
    const https = require('https');
    const http = require('http');
    setInterval(() => {
        const client = SERVER_URL.startsWith('https') ? https : http;
        client.get(`${SERVER_URL}/api/status`, () => {}).on('error', () => {});
    }, 10 * 60 * 1000);
}

// ৬. WhatsApp Baileys ক্লায়েন্ট চালু করার ফাংশন
async function startWhatsAppBot() {
    console.log('🚀 WhatsApp ক্লায়েন্ট চালু করা হচ্ছে...');

    // সেশন সেভ রাখার স্টেট (বারবার স্ক্যান করতে হবে না)
    const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), // টার্মিনাল পরিষ্কার রাখতে লগ সাইলেন্ট
        printQRInTerminal: false,
        auth: state,
        browser: ['Chrome (Windows)', 'Desktop', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    // সংযোগ আপডেট ইভেন্ট (QR কোড এবং কানেক্ট স্ট্যাটাস)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) currentQrDataUrl = url;
            });

            console.log('\n======================================================');
            console.log('📲 QR কোড তৈরি হয়েছে!');
            console.log('🖼️ আপনার স্ক্রিনে পরিষ্কার "qr.png" ইমেজ ফাইল ওপেন করা হচ্ছে...');
            console.log('   (WhatsApp > Settings/Menu > Linked Devices > Link a Device)');
            console.log('======================================================\n');
            
            // নিখুঁত সাইজের ইমেজ হিসেবে qr.png সেভ এবং সরাসরি ওপেন করা
            QRCode.toFile('./qr.png', qr, { width: 320, margin: 2 }, (err) => {
                if (!err) {
                    try { exec('start qr.png'); } catch (_) {}
                }
            });

            // টার্মিনালেও দেখানো (যদি কেউ দেখতে চায়)
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`⚠️ সংযোগ বিচ্ছিন্ন হয়েছে (Status: ${statusCode})।`);
            if (shouldReconnect) {
                console.log('🔄 পুনরায় স্বয়ংক্রিয়ভাবে কানেক্ট করার চেষ্টা করা হচ্ছে...');
                startWhatsAppBot();
            } else {
                console.log('❌ ডিভাইস থেকে লগআউট করা হয়েছে। পুনরায় স্ক্যান করতে হবে।');
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQrDataUrl = null;
            console.log('\n======================================================');
            console.log('🤖 আপনার AI এজেন্ট সফলভাবে WhatsApp-এ কানেক্ট হয়েছে!');
            console.log(`👤 মালিকের নাম: ${config.ownerName}`);
            console.log(`🧠 AI মডেল: ${config.geminiModel}`);
            console.log(`⚡ বর্তমান স্ট্যাটাস: ${isAgentActive ? '🟢 ACTIVE (অটো রিপ্লাই চালু)' : '🔴 OFF (অটো রিপ্লাই বন্ধ)'}`);
            console.log('======================================================\n');
            console.log('💡 কমান্ড লিস্ট (নিজের হোয়াটসঅ্যাপ থেকে মেসেজ পাঠান):');
            console.log('   !bot on     -> এজেন্ট চালু করতে');
            console.log('   !bot off    -> এজেন্ট বন্ধ করতে');
            console.log('   !bot status -> বর্তমান অবস্থা দেখতে');
            console.log('   !bot clear  -> মেমোরি ক্লিয়ার করতে\n');
        }
    });

    // কল ট্র্যাকিং স্টেট (কল রিসিভ করা হয়েছে নাকি কেটে দেওয়া/মিসড হয়েছে)
    const callSessions = new Map();
    const lastCallReplyTimestamps = new Map();

    // ৬. কল হ্যান্ডলিং ইভেন্ট (কল কেটে দেওয়া বা মিসড কল শনাক্তকরণ)
    sock.ev.on('call', async (calls) => {
        for (const call of calls) {
            const callId = call.id;
            const callerJid = call.chatId || call.from;

            if (!callerJid || call.isGroup || callerJid.endsWith('@g.us')) continue;
            if (isIgnoredContact(callerJid)) continue;
            if (!isAgentActive) continue;

            let session = callSessions.get(callId);
            if (!session) {
                session = { callerJid, accepted: false, createdAt: Date.now() };
                callSessions.set(callId, session);
                setTimeout(() => callSessions.delete(callId), 10 * 60 * 1000);
            }

            // আপনি নিজে ফোন রিসিভ করে কথা বললে 'accept' হবে
            if (call.status === 'accept') {
                session.accepted = true;
                console.log(`📞 [কল রিসিভ করা হয়েছে] ${callerJid}-এর সাথে কথা বলা হচ্ছে (কোনো অটো-রিপ্লাই যাবে না)`);
                continue;
            }

            // আপনি যদি কল কেটে দেন (reject), কিংবা রিং হয়ে কেটে যায় (timeout), কিংবা রিসিভ করার আগেই শেষ হয় (terminate without accept)
            const isRejectedOrMissed = (call.status === 'reject' || call.status === 'timeout' || call.status === 'terminate');

            if (isRejectedOrMissed && !session.accepted) {
                const lastSent = lastCallReplyTimestamps.get(callerJid) || 0;
                if (Date.now() - lastSent < 20000) {
                    continue;
                }
                lastCallReplyTimestamps.set(callerJid, Date.now());

                const actionLabel = call.status === 'reject' ? 'কল কেটে দেওয়া হয়েছে' : 'মিসড কল';
                console.log(`\n📞 [${actionLabel}] ${callerJid} (রিসিভ করা হয়নি)। অটো-মেসেজ পাঠানো হচ্ছে...`);

                const callReplyMessage = `আসসালামু আলাইকুম। দুঃখিত, ${config.ownerName} এই মুহূর্তে একটু ব্যস্ত থাকায় আপনার কলটি রিসিভ করতে পারেননি। তিনি ফ্রি হয়ে যত দ্রুত সম্ভব আপনার সাথে যোগাযোগ করবেন।\n\nআপনার কোনো জরুরি কথা বা বার্তা থাকলে এখানে লিখে রাখতে পারেন, আমি স্যারকে জানিয়ে দেব।`;

                try {
                    await sock.sendMessage(callerJid, { text: callReplyMessage });
                    addToHistory(callerJid, 'user', `[Call: ${actionLabel}]`);
                    addToHistory(callerJid, 'model', callReplyMessage);
                    addLog(`📞 [কল]: ${callerJid} (${actionLabel} -> অটো-মেসেজ পাঠানো হয়েছে)`);
                    console.log(`📤 কলের অটো-রিপ্লাই সফলভাবে পাঠানো হয়েছে: ${callerJid}`);
                } catch (err) {
                    console.error('❌ কলের রিপ্লাই পাঠাতে সমস্যা:', err.message);
                }
            }
        }
    });

    // ৭. ইনকামিং মেসেজ ও মিসড কল হ্যান্ডলিং
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            const fromMe = msg.key.fromMe;
            const jid = msg.key.remoteJid;

            // শুধুমাত্র ব্যক্তিগত চ্যাট ফিল্টার (গ্রুপ বা চ্যানেল ইগনোর)
            const isGroup = jid?.endsWith('@g.us');
            const isNewsletter = jid?.endsWith('@newsletter');
            const isBroadcast = jid?.includes('@broadcast');
            const isPersonalChat = jid?.endsWith('@s.whatsapp.net') || jid?.endsWith('@lid');

            if (isGroup || isNewsletter || isBroadcast || !isPersonalChat) {
                continue;
            }

            // নির্দিষ্ট নম্বর ইগনোর (ব্লকলিস্ট - এই নম্বরে কোনো অটো-রিপ্লাই বা মিসড কল মেসেজ যাবে না)
            if (!fromMe && isIgnoredContact(jid, msg.key.participant)) {
                continue;
            }

            // -------------------------------------------------------------
            // ক. রিমোট কন্ট্রোল কমান্ড (মালিক নিজের ফোন থেকে কন্ট্রোল করবেন)
            // -------------------------------------------------------------
            const messageText = (
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                ''
            ).trim();

            if (fromMe && messageText) {
                const cmd = messageText.toLowerCase();

                if (cmd === '!bot on') {
                    isAgentActive = true;
                    addLog('🟢 এজেন্ট চালু করা হয়েছে (WhatsApp Command)');
                    await sock.sendMessage(jid, { text: '🟢 [AI Agent]: সক্রিয় করা হয়েছে! এখন থেকে ইনকামিং মেসেজের অটো-রিপ্লাই দেওয়া হবে।' });
                    console.log('🔄 এজেন্ট স্ট্যাটাস পরিবর্তন: ACTIVE');
                    return;
                }

                if (cmd === '!bot off') {
                    isAgentActive = false;
                    addLog('🔴 এজেন্ট বন্ধ করা হয়েছে (WhatsApp Command)');
                    await sock.sendMessage(jid, { text: '🔴 [AI Agent]: নিষ্ক্রিয় করা হয়েছে! অটো-রিপ্লাই সাময়িকভাবে বন্ধ আছে।' });
                    console.log('🔄 এজেন্ট স্ট্যাটাস পরিবর্তন: OFF');
                    return;
                }

                if (cmd === '!bot status') {
                    const uptimeMinutes = Math.floor((new Date() - startTime) / 60000);
                    const statusMsg = `📊 [AI Agent স্ট্যাটাস]:\n` +
                        `• অবস্থা: ${isAgentActive ? '🟢 সক্রিয় (Active)' : '🔴 বন্ধ (Off)'}\n` +
                        `• মোট রিপ্লাই দেওয়া হয়েছে: ${repliedCount} টি\n` +
                        `• চালু রয়েছে: ${uptimeMinutes} মিনিট\n` +
                        `• মডেল: ${config.geminiModel}`;
                    await sock.sendMessage(jid, { text: statusMsg });
                    return;
                }

                if (cmd === '!bot clear') {
                    clearChatHistory(jid);
                    await sock.sendMessage(jid, { text: '🧹 [AI Agent]: এই চ্যাটের মেমোরি সফলভাবে মুছে ফেলা হয়েছে।' });
                    return;
                }

                if (cmd === '!bot help') {
                    const helpMsg = `🛠️ [AI Agent কমান্ড সমূহ]:\n` +
                        `• !bot on     -> এজেন্ট চালু করুন\n` +
                        `• !bot off    -> এজেন্ট বন্ধ করুন\n` +
                        `• !bot status -> বর্তমান অবস্থা দেখুন\n` +
                        `• !bot clear  -> এই চ্যাটের মেমোরি রিসেট করুন`;
                    await sock.sendMessage(jid, { text: helpMsg });
                    return;
                }

                return;
            }

            // -------------------------------------------------------------
            // খ. প্রকৃত মিসড কল শনাক্তকরণ (অফিসিয়াল WhatsApp স্টাব)
            // এটি কেবল তখনই ফায়ার হবে যখন কল সত্যি সত্যি রিসিভ করা হয়নি।
            // আপনি নিজে ফোন রিসিভ করে কথা বললে এটি কখনো মেসেজ পাঠাবে না!
            // -------------------------------------------------------------
            const isMissedCall = !fromMe && (
                msg.messageStubType === WAMessageStubType.CALL_MISSED_VOICE ||
                msg.messageStubType === WAMessageStubType.CALL_MISSED_VIDEO ||
                msg.messageStubType === 40 ||
                msg.messageStubType === 41
            );

            if (isMissedCall) {
                if (!isAgentActive) continue;

                // যদি গত ২০ সেকেন্ডের মধ্যে অলরেডি কল রিপ্লাই গিয়ে থাকে তবে ডুপ্লিকেট পাঠাবে না
                const lastSent = lastCallReplyTimestamps.get(jid) || 0;
                if (Date.now() - lastSent < 20000) {
                    continue;
                }
                lastCallReplyTimestamps.set(jid, Date.now());

                console.log(`\n📞 [প্রকৃত মিসড কল শনাক্ত] ${jid} কল করেছিলেন কিন্তু রিসিভ করা হয়নি।`);

                const missedCallMessage = `আসসালামু আলাইকুম। দুঃখিত, ${config.ownerName} এই মুহূর্তে একটু ব্যস্ত থাকায় আপনার কলটি রিসিভ করতে পারেননি। তিনি ফ্রি হয়ে যত দ্রুত সম্ভব আপনার সাথে যোগাযোগ করবেন।\n\nআপনার কোনো জরুরি কথা বা বার্তা থাকলে এখানে লিখে রাখতে পারেন, আমি স্যারকে জানিয়ে দেব।`;

                try {
                    await sock.sendMessage(jid, { text: missedCallMessage });
                    addToHistory(jid, 'user', '[Missed Call: কল করেছিলেন কিন্তু রিসিভ করা হয়নি]');
                    addToHistory(jid, 'model', missedCallMessage);
                    addLog(`📞 [মিসড কল]: ${jid} থেকে মিসড কল এসেছিল (অটো-মেসেজ পাঠানো হয়েছে)`);
                    console.log(`📤 মিসড কলের অটো-রিপ্লাই সফলভাবে পাঠানো হয়েছে: ${jid}`);
                } catch (err) {
                    console.error('❌ মিসড কল রিপ্লাই পাঠাতে সমস্যা:', err.message);
                }
                continue;
            }

            // -------------------------------------------------------------
            // গ. সাধারণ টেক্সট মেসেজের অটো-রিপ্লাই
            // -------------------------------------------------------------
            if (!isAgentActive || fromMe || !messageText) continue;

            const senderName = msg.pushName || 'User';
            console.log(`\n📩 [নতুন মেসেজ] ${senderName} (${jid}): "${messageText}"`);
            addLog(`📩 [মেসেজ] ${senderName}: "${messageText.substring(0, 30)}"`);

            try {
                // টাইপিং স্টেট প্রদর্শন
                await sock.sendPresenceUpdate('composing', jid);

                // মেমোরি ও Gemini চ্যাট সেশন
                const history = getChatHistory(jid);
                const chatSession = model.startChat({ history });

                const result = await chatSession.sendMessage(messageText);
                const replyText = result.response.text().trim();

                // মেমোরিতে সেভ
                addToHistory(jid, 'user', messageText);
                addToHistory(jid, 'model', replyText);

                // রিপ্লাই পাঠানো
                await sock.sendMessage(jid, { text: replyText }, { quoted: msg });
                repliedCount++;
                addLog(`📤 [রিপ্লাই -> ${senderName}]: "${replyText.substring(0, 35)}..."`);

                console.log(`📤 [রিপ্লাই পাঠানো হয়েছে]: "${replyText}"`);

                await sock.sendPresenceUpdate('paused', jid);

            } catch (error) {
                console.error('❌ রিপ্লাই তৈরিতে সমস্যা:', error.message);
                try {
                    await sock.sendPresenceUpdate('paused', jid);
                } catch (_) {}
            }
        }
    });
}

// শুরু করা
startWhatsAppBot().catch((err) => {
    console.error('❌ ক্লায়েন্ট চালুর সময় এরর:', err);
});
