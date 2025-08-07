# Discord 비활성 사용자 강퇴 봇

48시간 동안 활동(채팅, 음성채널 등)하지 않은 사용자를 자동으로 강퇴하는 디스코드 봇입니다.

## 🎯 주요 기능

- ⏰ **48시간 비활성 감지**: 채팅, 음성채널 활동을 추적하여 48시간 동안 활동하지 않은 사용자를 자동 강퇴
- 🛡️ **예외 처리**: 특정 사용자나 역할을 강퇴 대상에서 제외
- 📊 **실시간 모니터링**: 30분마다 자동으로 비활성 사용자를 체크
- 💾 **데이터 영구 저장**: 서버 재시작 후에도 활동 기록과 설정이 유지됨
- 🌐 **웹서비스**: Render 무료 플랜에서 24/7 운영 가능
- 🔒 **권한 기반 관리**: KICK_MEMBERS 권한이 있는 사용자만 봇 관리 가능

## 🚀 빠른 시작

### 1. Discord 봇 생성
1. [Discord Developer Portal](https://discord.com/developers/applications)에서 새 애플리케이션 생성
2. Bot 탭에서 봇 토큰 생성 및 복사
3. OAuth2 > URL Generator에서 다음 설정:
   - Scopes: `bot`
   - Bot Permissions: `Kick Members`, `Read Messages`, `Send Messages`

### 2. Render에 배포
1. GitHub에 이 코드를 업로드
2. [Render.com](https://render.com)에서 Web Service 생성
3. GitHub 리포지토리 연결
4. 환경변수 설정: `DISCORD_TOKEN=your_bot_token`
5. 자동 배포 완료!

## 📋 명령어 목록

### 사용자 관리 (KICK_MEMBERS 권한 필요)
- `!exempt @사용자` - 특정 사용자를 강퇴 제외 목록에 추가
- `!unexempt @사용자` - 특정 사용자를 강퇴 제외 목록에서 제거

### 역할 관리  
- `!exemptrole @역할` - 특정 역할을 강퇴 제외 목록에 추가
- `!unexemptrole @역할` - 특정 역할을 강퇴 제외 목록에서 제거

### 정보 확인
- `!status` - 봇 상태 및 통계 확인
- `!check` - 현재 비활성 사용자 목록 확인  
- `!help` - 도움말 보기

## 🌐 웹 엔드포인트

봇이 실행되면 다음 HTTP 엔드포인트를 사용할 수 있습니다:

- `GET /` - 기본 헬스 체크
- `GET /health` - 서비스 상태 확인
- `GET /status` - 봇 상세 상태 (서버 수, 멤버 수 등)
- `GET /stats` - 봇 통계 (비활성 사용자 수 등)
- `GET /keep-alive` - 슬립 방지용

### 사용 예시
```bash
# 헬스 체크
curl https://your-bot-name.onrender.com/health

# 봇 상태 확인  
curl https://your-bot-name.onrender.com/status
```

## 🔒 자동 제외 대상

다음 사용자들은 자동으로 강퇴 대상에서 제외됩니다:
- 서버 소유자
- 관리자 권한을 가진 사용자
- 봇 계정
- `!exempt` 명령어로 추가된 사용자
- 제외 역할을 가진 사용자

## 📊 활동 감지 기준

봇은 다음 활동을 감지합니다:
- 💬 **메시지 전송**: 모든 채널에서의 메시지 전송
- 🔊 **음성 채널 활동**: 음성 채널 입장/퇴장
- 🆕 **서버 가입**: 새로운 멤버가 서버에 가입

## ⚙️ 설정값

- **비활성 기준**: 48시간
- **체크 주기**: 30분
- **명령어 접두사**: `!`

## 🔧 로컬 개발

```bash
# 리포지토리 클론
git clone <your-repo-url>
cd discord-inactive-kick-bot

# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env
# .env 파일에 봇 토큰 입력

# 봇 실행
npm start
```

## 📝 Render 배포 설정

### 환경변수
- `DISCORD_TOKEN`: Discord 봇 토큰
- `NODE_ENV`: `production`
- `PORT`: `3000` (자동 할당)

### 빌드 설정
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Service Type**: Web Service

## 🚨 문제 해결

### 봇이 응답하지 않을 때
1. Render 로그에서 에러 확인
2. 환경변수 `DISCORD_TOKEN` 확인
3. `/health` 엔드포인트로 서비스 상태 확인

### 강퇴가 실행되지 않을 때
- 봇의 역할이 강퇴하려는 사용자보다 높은 위치에 있는지 확인
- 대상 사용자가 제외 목록에 있지 않은지 확인

## 📄 라이선스

MIT License - 자유롭게 사용, 수정, 배포할 수 있습니다.

## 🤝 기여하기

이슈나 Pull Request는 언제나 환영합니다!

---

**⚠️ 주의**: 봇 토큰을 절대 공개하지 마세요!
