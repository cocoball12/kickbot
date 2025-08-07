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
    // 레벨링 명령어 추가
    {
        name: 'level',
        description: '자신이나 다른 사용자의 레벨을 확인합니다.',
        options: [
            {
                name: 'user',
                type: 6,
                description: '레벨을 확인할 사용자 (선택사항)',
                required: false,
            },
        ],
    },
    {
        name: 'levelboard',
        description: '서버 레벨 랭킹을 확인합니다.',
        options: [
            {
                name: 'page',
                type: 4, // INTEGER 타입
                description: '페이지 번호 (기본값: 1)',
                required: false,
            },
        ],
    },
    {
        name: 'setlevelchannel',
        description: '레벨링이 적용될 채널을 설정합니다. (관리자 전용)',
        options: [
            {
                name: 'channel',
                type: 7, // CHANNEL 타입
                description: '레벨링 채널로 설정할 채널',
                required: true,
            },
        ],
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
        
        // 레벨링 데이터 파일들
        this.userLevelsFile = path.join(this.dataPath, 'user_levels.json');
        this.levelChannelsFile = path.join(this.dataPath, 'level_channels.json');

        // 메모리 캐시
        this.userActivity = new Map();
        this.exemptUsers = new Set();
        this.exemptRoles = new Set();
        
        // 레벨링 시스템 캐시
        this.userLevels = new Map(); // userId -> { level: number, messages: number }
        this.levelChannels = new Map(); // guildId -> channelId

        // 설정
        this.INACTIVE_THRESHOLD = 10 * 1000; // 10초 (테스트용)
        this.CHECK_INTERVAL = 30 * 1000; // 30초마다 체크 (테스트용)

        // 레벨 시스템 설정
        this.LEVEL_REQUIREMENTS = {
            1: { min: 0, max: 1 },
            2: { min: 2, max: 3 },
            3: { min: 4, max: 6 },
            4: { min: 7, max: 10 },
            5: { min: 11, max: 15 },
            6: { min: 16, max: 21 },
            7: { min: 22, max: 28 },
            8: { min: 29, max: 36 },
            9: { min: 37, max: 45 },
            10: { min: 46, max: 55 }
        };

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
        // 기존 데이터 로드
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

        // 레벨링 데이터 로드
        try {
            const levelsData = await fs.readFile(this.userLevelsFile, 'utf8');
            const levelsObj = JSON.parse(levelsData);
            this.userLevels = new Map();
            for (const [userId, data] of Object.entries(levelsObj)) {
                this.userLevels.set(userId, data);
            }
        } catch (error) {
            console.log('레벨 데이터 파일이 없습니다. 새로 생성합니다.');
            this.userLevels = new Map();
        }

        try {
            const channelsData = await fs.readFile(this.levelChannelsFile, 'utf8');
            const channelsObj = JSON.parse(channelsData);
            this.levelChannels = new Map(Object.entries(channelsObj));
        } catch (error) {
            console.log('레벨 채널 파일이 없습니다. 새로 생성합니다.');
            this.levelChannels = new Map();
        }
    }

    async saveData() {
        try {
            const activityObj = Object.fromEntries(this.userActivity);
            await fs.writeFile(this.userActivityFile, JSON.stringify(activityObj, null, 2));

            await fs.writeFile(this.exemptUsersFile, JSON.stringify([...this.exemptUsers], null, 2));

            await fs.writeFile(this.exemptRolesFile, JSON.stringify([...this.exemptRoles], null, 2));

            // 레벨링 데이터 저장
            const levelsObj = Object.fromEntries(this.userLevels);
            await fs.writeFile(this.userLevelsFile, JSON.stringify(levelsObj, null, 2));

            const channelsObj = Object.fromEntries(this.levelChannels);
            await fs.writeFile(this.levelChannelsFile, JSON.stringify(channelsObj, null, 2));
        } catch (error) {
            console.error('데이터 저장 중 오류:', error);
        }
    }

    setupEventHandlers() {
        this.client.once('ready', async () => {
            console.log(`${this.client.user.tag}로 로그인했습니다!`);
            console.log(`${this.client.guilds.cache.size}개 서버에서 활동 중`);
            
            setBotInstance(this);
            
            // 레벨 채널 자동 설정 (💬ㆍ공항 채널 찾기)
            for (const guild of this.client.guilds.cache.values()) {
                if (!this.levelChannels.has(guild.id)) {
                    const airportChannel = guild.channels.cache.find(channel => 
                        channel.name.includes('공항') || channel.name.includes('airport')
                    );
                    if (airportChannel) {
                        this.levelChannels.set(guild.id, airportChannel.id);
                        console.log(`[${guild.name}] 레벨링 채널 자동 설정: ${airportChannel.name}`);
                    }
                }
            }
            await this.saveData();
            
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

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            
            this.updateUserActivity(message.author.id);
            
            // 레벨링 시스템 처리
            await this.handleLevelingMessage(message);
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

    // 레벨링 메시지 처리
    async handleLevelingMessage(message) {
        const guildId = message.guild.id;
        const levelChannelId = this.levelChannels.get(guildId);
        
        // 설정된 레벨 채널이 아니면 무시
        if (!levelChannelId || message.channel.id !== levelChannelId) {
            return;
        }

        const userId = message.author.id;
        const userKey = `${guildId}-${userId}`;
        
        // 사용자 레벨 데이터 가져오기 또는 초기화
        let userData = this.userLevels.get(userKey) || { level: 1, messages: 0 };
        userData.messages++;
        
        // 레벨 계산
        const newLevel = this.calculateLevel(userData.messages);
        const oldLevel = userData.level;
        
        if (newLevel > oldLevel) {
            userData.level = newLevel;
            
            // 레벨업 메시지 전송
            const levelUpEmbed = new EmbedBuilder()
                .setTitle('🎉 레벨업!')
                .setDescription(`축하합니다! <@${userId}>님이 **${newLevel}레벨**로 올랐습니다!`)
                .setColor(0xFFD700)
                .addFields([
                    { name: '📊 현재 레벨', value: `${newLevel}`, inline: true },
                    { name: '💬 총 메시지', value: `${userData.messages}개`, inline: true }
                ])
                .setTimestamp();

            try {
                await message.channel.send({ embeds: [levelUpEmbed] });
            } catch (error) {
                console.error('레벨업 메시지 전송 실패:', error);
            }
        }
        
        this.userLevels.set(userKey, userData);
        
        // 주기적으로 데이터 저장 (5% 확률)
        if (Math.random() < 0.05) {
            await this.saveData();
        }
    }

    // 메시지 수에 따른 레벨 계산
    calculateLevel(messages) {
        for (let level = Object.keys(this.LEVEL_REQUIREMENTS).length; level >= 1; level--) {
            const requirement = this.LEVEL_REQUIREMENTS[level];
            if (messages >= requirement.min) {
                return level;
            }
        }
        return 1;
    }

    // 레벨에 필요한 메시지 범위 가져오기
    getLevelRequirement(level) {
        return this.LEVEL_REQUIREMENTS[level] || { min: 0, max: 0 };
    }

    updateUserActivity(userId) {
        const now = Date.now();
        this.userActivity.set(userId, now.toString());
        
        if (Math.random() < 0.01) {
            this.saveData();
        }
    }

    async handleSlashCommand(interaction) {
        const commandName = interaction.commandName;

        // 레벨링 관련 명령어는 권한 체크 제외
        const levelCommands = ['level', 'levelboard'];
        if (!levelCommands.includes(commandName)) {
            // 관리자 권한 체크
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                await interaction.reply({ content: '❌ 이 명령어를 사용할 권한이 없습니다. (KICK_MEMBERS 권한 필요)', ephemeral: true });
                return;
            }
        }

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
            // 레벨링 명령어들
            case 'level':
                await this.handleLevelCommand(interaction);
                break;
            case 'levelboard':
                await this.handleLevelboardCommand(interaction);
                break;
            case 'setlevelchannel':
                await this.handleSetLevelChannelCommand(interaction);
                break;
            default:
                await interaction.reply({ content: '❌ 알 수 없는 명령어입니다. `/help`로 도움말을 확인하세요.', ephemeral: true });
        }
    }

    // 레벨 확인 명령어
    async handleLevelCommand(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guild.id;
        const userKey = `${guildId}-${targetUser.id}`;
        
        const userData = this.userLevels.get(userKey) || { level: 1, messages: 0 };
        const currentReq = this.getLevelRequirement(userData.level);
        const nextReq = this.getLevelRequirement(userData.level + 1);
        
        let progressText = '';
        if (nextReq.min > 0) {
            const progress = userData.messages - currentReq.min;
            const needed = nextReq.min - currentReq.min;
            const percentage = Math.floor((progress / needed) * 100);
            progressText = `\n\n**다음 레벨까지:** ${nextReq.min - userData.messages}개 메시지 필요\n**진행도:** ${percentage}% ${'▰'.repeat(Math.floor(percentage/10))}${'▱'.repeat(10-Math.floor(percentage/10))}`;
        } else {
            progressText = '\n\n🏆 **최고 레벨 달성!**';
        }

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${targetUser.displayName}님의 레벨 정보`)
            .setThumbnail(targetUser.displayAvatarURL())
            .setColor(0x00AE86)
            .setDescription(`**현재 레벨:** ${userData.level}\n**총 메시지:** ${userData.messages}개${progressText}`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    // 레벨보드 명령어
    async handleLevelboardCommand(interaction) {
        const guildId = interaction.guild.id;
        const page = Math.max(1, interaction.options.getInteger('page') || 1);
        const itemsPerPage = 10;
        
        // 해당 길드의 사용자들만 필터링
        const guildUsers = Array.from(this.userLevels.entries())
            .filter(([key, data]) => key.startsWith(`${guildId}-`))
            .map(([key, data]) => {
                const userId = key.split('-')[1];
                return { userId, ...data };
            })
            .sort((a, b) => {
                if (b.level !== a.level) return b.level - a.level;
                return b.messages - a.messages;
            });

        if (guildUsers.length === 0) {
            await interaction.reply({ content: '📊 아직 레벨 데이터가 없습니다!', ephemeral: true });
            return;
        }

        const totalPages = Math.ceil(guildUsers.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, guildUsers.length);
        
        let leaderboard = '';
        for (let i = startIndex; i < endIndex; i++) {
            const userData = guildUsers[i];
            const user = this.client.users.cache.get(userData.userId);
            const username = user ? user.displayName : '알 수 없는 사용자';
            
            let medal = '';
            if (i === 0) medal = '🥇';
            else if (i === 1) medal = '🥈';
            else if (i === 2) medal = '🥉';
            else medal = `${i + 1}.`;
            
            leaderboard += `${medal} **${username}** - 레벨 ${userData.level} (${userData.messages}개 메시지)\n`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏆 ${interaction.guild.name} 레벨 랭킹`)
            .setDescription(leaderboard)
            .setColor(0xFFD700)
            .setFooter({ text: `페이지 ${page}/${totalPages} • 총 ${guildUsers.length}명` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    // 레벨 채널 설정 명령어
    async handleSetLevelChannelCommand(interaction) {
        // 관리자 권한 체크
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: '❌ 이 명령어는 관리자만 사용할 수 있습니다.', ephemeral: true });
            return;
        }

        const channel = interaction.options.getChannel('channel');
        const guildId = interaction.guild.id;
        
        this.levelChannels.set(guildId, channel.id);
        await this.saveData();
        
        await interaction.reply(`✅ 레벨링 채널이 <#${channel.id}>로 설정되었습니다!`);
    }

    // 기존 명령어들...
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
        
        // 레벨링 통계
        const guildLevelUsers = Array.from(this.userLevels.entries())
            .filter(([key, data]) => key.startsWith(`${guild.id}-`));
        const levelUsersCount = guildLevelUsers.length;
        const levelChannelId = this.levelChannels.get(guild.id);
        const levelChannel = levelChannelId ? guild.channels.cache.get(levelChannelId) : null;
        
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
                { name: '⚙️ 설정', value: `비활성 기준: 10초\n체크 주기: 30초`, inline: true },
                { name: '🔒 제외 목록', value: `제외 사용자: ${exemptUserCount}명\n제외 역할: ${exemptRoleCount}개`, inline: true },
                { name: '📈 레벨링 시스템', value: `레벨 사용자: ${levelUsersCount}명\n레벨 채널: ${levelChannel ? levelChannel.name : '설정 안됨'}`, inline: true }
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
            .setDescription('10초 동안 활동하지 않은 사용자를 자동으로 강퇴하는 봇입니다. (테스트 모드)')
            .addFields(
                {
                    name: '👤 사용자 관리 (관리자)',
                    value: '`/exempt @사용자` - 사용자를 제외 목록에 추가\n`/unexempt @사용자` - 사용자를 제외 목록에서 제거',
                    inline: false
                },
                {
                    name: '🎭 역할 관리 (관리자)',
                    value: '`/exemptrole @역할` - 역할을 제외 목록에 추가\n`/unexemptrole @역할` - 역할을 제외 목록에서 제거',
                    inline: false
                },
                {
                    name: '📊 정보 확인',
                    value: '`/status` - 봇 상태 및 통계 확인\n`/check` - 현재 비활성 사용자 목록 확인',
                    inline: false
                },
                {
                    name: '🎮 레벨링 시스템',
                    value: '`/level [사용자]` - 레벨 확인\n`/levelboard [페이지]` - 레벨 랭킹 확인\n`/setlevelchannel #채널` - 레벨링 채널 설정 (관리자)',
                    inline: false
                }
            )
            .setFooter({ text: '⚠️ 관리자 명령어들은 KICK_MEMBERS 또는 Administrator 권한이 필요합니다.' });

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
                await userData.member.kick('10초 이상 비활성으로 인한 자동 강퇴 (테스트 모드)');
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
