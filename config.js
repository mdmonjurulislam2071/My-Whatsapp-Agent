require('dotenv').config();

module.exports = {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    ownerName: process.env.OWNER_NAME || 'Md. Monjurul Islam Sir',
    agentName: process.env.AGENT_NAME || 'Personal AI Assistant',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    defaultActive: process.env.AUTO_REPLY_ACTIVE !== 'false',
    replyToGroups: process.env.REPLY_TO_GROUPS === 'true',
    maxHistoryLength: 50, // চ্যাট হিস্ট্রি সর্বোচ্চ ৫০টি আদান-প্রদান (১০০টি মেসেজ) মনে রাখবে
    // যে নম্বরগুলোকে এআই কোনো রিপ্লাই বা মিসড কল মেসেজ দেবে না (ব্লকলিস্ট)
    ignoredNumbers: [
        '8801304934339',
        '1304934339',
        '1099545247744',
        '15011011395751'
    ],
};
