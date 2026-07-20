/**
 * File xử lý dữ liệu đầu vào từ Discord Bot (Backend Processor)
 * Bạn có thể viết logic backend nặng, kết nối database hoặc gọi các file thực thi khác tại đây.
 */

/**
 * Xử lý dữ liệu cấu hình Quest nhận được từ người dùng
 * @param {string} userInput Dữ liệu người dùng nhập từ Modal
 * @param {import('discord.js').Interaction} interaction Đối tượng tương tác từ Discord
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function processQuestData(userInput, interaction) {
    console.log(`[Processor] Đang xử lý dữ liệu từ ${interaction.user.tag}: ${userInput}`);

    const { runAutoQuest } = require('./autoquests');

    try {
        // Chạy Auto Quest với token (userInput)
        runAutoQuest(userInput);
    } catch (err) {
        return {
            success: false,
            message: `Có lỗi khi khởi chạy Auto Quest: ${err.message}`
        };
    }

    return {
        success: true,
        message: `Dữ liệu cấu hình \`${userInput}\` đã được gửi tới bộ xử lý backend thành công!`
    };
}

module.exports = {
    processQuestData
};
