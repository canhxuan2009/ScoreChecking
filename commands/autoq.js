const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { processQuestData } = require('../utils/questProcessor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoq')
        .setDescription('Bật modal nhập liệu cấu hình Auto Quest'),

    async execute(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('autoqModal')
            .setTitle('Cấu hình Auto Quest');

        const dataInput = new TextInputBuilder()
            .setCustomId('questDataInput')
            .setLabel('Dữ liệu nhập vào')
            .setPlaceholder('Nhập dữ liệu tại đây...')
            .setStyle(TextInputStyle.Short) // 1 dòng
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(dataInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        const userInput = interaction.fields.getTextInputValue('questDataInput');
        console.log(`[Interaction - AutoQ] Người dùng ${interaction.user.tag} đã gửi modal.`);

        // Trả lời trì hoãn (deferReply) để tránh bot bị timeout (nếu xử lý backend nặng > 3s)
        await interaction.deferReply({ ephemeral: true });

        try {
            // Gọi module xử lý ở file khác (truyền botClient để gửi DM)
            const result = await processQuestData(userInput, interaction, interaction.client);

            if (result.success) {
                await interaction.editReply({
                    content: `✅ ${result.message}`
                });
            } else {
                await interaction.editReply({
                    content: `❌ Xử lý thất bại: ${result.message}`
                });
            }
        } catch (error) {
            console.error('[ERROR] Lỗi xử lý dữ liệu qua bộ xử lý:', error);
            await interaction.editReply({
                content: `❌ Có lỗi hệ thống xảy ra trong quá trình xử lý dữ liệu.`
            });
        }
    }
};
