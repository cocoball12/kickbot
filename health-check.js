// Render 무료 플랜에서 웹서비스로 실행하기 위한 HTTP 서버
const http = require('http');
const url = require('url');

// 포트 설정 (Render에서 자동으로 할당)
const PORT = process.env.PORT || 3000;

// 봇 인스턴스 참조 (나중에 설정됨)
let botInstance = null;

// HTTP 서버 생성
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    
    // CORS 헤더 추가
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    try {
        switch (path) {
            case '/':
            case '/health':
                // 기본 헬스 체크
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    message: 'Discord Inactive Kick Bot is running',
                    uptime: process.uptime()
                }));
                break;
                
            case '/status':
                // 봇 상세 상태
                if (!botInstance || !botInstance.client.isReady()) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: 'bot_not_ready',
                        message: 'Discord bot is not ready yet'
                    }));
                    return;
                }
                
                const guilds = botInstance.client.guilds.cache;
                const totalMembers = guilds.reduce((acc, guild) => acc + guild.memberCount, 0);
                const trackedUsers = botInstance.userActivity.size;
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'online',
                    bot_user: botInstance.client.user.tag,
                    servers: guilds.size,
                    total_members: totalMembers,
                    tracked_users: trackedUsers,
                    uptime: process.uptime(),
                    timestamp: new Date().toISOString()
                }));
                break;
                
            case '/stats':
                // 통계 정보
                if (!botInstance || !botInstance.client.isReady()) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Bot not ready' }));
                    return;
                }
                
                const now = Date.now();
                const INACTIVE_THRESHOLD = 48 * 60 * 60 * 1000;
                let inactiveCount = 0;
                
                for (const [userId, lastActivity] of botInstance.userActivity) {
                    const timeSinceActivity = now - parseInt(lastActivity);
                    if (timeSinceActivity > INACTIVE_THRESHOLD) {
                        inactiveCount++;
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    total_tracked: botInstance.userActivity.size,
                    inactive_users: inactiveCount,
                    exempt_users: botInstance.exemptUsers.size,
                    exempt_roles: botInstance.exemptRoles.size,
                    threshold_hours: 48,
                    timestamp: new Date().toISOString()
                }));
                break;
                
            case '/keep-alive':
                // Render 슬립 방지용 엔드포인트
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Bot is alive!');
                break;
                
            default:
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Not Found',
                    available_endpoints: [
                        '/',
                        '/health', 
                        '/status',
                        '/stats',
                        '/keep-alive'
                    ]
                }));
        }
    } catch (error) {
        console.error('HTTP server error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message
        }));
    }
});

// 서버 시작
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 웹서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📍 헬스 체크: http://localhost:${PORT}/health`);
    console.log(`📊 봇 상태: http://localhost:${PORT}/status`);
});

// 봇 인스턴스 설정 함수
function setBotInstance(bot) {
    botInstance = bot;
    console.log('🤖 봇 인스턴스가 HTTP 서버에 연결되었습니다.');
}

// Render 슬립 방지를 위한 자체 핑 (선택사항)
if (process.env.NODE_ENV === 'production') {
    setInterval(async () => {
        try {
            const http = require('http');
            const options = {
                hostname: 'localhost',
                port: PORT,
                path: '/keep-alive',
                method: 'GET'
            };

            const req = http.request(options, (res) => {
                console.log('🔄 자체 핑 완료:', new Date().toLocaleTimeString());
            });

            req.on('error', (error) => {
                console.log('⚠️ 자체 핑 실패:', error.message);
            });

            req.end();
        } catch (error) {
            console.log('⚠️ 자체 핑 오류:', error.message);
        }
    }, 14 * 60 * 1000); // 14분마다 핑
}

module.exports = { server, setBotInstance };
