const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, REST, Routes } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

// Render 웹서비스를 위한 HTTP 서버
const { setBotInstance } = require('./health-check');

// 명령어 정의
const commands = [
    {
        name: 'exempt',
        description: '특정 사용자를 강퇴 제외 목록에 추가합니다.',
        options: [
            {
                name: 'user',
                type: 6, // USER 타입
                description: '제외할 사용자',
                required: true,
            },
        ],
    },
    {
        name: 'unexempt',
        description: '특정 사용자를 강퇴 제외 목록에서 제거합니다.',
        options: [
            {
                name: 'user',
                type: 6,
                description: '제외 해제할 사용자',
                required: true,
            },
        ],
    },
    {
        name: 'exemptrole',
        description: '특정 역할을 강퇴 제외 목록에 추가합니다.',
        options: [
            {
                name: 'role',
                type: 8, // ROLE 타입
                description: '제외할 역할',
                required: true,
            },
        ],
    },
    {
        name: 'unexemptrole',
        description: '특정 역할을 강퇴 제외 목록에서 제거합니다.',
        options: [
            {
                name: 'role',
                type: 8,
                description: '제외 해제할 역할',
                required: true,
            },
        ],
    },
    {
        name: 'status',
        description: '봇의 현재 상태 및 통계를 확인합니다.',
    },
    {
        name: 'check',
        description: '현재 비활성 사용자 목록을 확인합니다.',
    },
    {
        name: 'help',
        description: '봇 명령어 도움말을 보여줍니다.',
    },
];

class InactiveKickBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates
            ]
        });

        // 데이터 저장 경로
        this.dataPath = path.join(__dirname, 'bot_data');
        this.userActivityFile = path.join(this.dataPath, 'user_activity.json');
        this.exemptUsersFile = path.join(this.dataPath, 'exempt_users.json');
        this.exemptRolesFile = path.join(this.dataPath, 'exempt_roles.json');

        // 메모리 캐시
        this.userActivity = new Map();
        this.exemptUsers = new Set();
        this.exemptRoles = new Set();

        // 설정
        this.INACTIVE_THRESHOLD = 48 * 60 * 60 * 1000;
        this.CHECK_INTERVAL = 30 * 60 * 1000;

        this.init();
    }

    async init() {
        await this.ensureDataDirectory();
        await this.loadData();
        this.setupEventHandlers();
        this.startPeriodicCheck();
    }

    async ensureDataDirectory() {
        try {
            await fs.access(this.dataPath);
        } catch {
            await fs.mkdir(this.dataPath, { recursive: true });
        }
    }

    async loadData() {
        try {
            const activityData = await fs.readFile(this.userActivityFile, 'utf8');
            const activityObj = JSON.parse(activityData);
            this.userActivity = new Map(Object.entries(activityObj));
        } catch (error) {
            console.log('활동 데이터 파일이 없습니다. 새로 생성합니다.');
            this.userActivity = new Map();
        }

        try {
            const exemptUsersData = await fs.readFile(this.exemptUsersFile, 'utf8');
            this.exemptUsers = new Set(JSON.parse(exemptUsersData));
        } catch (error) {
            console.log('제외 사용자 파일이 없습니다. 새로 생성합니다.');
            this.exemptUsers = new Set();
        }

        try {
            const exemptRolesData = await fs.readFile(this.exemptRolesFile, 'utf8');
            this.exemptRoles = new Set(JSON.parse(exemptRolesData));
        } catch (error) {
            console.log('제외 역할 파일이 없습니다. 새로 생성합니다.');
            this.exemptRoles = new Set();
        }
    }

    async saveData() {
        try {
            const activityObj = Object.fromEntries(this.userActivity);
            await fs.writeFile(this.userActivityFile, JSON.stringify(activityObj, null, 2));

            await fs.writeFile(this.exemptUsersFile, JSON.stringify([...this.exemptUsers], null, 2));

            await fs.writeFile(this.exemptRolesFile, JSON.stringify([...this.exemptRoles], null, 2));
        } catch (error) {
            console.error('데이터 저장 중 오류:', error);
        }
    }

    setupEventHandlers() {
        this.client.once('ready', async () => {
            console.log(`${this.client.user.tag}로 로그인했습니다!`);
            console.log(`${this.client.guilds.cache.size}개 서버에서 활동 중`);
            
            setBotInstance(this);
            
            // 슬래시 커맨드 등록
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            try {
                console.log('슬래시 커맨드 등록 시작...');
                await rest.put(
                    Routes.applicationCommands(this.client.user.id),
                    { body: commands },
                );
                console.log('슬래시 커맨드가 성공적으로 등록되었습니다!');
            } catch (error) {
                console.error('슬래시 커맨드 등록 중 오류:', error);
            }
        });

        this.client.on('messageCreate', (message) => {
            if (message.author.bot) return;
            this.updateUserActivity(message.author.id);
        });

        this.client.on('voiceStateUpdate', (oldState, newState) => {
            if (newState.member && !newState.member.user.bot) {
                this.updateUserActivity(newState.member.id);
            }
        });

        this.client.on('guildMemberAdd', (member) => {
            if (!member.user.bot) {
                this.updateUserActivity(member.id);
                console.log(`새 멤버 가입: ${member.user.tag}`);
            }
        });

        // 슬래시 커맨드 처리
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            await this.handleSlashCommand(interaction);
        });
    }

    updateUserActivity(userId) {
        const now = Date.now();
        this.userActivity.set(userId, now.toString());
        
        if (Math.random() < 0.01) {
            this.saveData();
        }
    }

    async handleSlashCommand(interaction) {
        // 관리자 권한 체크
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
            await interaction.reply({ content: '❌ 이 명령어를 사용할 권한이 없습니다. (KICK_MEMBERS 권한 필요)', ephemeral: true });
            return;
        }

        const commandName = interaction.commandName;

        switch (commandName) {
            case 'exempt':
                await this.handleExemptCommand(interaction);
                break;
            case 'unexempt':
                await this.handleUnexemptCommand(interaction);
                break;
            case 'exemptrole':
                await this.handleExemptRoleCommand(interaction);
                break;
            case 'unexemptrole':
                await this.handleUnexemptRoleCommand(interaction);
                break;
            case 'status':
                await this.handleStatusCommand(interaction);
                break;
            case 'check':
                await this.handleCheckCommand(interaction);
                break;
            case 'help':
                await this.handleHelpCommand(interaction);
                break;
            default:
                await interaction.reply({ content: '❌ 알 수 없는 명령어입니다. `/help`로 도움말을 확인하세요.', ephemeral: true });
        }
    }

    async handleExemptCommand(interaction) {
        const user = interaction.options.getUser('user');
        this.exemptUsers.add(user.id);
        await this.saveData();
        await interaction.reply(`✅ ${user.tag}을(를) 강퇴 제외 목록에 추가했습니다.`);
    }

    async handleUnexemptCommand(interaction) {
        const user = interaction.options.getUser('user');
        if (this.exemptUsers.delete(user.id)) {
            await this.saveData();
            await interaction.reply(`✅ ${user.tag}을(를) 강퇴 제외 목록에서 제거했습니다.`);
        } else {
            await interaction.reply({ content: '❌ 해당 사용자는 제외 목록에 없습니다.', ephemeral: true });
        }
    }

    async handleExemptRoleCommand(interaction) {
        const role = interaction.options.getRole('role');
        this.exemptRoles.add(role.id);
        await this.saveData();
        await interaction.reply(`✅ ${role.name} 역할을 강퇴 제외 목록에 추가했습니다.`);
    }

    async handleUnexemptRoleCommand(interaction) {
        const role = interaction.options.getRole('role');
        if (this.exemptRoles.delete(role.id)) {
            await this.saveData();
            await interaction.reply(`✅ ${role.name} 역할을 강퇴 제외 목록에서 제거했습니다.`);
        } else {
            await interaction.reply({ content: '❌ 해당 역할은 제외 목록에 없습니다.', ephemeral: true });
        }
    }

    async handleStatusCommand(interaction) {
        const now = Date.now();
        const guild = interaction.guild;
        
        let totalMembers = guild.memberCount;
        let trackedMembers = this.userActivity.size;
        let exemptUserCount = this.exemptUsers.size;
        let exemptRoleCount = this.exemptRoles.size;
        
        let inactiveCount = 0;
        for (const [userId, lastActivity] of this.userActivity) {
            const timeSinceActivity = now - parseInt(lastActivity);
            if (timeSinceActivity > this.INACTIVE_THRESHOLD) {
                const member = guild.members.cache.get(userId);
                if (member && !this.isUserExempt(member)) {
                    inactiveCount++;
                }
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('🤖 비활성 사용자 강퇴 봇 상태')
            .setColor(0x00AE86)
            .addFields(
                { name: '📊 서버 통계', value: `전체 멤버: ${totalMembers}명\n추적 중인 멤버: ${trackedMembers}명\n비활성 멤버: ${inactiveCount}명`, inline: true },
                { name: '⚙️ 설정', value: `비활성 기준: 48시간\n체크 주기: 30분`, inline: true },
                { name: '🔒 제외 목록', value: `제외 사용자: ${exemptUserCount}명\n제외 역할: ${exemptRoleCount}개`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    async handleCheckCommand(interaction) {
        await interaction.reply({ content: '🔍 비활성 사용자 확인 중...', ephemeral: true });
        const result = await this.checkInactiveUsers(interaction.guild);
        
        if (result.inactiveUsers.length === 0) {
            await interaction.followUp('✅ 현재 강퇴 대상 사용자가 없습니다.');
        } else {
            const userList = result.inactiveUsers.slice(0, 10).map(user => 
                `• ${user.displayName} (${Math.floor(user.inactiveDays)}일 비활성)`
            ).join('\n');
            
            const moreText = result.inactiveUsers.length > 10 ? `\n... 그리고 ${result.inactiveUsers.length - 10}명 더` : '';
            
            await interaction.followUp(`⚠️ **${result.inactiveUsers.length}명의 비활성 사용자가 발견되었습니다:**\n\`\`\`${userList}${moreText}\`\`\``);
        }
    }

    async handleHelpCommand(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('📖 비활성 사용자 강퇴 봇 도움말')
            .setColor(0x0099FF)
            .setDescription('48시간 동안 활동하지 않은 사용자를 자동으로 강퇴하는 봇입니다.')
            .addFields(
                {
                    name: '👤 사용자 관리',
                    value: '`/exempt @사용자` - 사용자를 제외 목록에 추가\n`/unexempt @사용자` - 사용자를 제외 목록에서 제거',
                    inline: false
                },
                {
                    name: '🎭 역할 관리',
                    value: '`/exemptrole @역할` - 역할을 제외 목록에 추가\n`/unexemptrole @역할` - 역할을 제외 목록에서 제거',
                    inline: false
                },
                {
                    name: '📊 정보 확인',
                    value: '`/status` - 봇 상태 및 통계 확인\n`/check` - 현재 비활성 사용자 목록 확인',
                    inline: false
                }
            )
            .setFooter({ text: '⚠️ 이 명령어들은 KICK_MEMBERS 권한이 필요합니다.' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    isUserExempt(member) {
        if (this.exemptUsers.has(member.id)) {
            return true;
        }

        for (const roleId of this.exemptRoles) {
            if (member.roles.cache.has(roleId)) {
                return true;
            }
        }

        if (member.id === member.guild.ownerId) {
            return true;
        }

        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return true;
        }

        return false;
    }

    async checkInactiveUsers(guild) {
        const now = Date.now();
        const inactiveUsers = [];
        const errors = [];

        try {
            await guild.members.fetch();
        } catch (error) {
            console.error('멤버 정보 가져오기 실패:', error);
        }

        for (const [memberId, member] of guild.members.cache) {
            if (member.user.bot) continue;
            if (this.isUserExempt(member)) continue;

            const lastActivity = this.userActivity.get(memberId);
            
            if (!lastActivity) {
                const accountAge = now - member.user.createdTimestamp;
                if (accountAge > this.INACTIVE_THRESHOLD) {
                    this.updateUserActivity(memberId);
                }
                continue;
            }

            const timeSinceActivity = now - parseInt(lastActivity);
            
            if (timeSinceActivity > this.INACTIVE_THRESHOLD) {
                inactiveUsers.push({
                    member: member,
                    displayName: member.displayName,
                    inactiveDays: timeSinceActivity / (24 * 60 * 60 * 1000)
                });
            }
        }

        return { inactiveUsers, errors };
    }

    async kickInactiveUsers(guild) {
        const result = await this.checkInactiveUsers(guild);
        const kickedUsers = [];
        const kickErrors = [];

        for (const userData of result.inactiveUsers) {
            try {
                await userData.member.kick('48시간 이상 비활성으로 인한 자동 강퇴');
                kickedUsers.push(userData);
                
                this.userActivity.delete(userData.member.id);
                
                console.log(`강퇴 완료: ${userData.displayName}`);
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                kickErrors.push({ user: userData, error: error.message });
                console.error(`강퇴 실패 - ${userData.displayName}:`, error.message);
            }
        }

        await this.saveData();

        return { kickedUsers, kickErrors, totalChecked: result.inactiveUsers.length };
    }

    startPeriodicCheck() {
        setInterval(async () => {
            console.log('주기적 비활성 사용자 체크 시작...');
            
            for (const guild of this.client.guilds.cache.values()) {
                try {
                    const result = await this.kickInactiveUsers(guild);
                    
                    if (result.kickedUsers.length > 0) {
                        console.log(`[${guild.name}] ${result.kickedUsers.length}명 강퇴 완료`);
                        
                        const logChannel = guild.channels.cache.find(channel =>
                            channel.name.includes('log') || channel.name.includes('로그')
                        );
                        
                        if (logChannel && logChannel.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
                            const embed = new EmbedBuilder()
                                .setTitle('🔨 자동 강퇴 실행')
                                .setDescription(`${result.kickedUsers.length}명의 비활성 사용자가 강퇴되었습니다.`)
                                .setColor(0xFF6B6B)
                                .setTimestamp();
                            
                            await logChannel.send({ embeds: [embed] });
                        }
                    }
                    
                    if (result.kickErrors.length > 0) {
                        console.log(`[${guild.name}] ${result.kickErrors.length}명 강퇴 실패`);
                    }
                    
                } catch (error) {
                    console.error(`[${guild.name}] 주기적 체크 중 오류:`, error);
                }
            }
            
            console.log('주기적 비활성 사용자 체크 완료');
        }, this.CHECK_INTERVAL);
    }

    async start(token) {
        try {
            await this.client.login(token);
        } catch (error) {
            console.error('봇 시작 실패:', error);
            process.exit(1);
        }
    }
}

// 봇 실행
const bot = new InactiveKickBot();

const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error('❌ DISCORD_TOKEN 환경 변수가 설정되지 않았습니다.');
    console.log('Discord Developer Portal에서 봇 토큰을 가져와서 환경 변수에 설정하세요.');
    process.exit(1);
}

bot.start(token);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('봇 종료 중...');
    await bot.saveData();
    bot.client.destroy();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('봇 종료 중...');
    await bot.saveData();
    bot.client.destroy();
    process.exit(0);
});
