const { SlashCommandBuilder } = require('discord.js');
const { setHypesquad } = require('../utils/hypesquad');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hypesquad')
        .setDescription('Lấy huy hiệu HypeSquad cho tài khoản của bạn')
        .addStringOption(option => 
            option.setName('token')
                .setDescription('Token tài khoản Discord của bạn')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('house')
                .setDescription('Chọn nhà HypeSquad (Bravery/Brilliance/Balance)')
                .setRequired(true)
                .addChoices(
                    { name: 'Bravery (Tím)', value: 1 },
                    { name: 'Brilliance (Đỏ)', value: 2 },
                    { name: 'Balance (Xanh lá)', value: 3 }
                )
        ),
    async execute(interaction) {
        // Defer reply, hide it from others (ephemeral: true) to protect the token
        await interaction.deferReply({ ephemeral: true });
        
        const token = interaction.options.getString('token');
        const houseId = interaction.options.getInteger('house');

        try {
            const resultMsg = await setHypesquad(token, houseId);
            await interaction.editReply({ content: `✅ ${resultMsg}` });
        } catch (error) {
            await interaction.editReply({ content: `❌ Thất bại: ${error.message}` });
        }
    }
};
