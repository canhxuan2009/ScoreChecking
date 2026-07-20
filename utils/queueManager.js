/**
 * =============================================================================
 * Queue Manager - Quản lý hàng đợi người dùng Auto Quest
 * =============================================================================
 * 
 * - Chỉ 1 người chạy autoquest tại 1 thời điểm.
 * - Người tiếp theo được xếp hàng, nhận DM cập nhật vị trí.
 * - Token chỉ lưu trong RAM, xóa ngay sau khi dùng xong.
 * =============================================================================
 */

const { runAutoQuest } = require('./autoquests');

// ─────────────────────────────────────────────────────────────────────────────
// DỮ LIỆU (RAM ONLY - không bao giờ ghi ra file)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {{ userId: string, userTag: string, gatewayClient: any, dmMessage: any, heartbeatCount: number, questListData: any } | null} */
let activeSession = null;

/** @type {Array<{ userId: string, userTag: string, token: string, addedAt: number, dmMessage: any }>} */
const queue = [];

// ─────────────────────────────────────────────────────────────────────────────
// HÀM TIỆN ÍCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gửi hoặc tạo DM message cho user
 * @param {import('discord.js').Client} botClient - Discord Bot Client
 * @param {string} userId - ID người dùng
 * @param {string} content - Nội dung tin nhắn
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function sendDM(botClient, userId, content) {
    try {
        const user = await botClient.users.fetch(userId);
        return await user.send(content);
    } catch (err) {
        console.error(`[Queue] Không thể gửi DM cho ${userId}: ${err.message}`);
        return null;
    }
}

/**
 * Chỉnh sửa tin nhắn DM đã gửi
 * @param {import('discord.js').Message|null} message
 * @param {string} content
 */
async function editDM(message, content) {
    if (!message) return;
    try {
        await message.edit(content);
    } catch (err) {
        console.error(`[Queue] Không thể edit DM: ${err.message}`);
    }
}

/**
 * Tạo nội dung DM tiến độ
 */
function buildProgressDM(session) {
    const lines = [];
    lines.push('📊 **Trạng thái Auto Quest**');
    lines.push(`👤 Người dùng: \`${session.userTag}\``);
    lines.push('');

    // Danh sách quest
    if (session.questListData) {
        const { playQuests, videoQuests } = session.questListData;
        lines.push('📋 **Danh sách nhiệm vụ:**');
        let idx = 1;
        for (const q of playQuests) {
            const status = session.completedQuests?.has(q.id) ? '✅' : (session.currentQuestId === q.id ? '🔄' : '⏳');
            lines.push(`${status} ${idx}. 🎮 ${q.title}`);
            idx++;
        }
        for (const q of videoQuests) {
            const status = session.completedQuests?.has(q.id) ? '✅' : (session.currentQuestId === q.id ? '🔄' : '⏳');
            lines.push(`${status} ${idx}. 📺 ${q.title}`);
            idx++;
        }
        lines.push('');
    }

    // Quest hiện tại
    if (session.currentQuestTitle) {
        lines.push(`▶️ **Đang chạy:** ${session.currentQuestTitle}`);
        if (session.lastProgress) {
            const { pct, progress, target } = session.lastProgress;
            const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
            lines.push(`📈 Tiến độ: ${bar} **${pct}%** (${progress}s / ${target}s)`);
        }
    }

    lines.push(`\n🕐 Cập nhật lần cuối: ${new Date().toLocaleTimeString('vi-VN')}`);
    return lines.join('\n');
}

/**
 * Tạo nội dung DM hàng đợi cho người chờ
 */
function buildQueueDM(userTag, position) {
    const lines = [];
    lines.push('⏳ **Hàng đợi Auto Quest**');
    lines.push(`👤 Người dùng: \`${userTag}\``);
    lines.push(`📍 Vị trí trong hàng đợi: **#${position}**`);
    lines.push('');
    lines.push('Bot sẽ tự động thông báo khi đến lượt của bạn.');
    lines.push(`\n🕐 Cập nhật lần cuối: ${new Date().toLocaleTimeString('vi-VN')}`);
    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁC HÀM CHÍNH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kiểm tra user đã có trong hàng đợi hoặc đang active chưa
 */
function isUserInSystem(userId) {
    if (activeSession && activeSession.userId === userId) return 'active';
    const idx = queue.findIndex(q => q.userId === userId);
    if (idx !== -1) return 'queued';
    return false;
}

/**
 * Lấy vị trí trong hàng đợi (1-indexed)
 */
function getPosition(userId) {
    const idx = queue.findIndex(q => q.userId === userId);
    return idx === -1 ? -1 : idx + 1;
}

/**
 * Kiểm tra có phiên nào đang chạy không
 */
function isBusy() {
    return activeSession !== null;
}

/**
 * Thêm người dùng vào hàng đợi
 * @returns {{ position: number, immediate: boolean }}
 */
function enqueue(userId, userTag, token) {
    queue.push({ userId, userTag, token, addedAt: Date.now(), dmMessage: null });
    const position = queue.length;
    const immediate = !isBusy();
    return { position, immediate };
}

/**
 * Bắt đầu phiên tiếp theo trong hàng đợi
 * @param {import('discord.js').Client} botClient - Discord Bot Client
 */
async function startNext(botClient) {
    if (activeSession) return; // Đang có phiên chạy
    if (queue.length === 0) return; // Hàng đợi trống

    // Lấy người đầu tiên ra khỏi hàng đợi
    const entry = queue.shift();
    const { userId, userTag, token } = entry;

    // Tạo session mới
    activeSession = {
        userId,
        userTag,
        gatewayClient: null,
        dmMessage: null,
        heartbeatCount: 0,
        questListData: null,
        currentQuestId: null,
        currentQuestTitle: null,
        lastProgress: null,
        completedQuests: new Set(),
    };

    // Xóa token khỏi entry đã lấy ra (bảo mật)
    entry.token = null;

    console.log(`\n[Queue] ▶️ Bắt đầu phiên cho ${userTag} (${userId})`);

    // Gửi DM thông báo bắt đầu
    const dmMsg = await sendDM(botClient, userId, '🚀 **Đến lượt của bạn!** Đang khởi chạy Auto Quest...');
    activeSession.dmMessage = dmMsg;

    // Khởi chạy Gateway Client
    const gwClient = runAutoQuest(token);
    activeSession.gatewayClient = gwClient;

    // ─── Gắn Event Listeners ───

    // Nhận danh sách quest
    gwClient.on('quest_list', async (data) => {
        if (!activeSession || activeSession.userId !== userId) return;
        activeSession.questListData = data;
        const dmContent = buildProgressDM(activeSession);
        await editDM(activeSession.dmMessage, dmContent);
    });

    // Quest bắt đầu
    gwClient.on('quest_start', async (data) => {
        if (!activeSession || activeSession.userId !== userId) return;
        activeSession.currentQuestId = data.questId;
        activeSession.currentQuestTitle = data.gameTitle;
        activeSession.lastProgress = { pct: 0, progress: 0, target: data.target };

        console.log(`[Queue] 🎮 ${userTag} | Bắt đầu quest: ${data.gameTitle}`);
        const dmContent = buildProgressDM(activeSession);
        await editDM(activeSession.dmMessage, dmContent);
    });

    // Cập nhật tiến độ
    gwClient.on('quest_progress', async (data) => {
        if (!activeSession || activeSession.userId !== userId) return;
        activeSession.lastProgress = { pct: data.pct, progress: data.progress, target: data.target };
        activeSession.heartbeatCount++;

        // DM: cập nhật mỗi 1 heartbeat
        const dmContent = buildProgressDM(activeSession);
        await editDM(activeSession.dmMessage, dmContent);

        // Console: log mỗi 3 heartbeat
        if (activeSession.heartbeatCount % 3 === 0) {
            const bar = '█'.repeat(Math.floor(data.pct / 10)) + '░'.repeat(10 - Math.floor(data.pct / 10));
            console.log(`[Queue] 📊 ${userTag} | ${data.gameTitle} | ${bar} ${data.pct}% (${data.progress}s/${data.target}s)`);
        }
    });

    // Quest hoàn thành
    gwClient.on('quest_complete', async (data) => {
        if (!activeSession || activeSession.userId !== userId) return;
        activeSession.completedQuests.add(data.questId);
        activeSession.currentQuestId = null;
        activeSession.currentQuestTitle = null;
        activeSession.lastProgress = null;

        console.log(`[Queue] ✅ ${userTag} | Quest hoàn thành: ${data.gameTitle}`);
        const dmContent = buildProgressDM(activeSession);
        await editDM(activeSession.dmMessage, dmContent);
    });

    // Tất cả quest hoàn thành
    gwClient.on('all_complete', async () => {
        if (!activeSession || activeSession.userId !== userId) return;
        console.log(`[Queue] 🎉 ${userTag} | Tất cả quest đã hoàn thành!`);

        // Gửi DM tổng kết (tin nhắn mới)
        await sendDM(botClient, userId, '🎉 **Hoàn thành tất cả nhiệm vụ!**\nBạn có thể vào Discord để nhận phần thưởng.');

        // Ngắt kết nối gateway
        gwClient.disconnect();

        // Xóa session và token
        clearSession();

        // Cập nhật vị trí cho người đang chờ
        await updateQueuePositions(botClient);

        // Bắt đầu phiên tiếp theo
        await startNext(botClient);
    });

    // Lỗi kết nối
    gwClient.on('error', async (data) => {
        if (!activeSession || activeSession.userId !== userId) return;
        console.error(`[Queue] ❌ ${userTag} | Lỗi: ${data.message}`);

        // Gửi DM thông báo lỗi
        await sendDM(botClient, userId, `❌ **Lỗi Auto Quest:** ${data.message}\nPhiên đã bị hủy. Vui lòng thử lại.`);

        // Xóa session
        clearSession();

        // Cập nhật vị trí cho người đang chờ
        await updateQueuePositions(botClient);

        // Bắt đầu phiên tiếp theo
        await startNext(botClient);
    });
}

/**
 * Xóa phiên hiện tại và giải phóng bộ nhớ
 */
function clearSession() {
    if (!activeSession) return;
    console.log(`[Queue] 🧹 Xóa phiên của ${activeSession.userTag}`);
    activeSession.gatewayClient = null;
    activeSession.dmMessage = null;
    activeSession.questListData = null;
    activeSession.completedQuests = null;
    activeSession.lastProgress = null;
    activeSession = null;
}

/**
 * Cập nhật vị trí hàng đợi cho tất cả người đang chờ
 * @param {import('discord.js').Client} botClient
 */
async function updateQueuePositions(botClient) {
    for (let i = 0; i < queue.length; i++) {
        const entry = queue[i];
        const newPosition = i + 1;
        const content = buildQueueDM(entry.userTag, newPosition);

        if (entry.dmMessage) {
            await editDM(entry.dmMessage, content);
        } else {
            entry.dmMessage = await sendDM(botClient, entry.userId, content);
        }
    }
}

/**
 * Lấy thông tin trạng thái hiện tại (cho debug/status commands)
 */
function getStatus() {
    return {
        activeUser: activeSession ? { userId: activeSession.userId, userTag: activeSession.userTag } : null,
        queueLength: queue.length,
        queueUsers: queue.map((q, i) => ({ position: i + 1, userTag: q.userTag })),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    isUserInSystem,
    getPosition,
    isBusy,
    enqueue,
    startNext,
    clearSession,
    updateQueuePositions,
    getStatus,
};
