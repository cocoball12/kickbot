const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

// Render 웹서비스를 위한 HTTP 서버
const { setBotInstance } = require('./health-check');

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
        this.userActivity = new Map(); // userId -> lastActivity timestamp
        this.exemptUsers = new Set(); // 제외된 사용자 ID 목록
        this.exemptRoles = new Set(); // 제외된 역할 ID 목록

        // 설정
        this.INACTIVE_THRESHOLD = 48 * 60 * 60 * 1000; // 48시간 (밀리초)
        this.CHECK_INTERVAL = 30 * 60 * 1000; // 30분마다 체크
        this.ADMIN_PREFIX = '!';

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
            // 사용자 활동 데이터 로드
            const activityData = await fs.readFile(this.userActivityFile, 'utf8');
            const activityObj = JSON.parse(activityData);
            this.userActivity = new Map(Object.entries(activityObj));
        } catch (error) {
            console.log('활동 데이터 파일이 없습니다. 새로 생성합니다.');
            this.userActivity = new Map();
        }

        try {
            // 제외 사용자 데이터 로드
            const exemptUsersData = await fs.readFile(this.exemptUsersFile, 'utf8');
            this.exemptUsers = new Set(JSON.parse(exemptUsersData));
        } catch (error) {
            console.log('제외 사용자 파일이 없습니다. 새로 생성합니다.');
            this.exemptUsers = new Set();
        }

        try {
            // 제외 역할 데이터 로드
            const exemptRolesData = await fs.readFile(this.exemptRolesFile, 'utf8');
            this.exemptRoles = new Set(JSON.parse(exemptRolesData));
        } catch (error) {
            console.log('제외 역할 파일이 없습니다. 새로 생성합니다.');
            this.exemptRoles = new Set();
        }
    }

    async saveData() {
        try {
            // 사용자 활동 데이터 저장
            const activityObj = Object.fromEntries(this.userActivity);
            await fs.writeFile(this.userActivityFile, JSON.stringify(activityObj, null, 2));

            // 제외 사용자 데이터 저장
            await fs.writeFile(this.exemptUsersFile, JSON.stringify([...this.exemptUsers], null, 2));

            // 제외 역할 데이터 저장
            await fs.writeFile(this.exemptRolesFile, JSON.stringify([...this.exemptRoles], null, 2));
        } catch (error) {
            console.error('데이터 저장 중 오류:', error);
        }
    }

    setupEventHandlers() {
        this.client.once('ready', () => {
            console.log(`${this.client.user.tag}로 로그인했습니다!`);
            console.log(`${this.client.guilds.cache.size}개 서버에서 활동 중`);
            
            // HTTP 서버에 봇 인스턴스 연결
            setBotInstance(this);
        });

        // 메시지 활동 감지
        this.client.on('messageCreate', (message) => {
            if (message.author.bot) return;
            this.updateUserActivity(message.author.id);
        });

        // 음성 채널 활동 감지
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            // 음성 채널에 들어오거나 나가는 경우
            if (newState.member && !newState.member.user.bot) {
                this.updateUserActivity(newState.member.id);
            }
        });

        // 새 멤버 감지
        this.client.on('guildMemberAdd', (member) => {
            if (!member.user.bot) {
                this.updateUserActivity(member.id);
                console.log(`새 멤버 가입: ${member.user.tag}`);
            }
        });

        // 명령어 처리
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            if (!message.content.startsWith(this.ADMIN_PREFIX)) return;

            const args = message.content.slice(this.ADMIN_PREFIX.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            await this.handleCommand(message, command, args);
        });
    }

    updateUserActivity(userId) {
        const now = Date.now();
        this.userActivity.set(userId, now.toString());
        
        // 주기적으로 데이터 저장 (5분마다)
        if (Math.random() < 0.01) { // 1% 확률로 저장
            this.saveData();
        }
    }

    async handleCommand(message, command, args) {
        // 관리자 권한 체크
        if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
            await message.reply('❌ 이 명령어를 사용할 권한이 없습니다. (KICK_MEMBERS 권한 필요)');
            return;
        }

        switch (command) {
            case 'exempt':
            case '제외':
                await this.handleExemptCommand(message, args);
                break;

            case 'unexempt':
            case '제외해제':
                await this.handleUnexemptCommand(message, args);
                break;

            case 'exemptrole':
            case '역할제외':
                await this.handleExemptRoleCommand(message, args);
                break;

            case 'unexemptrole':
            case '역할제외해제':
                await this.handleUnexemptRoleCommand(message, args);
                break;

            case 'status':
            case '상태':
                await this.handleStatusCommand(message);
                break;

            case 'check':
            case '확인':
                await this.handleCheckCommand(message);
                break;

            case 'help':
            case '도움말':
                await this.handleHelpCommand(message);
                break;

            default:
                await message.reply('❌ 알 수 없는 명령어입니다. `!help`로 도움말을 확인하세요.');
        }
    }

    async handleExemptCommand(message, args) {
        if (args.length === 0) {
            await message.reply('❌ 사용법: `!exempt @사용자` 또는 `!exempt 사용자ID`');
            return;
        }

        let userId;
        if (message.mentions.users.size > 0) {
            userId = message.mentions.users.first().id;
        } else {
            userId = args[0];
        }

        this.exemptUsers.add(userId);
        await this.saveData();

        const user = await this.client.users.fetch(userId).catch(() => null);
        const userName = user ? user.tag : userId;
        
        await message.reply(`✅ ${userName}을(를) 강퇴 제외 목록에 추가했습니다.`);
    }

    async handleUnexemptCommand(message, args) {
        if (args.length === 0) {
            await message.reply('❌ 사용법: `!unexempt @사용자` 또는 `!unexempt 사용자ID`');
            return;
        }

        let userId;
        if (message.mentions.users.size > 0) {
            userId = message.mentions.users.first().id;
        } else {
            userId = args[0];
        }

        if (this.exemptUsers.delete(userId)) {
            await this.saveData();
            const user = await this.client.users.fetch(userId).catch(() => null);
            const userName = user ? user.tag : userId;
            await message.reply(`✅ ${userName}을(를) 강퇴 제외 목록에서 제거했습니다.`);
        } else {
            await message.reply('❌ 해당 사용자는 제외 목록에 없습니다.');
        }
    }

    async handleExemptRoleCommand(message, args) {
        if (args.length === 0) {
            await message.reply('❌ 사용법: `!exemptrole @역할` 또는 `!exemptrole 역할ID`');
            return;
        }

        let roleId;
        if (message.mentions.roles.size > 0) {
            roleId = message.mentions.roles.first().id;
        } else {
            roleId = args[0];
        }

        const role = message.guild.roles.cache.get(roleId);
        if (!role) {
            await message.reply('❌ 해당 역할을 찾을 수 없습니다.');
            return;
        }

        this.exemptRoles.add(roleId);
        await this.saveData();
        
        await message.reply(`✅ ${role.name} 역할을 강퇴 제외 목록에 추가했습니다.`);
    }

    async handleUnexemptRoleCommand(message, args) {
        if (args.length === 0) {
            await message.reply('❌ 사용법: `!unexemptrole @역할` 또는 `!unexemptrole 역할ID`');
            return;
        }

        let roleId;
        if (message.mentions.roles.size > 0) {
            roleId = message.mentions.roles.first().id;
        } else {
            roleId = args[0];
        }

        if (this.exemptRoles.delete(roleId)) {
            await this.saveData();
            const role = message.guild.roles.cache.get(roleId);
            const roleName = role ? role.name : roleId;
            await message.reply(`✅ ${roleName} 역할을 강퇴 제외 목록에서 제거했습니다.`);
        } else {
            await message.reply('❌ 해당 역할은 제외 목록에 없습니다.');
        }
    }

    async handleStatusCommand(message) {
        const now = Date.now();
        const guild = message.guild;
        
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

        await message.reply({ embeds: [embed] });
    }

    async handleCheckCommand(message) {
        await message.reply('🔍 비활성 사용자 확인 중...');
        const result = await this.checkInactiveUsers(message.guild);
        
        if (result.inactiveUsers.length === 0) {
            await message.followUp('✅ 현재 강퇴 대상 사용자가 없습니다.');
        } else {
            const userList = result.inactiveUsers.slice(0, 10).map(user => 
                `• ${user.displayName} (${Math.floor(user.inactiveDays)}일 비활성)`
            ).join('\n');
            
            const moreText = result.inactiveUsers.length > 10 ? `\n... 그리고 ${result.inactiveUsers.length - 10}명 더` : '';
            
            await message.followUp(`⚠️ **${result.inactiveUsers.length}명의 비활성 사용자가 발견되었습니다:**\n\`\`\`${userList}${moreText}\`\`\``);
        }
    }

    async handleHelpCommand(message) {
        const embed = new EmbedBuilder()
            .setTitle('📖 비활성 사용자 강퇴 봇 도움말')
            .setColor(0x0099FF)
            .setDescription('48시간 동안 활동하지 않은 사용자를 자동으로 강퇴하는 봇입니다.')
            .addFields(
                { 
                    name: '👤 사용자 관리', 
                    value: '`!exempt @사용자` - 사용자를 제외 목록에 추가\n`!unexempt @사용자` - 사용자를 제외 목록에서 제거', 
                    inline: false 
                },
                { 
                    name: '🎭 역할 관리', 
                    value: '`!exemptrole @역할` - 역할을 제외 목록에 추가\n`!unexemptrole @역할` - 역할을 제외 목록에서 제거', 
                    inline: false 
                },
                { 
                    name: '📊 정보 확인', 
                    value: '`!status` - 봇 상태 및 통계 확인\n`!check` - 현재 비활성 사용자 목록 확인', 
                    inline: false 
                }
            )
            .setFooter({ text: '⚠️ 이 명령어들은 KICK_MEMBERS 권한이 필요합니다.' });

        await message.reply({ embeds: [embed] });
    }

    isUserExempt(member) {
        // 제외 사용자 목록에 있는지 확인
        if (this.exemptUsers.has(member.id)) {
            return true;
        }

        // 제외 역할을 가지고 있는지 확인
        for (const roleId of this.exemptRoles) {
            if (member.roles.cache.has(roleId)) {
                return true;
            }
        }

        // 서버 소유자는 항상 제외
        if (member.id === member.guild.ownerId) {
            return true;
        }

        // 관리자 권한이 있는 사용자는 제외
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
            // 모든 멤버 정보 가져오기
            await guild.members.fetch();
        } catch (error) {
            console.error('멤버 정보 가져오기 실패:', error);
        }

        for (const [memberId, member] of guild.members.cache) {
            // 봇 사용자는 제외
            if (member.user.bot) continue;

            // 제외 목록에 있는 사용자는 건너뛰기
            if (this.isUserExempt(member)) continue;

            const lastActivity = this.userActivity.get(memberId);
            
            // 활동 기록이 없는 경우 (새로 가입했거나 봇이 시작되기 전에 가입)
            if (!lastActivity) {
                // 계정 생성일로부터 48시간이 지났는지 확인
                const accountAge = now - member.user.createdTimestamp;
                if (accountAge > this.INACTIVE_THRESHOLD) {
                    // 활동 기록이 없고 계정이 오래된 경우 현재 시간으로 설정
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
                
                // 활동 기록에서 제거
                this.userActivity.delete(userData.member.id);
                
                console.log(`강퇴 완료: ${userData.displayName}`);
                
                // API 속도 제한을 위한 딜레이
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                kickErrors.push({ user: userData, error: error.message });
                console.error(`강퇴 실패 - ${userData.displayName}:`, error.message);
            }
        }

        // 데이터 저장
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
                        
                        // 로그 채널이 있다면 알림 전송 (선택사항)
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

// 환경 변수에서 토큰 가져오기
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
