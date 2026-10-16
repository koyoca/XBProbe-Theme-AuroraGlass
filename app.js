// Aurora Glass · 极光琉璃 —— XB-Probe 外部主题前端。
//
// 安全约束（与平台一致）：
//   - 只调用 /api/public/v1/*，无权访问管理 API；
//   - CSP 恒为 default-src 'self'（+ img-src data:），不引任何外部库，
//     图表用 Canvas 手绘；渲染不可信字符串一律 textContent。
//
// 布局稳定性（沿用平台约定）：
//   节点卡片每 3 秒刷新一次，因此以 public_id 为键复用 DOM、只就地更新文本
//   与宽度；顺序完全采用服务端返回的顺序，前端不做二次排序。2×2 指标格在
//   某条指标被 public.cards 关闭时自动回流（奇数个可见时最后一个铺满整行）。
(function () {
  'use strict';

  var API = '/api/public/v1';
  var POLL_MS = 3000;
  var SPARK_POINTS = 48;

  var current = null;      // 当前详情页的 public_id
  var detailNode = null;   // 当前详情页的节点 DTO
  var detailTab = 'resources';
  var filter = '\u0000all';
  var cards = {};          // public_id -> { root, refs }
  var tabSig = '';
  var spark = [];

  var cardAllow = null;    // settings.public.cards：null=不限 / []=全关 / [...] 白名单
  var overviewChrome = true;

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function setText(node, text) {
    if (!node) return;
    var s = String(text);
    if (node.textContent !== s) node.textContent = s;
  }

  function setWidth(node, percent) {
    if (!node) return;
    var p = Math.max(0, Math.min(10000, Number(percent) || 0)) / 100;
    var s = p.toFixed(1) + '%';
    if (node.style.width !== s) node.style.width = s;
  }

  function setClass(node, cls) {
    if (node && node.className !== cls) node.className = cls;
  }

  function fmtBps(v) {
    if (v === undefined || v === null) return '—';
    if (!v) return '0 B/s';
    var u = ['B/s', 'KB/s', 'MB/s', 'GB/s'], i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  function fmtBytes(v) {
    if (v === undefined || v === null) return '—';
    if (!v) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 100 ? 2 : 0) + ' ' + u[i];
  }

  function pct(v, decimals) {
    if (v === undefined || v === null) return '—';
    return (v / 100).toFixed(decimals === undefined ? 0 : decimals) + '%';
  }

  function fmtMoney(minor, currency) {
    if (minor === undefined || minor === null) return '—';
    var sym = { CNY: '¥', USD: '$', EUR: '€', HKD: 'HK$', JPY: '¥' }[currency] || '¥';
    var major = Number(minor) / 100;
    return sym + major.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function dur(sec) {
    if (sec === undefined || sec === null || sec < 0) return '—';
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600),
        m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + '天' + h + '小时';
    if (h > 0) return h + '小时' + m + '分';
    return m + '分';
  }

  function levelOf(percent) {
    if (percent === undefined || percent === null) return '';
    if (percent >= 9000) return 'bad';
    if (percent >= 7500) return 'warn';
    return '';
  }

  function statusText(n, nowSec) {
    switch (n.status) {
      case 'online': return '在线 ' + dur(n.uptime_s);
      case 'warning': return '疑似离线';
      case 'archived': return '已归档';
      default:
        if (!n.updated_at) return '离线';
        return '离线 ' + dur(Math.max(0, nowSec - n.updated_at));
    }
  }

  function expireText(days) {
    if (days === undefined || days === null) return { text: '永久', level: '' };
    if (days < 0) return { text: '已过期' + (-days) + '天', level: 'bad' };
    if (days === 0) return { text: '今天到期', level: 'bad' };
    if (days <= 3) return { text: days + '天后到期', level: 'bad' };
    if (days <= 7) return { text: days + '天后到期', level: 'warn' };
    return { text: days + '天后到期', level: '' };
  }

  // -- 国旗：FLAG-COMMON-BEGIN -- （与平台内置前端同一张表，保证看板与后台一致）
  function starPts(cx, cy, r) {
    var p = [];
    for (var i = 0; i < 10; i++) {
      var rr = i % 2 ? r * 0.382 : r;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      p.push((cx + rr * Math.cos(a)).toFixed(2) + ',' + (cy + rr * Math.sin(a)).toFixed(2));
    }
    return p.join(' ');
  }
  var FLAGS = {
    CN: ['中国', '<rect width="20" height="14" fill="#DE2910"/><polygon points="' + starPts(4.4, 4.2, 2.9) + '" fill="#FFDE00"/><circle cx="9.3" cy="1.9" r=".8" fill="#FFDE00"/><circle cx="11.5" cy="3.6" r=".8" fill="#FFDE00"/><circle cx="11.5" cy="6.4" r=".8" fill="#FFDE00"/><circle cx="9.3" cy="8.1" r=".8" fill="#FFDE00"/>'],
    HK: ['中国香港', '<rect width="20" height="14" fill="#DE2910"/><circle cx="10" cy="7" r="3.7" fill="#FFFFFF"/><circle cx="10" cy="4.4" r="1.05" fill="#DE2910"/><circle cx="12.5" cy="6.2" r="1.05" fill="#DE2910"/><circle cx="11.6" cy="9.2" r="1.05" fill="#DE2910"/><circle cx="8.4" cy="9.2" r="1.05" fill="#DE2910"/><circle cx="7.5" cy="6.2" r="1.05" fill="#DE2910"/>'],
    TW: ['中国台湾', '<rect width="20" height="14" fill="#FE0000"/><rect width="10" height="7" fill="#000095"/><circle cx="5" cy="3.5" r="2.5" fill="#FFFFFF"/><circle cx="5" cy="3.5" r="1.75" fill="#000095"/><circle cx="5" cy="3.5" r="1.25" fill="#FFFFFF"/>'],
    MO: ['中国澳门', '<rect width="20" height="14" fill="#00785E"/><circle cx="10" cy="6.5" r="2.9" fill="#FFFFFF"/><circle cx="10" cy="3.5" r="1" fill="#FFFFFF"/><circle cx="12.5" cy="5.4" r="1" fill="#FFFFFF"/><circle cx="11.6" cy="8.3" r="1" fill="#FFFFFF"/><circle cx="8.4" cy="8.3" r="1" fill="#FFFFFF"/><circle cx="7.5" cy="5.4" r="1" fill="#FFFFFF"/>'],
    JP: ['日本', '<rect width="20" height="14" fill="#FFFFFF"/><circle cx="10" cy="7" r="4" fill="#BC002D"/>'],
    KR: ['韩国', '<rect width="20" height="14" fill="#FFFFFF"/><circle cx="10" cy="7" r="3.6" fill="#CD2E3A"/><path d="M6.4 7a3.6 3.6 0 0 0 7.2 0z" fill="#0047A0"/>'],
    SG: ['新加坡', '<rect width="20" height="7" fill="#EE2536"/><rect y="7" width="20" height="7" fill="#FFFFFF"/><circle cx="4.8" cy="3.5" r="2.6" fill="#FFFFFF"/><circle cx="6.1" cy="3.5" r="2.2" fill="#EE2536"/><circle cx="7.4" cy="1.9" r=".6" fill="#FFFFFF"/><circle cx="8.8" cy="3.2" r=".6" fill="#FFFFFF"/><circle cx="8.1" cy="4.9" r=".6" fill="#FFFFFF"/>'],
    MY: ['马来西亚', '<rect width="20" height="14" fill="#FFFFFF"/><g fill="#CC0001"><rect width="20" height="1.08"/><rect y="2.15" width="20" height="1.08"/><rect y="4.31" width="20" height="1.08"/><rect y="6.46" width="20" height="1.08"/><rect y="8.62" width="20" height="1.08"/><rect y="10.77" width="20" height="1.08"/><rect y="12.92" width="20" height="1.08"/></g><rect width="10" height="7" fill="#010066"/><circle cx="4.7" cy="3.5" r="2.2" fill="#FFCC00"/><circle cx="5.9" cy="3.5" r="1.8" fill="#010066"/><polygon points="' + starPts(8.1, 3.5, 1.7) + '" fill="#FFCC00"/>'],
    TH: ['泰国', 'h:#A51931,#F4F5F8,#2D2A4A'],
    VN: ['越南', '<rect width="20" height="14" fill="#DA251D"/><polygon points="' + starPts(10, 7, 3.7) + '" fill="#FFFF00"/>'],
    PH: ['菲律宾', '<rect width="20" height="7" fill="#0038A8"/><rect y="7" width="20" height="7" fill="#CE1126"/><path d="M0 0L8.4 7 0 14z" fill="#FFFFFF"/><circle cx="2.7" cy="7" r="1.2" fill="#FCD116"/>'],
    ID: ['印度尼西亚', 'h:#CE1126,#FFFFFF'],
    IN: ['印度', '<rect width="20" height="4.67" fill="#FF9933"/><rect y="4.67" width="20" height="4.67" fill="#FFFFFF"/><rect y="9.33" width="20" height="4.67" fill="#138808"/><circle cx="10" cy="7" r="1.9" fill="none" stroke="#000080" stroke-width=".7"/>'],
    MN: ['蒙古', 'v:#C4272F,#015197,#F9CF02'],
    AU: ['澳大利亚', '<rect width="20" height="14" fill="#00247D"/><path d="M0 0L9 7M9 0L0 7" stroke="#FFFFFF" stroke-width="1.2"/><rect x="3.8" width="1.4" height="7" fill="#FFFFFF"/><rect y="2.8" width="9" height="1.4" fill="#FFFFFF"/><rect x="4.05" width=".9" height="7" fill="#C8102E"/><rect y="3.05" width="9" height=".9" fill="#C8102E"/><circle cx="14.6" cy="4" r="1" fill="#FFFFFF"/><circle cx="16.6" cy="9.2" r="1" fill="#FFFFFF"/><circle cx="12.6" cy="10.2" r=".8" fill="#FFFFFF"/><circle cx="15" cy="6.6" r=".6" fill="#FFFFFF"/>'],
    NZ: ['新西兰', '<rect width="20" height="14" fill="#00247D"/><path d="M0 0L9 7M9 0L0 7" stroke="#FFFFFF" stroke-width="1.2"/><rect x="3.8" width="1.4" height="7" fill="#FFFFFF"/><rect y="2.8" width="9" height="1.4" fill="#FFFFFF"/><rect x="4.05" width=".9" height="7" fill="#C8102E"/><rect y="3.05" width="9" height=".9" fill="#C8102E"/><polygon points="' + starPts(15.4, 8.6, 1.1) + '" fill="#FFFFFF"/><polygon points="' + starPts(16.6, 4.2, .9) + '" fill="#C8102E"/><circle cx="12.4" cy="10.6" r=".7" fill="#FFFFFF"/>'],
    US: ['美国', '<rect width="20" height="14" fill="#FFFFFF"/><g fill="#B22234"><rect width="20" height="1.08"/><rect y="2.15" width="20" height="1.08"/><rect y="4.31" width="20" height="1.08"/><rect y="6.46" width="20" height="1.08"/><rect y="8.62" width="20" height="1.08"/><rect y="10.77" width="20" height="1.08"/><rect y="12.92" width="20" height="1.08"/></g><rect width="8.8" height="7.6" fill="#3C3B6E"/><g fill="#FFFFFF"><circle cx="2" cy="1.8" r=".55"/><circle cx="5" cy="1.8" r=".55"/><circle cx="3.5" cy="3.3" r=".55"/><circle cx="6.5" cy="3.3" r=".55"/><circle cx="2" cy="4.8" r=".55"/><circle cx="5" cy="4.8" r=".55"/><circle cx="7.6" cy="5.8" r=".55"/><circle cx="1.4" cy="6.3" r=".55"/></g>'],
    CA: ['加拿大', '<rect width="20" height="14" fill="#FFFFFF"/><rect width="5" height="14" fill="#D80621"/><rect x="15" width="5" height="14" fill="#D80621"/><path d="M10 2.4l.9 2 1.9-.8-.8 2.1 1.7 1.2-2.1.5.3 2.1-1.9-1.2-1.9 1.2.3-2.1-2.1-.5 1.7-1.2-.8-2.1 1.9.8z" fill="#D80621"/>'],
    MX: ['墨西哥', 'v:#006847,#FFFFFF,#CE1126'],
    BR: ['巴西', '<rect width="20" height="14" fill="#009C3B"/><path d="M10 1.5L19 7l-9 5.5L1 7z" fill="#FFDF00"/><circle cx="10" cy="7" r="3.1" fill="#002776"/>'],
    AR: ['阿根廷', 'h:#74ACDF,#FFFFFF,#74ACDF'],
    CL: ['智利', '<rect width="20" height="14" fill="#FFFFFF"/><rect y="7" width="20" height="7" fill="#D52B1E"/><rect width="6.8" height="7" fill="#0039A6"/><polygon points="' + starPts(3.4, 3.5, 2.1) + '" fill="#FFFFFF"/>'],
    CO: ['哥伦比亚', 'h:#FCD116,#003893,#CE1126'],
    PE: ['秘鲁', 'v:#D91023,#FFFFFF,#D91023'],
    GB: ['英国', '<rect width="20" height="14" fill="#012169"/><path d="M0 0L20 14M20 0L0 14" stroke="#FFFFFF" stroke-width="2.8"/><path d="M0 0L20 14M20 0L0 14" stroke="#C8102E" stroke-width="1.4"/><rect x="8.2" width="3.6" height="14" fill="#FFFFFF"/><rect y="5.2" width="20" height="3.6" fill="#FFFFFF"/><rect x="9" width="2" height="14" fill="#C8102E"/><rect y="6" width="20" height="2" fill="#C8102E"/>'],
    DE: ['德国', 'h:#000000,#DD0000,#FFCE00'],
    FR: ['法国', 'v:#002395,#FFFFFF,#ED2939'],
    NL: ['荷兰', 'h:#AE1C28,#FFFFFF,#21468B'],
    BE: ['比利时', 'v:#000000,#FDDA24,#EF3340'],
    LU: ['卢森堡', 'h:#ED2939,#FFFFFF,#00A1DE'],
    CH: ['瑞士', '<rect width="20" height="14" fill="#D52B1E"/><rect x="8.5" y="3.2" width="3" height="7.6" fill="#FFFFFF"/><rect x="6.2" y="5.5" width="7.6" height="3" fill="#FFFFFF"/>'],
    AT: ['奥地利', 'h:#ED2939,#FFFFFF,#ED2939'],
    IT: ['意大利', 'v:#009246,#FFFFFF,#CE2B37'],
    ES: ['西班牙', 'h:#AA151B,#F1BF00,#AA151B'],
    PT: ['葡萄牙', 'v:#006600,#FF0000'],
    IE: ['爱尔兰', 'v:#169B62,#FFFFFF,#FF883E'],
    SE: ['瑞典', 'x:#006AA7,#FECC00,0.32'],
    NO: ['挪威', '<rect width="20" height="14" fill="#BA0C2F"/><rect x="5.4" width="3.4" height="14" fill="#FFFFFF"/><rect y="5.3" width="20" height="3.4" fill="#FFFFFF"/><rect x="6.4" width="1.4" height="14" fill="#00205B"/><rect y="6.3" width="20" height="1.4" fill="#00205B"/>'],
    DK: ['丹麦', 'x:#C60C30,#FFFFFF,0.32'],
    FI: ['芬兰', 'x:#FFFFFF,#002F6C,0.32'],
    IS: ['冰岛', 'x:#02529C,#FFFFFF,0.32'],
    PL: ['波兰', 'h:#FFFFFF,#DC143C'],
    CZ: ['捷克', '<rect width="20" height="7" fill="#FFFFFF"/><rect y="7" width="20" height="7" fill="#D7141A"/><path d="M0 0L9.6 7 0 14z" fill="#11457E"/>'],
    HU: ['匈牙利', 'h:#CE2939,#FFFFFF,#477050'],
    RO: ['罗马尼亚', 'v:#002B7F,#FCD116,#CE1126'],
    BG: ['保加利亚', 'h:#FFFFFF,#00966E,#D62612'],
    GR: ['希腊', '<rect width="20" height="14" fill="#FFFFFF"/><g fill="#0D5EAF"><rect width="20" height="1.56"/><rect y="3.11" width="20" height="1.56"/><rect y="6.22" width="20" height="1.56"/><rect y="9.33" width="20" height="1.56"/><rect y="12.44" width="20" height="1.56"/></g><rect width="7.8" height="7.8" fill="#0D5EAF"/><rect x="2.9" width="2" height="7.8" fill="#FFFFFF"/><rect y="2.9" width="7.8" height="2" fill="#FFFFFF"/>'],
    RU: ['俄罗斯', 'h:#FFFFFF,#0039A6,#D52B1E'],
    UA: ['乌克兰', 'h:#0057B7,#FFD700'],
    TR: ['土耳其', '<rect width="20" height="14" fill="#E30A17"/><circle cx="7.8" cy="7" r="3.2" fill="#FFFFFF"/><circle cx="9.1" cy="7" r="2.6" fill="#E30A17"/><polygon points="' + starPts(12.7, 7, 2) + '" fill="#FFFFFF"/>'],
    AE: ['阿联酋', '<rect width="20" height="4.67" fill="#00732F"/><rect y="4.67" width="20" height="4.67" fill="#FFFFFF"/><rect y="9.33" width="20" height="4.67" fill="#000000"/><rect width="5" height="14" fill="#FF0000"/>'],
    SA: ['沙特阿拉伯', '<rect width="20" height="14" fill="#006C35"/><rect x="4.2" y="8.2" width="11.6" height="1.5" rx=".75" fill="#FFFFFF"/><rect x="4.2" y="4.9" width="8.6" height="1.1" fill="#FFFFFF"/>'],
    IL: ['以色列', '<rect width="20" height="14" fill="#FFFFFF"/><rect y="1.6" width="20" height="1.9" fill="#0038B8"/><rect y="10.5" width="20" height="1.9" fill="#0038B8"/><path d="M10 3.9l2.5 4.3H7.5z" fill="none" stroke="#0038B8" stroke-width=".8"/><path d="M10 10.1L7.5 5.8h5z" fill="none" stroke="#0038B8" stroke-width=".8"/>'],
    IR: ['伊朗', 'h:#239F40,#FFFFFF,#DA0000'],
    EG: ['埃及', 'h:#CE1126,#FFFFFF,#000000'],
    PK: ['巴基斯坦', '<rect width="20" height="14" fill="#01411C"/><rect width="5.4" height="14" fill="#FFFFFF"/><circle cx="13.6" cy="7" r="3.4" fill="#FFFFFF"/><circle cx="15.1" cy="6.2" r="2.9" fill="#01411C"/><polygon points="' + starPts(16.6, 3.4, 1.3) + '" fill="#FFFFFF"/>'],
    BD: ['孟加拉国', '<rect width="20" height="14" fill="#006A4E"/><circle cx="8.4" cy="7" r="4.2" fill="#F42A41"/>'],
    KH: ['柬埔寨', '<rect width="20" height="14" fill="#032EA1"/><rect y="4" width="20" height="6" fill="#E00025"/><rect y="10" width="20" height="4" fill="#032EA1"/>'],
    MM: ['缅甸', 'h:#FECB00,#34B233,#EA2839'],
    LA: ['老挝', '<rect width="20" height="14" fill="#CE1126"/><rect y="3.5" width="20" height="7" fill="#002868"/><circle cx="10" cy="7" r="3" fill="#FFFFFF"/>'],
    BN: ['文莱', '<rect width="20" height="14" fill="#F7E017"/><path d="M0 3.4l20 5.4M0 8.8l20-5.4" stroke="#FFFFFF" stroke-width="2.4"/><path d="M0 4.4l20 5.4M0 9.8l20-5.4" stroke="#000000" stroke-width=".8"/>'],
    KZ: ['哈萨克斯坦', '<rect width="20" height="14" fill="#00AFCA"/><circle cx="10" cy="7" r="2.8" fill="#FEC50C"/>'],
    UZ: ['乌兹别克斯坦', 'h:#0099B5,#FFFFFF,#1EB53A'],
    AZ: ['阿塞拜疆', 'h:#0092BC,#E4002B,#00AE65'],
    GE: ['格鲁吉亚', '<rect width="20" height="14" fill="#FFFFFF"/><rect y="5.6" width="20" height="2.8" fill="#FF0000"/><rect x="8.6" width="2.8" height="14" fill="#FF0000"/>'],
    AM: ['亚美尼亚', 'h:#D90012,#0033A0,#F2A800'],
    QA: ['卡塔尔', '<rect width="20" height="14" fill="#FFFFFF"/><path d="M5 0l2 1.4-2 1.4 2 1.4-2 1.4 2 1.4-2 1.4 2 1.4-2 1.4 2 1.4-2 1.4h15V0z" fill="#8A1538"/>'],
    KW: ['科威特', '<rect width="20" height="14" fill="#FFFFFF"/><rect width="20" height="4.67" fill="#007A3D"/><rect y="9.33" width="20" height="4.67" fill="#CE1126"/><path d="M0 0l5.6 7L0 14z" fill="#000000"/>'],
    BH: ['巴林', '<rect width="20" height="14" fill="#FFFFFF"/><path d="M5 0l2 1.4-2 1.4 2 1.4-2 1.4 2 1.4-2 1.4 2 1.4-2 1.4 2 1.4-2 1.4h15V0z" fill="#CE1126"/>'],
    CY: ['塞浦路斯', '<rect width="20" height="14" fill="#FFFFFF"/><path d="M4.6 8.6c1.4-1.6 3-2.4 4.2-2 .9.3 1.2 1.4 1.6 1.9.3.4 1 .5 1.6.2.7-.3 1.5-.4 2.2 0 .6.3 1 .9 1.2 1.5" stroke="#D57800" stroke-width="1.2" fill="none" stroke-linecap="round"/>'],
    MT: ['马耳他', '<rect width="20" height="14" fill="#FFFFFF"/><rect x="10" width="10" height="14" fill="#CF142B"/><rect x="3.4" y="1.4" width="3.2" height="4" fill="#FFFFFF" stroke="#7F7F7F" stroke-width=".4"/><path d="M5 1.9v3M3.9 3.4h2.2" stroke="#7F7F7F" stroke-width=".5"/>'],
    JO: ['约旦', '<rect width="20" height="14" fill="#FFFFFF"/><rect width="20" height="4.67" fill="#000000"/><rect y="9.33" width="20" height="4.67" fill="#007A3D"/><path d="M0 0l7 7L0 14z" fill="#CE1126"/><polygon points="' + starPts(3.1, 7, 1.5) + '" fill="#FFFFFF"/>'],
    LB: ['黎巴嫩', '<rect width="20" height="14" fill="#FFFFFF"/><rect width="20" height="3.4" fill="#EE161F"/><rect y="10.6" width="20" height="3.4" fill="#EE161F"/><path d="M10 3.8l1.2 2 2-.3-1.1 1.6 1.1 1.6-2-.3L10 10.2 8.8 8.4l-2 .3L7.9 7.1 6.8 5.5l2 .3z" fill="#00A651"/>'],
    IQ: ['伊拉克', 'h:#CE1126,#FFFFFF,#000000'],
    RS: ['塞尔维亚', 'h:#C6363C,#0C4076,#FFFFFF'],
    HR: ['克罗地亚', 'h:#FF0000,#FFFFFF,#171796'],
    SI: ['斯洛文尼亚', 'h:#FFFFFF,#005DA4,#ED1C24'],
    SK: ['斯洛伐克', 'h:#FFFFFF,#0B4EA2,#EE1C25'],
    MD: ['摩尔多瓦', 'v:#003DA5,#FFD200,#C8102E'],
    UY: ['乌拉圭', '<rect width="20" height="14" fill="#FFFFFF"/><g fill="#0038A8"><rect width="20" height="1.75"/><rect y="3.5" width="20" height="1.75"/><rect y="7" width="20" height="1.75"/><rect y="10.5" width="20" height="1.75"/></g><rect width="7.6" height="7" fill="#FFFFFF"/><circle cx="3.8" cy="3.5" r="1.9" fill="#FEDF00"/>'],
    PY: ['巴拉圭', 'h:#D52B1E,#FFFFFF,#0038A8'],
    BO: ['玻利维亚', 'h:#D52B1E,#F9E300,#007934'],
    EC: ['厄瓜多尔', '<rect width="20" height="14" fill="#FFDD00"/><rect y="7" width="20" height="3.5" fill="#0055A4"/><rect y="10.5" width="20" height="3.5" fill="#EF3340"/>'],
    VE: ['委内瑞拉', 'h:#FFCC00,#00247D,#CF142B'],
    CR: ['哥斯达黎加', '<rect width="20" height="14" fill="#002B7F"/><rect y="2.3" width="20" height="9.4" fill="#FFFFFF"/><rect y="4.7" width="20" height="4.7" fill="#CE1126"/>'],
    PA: ['巴拿马', '<rect width="20" height="14" fill="#FFFFFF"/><rect x="10" width="10" height="7" fill="#DA121A"/><rect y="7" width="10" height="7" fill="#005293"/>'],
    GT: ['危地马拉', 'v:#4997D0,#FFFFFF,#4997D0'],
    PR: ['波多黎各', '<rect width="20" height="14" fill="#FFFFFF"/><g fill="#ED0000"><rect width="20" height="2.8"/><rect y="5.6" width="20" height="2.8"/><rect y="11.2" width="20" height="2.8"/></g><path d="M0 0l8.4 7L0 14z" fill="#0050F0"/><polygon points="' + starPts(2.7, 7, 1.5) + '" fill="#FFFFFF"/>'],
    JM: ['牙买加', '<path d="M0 0h20v14H0z" fill="#FED100"/><path d="M0 0l20 14M20 0L0 14" stroke="#000000" stroke-width="3.6"/><path d="M0 0l20 14M20 0L0 14" stroke="#009B3A" stroke-width="1.6"/>'],
    MA: ['摩洛哥', '<rect width="20" height="14" fill="#C1272D"/><polygon points="' + starPts(10, 7, 3.3) + '" fill="none" stroke="#006233" stroke-width=".7"/>'],
    TN: ['突尼斯', '<rect width="20" height="14" fill="#E70013"/><circle cx="10" cy="7" r="3.6" fill="#FFFFFF"/><circle cx="11.2" cy="7" r="2.9" fill="#E70013"/><polygon points="' + starPts(11.6, 7, 1.6) + '" fill="#E70013"/>'],
    FJ: ['斐济', '<rect width="20" height="14" fill="#68BFE5"/><rect width="9.4" height="7" fill="#FFFFFF"/><path d="M0 0l9.4 7M9.4 0L0 7" stroke="#C8102E" stroke-width="1.5"/><rect x="4.1" width="1.2" height="7" fill="#C8102E"/><rect y="2.9" width="9.4" height="1.2" fill="#C8102E"/><circle cx="15.2" cy="7" r="2.4" fill="#FFFFFF"/>']
  };
  function flagSVG(code) {
    var e = FLAGS[code];
    if (!e) return '';
    var spec = e[1];
    var m = /^([hvx]):/.exec(spec);
    var kind = m ? m[1] : 's';
    var arg = m ? spec.slice(m[0].length) : spec;
    var inner = '';
    if (kind === 'h' || kind === 'v') {
      var cs = arg.split(',');
      var step = (kind === 'h' ? 14 : 20) / cs.length;
      for (var k = 0; k < cs.length; k++) {
        inner += kind === 'h'
          ? '<rect y="' + (step * k).toFixed(2) + '" width="20" height="' + step.toFixed(2) + '" fill="' + cs[k] + '"/>'
          : '<rect x="' + (step * k).toFixed(2) + '" width="' + step.toFixed(2) + '" height="14" fill="' + cs[k] + '"/>';
      }
    } else if (kind === 'x') {
      var xs = arg.split(',');
      var ox = parseFloat(xs[2]) * 20;
      inner = '<rect width="20" height="14" fill="' + xs[0] + '"/>' +
        '<rect x="' + (ox - 1.7).toFixed(2) + '" width="3.4" height="14" fill="' + xs[1] + '"/>' +
        '<rect y="5.3" width="20" height="3.4" fill="' + xs[1] + '"/>';
    } else {
      inner = arg;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14" width="20" height="14" aria-hidden="true">' +
      '<rect width="20" height="14" fill="#dfe4ee"/>' + inner + '</svg>';
  }

  var COUNTRY_HINTS = [
    ['US', ['美国', '洛杉矶', '圣何塞', '西雅图', '达拉斯', '纽约', '芝加哥', '凤凰城', '硅谷', '迈阿密', 'us', 'usa', 'united states', 'los angeles', 'san jose', 'seattle', 'dallas', 'new york']],
    ['HK', ['香港', 'hongkong', 'hong kong', 'hk']],
    ['TW', ['台湾', '台北', 'taiwan', 'taipei', 'tw']],
    ['JP', ['日本', '东京', '大阪', 'japan', 'tokyo', 'osaka', 'jp']],
    ['KR', ['韩国', '首尔', 'korea', 'seoul', 'kr']],
    ['SG', ['新加坡', '狮城', 'singapore', 'sg']],
    ['MY', ['马来西亚', '吉隆坡', 'malaysia', 'kuala lumpur']],
    ['TH', ['泰国', '曼谷', 'thailand', 'bangkok', 'th']],
    ['VN', ['越南', '胡志明', 'vietnam', 'vn']],
    ['PH', ['菲律宾', '马尼拉', 'philippines', 'manila', 'ph']],
    ['ID', ['印度尼西亚', '印尼', '雅加达', 'indonesia', 'jakarta']],
    ['IN', ['印度', '孟买', '班加罗尔', 'india', 'mumbai']],
    ['AU', ['澳大利亚', '澳洲', '悉尼', '墨尔本', 'australia', 'sydney', 'melbourne', 'au']],
    ['NZ', ['新西兰', 'new zealand', 'nz']],
    ['CA', ['加拿大', '多伦多', '蒙特利尔', 'canada', 'toronto', 'montreal', 'ca']],
    ['BR', ['巴西', '圣保罗', 'brazil', 'sao paulo', 'br']],
    ['DE', ['德国', '法兰克福', 'germany', 'frankfurt', 'de']],
    ['FR', ['法国', '巴黎', 'france', 'paris', 'fr']],
    ['GB', ['英国', '伦敦', 'uk', 'united kingdom', 'britain', 'london']],
    ['NL', ['荷兰', '阿姆斯特丹', 'netherlands', 'amsterdam', 'nl']],
    ['RU', ['俄罗斯', '莫斯科', 'russia', 'moscow', 'ru']],
    ['TR', ['土耳其', '伊斯坦布尔', 'turkey', 'istanbul', 'tr']],
    ['AE', ['阿联酋', '迪拜', 'emirates', 'dubai', 'ae']],
    ['SE', ['瑞典', '斯德哥尔摩', 'sweden', 'stockholm', 'se']],
    ['CH', ['瑞士', '苏黎世', 'switzerland', 'zurich', 'ch']],
    ['IT', ['意大利', '米兰', 'italy', 'milan']],
    ['ES', ['西班牙', '马德里', 'spain', 'madrid', 'es']],
    ['PL', ['波兰', '华沙', 'poland', 'warsaw', 'pl']],
    ['UA', ['乌克兰', 'ukraine', 'ua']],
    ['ZA', ['南非', 'south africa', 'za']],
    ['IE', ['爱尔兰', '都柏林', 'ireland', 'dublin', 'ie']],
    ['FI', ['芬兰', '赫尔辛基', 'finland', 'helsinki', 'fi']],
    ['NO', ['挪威', 'norway']],
    ['AT', ['奥地利', '维也纳', 'austria', 'vienna']]
  ];

  var countryHintRe = {};
  function matchCountryHint(s, hint) {
    if (/[^\x00-\x7f]/.test(hint)) return s.indexOf(hint) >= 0;
    var re = countryHintRe[hint];
    if (!re) {
      re = new RegExp('(^|[^a-z0-9])' + hint + '([^a-z0-9]|$)');
      countryHintRe[hint] = re;
    }
    return re.test(s);
  }

  function inferCountry(name, group) {
    var s = (String(group || '') + ' ' + String(name || '')).toLowerCase();
    if (!s.replace(/\s/g, '')) return '';
    for (var i = 0; i < COUNTRY_HINTS.length; i++) {
      var hints = COUNTRY_HINTS[i][1];
      for (var k = 0; k < hints.length; k++) {
        if (matchCountryHint(s, hints[k])) return COUNTRY_HINTS[i][0];
      }
    }
    return '';
  }

  function countryOf(n) {
    if (!n) return '';
    if (n.country) return n.country;
    return inferCountry(n.name, n.group);
  }
  // -- 国旗：FLAG-COMMON-END --

  function svgNode(svgText) {
    try {
      var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      var root = doc && doc.documentElement;
      if (!root || root.nodeName === 'parsererror' ||
        String(root.nodeName).toLowerCase() !== 'svg') {
        return null;
      }
      return document.importNode(root, true);
    } catch (e) {
      return null;
    }
  }

  function renderFlag(box, code) {
    if (!box) return;
    if (box._code === code) return;
    box._code = code;
    box.textContent = '';
    box.removeAttribute('title');
    if (!code) return;
    var svg = svgNode(flagSVG(code));
    if (!svg) {
      box.appendChild(el('span', 'n-flag-code', code));
      box.title = '地区 ' + code;
      return;
    }
    box.appendChild(svg);
    var e = FLAGS[code];
    box.title = e ? e[0] : ('地区 ' + code);
  }

  function renderStackBadges(box, stack) {
    box.textContent = '';
    var parts = stack ? String(stack).split('+') : [];
    parts.forEach(function (p) {
      var v = p.trim().toLowerCase();
      var text = v === 'v6' ? 'IPv6' : (v === 'v4' ? 'IPv4' : '');
      if (!text) return;
      var b = el('span', 'ip-badge ' + v, text);
      b.title = '该节点已配置 ' + text + ' 地址';
      box.appendChild(b);
    });
  }

  // -------------------------------------------------------------------------
  // 探测延迟点阵（每条目标：名称 + 当前值 + 两行色段）
  // -------------------------------------------------------------------------

  var latWindow = '24h';
  var LAT_WINDOW_LABEL = {
    '30m': '近 30 分钟', '1h': '近 1 小时', '6h': '近 6 小时', '24h': '近 24 小时'
  };
  function latWindowLabel() { return LAT_WINDOW_LABEL[latWindow] || LAT_WINDOW_LABEL['24h']; }
  function stepLabel(s) {
    if (s % 3600 === 0) return (s / 3600) + ' 小时';
    if (s % 60 === 0) return (s / 60) + ' 分钟';
    return s + ' 秒';
  }

  // 五档延迟色阶（绿 → 黄绿 → 琥珀 → 橙 → 红）与丢包色阶。
  // 与黑白灰阶版不同，这里颜色直接表达"严重度"，一眼能看出哪条链路不安分。
  function latColor(rttUs) {
    var ms = (rttUs || 0) / 1000;
    if (ms <= 50)  return cssVar('--lat-1', '#10b981');
    if (ms <= 100) return cssVar('--lat-2', '#84cc16');
    if (ms <= 200) return cssVar('--lat-3', '#f59e0b');
    if (ms <= 500) return cssVar('--lat-4', '#f97316');
    return cssVar('--lat-5', '#ef4444');
  }
  function lossColor(lossX100) {
    if (lossX100 <= 0)    return cssVar('--lat-1', '#10b981');
    if (lossX100 < 100)   return cssVar('--lat-2', '#84cc16');
    if (lossX100 < 500)   return cssVar('--lat-3', '#f59e0b');
    if (lossX100 < 2000)  return cssVar('--lat-4', '#f97316');
    return cssVar('--lat-5', '#ef4444');
  }

  function renderLatencyBars(box, bars) {
    var on = cardOn('lat_bars');
    var list = bars || [];
    if (!on || !list.length) {
      box.hidden = true;
      box.textContent = '';
      box._sig = null;
      return;
    }
    var sig = latWindow + '|on' + JSON.stringify(list);
    if (box._sig === sig) return;
    box._sig = sig;
    box.hidden = false;
    box.textContent = '';

    var tip = el('div', 'lb-title');
    tip.textContent = '延迟 / 丢包 · ' + latWindowLabel();
    if (list.length && list[0].step) {
      tip.title = '每个点约 ' + stepLabel(list[0].step) +
        '；上行色段是延迟、下行色段是丢包，悬浮某段可看该段时间的数值。';
    } else {
      tip.title = '上行色段是延迟、下行色段是丢包，悬浮某段可看该段时间的数值。';
    }
    box.appendChild(tip);

    list.forEach(function (b) { box.appendChild(latRow(b)); });
  }

  function lastNonNull(arr) {
    if (!arr) return null;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] != null) return arr[i];
    }
    return null;
  }

  function latRow(b) {
    var row = el('div', 'lb-row');
    var head = el('div', 'lb-head');
    var label = b.name || CARRIER[b.carrier] || b.carrier;
    var carrier = CARRIER[b.carrier] || '';
    if (carrier && label.indexOf(carrier) < 0) label += ' · ' + carrier;
    head.appendChild(el('span', 'lb-name', label));

    var lastRtt = lastNonNull(b.rtt);
    var lastLoss = lastNonNull(b.loss);
    var rt = el('span', 'lb-val');
    if (lastRtt != null) {
      rt.textContent = (lastRtt / 1000).toFixed(0) + ' ms';
      rt.style.color = latColor(lastRtt);
    } else {
      rt.textContent = '—';
      rt.className = 'lb-val muted-v';
    }
    head.appendChild(rt);

    var ls = el('span', 'lb-val lb-loss');
    if (lastLoss != null) {
      ls.textContent = (lastLoss / 100).toFixed(1) + '%';
      ls.style.color = lossColor(lastLoss);
    } else {
      ls.textContent = '—';
      ls.className = 'lb-val muted-v';
    }
    head.appendChild(ls);
    row.appendChild(head);

    var strips = el('div', 'strips');
    strips.appendChild(stripLine(b, 'rtt'));
    strips.appendChild(stripLine(b, 'loss'));
    row.appendChild(strips);
    return row;
  }

  function stripLine(bar, kind) {
    var line = el('div', 'strip');
    var arr = kind === 'rtt' ? bar.rtt : bar.loss;
    var n = (bar.rtt || []).length;
    for (var i = 0; i < n; i++) {
      var d = el('i', 'seg');
      var v = arr ? arr[i] : null;
      var when = fmtHM((bar.from || 0) + i * (bar.step || 1));
      if (v == null) {
        d.className = 'seg none';
        d.title = when + ' · 无数据';
      } else if (kind === 'rtt') {
        d.style.backgroundColor = latColor(v);
        d.title = when + ' · ' + (v / 1000).toFixed(0) + ' ms';
      } else {
        d.style.backgroundColor = lossColor(v);
        d.title = when + ' · 丢包 ' + (v / 100).toFixed(1) + '%';
      }
      line.appendChild(d);
    }
    return line;
  }

  function fmtHM(ts) {
    var d = new Date(ts * 1000);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mm;
  }

  function getJSON(path) {
    return fetch(API + path, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  var CARRIER = { telecom: '电信', unicom: '联通', mobile: '移动', custom: '自定义' };
  var CARRIER_NAME = {
    ok: '正常', warn: '偏高', bad: '很高', unknown: '无数据',
    online: '在线', offline: '离线', warning: '疑似离线'
  };

  // -------------------------------------------------------------------------
  // 节点卡片：头部 + 副行 + 2×2 指标格 + 速率/续费 + 延迟点阵
  // -------------------------------------------------------------------------

  // 指标小图标（内联 SVG，24×24 网格，描边用 currentColor）。
  var ICONS = {
    cpu: ['M6 6h12v12H6z', 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3'],
    mem: ['M6 7h12v7H6z', 'M4 17h16', 'M9 10.5h1.5M13 10.5h1.5'],
    disk: ['M4 6h16v12H4z', 'M4 13.5h16', 'M7 16h.01M10.5 16h.01'],
    traf: ['M7 5v13M4 15l3 3 3-3M17 19V6M14 9l3-3 3 3']
  };

  function iconSvg(kind, size) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', String(size || 12));
    s.setAttribute('height', String(size || 12));
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    (ICONS[kind] || []).forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }

  // makeTile 构建一格指标：标签行（图标+名称+数值）→ 进度条 → 说明行。
  function makeTile(kind, label, cardKey) {
    var box = el('div', 'tile t-' + kind);
    box.setAttribute('data-card', cardKey);

    var head = el('div', 'tile-head');
    var k = el('span', 'tile-k');
    k.appendChild(iconSvg(kind, 12));
    k.appendChild(document.createTextNode(label));
    var kb = el('b');
    k.appendChild(kb);
    var v = el('span', 'tile-val');
    head.appendChild(k);
    head.appendChild(v);

    var bar = el('div', 'bar');
    var fill = el('i');
    bar.appendChild(fill);

    var sub = el('div', 'tile-sub');

    box.appendChild(head);
    box.appendChild(bar);
    box.appendChild(sub);
    return { box: box, key: cardKey, kind: kind, kb: kb, v: v, fill: fill, sub: sub };
  }

  function makeCard(n) {
    var root = el('article', 'node');
    root.tabIndex = 0;
    root.setAttribute('role', 'button');

    var head = el('div', 'n-head');
    var dot = el('span', 'dot');
    var flag = el('span', 'n-flag');
    var name = el('span', 'n-name');
    var chip = el('span', 'n-chip');
    head.appendChild(dot);
    head.appendChild(flag);
    head.appendChild(name);
    head.appendChild(chip);

    var sub = el('div', 'n-sub');
    var os = el('span', 'n-os');
    var badges = el('span', 'n-badges');
    var exp = el('span', 'n-exp');
    sub.appendChild(os);
    sub.appendChild(badges);
    sub.appendChild(exp);

    var tiles = el('div', 'n-tiles');
    var mCpu = makeTile('cpu', 'CPU', 'node_cpu');
    var mMem = makeTile('mem', '内存', 'node_mem');
    var mDisk = makeTile('disk', '磁盘', 'node_disk');
    var mTraf = makeTile('traf', '流量', 'node_traffic');
    tiles.appendChild(mCpu.box);
    tiles.appendChild(mMem.box);
    tiles.appendChild(mDisk.box);
    tiles.appendChild(mTraf.box);

    var fee = el('div', 'n-fee');
    fee.setAttribute('data-card', 'node_fee');
    fee.hidden = true;
    var feeK = el('span', 'fee-k', '续费');
    var feeV = el('span', 'fee-v', '—');
    fee.appendChild(feeK);
    fee.appendChild(feeV);

    var net = el('div', 'n-net');
    net.setAttribute('data-card', 'node_net');
    var rateRow = el('div', 'net-row');
    var rateRxDir = el('span', 'dir down', '↓');
    var rateRx = el('b');
    var rateTxDir = el('span', 'dir up up-gap', '↑');
    var rateTx = el('b');
    rateRow.appendChild(rateRxDir); rateRow.appendChild(rateRx);
    rateRow.appendChild(rateTxDir); rateRow.appendChild(rateTx);

    var totRow = el('div', 'net-row totals');
    var totRxDir = el('span', 'dir down', '↓');
    var totRx = el('b');
    var totTxDir = el('span', 'dir up up-gap', '↑');
    var totTx = el('b');
    totRow.appendChild(totRxDir); totRow.appendChild(totRx);
    totRow.appendChild(totTxDir); totRow.appendChild(totTx);

    var rateLine = el('div', 'net-line');
    rateLine.appendChild(rateRow);
    rateLine.appendChild(fee);

    net.appendChild(rateLine);
    net.appendChild(totRow);

    var lat = el('div', 'n-lat');
    lat.hidden = true;

    root.appendChild(head);
    root.appendChild(sub);
    root.appendChild(tiles);
    root.appendChild(net);
    root.appendChild(lat);

    var open = function () {
      location.hash = '#/n/' + encodeURIComponent(n.public_id);
    };
    root.addEventListener('click', open);
    root.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });

    return {
      root: root,
      dot: dot, flag: flag, name: name, chip: chip, os: os, exp: exp, badges: badges,
      tiles: tiles, fee: fee, feeV: feeV, net: net, rateRow: rateRow, totRow: totRow,
      cpu: mCpu, mem: mMem, disk: mDisk, traf: mTraf,
      rateRx: rateRx, rateTx: rateTx, totRx: totRx, totTx: totTx,
      lat: lat
    };
  }

  // applyNodeCardBlocks 把 public.cards 白名单应用到单张卡片的各区块。
  //
  // 2×2 指标格是网格布局：4 格全开时正好铺满；关掉一格后余下 3 格会
  // 排成 2+1、末格留在左半——所以让**奇数个可见时的最后一格铺满整行**，
  // 视觉上没有缺口。一格都不剩时整块隐藏（否则会留一条带边框的空壳）。
  function applyNodeCardBlocks(c) {
    var list = [c.cpu, c.mem, c.disk, c.traf];
    var visible = [];
    list.forEach(function (t) {
      t.box.hidden = !cardOn(t.key);
      t.box.classList.remove('last-visible');
      if (!t.box.hidden) visible.push(t);
    });
    if (visible.length && visible.length % 2 === 1) {
      visible[visible.length - 1].box.classList.add('last-visible');
    }
    c.tiles.hidden = visible.length === 0;

    // 速率行与价格行在同一个 .net-line 里；价格行只在"确实有价格信息"时显示。
    c.fee.hidden = !cardOn('node_fee') || !c.hasFee;
    c.rateRow.hidden = !cardOn('node_net');
    c.totRow.hidden = !cardOn('node_net');
    c.net.hidden = !((cardOn('node_fee') && c.hasFee) || cardOn('node_net'));
  }

  function updateTile(t, percent, valueText, subText, labelBold) {
    setText(t.kb, labelBold === undefined ? '' : labelBold);
    setText(t.v, valueText);
    setWidth(t.fill, percent);
    var lv = levelOf(percent);
    setClass(t.fill, lv);
    t.box.classList.toggle('warn', lv === 'warn');
    t.box.classList.toggle('bad', lv === 'bad');
    setText(t.sub, subText || '—');
  }

  function updateCard(c, n, nowSec) {
    var status = n.status || 'offline';
    setClass(c.dot, 'dot ' + status);
    setText(c.name, n.name || n.public_id);
    setClass(c.chip, 'n-chip ' + status);
    setText(c.chip, statusText(n, nowSec));
    renderFlag(c.flag, countryOf(n));

    // 续费价格（折算到月均）。终身/一次性折算后是 0，靠 fee_cycle 区分文案。
    var feeText = '—';
    if (n.monthly_fee > 0) {
      feeText = fmtMoney(n.monthly_fee, n.monthly_fee_currency) + ' / 月';
    } else if (n.fee_cycle === 'lifetime') {
      feeText = '终身';
    } else if (n.fee_cycle === 'once') {
      feeText = '一次性';
    }
    c.hasFee = feeText !== '—';
    setText(c.feeV, feeText);

    // 先定区块显隐、再填值：否则缺值占位会先写进 DOM、视觉上闪一下。
    applyNodeCardBlocks(c);

    var noData = !n.updated_at;

    var osParts = [];
    if (n.virt) osParts.push(n.virt);
    if (n.arch) osParts.push(n.arch);
    setText(c.os, osParts.length ? osParts.join(' · ') : (n.os || '—'));

    var ex = expireText(n.expire_days);
    setClass(c.exp, 'n-exp ' + ex.level);
    setText(c.exp, ex.text);

    renderStackBadges(c.badges, n.net_stack);
    renderLatencyBars(c.lat, n.lat_bars);

    updateTile(
      c.cpu,
      noData ? 0 : n.cpu_pct,
      noData ? '—' : pct(n.cpu_pct),
      noData ? '—' : (n.load1 === undefined || n.load1 === null
        ? '—' : '负载 ' + (n.load1 / 100).toFixed(2)),
      n.cpu_cores ? n.cpu_cores + ' 核' : ''
    );

    updateTile(c.mem, noData ? 0 : n.mem_pct, noData ? '—' : pct(n.mem_pct),
      noData ? '—' : fmtBytes(n.mem_used) + ' / ' + fmtBytes(n.mem_total));

    updateTile(c.disk, noData ? 0 : n.disk_pct, noData ? '—' : pct(n.disk_pct),
      noData ? '—' : fmtBytes(n.disk_used) + ' / ' + fmtBytes(n.disk_total));

    if (noData) {
      updateTile(c.traf, 0, '—', '—');
    } else if (n.traffic_quota > 0) {
      updateTile(c.traf, n.traffic_used_pct, pct(n.traffic_used_pct),
        fmtBytes(n.traffic_used) + ' / ' + fmtBytes(n.traffic_quota));
    } else {
      updateTile(c.traf, 0, '不限',
        n.traffic_used === undefined ? '—' : fmtBytes(n.traffic_used) + ' 已用');
    }

    setText(c.rateRx, noData ? '—' : fmtBps(n.rx_bps));
    setText(c.rateTx, noData ? '—' : fmtBps(n.tx_bps));
    setText(c.totRx, noData ? '—' : fmtBytes(n.rx_used));
    setText(c.totTx, noData ? '—' : fmtBytes(n.tx_used));
  }

  // -------------------------------------------------------------------------
  // 顶部分组筛选
  // -------------------------------------------------------------------------

  function groupKey(n) { return n.group ? String(n.group) : ''; }

  var FILTER_ALL = '\u0000all';
  var FILTER_NONE = '\u0000nogroup';

  function tabItems(list) {
    var counts = {};
    var order = [];
    list.forEach(function (n) {
      var g = groupKey(n);
      if (!(g in counts)) { counts[g] = 0; order.push(g); }
      counts[g]++;
    });

    var items = [{ key: FILTER_ALL, label: '全部', count: list.length }];
    order.forEach(function (g) {
      if (g === '') return;
      items.push({ key: g, label: g, count: counts[g] });
    });
    if (counts['']) items.push({ key: FILTER_NONE, label: '未分组', count: counts[''] });
    return items;
  }

  function buildTabs(list) {
    var items = tabItems(list);
    var sig = items.map(function (i) { return i.label + ':' + i.count; }).join('|');
    if (sig === tabSig) {
      applyFilter();
      return;
    }
    tabSig = sig;

    var stillThere = items.some(function (i) { return i.key === filter; });
    if (!stillThere) filter = FILTER_ALL;

    var box = $('tabs');
    box.textContent = '';
    items.forEach(function (it) {
      var b = el('button', 'tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.key = it.key;
      b.appendChild(document.createTextNode(it.label));
      b.appendChild(el('span', 'n', it.count));
      b.addEventListener('click', function () {
        filter = it.key;
        applyFilter();
      });
      box.appendChild(b);
    });
    applyFilter();
  }

  function applyFilter() {
    var tabs = $('tabs').children;
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      t.setAttribute('aria-selected', t.dataset.key === filter ? 'true' : 'false');
    }
    Object.keys(cards).forEach(function (id) {
      var c = cards[id];
      var show;
      if (filter === FILTER_ALL) show = true;
      else if (filter === FILTER_NONE) show = c.group === '';
      else show = c.group === filter;
      if (c.root.hidden === show) c.root.hidden = !show;
    });
  }

  // -------------------------------------------------------------------------
  // 列表刷新
  // -------------------------------------------------------------------------

  function renderNodes(list) {
    var grid = $('nodes');
    var seen = {};
    var nowSec = Math.floor(Date.now() / 1000);

    list.forEach(function (n, idx) {
      var id = n.public_id;
      seen[id] = true;
      var c = cards[id];
      if (!c) {
        c = makeCard(n);
        cards[id] = c;
      }
      c.group = groupKey(n);
      updateCard(c, n, nowSec);

      var at = grid.children[idx];
      if (at !== c.root) grid.insertBefore(c.root, at || null);
    });

    Object.keys(cards).forEach(function (id) {
      if (seen[id]) return;
      var c = cards[id];
      if (c.root.parentNode) c.root.parentNode.removeChild(c.root);
      delete cards[id];
    });

    $('empty-tip').hidden = list.length > 0;
    buildTabs(list);
  }

  function renderOverview(o) {
    setText($('kpi-online'), o.nodes_online);
    setText($('kpi-total'), o.nodes_total);
    var off = (o.nodes_total || 0) - (o.nodes_online || 0);
    setText($('kpi-offline'), off > 0 ? off + ' 个离线' : '全部在线');

    setText($('kpi-today-rx'), fmtBytes(o.today_rx));
    setText($('kpi-today-tx'), fmtBytes(o.today_tx));
    setText($('kpi-total-rx'), fmtBytes(o.rx_used));
    setText($('kpi-total-tx'), fmtBytes(o.tx_used));

    setText($('kpi-rx'), fmtBps(o.rx_bps));
    setText($('kpi-tx'), fmtBps(o.tx_bps));

    setText($('kpi-fee'), fmtMoney(o.monthly_fee, o.monthly_fee_currency));
    setText($('kpi-fee-currency'), (o.monthly_fee_currency || 'CNY') + ' / 月');

    spark.push(o.rx_bps || 0);
    if (spark.length > SPARK_POINTS) spark.shift();
    drawSpark();
  }

  function renderBusiest(list) {
    var best = null;
    list.forEach(function (n) {
      if (n.cpu_pct === undefined || n.cpu_pct === null) return;
      if (n.status === 'archived') return;
      if (!best || n.cpu_pct > best.cpu_pct) best = n;
    });
    if (!best) {
      setText($('kpi-busy-pct'), '—');
      setText($('kpi-busy-name'), '暂无数据');
      return;
    }
    setText($('kpi-busy-pct'), pct(best.cpu_pct, 1));
    setText($('kpi-busy-name'), best.name || best.public_id);
  }

  function refreshList() {
    getJSON('/overview').then(renderOverview).catch(function () { });

    getJSON('/nodes').then(function (list) {
      list = list || [];
      renderBusiest(list);
      renderNodes(list);
      setText($('updated'), '更新于 ' + new Date().toLocaleTimeString());
    }).catch(function () {
      setText($('updated'), '连接中断，重试中…');
    });
  }

  // -------------------------------------------------------------------------
  // 卡片级展示开关（settings.public.cards）
  // -------------------------------------------------------------------------

  function cardOn(key) {
    if (!cardAllow) return true;
    return cardAllow[key] === true;
  }

  function applyCards(list) {
    cardAllow = null;
    if (list !== null && list !== undefined) {
      cardAllow = {};
      list.forEach(function (k) { cardAllow[k] = true; });
    }
    Object.keys(cards).forEach(function (id) {
      applyNodeCardBlocks(cards[id]);
    });
    syncOverviewChrome();
  }

  function syncOverviewChrome() {
    var tabs = $('tabs');
    if (tabs) tabs.hidden = !overviewChrome;

    var box = $('kpis');
    if (!box) return;
    var shown = 0;
    Array.prototype.forEach.call(box.querySelectorAll('[data-card]'), function (n) {
      var on = cardOn(n.getAttribute('data-card'));
      n.hidden = !on;
      if (on) shown++;
    });
    box.className = 'kpis' + (shown >= 1 && shown <= 5 ? ' n' + shown : '');
    box.hidden = !overviewChrome || shown === 0;
  }

  // -------------------------------------------------------------------------
  // 聚合带宽迷你趋势图
  // -------------------------------------------------------------------------

  function drawSpark() {
    var cv = $('spark');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 200, h = cv.clientHeight || 22;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (spark.length < 2) return;

    var max = 1;
    spark.forEach(function (v) { if (v > max) max = v; });

    var step = w / (SPARK_POINTS - 1);
    var off = SPARK_POINTS - spark.length;
    var line = cssVar('--m-down', '#059669');

    ctx.beginPath();
    spark.forEach(function (v, i) {
      var x = (off + i) * step;
      var y = h - (v / max) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.lineTo((off + spark.length - 1) * step, h);
    ctx.lineTo(off * step, h);
    ctx.closePath();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = line;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // 详情视图
  // -------------------------------------------------------------------------

  function renderDetail(n) {
    detailNode = n;
    setText($('detail-name'), n.name || n.public_id);
    renderFlag($('detail-flag'), countryOf(n));
    var st = $('detail-status');
    setText(st, statusText(n, Math.floor(Date.now() / 1000)));
    setClass(st, 'chip ' + (n.status || 'offline'));

    var ex = expireText(n.expire_days);
    var osParts = [];
    if (n.virt) osParts.push(n.virt);
    if (n.arch) osParts.push(n.arch);

    var info = $('detail-info');
    info.textContent = '';
    var online = n.status === 'online';
    var groups = [
      ['info_system', '系统', n.os || '—', '架构', osParts.length ? osParts.join(' · ') : '—'],
      ['info_cpu', 'CPU', (n.cpu_cores ? n.cpu_cores + ' 核' : '—') + ' · ' + pct(n.cpu_pct),
       '负载', n.load1 === undefined || n.load1 === null ? '—' : (n.load1 / 100).toFixed(2)],
      ['info_mem', '内存 / 磁盘',
       fmtBytes(n.mem_used) + ' / ' + fmtBytes(n.mem_total) + ' · ' +
       fmtBytes(n.disk_used) + ' / ' + fmtBytes(n.disk_total),
       '交换区', pct(n.swap_pct)],
      ['info_today', '今日流量', '↓ ' + fmtBytes(n.today_rx) + ' · ↑ ' + fmtBytes(n.today_tx),
       '实时速率', '↓ ' + fmtBps(n.rx_bps) + ' · ↑ ' + fmtBps(n.tx_bps)],
      ['info_period', '本周期流量', n.traffic_quota > 0
        ? fmtBytes(n.traffic_used) + ' / ' + fmtBytes(n.traffic_quota) + '（' + pct(n.traffic_used_pct) + '）'
        : fmtBytes(n.traffic_used) + '（不限）',
       '本周期 ↓↑', fmtBytes(n.rx_used) + ' / ' + fmtBytes(n.tx_used)],
      ['info_uptime', '运行时长', online ? dur(n.uptime_s) : '—', '到期', ex.text]
    ];
    var shownInfo = 0;
    groups.forEach(function (g) {
      if (!cardOn(g[0])) return;
      var cell = el('div', 'di');
      cell.setAttribute('data-card', g[0]);
      [[g[1], g[2]], [g[3], g[4]]].forEach(function (pair) {
        var r = el('div', 'di-row');
        r.appendChild(el('span', 'di-k', pair[0]));
        r.appendChild(el('span', 'di-v', pair[1]));
        cell.appendChild(r);
      });
      info.appendChild(cell);
      shownInfo++;
    });
    info.className = 'dinfo' + (shownInfo >= 1 && shownInfo <= 6 ? ' d' + shownInfo : '');
    info.hidden = shownInfo === 0;

    var expChip = $('detail-expire');
    setText(expChip, ex.text);
    setClass(expChip, 'chip ' + (ex.level || ''));
  }

  function rangeSeconds(range) {
    switch (range) {
      case '30m': return 30 * 60;
      case '1h': return 3600;
      case '5h': return 5 * 3600;
      case '24h': return 24 * 3600;
      case '7d': return 7 * 86400;
      case '30d': return 30 * 86400;
      default: return 24 * 3600;
    }
  }

  function axisWindow(range) {
    var now = Math.floor(Date.now() / 1000);
    return { tMin: now - rangeSeconds(range), tMax: now };
  }

  // 图表序列调色：资源图各用自己的指标色；延迟图按序号取极光色相 + 虚线。
  var LAT_PALETTE = ['--accent-2', '--accent', '--accent-3', '--warn', '--ok', '--m-mem'];
  var LAT_DASH = [null, [6, 3], [2, 3], [10, 4, 2, 4], [1, 4], [8, 3]];

  function paletteColor(i) {
    return cssVar(LAT_PALETTE[i % LAT_PALETTE.length], '#6366f1');
  }
  function paletteDash(i) {
    return LAT_DASH[i % LAT_DASH.length];
  }

  var latToggles = {};

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function refreshDetail() {
    var id = current;
    var range = $('range-select').value;
    getJSON('/nodes/' + encodeURIComponent(id)).then(function (n) {
      if (current !== id) return;
      renderDetail(n);
      setText($('updated'), '更新于 ' + new Date().toLocaleTimeString());
    }).catch(function () { });

    if (detailTab === 'resources') {
      getJSON('/nodes/' + encodeURIComponent(id) +
              '/history?range=' + range + '&metrics=cpu,mem,net_rx,net_tx,disk_used')
        .then(function (series) {
          if (current !== id) return;
          var by = {};
          (series || []).forEach(function (s) { by[s.metric] = s.points || []; });
          var n = detailNode || {};

          var win = axisWindow(range);
          drawChart($('c-cpu'), [
            { points: by.cpu, unit: 'pct', name: 'CPU 使用率', color: cssVar('--m-cpu', '#0891b2') }
          ], win);
          capMeta('cap-cpu', [{ pts: by.cpu, unit: 'pct' }]);

          drawChart($('c-mem'), [
            { points: by.mem, unit: 'bytes', name: '内存已用', color: cssVar('--m-mem', '#7c3aed') }
          ], win);
          capMeta('cap-mem', [{ pts: by.mem, unit: 'bytes' }], n.mem_total);

          drawChart($('c-net'), [
            { points: by.net_rx, unit: 'bps', name: '↓ 下行', color: cssVar('--m-down', '#059669') },
            { points: by.net_tx, unit: 'bps', name: '↑ 上行', color: cssVar('--m-up', '#4f46e5') }
          ], win);
          capMeta('cap-net', [
            { pts: by.net_rx, unit: 'bps', name: '↓' },
            { pts: by.net_tx, unit: 'bps', name: '↑' }
          ]);

          drawChart($('c-disk'), [
            { points: by.disk_used, unit: 'bytes', name: '磁盘已用', color: cssVar('--m-disk', '#d97706') }
          ], win);
          capMeta('cap-disk', [{ pts: by.disk_used, unit: 'bytes' }], n.disk_total);
        }).catch(function () { });
    }

    if (detailTab === 'latency') {
      getJSON('/nodes/' + encodeURIComponent(id) + '/latency?range=' + range)
        .then(function (list) {
          if (current !== id) return;
          var items = list || [];
          var allSets = items.map(function (t, i) {
            return {
              points: t.points || [], unit: 'us',
              name: t.name || ('目标 #' + t.target_id),
              targetID: t.target_id,
              color: t.avg_rtt == null ? cssVar('--muted', '#5c6884') : paletteColor(i),
              dash: paletteDash(i)
            };
          });
          var activeSets = allSets.filter(function (s) { return latToggles[s.targetID] !== false; });
          drawChart($('c-latency'), activeSets, axisWindow(range));
          capMeta('cap-latency', items.filter(function (t) {
            return latToggles[t.target_id] !== false;
          }).map(function (t, i) {
            return { pts: t.points || [], unit: 'us', name: t.name, idx: i };
          }));
          renderLatencyLegend(items, allSets);
          renderLatencyList(items);
        }).catch(function () { });
    }
  }

  function capMeta(id, specs, total) {
    var node = $(id);
    if (!node) return;
    var has = specs.some(function (s) { return s.pts && s.pts.length; });
    if (!has) { setText(node, '该范围无数据'); return; }
    var unit = specs[0].unit;
    var peak = 0;
    var cur = specs.map(function (s) {
      var label = s.name ? s.name + ' ' : (s.prefix || '');
      if (!s.pts || !s.pts.length) return label + '无数据';
      s.pts.forEach(function (p) { if (p.value > peak) peak = p.value; });
      return label + fmtVal(s.pts[s.pts.length - 1].value, unit);
    });
    var parts = [];
    parts.push(specs.length === 1 ? '当前 ' + cur[0] : cur.join(' '));
    parts.push('峰值 ' + fmtVal(peak, unit));
    if (total) parts.push('总量 ' + fmtBytes(total));
    setText(node, parts.join(' · '));
  }

  function renderLatencyLegend(items, allSets) {
    var box = $('latency-legend');
    if (!box) return;
    box.textContent = '';
    if (!items || !items.length) return;
    items.forEach(function (t, i) {
      var color = (allSets[i] || {}).color || paletteColor(i);
      var on = latToggles[t.target_id] !== false;
      var item = el('span', 'item' + (on ? '' : ' off'));
      var dot = el('span', 'dot');
      dot.style.backgroundColor = color;
      item.appendChild(dot);
      item.appendChild(document.createTextNode(
        (t.name || ('目标 #' + t.target_id)) +
        (t.avg_rtt == null ? '（无数据）' : ' ' + (t.avg_rtt / 1000).toFixed(1) + ' ms')));
      item.addEventListener('click', function () {
        latToggles[t.target_id] = !on;
        refreshDetail();
      });
      box.appendChild(item);
    });
  }

  function renderLatencyList(items) {
    var box = $('latency-list');
    box.textContent = '';
    if (!items || !items.length) {
      box.appendChild(el('p', 'muted', '该节点没有配置探测目标，或所选时间范围内没有探测数据。'));
      return;
    }
    items.forEach(function (t) {
      var c = el('div', 'stat');
      var k = el('div', 'k');
      var dot = el('span', 'dot');
      if (t.avg_rtt == null) {
        dot.className = 'dot unknown';
      } else {
        dot.style.backgroundColor = latColor(t.avg_rtt);
      }
      k.appendChild(dot);
      var carrier = CARRIER[t.carrier] || '';
      var title = t.name || ('目标 #' + t.target_id);
      if (carrier && title.indexOf(carrier) < 0) title += ' · ' + carrier;
      k.appendChild(document.createTextNode(title));
      c.appendChild(k);

      c.appendChild(el('div', 'v', t.avg_rtt == null ? '无数据' : (t.avg_rtt / 1000).toFixed(1) + ' ms'));
      c.appendChild(el('div', 'sub', t.avg_rtt == null
        ? '窗口内未探通 · 状态 ' + (CARRIER_NAME[t.status] || t.status || '未知')
        : '最小 ' + (t.min_rtt / 1000).toFixed(1) + ' · 最大 ' + (t.max_rtt / 1000).toFixed(1) +
          ' ms · 丢包 ' + ((t.loss || 0) / 100).toFixed(1) + '% · ' +
          (CARRIER_NAME[t.status] || t.status || '未知')));
      box.appendChild(c);
    });
  }

  // -------------------------------------------------------------------------
  // Canvas 图表（与平台前端同源的算法，只换配色）
  // -------------------------------------------------------------------------

  function prepare(cv) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 320;
    var h = cv.clientHeight || 160;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  var NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  var NICE_BINARY = [1, 2, 2.5, 3, 4, 5, 6, 8, 10, 12.5, 16, 20, 25, 40, 50,
                     80, 100, 125, 200, 250, 500, 625, 800, 1000];

  function niceTop(v, binary) {
    if (!(v > 0)) return binary ? 1024 : 1;
    var rough = v * 1.12 / 4;
    var base, steps;
    if (binary) {
      base = 1;
      while (base * 1024 <= rough && base < 1099511627776) base *= 1024;
      steps = NICE_BINARY;
      var b = base;
      for (var i = 0; i < steps.length; i++) {
        if (steps[i] * b >= rough) return steps[i] * b * 4;
      }
      return 1000 * b * 4;
    }
    var exp = Math.floor(Math.log(rough) / Math.LN10);
    base = Math.pow(10, exp);
    for (var k = 0; k < NICE_STEPS.length; k++) {
      if (NICE_STEPS[k] * base >= rough) return NICE_STEPS[k] * base * 4;
    }
    return 10 * base * 4;
  }

  function fmtVal(v, unit) {
    if (unit === 'pct') return (v / 100).toFixed(1) + '%';
    if (unit === 'us') return (v / 1000).toFixed(1) + ' ms';
    if (unit === 'bps') return fmtBps(v);
    return fmtBytes(v);
  }

  function axisLabel(v, unit) {
    if (unit === 'pct') {
      var n = v / 100;
      return (n % 1 === 0 ? n : n.toFixed(1)) + '%';
    }
    if (unit === 'us') return (v / 1000).toFixed(0) + ' ms';
    if (unit === 'bps') return fmtBytes(v) + '/s';
    return fmtBytes(v);
  }

  var TIME_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 3 * 3600,
                    6 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400, 14 * 86400];

  function timeTicks(tMin, tMax, want) {
    var span = Math.max(1, tMax - tMin);
    var target = span / Math.max(2, want);
    var step = TIME_STEPS[TIME_STEPS.length - 1];
    for (var i = 0; i < TIME_STEPS.length; i++) {
      if (TIME_STEPS[i] >= target) { step = TIME_STEPS[i]; break; }
    }
    var out = [];
    if (step >= 86400) {
      var days = Math.max(1, Math.round(step / 86400));
      var d = new Date(tMin * 1000);
      d.setHours(0, 0, 0, 0);
      var t0 = Math.round(d.getTime() / 1000);
      for (var t = t0; t <= tMax; t += days * 86400) {
        if (t >= tMin) out.push(t);
      }
      if (out.length < 2) out = [tMin, tMax];
      return out;
    }
    for (var t2 = Math.ceil(tMin / step) * step; t2 <= tMax; t2 += step) out.push(t2);
    if (out.length < 2) out = [tMin, tMax];
    return out;
  }

  function timeLabel(ts, span) {
    var d = new Date(ts * 1000);
    if (span > 3 * 86400) return (d.getMonth() + 1) + '/' + d.getDate();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  function gapThreshold(points) {
    if (!points || points.length < 4) return Infinity;
    var gaps = [];
    for (var i = 1; i < points.length; i++) {
      var g = points[i].ts - points[i - 1].ts;
      if (g > 0) gaps.push(g);
    }
    if (gaps.length < 3) return Infinity;
    gaps.sort(function (a, b) { return a - b; });
    var mid = gaps.length >> 1;
    var median = gaps.length % 2
      ? gaps[mid]
      : (gaps[mid - 1] + gaps[mid]) / 2;
    if (!(median > 0)) return Infinity;
    return median * 3;
  }

  function segmentsOf(points, thresh, project) {
    var segs = [], cur = [];
    for (var i = 0; i < points.length; i++) {
      if (i > 0 && thresh !== Infinity &&
          points[i].ts - points[i - 1].ts > thresh) {
        if (cur.length) segs.push(cur);
        cur = [];
      }
      cur.push(project(points[i]));
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  function initChartHover(cv, sets, axisWin) {
    cv._last = { sets: sets, axisWin: axisWin };
    if (cv._hoverInit) return;
    cv._hoverInit = true;
    cv.addEventListener('mousemove', function (ev) {
      if (!cv._last || !cv._hoverState) return;
      var r = cv.getBoundingClientRect();
      var x = ev.clientX - r.left;
      var st = cv._hoverState;
      if (x < st.padL - 4 || x > st.padL + st.plotW + 4) {
        if (cv._hoverTs != null) { cv._hoverTs = null; drawChart(cv, cv._last.sets, cv._last.axisWin); }
        return;
      }
      var ts = st.tMin + (x - st.padL) / st.plotW * (st.tMax - st.tMin);
      if (ts !== cv._hoverTs) {
        cv._hoverTs = ts;
        drawChart(cv, cv._last.sets, cv._last.axisWin, ts);
      }
    });
    cv.addEventListener('mouseleave', function () {
      if (cv._hoverTs != null) {
        cv._hoverTs = null;
        drawChart(cv, cv._last.sets, cv._last.axisWin);
      }
    });
  }

  function drawChartHover(cv, ctx, hoverTs, ax) {
    if (hoverTs == null || !ax.live.length) return;
    var x = ax.padL + ax.plotW * ((hoverTs - ax.tMin) / (ax.tMax - ax.tMin));
    var tolFloor = (ax.tMax - ax.tMin) / 200;
    var hits = [], miss = [];
    ax.live.forEach(function (s) {
      if (!s.points || !s.points.length) return;
      var avg = s.points.length > 1
        ? (s.points[s.points.length - 1].ts - s.points[0].ts) / (s.points.length - 1) : 0;
      var tol = Math.max(avg * 1.5, tolFloor);
      var best = null, bestD = Infinity;
      s.points.forEach(function (pt) {
        var d = Math.abs(pt.ts - hoverTs);
        if (d < bestD) { bestD = d; best = pt; }
      });
      if (best && bestD <= tol) hits.push({ s: s, pt: best });
      else miss.push(s);
    });

    ctx.save();
    ctx.strokeStyle = cssVar('--muted', '#5c6884');
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + .5, ax.padT);
    ctx.lineTo(Math.round(x) + .5, ax.padT + ax.plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!hits.length) { ctx.restore(); return; }

    var lines = [];
    var d = new Date(hits[0].pt.ts * 1000);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    lines.push({ text: (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mm + ':' + ss, head: true });
    hits.forEach(function (h) {
      lines.push({ text: (h.s.name ? h.s.name + '  ' : '') + axisLabel(h.pt.value, h.s.unit), color: h.s.color });
    });
    miss.forEach(function (s) {
      lines.push({ text: (s.name ? s.name + '  ' : '') + '无数据', color: s.color, muted: true });
    });

    ctx.font = '11px sans-serif';
    var w = 0;
    lines.forEach(function (l) { w = Math.max(w, ctx.measureText(l.text).width); });
    w += 24;
    var lh = 15, boxH = lines.length * lh + 10;
    var bx = x + 10, by = ax.padT + 8;
    if (bx + w > ax.padL + ax.plotW) bx = x - w - 10;

    ctx.globalAlpha = .96;
    ctx.fillStyle = cssVar('--solid', '#f2f5fd');
    ctx.strokeStyle = cssVar('--glass-border', '#ffffff');
    ctx.beginPath();
    ctx.rect(bx, by, w, boxH);
    ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;

    var ty = by + 13;
    lines.forEach(function (l) {
      if (l.head) {
        ctx.fillStyle = cssVar('--muted', '#5c6884');
      } else {
        if (l.color) { ctx.fillStyle = l.color; ctx.fillRect(bx + 7, ty - 4, 8, 8); }
        ctx.fillStyle = l.muted ? cssVar('--muted', '#5c6884') : cssVar('--fg', '#151b2c');
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, bx + (l.head ? 7 : 20), ty);
      ty += lh;
    });

    hits.forEach(function (h) {
      var st = cv._hoverState;
      var px = ax.padL + ax.plotW * ((h.pt.ts - ax.tMin) / (ax.tMax - ax.tMin));
      var y = ax.padT + ax.plotH - ax.plotH * Math.min(1, h.pt.value / (st ? st.top : 1));
      ctx.beginPath();
      ctx.arc(px, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = h.s.color;
      ctx.fill();
      ctx.strokeStyle = cssVar('--card-bg', '#ffffff');
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawChart(cv, sets, axisWin, hoverTs) {
    if (!cv) return;
    sets = sets || [];
    initChartHover(cv, sets, axisWin);
    var p = prepare(cv), ctx = p.ctx;
    var live = sets.filter(function (s) { return s.points && s.points.length; });

    if (!live.length) {
      ctx.fillStyle = cssVar('--muted', '#5c6884');
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('该时间范围内没有数据', 12, p.h / 2);
      return;
    }

    var unit = live[0].unit || 'raw';
    var padL = 62, padR = 10, padT = 10, padB = 24;
    var plotW = Math.max(10, p.w - padL - padR);
    var plotH = Math.max(10, p.h - padT - padB);

    var tMin = Infinity, tMax = -Infinity, vMax = 0;
    live.forEach(function (s) {
      s.points.forEach(function (pt) {
        if (pt.ts < tMin) tMin = pt.ts;
        if (pt.ts > tMax) tMax = pt.ts;
        if (pt.value > vMax) vMax = pt.value;
      });
    });
    if (!isFinite(tMin)) return;
    if (axisWin && axisWin.tMin != null) {
      tMin = Math.min(tMin, axisWin.tMin);
      var winMax = axisWin.tMax != null ? axisWin.tMax : tMax;
      tMax = (tMax >= winMax - 120) ? tMax : winMax;
    }
    if (tMax <= tMin) tMax = tMin + 1;
    var span = tMax - tMin;

    var top = niceTop(vMax, unit === 'bytes' || unit === 'bps');
    if (unit === 'pct' && top > 10000) top = 10000;

    cv._hoverState = {
      tMin: tMin, tMax: tMax, padL: padL, padT: padT, padR: padR,
      plotW: plotW, plotH: plotH, top: top, unit: unit,
      live: live.map(function (s, i) {
        return { points: s.points, name: s.name, unit: s.unit || unit,
                 color: s.color || paletteColor(i) };
      })
    };

    var axis = cssVar('--glass-line', '#ddd');
    var muted = cssVar('--muted', '#5c6884');

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var i = 0; i <= 4; i++) {
      var y = Math.round(padT + plotH - plotH * i / 4) + .5;
      ctx.strokeStyle = axis;
      ctx.globalAlpha = i === 0 ? 1 : .55;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = muted;
      ctx.fillText(axisLabel(top * i / 4, unit), padL - 8, y);
    }

    var ticks = timeTicks(tMin, tMax, Math.max(2, Math.floor(plotW / 110)));
    ctx.textBaseline = 'top';
    ticks.forEach(function (ts, idx) {
      var x = Math.round(padL + plotW * ((ts - tMin) / span)) + .5;
      if (idx > 0 && idx < ticks.length - 1) {
        ctx.strokeStyle = axis;
        ctx.globalAlpha = .3;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      var align = 'center';
      if (x - padL < 26) align = 'left';
      else if (padL + plotW - x < 26) align = 'right';
      ctx.textAlign = align;
      ctx.fillStyle = muted;
      ctx.fillText(timeLabel(ts, span), x, padT + plotH + 7);
    });

    live.forEach(function (s, idx) {
      var color = s.color || paletteColor(idx);
      var dash = s.dash || null;
      var segs = segmentsOf(s.points, gapThreshold(s.points), function (pt) {
        return [padL + plotW * ((pt.ts - tMin) / span),
                padT + plotH - plotH * Math.min(1, pt.value / top)];
      });

      if (live.length === 1) {
        ctx.globalAlpha = .16;
        ctx.fillStyle = color;
        segs.forEach(function (seg) {
          if (seg.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(seg[0][0], padT + plotH);
          seg.forEach(function (q) { ctx.lineTo(q[0], q[1]); });
          ctx.lineTo(seg[seg.length - 1][0], padT + plotH);
          ctx.closePath();
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = live.length > 1 ? 1.5 : 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (dash && dash.length) ctx.setLineDash(dash); else ctx.setLineDash([]);
      segs.forEach(function (seg) {
        ctx.beginPath();
        if (seg.length === 1) {
          ctx.moveTo(seg[0][0] - .6, seg[0][1]);
          ctx.lineTo(seg[0][0] + .6, seg[0][1]);
        } else {
          ctx.moveTo(seg[0][0], seg[0][1]);
          for (var k = 1; k < seg.length; k++) ctx.lineTo(seg[k][0], seg[k][1]);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);

      var tail = segs.length ? segs[segs.length - 1] : null;
      if (tail && tail.length) {
        var lastPt = tail[tail.length - 1];
        ctx.beginPath();
        ctx.arc(lastPt[0], lastPt[1], 2.8, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    });

    if (sets.length > 1) {
      var rows = sets.length;
      var lx = padL + 8, ly = padT + 12;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '11px sans-serif';

      ctx.globalAlpha = .88;
      ctx.fillStyle = cssVar('--solid', '#f2f5fd');
      ctx.fillRect(lx - 6, ly - 11, 210, rows * 15 + 8);
      ctx.globalAlpha = 1;

      var fg = cssVar('--fg', '#151b2c');
      sets.forEach(function (s, idx) {
        var color = s.color || paletteColor(idx);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'butt';
        if (s.dash && s.dash.length) ctx.setLineDash(s.dash); else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + 12, ly);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = fg;
        var txt = (s.name || ('序列 ' + (idx + 1))) + '  ';
        txt += s.points && s.points.length
          ? fmtVal(s.points[s.points.length - 1].value, s.unit || unit)
          : '无数据';
        ctx.fillText(txt, lx + 17, ly);
        ly += 15;
      });
    }

    drawChartHover(cv, ctx, hoverTs, { tMin: tMin, tMax: tMax, padL: padL, padT: padT,
      plotW: plotW, plotH: plotH, span: span, live: cv._hoverState ? cv._hoverState.live : [] });
  }

  // -------------------------------------------------------------------------
  // 路由与轮询
  // -------------------------------------------------------------------------

  function setOverviewChrome(show) {
    overviewChrome = show;
    syncOverviewChrome();
  }

  function setDetailTab(tab) {
    detailTab = tab === 'latency' ? 'latency' : 'resources';
    var tabs = $('detail-tabs');
    if (tabs) {
      for (var i = 0; i < tabs.children.length; i++) {
        var b = tabs.children[i];
        b.classList.toggle('active', b.dataset.tab === detailTab);
      }
    }
    var resPanel = $('tab-resources');
    var latPanel = $('tab-latency');
    if (resPanel) resPanel.hidden = detailTab !== 'resources';
    if (latPanel) latPanel.hidden = detailTab !== 'latency';
    if (current) refreshDetail();
  }

  function route() {
    var h = location.hash || '';
    var m = h.match(/^#\/n\/(.+)$/);
    if (m) {
      current = decodeURIComponent(m[1]);
      $('list-view').hidden = true;
      $('detail-view').hidden = false;
      setOverviewChrome(false);
      refreshDetail();
    } else {
      current = null;
      $('detail-view').hidden = true;
      $('list-view').hidden = false;
      setOverviewChrome(true);
      refreshList();
    }
  }

  $('btn-back').addEventListener('click', function () { location.hash = ''; });
  $('range-select').addEventListener('change', refreshDetail);
  var detailTabs = $('detail-tabs');
  if (detailTabs) {
    detailTabs.addEventListener('click', function (ev) {
      if (ev.target && ev.target.dataset && ev.target.dataset.tab) {
        setDetailTab(ev.target.dataset.tab);
      }
    });
  }
  window.addEventListener('hashchange', route);

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    drawSpark();
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = 0;
      if (current) refreshDetail(); else refreshList();
    }, 200);
  });

  // -------------------------------------------------------------------------
  // 深浅色切换
  // -------------------------------------------------------------------------
  var THEME_KEY = 'probe.theme';

  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || t === 'light' ? t : (systemDark() ? 'dark' : 'light');
  }
  function syncThemeBtn() {
    var btn = document.getElementById('btn-theme');
    if (btn) {
      var next = currentTheme() === 'dark' ? '浅色' : '深色';
      btn.setAttribute('aria-label', '切换到' + next);
      btn.setAttribute('title', '切换到' + next);
    }
  }
  function applyTheme(t) {
    if (t === 'dark' || t === 'light') {
      document.documentElement.setAttribute('data-theme', t);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    syncThemeBtn();
  }

  (function initTheme() {
    var q = '';
    try { q = new URLSearchParams(location.search).get('theme') || ''; } catch (e) { }
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { }
    var t = (q === 'dark' || q === 'light') ? q
          : (saved === 'dark' || saved === 'light') ? saved
          : '';
    if (t) applyTheme(t); else syncThemeBtn();
    var btn = document.getElementById('btn-theme');
    if (btn) btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { }
      tick();
    });
  })();

  function tick() {
    if (current) refreshDetail();
    else refreshList();
  }

  function loadSite() {
    getJSON('/site').then(function (s) {
      if (s.title) {
        document.title = s.title;
        setText($('site-title'), s.title);
      }
      if (s.lat_window) latWindow = s.lat_window;
      if (s.admin_url) applyAdminURL(s.admin_url);
      applyCards(s.cards);
    }).catch(function () { });
  }

  function applyAdminURL(url) {
    var btn = $('btn-login');
    if (!btn) return;
    if (!/^https?:\/\/[A-Za-z0-9._:\/-]+$/.test(url)) return;
    btn.setAttribute('href', url);
  }

  loadSite();
  route();
  setupRefreshInterval();

  function setupRefreshInterval() {
    var sel = document.getElementById('refresh-interval');
    if (!sel) return;
    var KEY = 'probe.refresh_s';
    var saved = parseInt(localStorage.getItem(KEY), 10);
    if ([1, 3, 5, 10, 30].indexOf(saved) >= 0) sel.value = String(saved);
    var timer = 0;
    function schedule() {
      if (timer) clearInterval(timer);
      timer = setInterval(tick, parseInt(sel.value, 10) * 1000);
      var fs = document.getElementById('foot-status');
      if (fs) fs.textContent = '每 ' + sel.value + ' 秒自动刷新';
    }
    sel.addEventListener('change', function () {
      localStorage.setItem(KEY, sel.value);
      schedule();
    });
    schedule();
  }
})();
