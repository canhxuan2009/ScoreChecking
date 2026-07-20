/**
 * File xử lý dữ liệu đầu vào từ Discord Bot (Backend Processor)
 * Tích hợp Queue Manager để quản lý hàng đợi người dùng.
 */

const queueManager = require('./queueManager');

/**
 * Xử lý dữ liệu cấu hình Quest nhận được từ người dùng
 * @param {string} userInput Dữ liệu người dùng nhập từ Modal (token)
 * @param {import('discord.js').Interaction} interaction Đối tượng tương tác từ Discord
 * @param {import('discord.js').Client} botClient Discord Bot Client để gửi DM
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function processQuestData(userInput, interaction, botClient) {
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;

    console.log(`[Processor] Nhận yêu cầu từ ${userTag} (${userId})`);

    // Kiểm tra user đã có trong hệ thống chưa
    const status = queueManager.isUserInSystem(userId);
    if (status === 'active') {
        return {
            success: false,
            message: 'Bạn đang có phiên Auto Quest đang chạy! Vui lòng chờ hoàn thành.'
        };
    }
    if (status === 'queued') {
        const pos = queueManager.getPosition(userId);
        return {
            success: false,
            message: `Bạn đã có trong hàng đợi ở vị trí **#${pos}**. Vui lòng chờ đến lượt.`
        };
    }

    // Thêm vào hàng đợi
    const { position, immediate } = queueManager.enqueue(userId, userTag, userInput, interaction.channelId);

    if (immediate) {
        // Không có ai đang chạy → bắt đầu ngay
        try {
            await queueManager.startNext(botClient);
        } catch (err) {
            console.error('[Processor] Lỗi khởi chạy Auto Quest:', err);
            return {
                success: false,
                message: `Có lỗi khi khởi chạy Auto Quest: ${err.message}`
            };
        }
        return {
            success: true,
            message: '🚀 Auto Quest đang được khởi chạy! Kiểm tra DM để theo dõi tiến độ.'
        };
    } else {
        // Đang có người chạy → xếp hàng
        return {
            success: true,
            message: `⏳ Đã thêm bạn vào hàng đợi ở vị trí **#${position}**. Bot sẽ DM thông báo khi đến lượt.`
        };
    }
}

module.exports = {
    processQuestData
};
