require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Events, GatewayIntentBits, Collection } = require('discord.js');

// Verify token presence
const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;

if (!token || token === 'your_bot_token_here') {
    console.error('[ERROR] Vui lòng cấu hình DISCORD_BOT_TOKEN hợp lệ trong tệp .env!');
    console.error('Hướng dẫn: Tạo Bot Token tại https://discord.com/developers/applications');
    process.exit(1);
}

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Load commands dynamically
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
}

// Event: Bot is ready
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`========================================`);
    console.log(`  Discord Bot đã đăng nhập thành công!`);
    console.log(`  Bot Name : ${readyClient.user.tag}`);
    console.log(`  Bot ID   : ${readyClient.user.id}`);
    console.log(`========================================`);

    // Register Slash Commands
    try {
        const commandsData = client.commands.map(cmd => cmd.data.toJSON());
        const guildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

        if (guildId && guildId.trim() !== '') {
            try {
                await readyClient.application.commands.set(commandsData, guildId);
                console.log(`  Đã đăng ký ${client.commands.size} slash command(s) thành công cho Guild ${guildId}!`);
            } catch (guildError) {
                console.error(`  [WARNING] Đăng ký Slash Command cho Guild ${guildId} thất bại. Có thể Bot chưa tham gia Guild này hoặc ID không hợp lệ.`);
                console.error(`  Lỗi chi tiết: ${guildError.message}`);
                console.log(`  Đang thử đăng ký Global...`);
                await readyClient.application.commands.set(commandsData);
                console.log(`  Đã đăng ký ${client.commands.size} slash command(s) thành công (Global)!`);
            }
        } else {
            await readyClient.application.commands.set(commandsData);
            console.log(`  Đã đăng ký ${client.commands.size} slash command(s) thành công (Global)!`);
        }
    } catch (error) {
        console.error('  [ERROR] Đăng ký Slash Command thất bại:', error);
    }
});

// Event: Message Received (legacy prefix commands)
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // Security Guard: Only allow in the authorized guild if DISCORD_GUILD_ID is configured
    const authorizedGuildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;
    if (authorizedGuildId && authorizedGuildId.trim() !== '' && message.guildId !== authorizedGuildId) {
        if (message.guild) {
            console.log(`[SECURITY] Nhận tin nhắn từ server lạ: ${message.guild.name} (${message.guildId}). Tự động rời server...`);
            await message.guild.leave().catch(err => console.error('[SECURITY ERROR] Lỗi khi rời server:', err.message));
        }
        return;
    }

    const content = message.content.trim();

    if (content === '!ping') {
        const reply = await message.reply('🏓 Đang tính độ trễ...');
        const latency = reply.createdTimestamp - message.createdTimestamp;
        reply.edit(`🏓 Pong! Độ trễ phản hồi: \`${latency}ms\` | API Latency: \`${Math.round(client.ws.ping)}ms\``);
    }

    if (content === '!info') {
        message.reply(`🤖 **Discord Bot Info**\n- Bot Username: \`${client.user.tag}\`\n- Node.js Version: \`${process.version}\`\n- Trạng thái: Hoạt động bình thường`);
    }

    if (content === '!help') {
        message.reply(`📜 **Danh sách câu lệnh:**\n- \`!ping\`: Kiểm tra độ trễ của Bot\n- \`!info\`: Xem thông tin Bot\n- \`!help\`: Hiển thị danh sách trợ giúp này\n- \`/autoq\`: Lệnh slash cấu hình Auto Quest`);
    }
});

// Event: Interaction handling
client.on(Events.InteractionCreate, async (interaction) => {
    // Security Guard: Only allow in the authorized guild if DISCORD_GUILD_ID is configured
    const authorizedGuildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;
    if (authorizedGuildId && authorizedGuildId.trim() !== '' && interaction.guildId !== authorizedGuildId) {
        console.log(`[SECURITY] Phát hiện tương tác từ guild lạ hoặc cá nhân (Guild ID: ${interaction.guildId}).`);
        const replyContent = { content: '❌ Bot này ở chế độ riêng tư và chỉ hoạt động trên máy chủ được chỉ định!', ephemeral: true };
        
        try {
            if (interaction.isRepliable()) {
                await interaction.reply(replyContent);
            }
        } catch (err) {
            console.error('[SECURITY ERROR] Không thể gửi tin nhắn phản hồi bảo mật:', err.message);
        }

        if (interaction.guild) {
            await interaction.guild.leave().catch(err => console.error('[SECURITY ERROR] Lỗi khi rời server:', err.message));
        }
        return;
    }

    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`[ERROR] Lỗi thực thi lệnh ${interaction.commandName}:`, error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'Có lỗi xảy ra khi thực thi lệnh này!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Có lỗi xảy ra khi thực thi lệnh này!', ephemeral: true });
            }
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'autoqModal') {
            const command = client.commands.get('autoq');
            if (command && 'handleModal' in command) {
                try {
                    await command.handleModal(interaction);
                } catch (error) {
                    console.error('[ERROR] Lỗi xử lý Modal Submit:', error);
                    await interaction.reply({ content: 'Có lỗi xảy ra khi xử lý dữ liệu nhập vào!', ephemeral: true });
                }
            }
        }
    }
});

// Event: Auto-leave unauthorized servers when added
client.on(Events.GuildCreate, async (guild) => {
    const authorizedGuildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;
    if (authorizedGuildId && authorizedGuildId.trim() !== '' && guild.id !== authorizedGuildId) {
        console.log(`[SECURITY] Bot bị thêm vào server lạ: ${guild.name} (${guild.id}). Đang tự động rời khỏi...`);
        await guild.leave().catch(err => console.error('[SECURITY ERROR] Lỗi khi tự động rời server lạ:', err.message));
    }
});

// Start the bot
client.login(token).catch((err) => {
    console.error('[ERROR] Đăng nhập thất bại. Kiểm tra lại Bot Token của bạn:', err.message);
});
