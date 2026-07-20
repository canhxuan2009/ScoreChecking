/**
 * =============================================================================
 * Discord Gateway WebSocket - Educational Simulator
 * =============================================================================
 * 
 * Mục đích: Học tập và tìm hiểu cách Discord Client giao tiếp với Discord
 * Server thông qua WebSocket Gateway Protocol.
 * 
 * Giao thức Discord Gateway hoạt động như sau:
 * 
 *  1. Client kết nối tới wss://gateway.discord.gg/?v=10&encoding=json
 *  2. Server gửi Opcode 10 (HELLO) chứa heartbeat_interval
 *  3. Client gửi Opcode 2 (IDENTIFY) với token và thông tin thiết bị
 *  4. Client gửi Opcode 1 (HEARTBEAT) định kỳ để duy trì kết nối
 *  5. Client gửi Opcode 3 (PRESENCE UPDATE) để cập nhật trạng thái hoạt động
 * 
 * Tham khảo: https://discord.com/developers/docs/topics/gateway
 * 
 * ⚠️  CHỈ SỬ DỤNG CHO MỤC ĐÍCH HỌC TẬP
 * =============================================================================
 */

require('dotenv').config();
const WebSocket = require('ws');
const os = require('os');
const https = require('https');
const { EventEmitter } = require('events');

// ─────────────────────────────────────────────────────────────────────────────
// CẤU HÌNH
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  // Discord Gateway URL (API version 10, encoding JSON)
  GATEWAY_URL: 'wss://gateway.discord.gg/?v=10&encoding=json',

  // Token lấy từ file .env
  TOKEN: process.env.DISCORD_TOKEN,

  // Thông tin giả lập thiết bị (properties) gửi kèm khi IDENTIFY
  // Discord sử dụng thông tin này để xác định loại client (App/Browser/Mobile)
  // ⚠️ Quan trọng: Quest PLAY_ON_DESKTOP chỉ được tính khi client là Desktop App
  PROPERTIES: {
    os: 'Windows',                    // Hệ điều hành
    browser: 'Discord Client',        // Loại client (phải là 'Discord Client' cho desktop app)
    device: '',                       // Để trống cho desktop app
    system_locale: 'vi',              // Ngôn ngữ hệ thống
    browser_user_agent: '',           // Để trống cho desktop app (chỉ browser mới có)
    browser_version: '',              // Để trống cho desktop app
    os_version: '10.0.22631',         // Phiên bản Windows (Win 11 23H2)
    referrer: '',
    referring_domain: '',
    referrer_current: '',
    referring_domain_current: '',
    release_channel: 'stable',        // Kênh phát hành (stable/ptb/canary)
    client_build_number: 366934,      // Số build của Discord Client
    native_build_number: 57956,       // Số build native
    client_event_source: null,
    design_id: 0,
  },

  // Các Opcode trong Discord Gateway Protocol
  // Tham khảo: https://discord.com/developers/docs/topics/opcodes-and-status-codes
  OPCODES: {
    DISPATCH:            0,  // Server -> Client: Nhận event (MESSAGE_CREATE, READY, v.v.)
    HEARTBEAT:           1,  // Client -> Server: Gửi heartbeat để duy trì kết nối
    IDENTIFY:            2,  // Client -> Server: Xác thực token và bắt đầu session
    PRESENCE_UPDATE:     3,  // Client -> Server: Cập nhật trạng thái (online/idle/dnd/invisible)
    VOICE_STATE_UPDATE:  4,  // Client -> Server: Tham gia/rời voice channel
    RESUME:              6,  // Client -> Server: Khôi phục session sau khi bị ngắt kết nối
    RECONNECT:           7,  // Server -> Client: Yêu cầu client reconnect
    REQUEST_GUILD_MEMBERS: 8, // Client -> Server: Yêu cầu danh sách thành viên guild
    INVALID_SESSION:     9,  // Server -> Client: Session không hợp lệ
    HELLO:              10,  // Server -> Client: Gửi heartbeat_interval khi mới kết nối
    HEARTBEAT_ACK:      11,  // Server -> Client: Xác nhận đã nhận heartbeat
  },

  // Trạng thái (status) có thể đặt
  STATUS_TYPES: {
    ONLINE:    'online',    // Trực tuyến (xanh lá)
    IDLE:      'idle',      // Vắng mặt (vàng) 
    DND:       'dnd',       // Không làm phiền (đỏ)
    INVISIBLE: 'invisible', // Ẩn (xám)
  },

  // Loại Activity
  // Tham khảo: https://discord.com/developers/docs/topics/gateway-events#activity-object-activity-types
  ACTIVITY_TYPES: {
    PLAYING:    0,  // "Playing ..."
    STREAMING:  1,  // "Streaming ..."
    LISTENING:  2,  // "Listening to ..."
    WATCHING:   3,  // "Watching ..."
    CUSTOM:     4,  // Custom status
    COMPETING:  5,  // "Competing in ..."
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// LỚP DISCORD GATEWAY CLIENT
// ─────────────────────────────────────────────────────────────────────────────

class DiscordGatewayClient extends EventEmitter {
  constructor(token) {
    super();
    if (!token || token === 'your_token_here') {
      console.error('❌ Lỗi: Vui lòng đặt DISCORD_TOKEN trong file .env');
      process.exit(1);
    }

    this.token = token;
    this.ws = null;
    this.heartbeatInterval = null;  // Timer gửi heartbeat
    this.lastSequence = null;       // Sequence number cuối cùng nhận được
    this.sessionId = null;          // Session ID cho việc resume
    this.resumeGatewayUrl = null;   // URL để resume kết nối
    this.isReconnecting = false;
    this.heartbeatAcknowledged = true; // Theo dõi ACK
    this.startTime = Date.now();
    this.intentionalDisconnect = false; // Cờ kiểm soát ngắt kết nối chủ động
    this.questQueue = [];               // Hàng đợi các quest cần chạy
    this.activeQuestsCount = 0;         // Số quest đang chạy đồng thời
    this.questIntervals = new Map();    // Map lưu các interval heartbeat của quest
    this.activeActivities = new Map();  // Map lưu các trạng thái đang chơi game
    this.MAX_CONCURRENT_QUESTS = 2;     // Chạy tối đa 2 quest cùng lúc
    this.reconnectAttempts = 0;         // Số lần thử kết nối lại liên tiếp
    this.MAX_RECONNECT_ATTEMPTS = 5;    // Giới hạn kết nối lại tối đa 5 lần
  }

  // Helper cho API Discord
  discordRequest(method, path, body = null, useBrowserHeaders = false) {
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : null;
      let headers = {};

      if (useBrowserHeaders) {
        headers = {
          'accept': '*/*',
          'accept-language': 'vi;q=0.6',
          'authorization': this.token,
          'content-type': 'application/json',
          'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'sec-gpc': '1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
          'x-debug-options': 'bugReporterEnabled',
          'x-discord-locale': 'vi',
          'x-discord-timezone': 'Asia/Bangkok',
          'x-super-properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6InZpIiwiaGFzX2NsaWVudF9tb2RzIjpmYWxzZSwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE1MC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTUwLjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiJodHRwczovL3d1dGhlcmluZ3dhdmVzLWRjLmt1cm9nYW1lcy1nbG9iYWwuY29tLyIsInJlZmVycmluZ19kb21haW4iOiJ3dXRoZXJpbmd3YXZlcy1kYy5rdXJvZ2FtZXMtZ2xvYmFsLmNvbSIsInJlZmVycmVyX2N1cnJlbnQiOiJodHRwczovL2Rpc2NvcmQuYXBwLyIsInJlZmVycmluZ19kb21haW5fY3VycmVudCI6ImRpc2NvcmQuYXBwIiwicmVsZWFzZV9jaGFubmVsIjoic3RhYmxlIiwiY2xpZW50X2J1aWxkX251bWJlciI6NTgwMTU2LCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsLCJjbGllbnRfbGF1bmNoX2lkIjoiMDVmZTY2NDEtY2Y2Mi00NmI5LWJlMjYtMzdjZWRlNGFkYWM2IiwibGF1bmNoX3NpZ25hdHVyZSI6IjA4NTA0OGFlLWIyYzItNDc5Yy05ZDJhLWYzYTQ2ODhlMTA3NiIsImNsaWVudF9hcHBfc3RhdGUiOiJmb2N1c2VkIiwiY2xpZW50X2hlYXJ0YmVhdF9zZXNzaW9uX2lkIjoiZGFmMzA4NDktMDQzMy00NTliLWFjNmYtYWJkZTU5YzczZWViIn0=',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        };
      } else {
        headers = {
          'Authorization': this.token,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Discord/1.0.9189 Chrome/120.0.6099.291 Electron/28.3.1 Safari/537.36',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        };
      }

      const options = {
        hostname: 'discord.com',
        port: 443,
        path: path.startsWith('/api/') ? path : `/api/v9${path}`,
        method,
        headers,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } 
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * BƯỚC 1: KẾT NỐI WEBSOCKET
   * ═══════════════════════════════════════════════════════════════════════════
   * Thiết lập kết nối WebSocket tới Discord Gateway
   */
  connect() {
    const url = this.resumeGatewayUrl || CONFIG.GATEWAY_URL;
    console.log(`\n🔌 Đang kết nối tới Discord Gateway...`);
    console.log(`   URL: ${url}`);

    this.ws = new WebSocket(url);

    // Khi kết nối thành công
    this.ws.on('open', () => {
      console.log('✅ Kết nối WebSocket thành công!');
      console.log('   Đang chờ HELLO từ server...\n');
    });

    // Khi nhận được message từ server
    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    // Khi kết nối đóng
    this.ws.on('close', (code, reason) => {
      console.log(`\n🔴 Kết nối đã đóng!`);
      console.log(`   Code: ${code}`);
      console.log(`   Reason: ${reason || 'Không rõ'}`);
      this.cleanup();
      this.handleReconnect(code);
    });

    // Khi có lỗi
    this.ws.on('error', (error) => {
      console.error(`\n❌ Lỗi WebSocket: ${error.message}`);
    });
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * XỬ LÝ MESSAGE TỪ SERVER
   * ═══════════════════════════════════════════════════════════════════════════
   * Phân tích và xử lý các gói tin nhận được từ Discord Gateway
   */
  handleMessage(rawData) {
    const payload = JSON.parse(rawData);

    const { op, d: data, s: sequence, t: eventName } = payload;
    // op: Opcode (loại gói tin)
    // d:  Data (dữ liệu đính kèm)
    // s:  Sequence number (dùng cho heartbeat và resume)
    // t:  Event name (tên event, chỉ có khi op = 0)

    // Cập nhật sequence number mới nhất
    if (sequence !== null) {
      this.lastSequence = sequence;
    }

    switch (op) {
      // ─────────────────────────────────────────────────────────────────────
      // OPCODE 10: HELLO
      // Đây là gói tin đầu tiên server gửi sau khi kết nối WebSocket
      // Chứa heartbeat_interval (ms) - khoảng thời gian gửi heartbeat
      // ─────────────────────────────────────────────────────────────────────
      case CONFIG.OPCODES.HELLO:
        console.log('📨 Nhận HELLO từ server');
        console.log(`   Heartbeat interval: ${data.heartbeat_interval}ms`);
        this.startHeartbeat(data.heartbeat_interval);

        // Sau khi nhận HELLO, gửi IDENTIFY hoặc RESUME
        if (this.sessionId && this.isReconnecting) {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;

      // ─────────────────────────────────────────────────────────────────────
      // OPCODE 11: HEARTBEAT_ACK
      // Server xác nhận đã nhận heartbeat
      // Nếu không nhận được ACK, cần reconnect
      // ─────────────────────────────────────────────────────────────────────
      case CONFIG.OPCODES.HEARTBEAT_ACK:
        this.heartbeatAcknowledged = true;
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        console.log(`💚 Heartbeat ACK | Uptime: ${this.formatDuration(uptime)}`);
        break;

      // ─────────────────────────────────────────────────────────────────────
      // OPCODE 1: HEARTBEAT
      // Server yêu cầu gửi heartbeat ngay lập tức
      // ─────────────────────────────────────────────────────────────────────
      case CONFIG.OPCODES.HEARTBEAT:
        console.log('💛 Server yêu cầu heartbeat ngay!');
        this.sendHeartbeat();
        break;

      // ─────────────────────────────────────────────────────────────────────
      // OPCODE 7: RECONNECT
      // Server yêu cầu client reconnect
      // ─────────────────────────────────────────────────────────────────────
      case CONFIG.OPCODES.RECONNECT:
        console.log('🔄 Server yêu cầu reconnect...');
        this.isReconnecting = true;
        this.ws.close();
        break;

      // ─────────────────────────────────────────────────────────────────────
      // OPCODE 9: INVALID SESSION
      // Session không hợp lệ, cần IDENTIFY lại
      // ─────────────────────────────────────────────────────────────────────
      case CONFIG.OPCODES.INVALID_SESSION:
        console.log('⚠️  Session không hợp lệ');
        const canResume = data === true;
        if (!canResume) {
          this.sessionId = null;
          this.lastSequence = null;
        }
        // Chờ 1-5 giây rồi reconnect (theo Discord docs)
        const delay = Math.floor(Math.random() * 4000) + 1000;
        console.log(`   Reconnect sau ${delay}ms...`);
        setTimeout(() => {
          this.isReconnecting = canResume;
          this.connect();
        }, delay);
        break;

      // ─────────────────────────────────────────────────────────────────────
      // OPCODE 0: DISPATCH
      // Nhận các event từ server (READY, MESSAGE_CREATE, v.v.)
      // ─────────────────────────────────────────────────────────────────────
      case CONFIG.OPCODES.DISPATCH:
        this.handleDispatchEvent(eventName, data);
        break;

      default:
        console.log(`❓ Opcode chưa xử lý: ${op}`, data);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * XỬ LÝ DISPATCH EVENTS (Opcode 0)
   * ═══════════════════════════════════════════════════════════════════════════
   * Các event quan trọng được server gửi qua Opcode 0
   */
  handleDispatchEvent(eventName, data) {
    switch (eventName) {
      // READY: Nhận được sau khi IDENTIFY thành công
      case 'READY':
        this.sessionId = data.session_id;
        this.resumeGatewayUrl = data.resume_gateway_url;
        this.reconnectAttempts = 0; // Reset số lần reconnect thành công
        console.log(`\n🎉 Đăng nhập thành công: ${data.user.username}#${data.user.discriminator} (Guilds: ${data.guilds.length}, ID: ${data.user.id})`);

        // Khởi động trình quản lý Quest (Lấy danh sách và chạy)
        this.initQuestManager();
        break;

      // RESUMED: Session đã được khôi phục thành công
      case 'RESUMED':
        console.log('✅ Session đã được khôi phục (RESUMED)');
        this.isReconnecting = false;
        this.reconnectAttempts = 0; // Reset số lần reconnect thành công
        break;

      // Các event khác - chỉ log tên
      case 'MESSAGE_CREATE':
        // Đã tắt log tin nhắn để giữ sạch console theo yêu cầu
        break;

      case 'PRESENCE_UPDATE':
        // Bỏ qua, quá nhiều event
        break;

      case 'GUILD_CREATE':
        console.log(`🏠 Guild loaded: ${data.name} (${data.member_count} members)`);
        break;

      default:
        // Log các event khác nhẹ nhàng
        // console.log(`📩 Event: ${eventName}`);
        break;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * BƯỚC 2: GỬI IDENTIFY (Opcode 2)
   * ═══════════════════════════════════════════════════════════════════════════
   * Gửi token và thông tin client để xác thực với Discord
   * 
   * Cấu trúc gói tin IDENTIFY:
   * {
   *   op: 2,
   *   d: {
   *     token: "user_token",
   *     intents: 0,           // Không cần intents cho user account
   *     properties: { os, browser, device },
   *     presence: { status, activities, since, afk }
   *   }
   * }
   */
  sendIdentify() {
    const identifyPayload = {
      op: CONFIG.OPCODES.IDENTIFY,
      d: {
        token: this.token,
        intents: 33280,  // GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES
        properties: CONFIG.PROPERTIES,
        presence: {
          status: CONFIG.STATUS_TYPES.ONLINE,
          activities: [],
          since: 0,
          afk: false,
        },
        // Compress: yêu cầu nén dữ liệu (tùy chọn)
        compress: false,
        // Large threshold: số thành viên tối thiểu để guild được coi là "large"
        large_threshold: 250,
      },
    };

    console.log(`\n📤 Gửi IDENTIFY (Token: ${this.token.substring(0, 10)}...)`);
    this.send(identifyPayload);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * GỬI RESUME (Opcode 6)
   * ═══════════════════════════════════════════════════════════════════════════
   * Khôi phục session cũ thay vì tạo session mới
   * Giúp không bị mất các event trong lúc bị ngắt kết nối
   */
  sendResume() {
    const resumePayload = {
      op: CONFIG.OPCODES.RESUME,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.lastSequence,
      },
    };

    console.log('📤 Gửi RESUME...');
    console.log(`   Session: ${this.sessionId}`);
    console.log(`   Sequence: ${this.lastSequence}`);
    this.send(resumePayload);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * BƯỚC 3: GỬI HEARTBEAT (Opcode 1)
   * ═══════════════════════════════════════════════════════════════════════════
   * Heartbeat là cơ chế "keep-alive" - gửi định kỳ để Discord biết
   * client vẫn đang kết nối. Nếu ngừng gửi heartbeat, server sẽ ngắt kết nối.
   * 
   * Cấu trúc: { op: 1, d: last_sequence_number }
   */
  startHeartbeat(intervalMs) {
    // Gửi heartbeat đầu tiên sau khoảng thời gian ngẫu nhiên
    // (tránh tất cả client gửi cùng lúc - jitter)
    const jitter = Math.random();
    const firstDelay = Math.floor(intervalMs * jitter);

    console.log(`\n⏱️ Bắt đầu heartbeat (${(intervalMs / 1000).toFixed(1)}s interval, first in ${firstDelay}ms)`);

    // Gửi heartbeat đầu tiên
    setTimeout(() => {
      this.sendHeartbeat();

      // Thiết lập interval cho các heartbeat tiếp theo
      this.heartbeatInterval = setInterval(() => {
        if (!this.heartbeatAcknowledged) {
          console.log('💔 Không nhận được Heartbeat ACK! Đang reconnect...');
          this.ws.terminate(); // Terminate forcefully instead of close() to prevent hanging
          return;
        }
        this.sendHeartbeat();
      }, intervalMs);
    }, firstDelay);
  }

  sendHeartbeat() {
    this.heartbeatAcknowledged = false;
    const payload = {
      op: CONFIG.OPCODES.HEARTBEAT,
      d: this.lastSequence,
    };
    console.log(`💓 Gửi Heartbeat (seq: ${this.lastSequence})`);
    this.send(payload);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * BƯỚC 4: CẬP NHẬT PRESENCE (Opcode 3)
   * ═══════════════════════════════════════════════════════════════════════════
   * Gửi thông tin trạng thái và hoạt động của user
   * 
   * Cấu trúc gói tin:
   * {
   *   op: 3,
   *   d: {
   *     since: null hoặc unix timestamp (khi idle),
   *     activities: [{
   *       name: "Tên hoạt động",
   *       type: 0-5 (Playing/Streaming/Listening/Watching/Custom/Competing)
   *     }],
   *     status: "online" | "idle" | "dnd" | "invisible",
   *     afk: true | false
   *   }
   * }
   */
  updatePresence({ status = 'online', activities = [], afk = false, since = null }) {
    const presencePayload = {
      op: CONFIG.OPCODES.PRESENCE_UPDATE,
      d: {
        since: since,
        activities: activities,
        status: status,
        afk: afk,
      },
    };

    const activityNames = activities.map(a => a.name).join(', ');
    console.log(`\n🎮 Cập nhật Presence: ${status}${activities.length > 0 ? ` | Activities: ${activityNames}` : ''}`);
    this.send(presencePayload);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * QUẢN LÝ AUTO QUEST HÀNG LOẠT
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async initQuestManager() {
    console.log('\n🔎 Đang lấy danh sách Quest từ Discord (Mô phỏng Trình duyệt)...');
    const res = await this.discordRequest('GET', '/quests/@me', null, true); // true = useBrowserHeaders
    
    if (res.status !== 200) {
      console.error(`❌ Lỗi khi lấy Quest (${res.status}):`, res.body);
      return;
    }

    const quests = res.body.quests || [];
    const playQuests = [];
    const videoQuests = [];

    for (const quest of quests) {
      const { config, user_status } = quest;
      const isExpired = new Date(config.expires_at) < new Date();
      const isCompleted = user_status?.completed_at != null;
      
      // Bỏ qua các nhiệm vụ đã hết hạn hoặc đã làm xong
      if (isExpired || isCompleted) continue;

      const tasks = config.task_config_v2?.tasks || {};
      const isVideo = Object.keys(tasks).some(key => key.includes('WATCH'));

      if (isVideo) {
        videoQuests.push(quest);
      } else {
        playQuests.push(quest);
      }
    }

    // Ghép 2 mảng: Play Quests chạy trước, Video Quests chạy sau
    this.questQueue = [...playQuests, ...videoQuests];

    console.log(`\n✅ Nạp Quest: ${playQuests.length} Game, ${videoQuests.length} Video`);

    // Emit danh sách quest cho external listeners
    this.emit('quest_list', {
      playQuests: playQuests.map(q => ({ id: q.config.id, title: q.config.messages?.game_title || 'Game ẩn danh' })),
      videoQuests: videoQuests.map(q => ({ id: q.config.id, title: q.config.messages?.game_title || 'Video ẩn danh' })),
      totalCount: this.questQueue.length
    });

    this.tryStartNextQuest();
  }

  tryStartNextQuest() {
    if (this.activeQuestsCount >= this.MAX_CONCURRENT_QUESTS || this.questQueue.length === 0) {
      if (this.activeQuestsCount === 0 && this.questQueue.length === 0) {
        console.log('🎉 TOÀN BỘ NHIỆM VỤ ĐÃ HOÀN THÀNH!');
        this.updatePresence({ status: CONFIG.STATUS_TYPES.IDLE, activities: [] });
        this.emit('all_complete', {});
      }
      return;
    }

    // Lấy quest ra khỏi hàng đợi
    const quest = this.questQueue.shift();
    this.activeQuestsCount++;
    
    // Bắt đầu xử lý
    this.processQuest(quest);

    // Nếu vẫn còn nhiệm vụ trong hàng đợi và chưa đạt max concurrent, lên lịch chạy tiếp theo
    if (this.questQueue.length > 0 && this.activeQuestsCount < this.MAX_CONCURRENT_QUESTS) {
      const nextDelay = Math.floor(Math.random() * (45000 - 30000 + 1)) + 30000;
      console.log(`⏳ Chờ ${(nextDelay / 1000).toFixed(1)}s trước khi khởi động Quest tiếp theo...`);
      setTimeout(() => {
        this.tryStartNextQuest();
      }, nextDelay);
    }
  }

  async processQuest(quest) {
    const { config, user_status } = quest;
    const questId = config.id;
    const gameTitle = config.messages?.game_title || 'Game ẩn danh';
    const appId = config.application?.id;

    console.log(`\n🎮 [${questId}] Bắt đầu Quest: ${gameTitle}`);

    const tasks = config.task_config_v2?.tasks || {};
    const isVideo = Object.keys(tasks).some(key => key.includes('WATCH'));
    
    let target = 900;
    if (isVideo) {
      target = tasks.WATCH_VIDEO_ON_MOBILE?.target || tasks.WATCH_VIDEO?.target || 60;
    } else {
      target = tasks.PLAY_ON_DESKTOP?.target || tasks.PLAY_ON_PLAYSTATION?.target || 900;
    }

    // Emit quest_start cho external listeners
    this.emit('quest_start', { questId, gameTitle, isVideo, target });

    // 1. Kiểm tra đã enroll chưa, chưa thì tự enroll
    if (!user_status?.enrolled_at) {
      console.log(`📝 [${questId}] Đang tự động enroll Quest...`);
      const enrollRes = await this.discordRequest('POST', `/quests/${questId}/enroll`, { location: 0 });
      if (enrollRes.status === 200 || enrollRes.status === 201) {
        console.log(`✅ [${questId}] Enroll thành công!`);
      } else {
        console.log(`❌ [${questId}] Lỗi enroll (${enrollRes.status}), thử tiếp tục...`);
      }
    }

    // 2. Chuyển trạng thái Presence sang game của quest này (nếu có App ID)
    if (appId && !isVideo) {
      this.activeActivities.set(appId, {
        name: gameTitle,
        type: CONFIG.ACTIVITY_TYPES.PLAYING,
        application_id: appId,
        timestamps: { start: Date.now() }
      });
      this.updatePresence({
        status: CONFIG.STATUS_TYPES.ONLINE,
        activities: Array.from(this.activeActivities.values())
      });
    } else if (isVideo) {
      console.log(`👁️ [${questId}] Nhiệm vụ này là dạng Xem Video, không cần đổi trạng thái Playing.`);
    }

    // 3. Bắt đầu gửi heartbeat vòng lặp
    console.log(`⏱️  [${questId}] Bắt đầu chạy Heartbeat mỗi 60s...`);
    this.sendQuestHeartbeatLoop(quest, target, isVideo);
  }

  sendQuestHeartbeatLoop(quest, target, isVideo) {
    const questId = quest.config.id;
    const appId = quest.config.application?.id;

    let currentVideoTime = 0; // Biến lưu thời gian đã xem (dành cho Video Quest)
    if (isVideo) {
      const progressObj = quest.user_status?.progress || {};
      const key = Object.keys(progressObj).find(k => k.includes('WATCH'));
      if (key && progressObj[key]) {
        currentVideoTime = progressObj[key].value || 0;
      }
    }

    const sendBeat = async () => {
      let res;
      if (isVideo) {
        currentVideoTime += 60;
        if (currentVideoTime > target) currentVideoTime = target;
        
        // Video Quest yêu cầu API v10 và timestamp BẮT BUỘC phải là số thập phân (float)
        // Dùng Math.random() để tạo phần thập phân ngẫu nhiên cho mọi request, giả lập thời gian xem thực tế
        const floatTimestamp = currentVideoTime + Math.random();
        
        // Gửi vào endpoint video-progress của v10
        res = await this.discordRequest('POST', `/api/v10/quests/${questId}/video-progress`, { timestamp: floatTimestamp });
        
        // Nếu endpoint video không tồn tại (404), thử dùng heartbeat tiêu chuẩn
        if (res.status === 404) {
            console.log(`⚠️ [${questId}] video-progress trả về 404, chuyển sang dùng heartbeat tiêu chuẩn...`);
            res = await this.discordRequest('POST', `/api/v10/quests/${questId}/heartbeat`, { terminal: false });
        }
      } else {
        // Gửi heartbeat chơi game
        res = await this.discordRequest('POST', `/quests/${questId}/heartbeat`, { terminal: false });
      }
      
      if (res.status !== 200) {
        console.log(`⚠️ [${questId}] Heartbeat trả về lỗi ${res.status}`);
        console.log(`🔍 Chi tiết lỗi:`, res.body);
        
        if (res.status === 404) {
            console.log(`❌ Hủy Quest ${questId} do API không hỗ trợ (404). Đang bỏ qua nhiệm vụ này...`);
            clearInterval(this.questIntervals.get(questId));
            this.questIntervals.delete(questId);
            this.activeQuestsCount--;
            this.tryStartNextQuest();
        }
        return;
      }

      // Đọc phần trăm hoàn thành
      let progress = 0;
      if (isVideo) {
        progress = res.body.progress?.WATCH_VIDEO_ON_MOBILE?.value || res.body.progress?.WATCH_VIDEO?.value || currentVideoTime;
      } else {
        progress = res.body.progress?.PLAY_ON_DESKTOP?.value || res.body.progress?.PLAY_ON_PLAYSTATION?.value || 0;
      }

      const pct = Math.min(100, Math.round((progress / target) * 100));
      const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      
      console.log(`🎁 [${questId}] Tiến độ: ${bar} ${pct}% (${progress}s / ${target}s)`);

      // Emit quest_progress cho external listeners
      const gameTitle = quest.config.messages?.game_title || 'Game ẩn danh';
      this.emit('quest_progress', { questId, gameTitle, progress, target, pct });

      // Nếu đủ 100%, kết thúc quest hiện tại
      if (progress >= target) {
        clearInterval(this.questIntervals.get(questId));
        this.questIntervals.delete(questId);
        this.activeQuestsCount--;

        // Xóa activity và update lại presence
        if (appId && this.activeActivities.has(appId)) {
          this.activeActivities.delete(appId);
          this.updatePresence({
            status: this.activeQuestsCount > 0 ? CONFIG.STATUS_TYPES.ONLINE : CONFIG.STATUS_TYPES.IDLE,
            activities: Array.from(this.activeActivities.values())
          });
        }

        // Emit quest_complete cho external listeners
        this.emit('quest_complete', { questId, gameTitle });

        console.log(`✅ [${questId}] Quest đã hoàn thành (100%)! [Lưu ý: Cần vào Discord tự nhận thưởng]`);
        
        let delayMs = 0;
        if (isVideo) {
          delayMs = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
        } else {
          delayMs = Math.floor(Math.random() * (60000 - 45000 + 1)) + 45000;
        }
        
        console.log(`☕ Nghỉ giải lao ${(delayMs / 1000).toFixed(0)}s cho luồng này trước khi nhận Quest mới...`);
        
        setTimeout(() => {
          this.tryStartNextQuest();
        }, delayMs);
      }
    };

    // Chạy beat đầu tiên ngay lập tức
    sendBeat();

    // Hẹn giờ chạy tiếp mỗi 60s
    if (this.questIntervals.has(questId)) {
      clearInterval(this.questIntervals.get(questId));
    }
    const interval = setInterval(sendBeat, 60 * 1000);
    this.questIntervals.set(questId, interval);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TIỆN ÍCH
  // ─────────────────────────────────────────────────────────────────────────

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  cleanup(isIntentional = false) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    // Only clear quest intervals if we are intentionally disconnecting
    if (isIntentional) {
      for (const [id, interval] of this.questIntervals.entries()) {
        clearInterval(interval);
      }
      this.questIntervals.clear();
    }
  }

  handleReconnect(closeCode) {
    if (this.intentionalDisconnect) {
      return;
    }

    // Các close code không thể resume
    const nonRecoverableCodes = [4004, 4010, 4011, 4012, 4013, 4014];

    if (nonRecoverableCodes.includes(closeCode)) {
      console.log('❌ Lỗi không thể khôi phục. Dừng kết nối.');
      console.log('   Kiểm tra lại token hoặc intents.');
      this.emit('error', { message: `Lỗi kết nối không thể khôi phục (code: ${closeCode}). Kiểm tra lại token.` });
      return;
    }

    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`\n❌ Đã thử kết nối lại ${this.MAX_RECONNECT_ATTEMPTS} lần thất bại. Tắt phiên.`);
      this.emit('error', { message: `Mất kết nối với Discord (Không nhận được Heartbeat ACK sau ${this.MAX_RECONNECT_ATTEMPTS} lần thử lại).` });
      this.disconnect();
      return;
    }

    this.reconnectAttempts++;
    const delay = 5000;
    console.log(`\n🔄 Reconnect (Lần ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}) sau ${delay / 1000}s...`);
    this.isReconnecting = true;
    setTimeout(() => this.connect(), delay);
  }

  formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const parts = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
  }

  disconnect() {
    console.log('\n👋 Đang ngắt kết nối...');
    this.intentionalDisconnect = true;
    this.cleanup(true);
    if (this.ws) {
      this.ws.close(1000, 'User requested disconnect');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

function runAutoQuest(token) {
  console.log(`\n🚀 Khởi chạy Auto Quest | ⏰ ${new Date().toLocaleString('vi-VN')} | 💻 ${os.hostname()}`);

  const client = new DiscordGatewayClient(token);
  client.connect();
  
  return client;
}

module.exports = {
  DiscordGatewayClient,
  runAutoQuest
};
