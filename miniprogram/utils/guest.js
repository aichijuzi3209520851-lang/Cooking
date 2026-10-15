// utils/guest.js — 游客模式（GUEST-001）
//
// 需求：微信登录之后**不再强制创建/加入家庭** —— 用户可以直接落进一个
// 「体验家庭」（虚拟家庭），把点菜 / 汇总 / 菜单 / 我的 四个 tab 全部逛一遍，
// 看清功能之后，再决定要不要真的建一个家。
//
// 实现：**只在 utils/api.js 的 call() 层做一次拦截**。游客模式下所有云函数
// 调用都由本模块的本地数据源应答，好处是：
//   1. 页面代码零改动 —— menu / summary / menu-board / profile 照常发请求；
//   2. 退出游客模式即恢复真实链路，不必维护第二套页面逻辑；
//   3. 数据源是纯函数式的，可以脱离小程序环境直接单测（见 tests/unit）。
//
// ⚠️ 边界：
//   - 体验数据只存在于内存，重启小程序会回到初始体验数据（不落盘）；
//   - 只有**开关**（globalData.isGuest）进缓存，数据本身不进缓存；
//   - 涉及「真正建家/加入别人家」的写操作一律拒绝，并给可理解的提示 ——
//     否则用户会以为自己已经有一个家了，下次登录却什么都没有。

const categoryUtil = require('./category.js');
const util = require('./util.js');

// ===== 虚拟家庭的固定标识 =====
// familyId 用非 ObjectId 的常量：真库里不会出现，也不会被误当成真实家庭
const FAMILY_ID = 'guest-family';
// 云端登录不可用时的兜底身份（模拟器未开云开发 / 断网）
const FALLBACK_OPENID = 'guest-openid';
const GUEST_NICKNAME = '体验用户';
const GUEST_FAMILY_NAME = '体验家庭';
const GUEST_JOIN_CODE = 'GUEST';
// 种子数据里代表「我」的占位符，setMe 时统一替换为当前 openid
const ME = '__me__';

// ===== 体验家庭的成员（不含「我」，我在 buildState 里以 openid 登记）=====
const SEED_MEMBERS = [
  { userId: 'guest-mom', nickname: '妈妈', role: 'eater' },
  { userId: 'guest-dad', nickname: '爸爸', role: 'eater' },
  { userId: 'guest-sis', nickname: '妹妹', role: 'eater' }
];

// ===== 体验菜品库 =====
// 覆盖全部 5 个内置分类；imageUrl 留空 → 渲染走分类插画 / emoji 兜底（不引入图片资源）
// createdAt 越靠后越「新」，与 utils/dto.js 的同票次级排序口径一致
const SEED_DISHES = [
  { _id: 'gd-01', name: '红烧排骨', category: 'meat', cookCount: 12, isHidden: false },
  { _id: 'gd-02', name: '可乐鸡翅', category: 'meat', cookCount: 9, isHidden: false },
  { _id: 'gd-03', name: '番茄牛腩', category: 'meat', cookCount: 6, isHidden: false },
  { _id: 'gd-04', name: '糖醋里脊', category: 'meat', cookCount: 4, isHidden: false },
  { _id: 'gd-05', name: '蒜蓉西兰花', category: 'veg', cookCount: 8, isHidden: false },
  { _id: 'gd-06', name: '手撕包菜', category: 'veg', cookCount: 5, isHidden: false },
  { _id: 'gd-07', name: '清炒时蔬', category: 'veg', cookCount: 3, isHidden: false },
  { _id: 'gd-08', name: '番茄蛋花汤', category: 'soup', cookCount: 11, isHidden: false },
  { _id: 'gd-09', name: '玉米排骨汤', category: 'soup', cookCount: 7, isHidden: false },
  { _id: 'gd-10', name: '米饭', category: 'staple', cookCount: 20, isHidden: false },
  { _id: 'gd-11', name: '葱油拌面', category: 'staple', cookCount: 6, isHidden: false },
  { _id: 'gd-12', name: '凉拌黄瓜', category: 'cold', cookCount: 5, isHidden: false }
];

// 今日已有人点的菜（让「汇总 / 菜单」一进来就有内容，而不是空态）
const SEED_VOTES = {
  'gd-01': [ME, 'guest-mom'],
  'gd-03': ['guest-dad'],
  'gd-05': ['guest-mom', 'guest-sis'],
  'gd-08': [ME, 'guest-dad', 'guest-sis'],
  'gd-10': [ME, 'guest-mom', 'guest-dad', 'guest-sis']
};

// 大厨已拍板「今晚吃」的菜
const SEED_DECIDED = ['gd-01', 'gd-08'];

// 今日菜单提交（菜单页数据源）：谁、什么餐次、点了什么
const SEED_SUBMISSIONS = [
  {
    userId: 'guest-mom',
    userName: '妈妈',
    meal: 'lunch',
    dishIds: ['gd-01', 'gd-05', 'gd-10'],
    time: '10:05'
  },
  {
    userId: ME,
    userName: GUEST_NICKNAME,
    meal: 'lunch',
    dishIds: ['gd-08', 'gd-10'],
    time: '10:12'
  }
];

// 历史记录：按「距今天数」造 3 天，其余日期为空（历史页默认打开昨天）
const SEED_HISTORY = [
  {
    offset: 1,
    votes: {
      'gd-01': [ME, 'guest-mom'],
      'gd-05': ['guest-sis'],
      'gd-10': [ME, 'guest-mom', 'guest-dad', 'guest-sis']
    }
  },
  {
    offset: 2,
    votes: {
      'gd-02': ['guest-dad', 'guest-sis'],
      'gd-09': [ME, 'guest-mom', 'guest-dad'],
      'gd-10': [ME, 'guest-mom', 'guest-dad']
    }
  },
  {
    offset: 3,
    votes: {
      'gd-03': [ME, 'guest-dad'],
      'gd-07': ['guest-mom'],
      'gd-11': ['guest-sis']
    }
  }
];

// 季节食材与提示（与云函数 shared/season.js 的季节口径一致：3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬）
const SEASON_FOODS = {
  spring: ['春笋', '荠菜', '香椿', '豌豆'],
  summer: ['黄瓜', '苦瓜', '丝瓜', '毛豆'],
  autumn: ['莲藕', '南瓜', '栗子', '山药'],
  winter: ['白萝卜', '大白菜', '羊肉', '红薯']
};

const SEASON_TIPS = {
  spring: '春菜正鲜，清淡点更合时令',
  summer: '天热没胃口，爽口菜更下饭',
  autumn: '秋燥宜润，炖煮类正合适',
  winter: '天冷想吃点热的，汤煲最抚慰'
};

// ===== 内部状态 =====
let _state = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seasonOfMonth(month) {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function shiftDate(dateStr, days) {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return dateStr || '';
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function nextId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * 构造一份全新的体验数据。
 * @param {string} openid 当前身份标识；为空时用 FALLBACK_OPENID
 */
function buildState(openid) {
  const me = openid || FALLBACK_OPENID;
  const now = new Date().toISOString();
  const today = util.today();

  const dishes = SEED_DISHES.map((d, i) => ({
    _id: d._id,
    familyId: FAMILY_ID,
    name: d.name,
    category: d.category,
    imageUrl: '',
    isHidden: !!d.isHidden,
    cookCount: d.cookCount || 0,
    createdAt: new Date(Date.now() - (SEED_DISHES.length - i) * 3600 * 1000).toISOString()
  }));

  const votes = {};
  Object.keys(SEED_VOTES).forEach(dishId => {
    votes[dishId] = SEED_VOTES[dishId].map(id => (id === ME ? me : id));
  });

  const submissions = SEED_SUBMISSIONS.map((s, i) => ({
    _id: 'gs-' + (i + 1),
    familyId: FAMILY_ID,
    date: today,
    userId: s.userId === ME ? me : s.userId,
    userName: s.userName,
    meal: s.meal || 'lunch',
    dishIds: s.dishIds.slice(),
    dishCount: s.dishIds.length,
    submittedAt: today + 'T' + (s.time || '10:00') + ':00.000Z'
  }));

  return {
    openid: me,
    user: {
      _id: me,
      openid: me,
      nickname: GUEST_NICKNAME,
      avatarUrl: '',
      currentFamilyId: FAMILY_ID,
      theme: 'system',
      notifyEnabled: false,
      notifyStatus: 'unknown',
      notifyReason: '',
      createdAt: now,
      updatedAt: now
    },
    family: {
      familyId: FAMILY_ID,
      name: GUEST_FAMILY_NAME,
      joinCode: GUEST_JOIN_CODE,
      memberCount: SEED_MEMBERS.length + 1,
      creatorId: me,
      role: 'chef',
      categories: categoryUtil.DEFAULT_CATEGORIES.map(c => ({ ...c, dishCount: 0 })),
      createdAt: now,
      updatedAt: now
    },
    members: [
      { userId: me, nickname: GUEST_NICKNAME, avatarUrl: '', role: 'chef', joinedAt: now }
    ].concat(SEED_MEMBERS.map((m, i) => ({
      userId: m.userId,
      nickname: m.nickname,
      avatarUrl: '',
      role: m.role,
      joinedAt: new Date(Date.now() - (i + 1) * 86400000).toISOString()
    }))),
    dishes,
    votes: { [today]: votes },
    decided: { [today]: SEED_DECIDED.slice() },
    submissions: { [today]: submissions }
  };
}

function ensure() {
  if (!_state) _state = buildState(FALLBACK_OPENID);
  return _state;
}

// ===== 基础查询 =====

function nickOf(s, userId) {
  const m = (s.members || []).find(x => x.userId === userId);
  return m ? m.nickname : '家人';
}

function avatarOf(s, userId) {
  const m = (s.members || []).find(x => x.userId === userId);
  return m ? (m.avatarUrl || '') : '';
}

function visibleDishes(s, includeHidden) {
  return s.dishes.filter(d => includeHidden || !d.isHidden);
}

/**
 * 组装某一天的投票分组（对齐云函数 vote/todayList 的 groups 契约）
 */
function buildGroups(s, date) {
  const byDate = s.votes[date] || {};
  const decided = s.decided[date] || [];
  return Object.keys(byDate)
    .map(dishId => {
      const dish = s.dishes.find(d => d._id === dishId) || {};
      return {
        dishId,
        dishName: dish.name || '已删除菜品',
        category: dish.category || '',
        imageUrl: dish.imageUrl || '',
        isHidden: !!dish.isHidden,
        decided: decided.indexOf(dishId) > -1,
        createdAt: dish.createdAt || '',
        voters: (byDate[dishId] || []).map(userId => ({
          openid: userId,
          nickname: nickOf(s, userId),
          avatarUrl: avatarOf(s, userId),
          votedAt: date
        }))
      };
    })
    .sort((a, b) => b.voters.length - a.voters.length);
}

function buildSubmissions(s, date) {
  const subs = s.submissions[date] || [];
  const byDate = s.votes[date] || {};

  const submissions = subs.map(item => ({
    userId: item.userId,
    userName: item.userName,
    avatarUrl: avatarOf(s, item.userId),
    meal: item.meal || 'lunch',
    dishCount: (item.dishIds || []).length,
    dishes: (item.dishIds || []).map(id => ({
      dishId: id,
      name: (s.dishes.find(d => d._id === id) || {}).name || '已删除菜品'
    })),
    dishNames: (item.dishIds || []).map(
      id => (s.dishes.find(d => d._id === id) || {}).name || '已删除菜品'
    ),
    submittedAt: item.submittedAt
  }));

  // 全家总单：跨提交人按菜名去重，统计被点了几次 + 谁想吃
  const counter = {};
  subs.forEach(item => {
    (item.dishIds || []).forEach(id => {
      const dish = s.dishes.find(d => d._id === id) || {};
      const name = dish.name || '已删除菜品';
      if (!counter[name]) {
        counter[name] = { name, count: 0, imageUrl: dish.imageUrl || '', category: dish.category || '', voters: [] };
      }
      counter[name].count += 1;
      const seen = {};
      counter[name].voters.forEach(v => { seen[v.openid] = true; });
      (byDate[id] || []).forEach(userId => {
        if (seen[userId]) return;
        seen[userId] = true;
        counter[name].voters.push({
          openid: userId,
          nickname: nickOf(s, userId),
          avatarUrl: avatarOf(s, userId)
        });
      });
    });
  });

  const totalDishes = Object.keys(counter).map(k => counter[k])
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { date, submissions, totalDishes };
}

// ===== 错误 =====

const GUEST_BLOCKED_CODE = 'GUEST_MODE_READ_ONLY';

function blocked(message) {
  const err = new Error(message);
  err.errorCode = GUEST_BLOCKED_CODE;
  return err;
}

// ===== 处理器表：key = `云函数名:action` =====

const handlers = {
  // ---------- login 云函数 ----------
  // login:login 不在表里 —— 游客模式仍然先走一次真实登录拿 openid，
  // 拿不到时由 app.js 回落到本地身份（见 app.js applyGuestContext）

  'login:setNotifyStatus': (s, data) => {
    const status = data.status || 'unknown';
    s.user.notifyStatus = status;
    s.user.notifyEnabled = status === 'accepted';
    s.user.notifyReason = typeof data.reason === 'string' ? data.reason.slice(0, 200) : '';
    return {
      notifyEnabled: s.user.notifyEnabled,
      notifyStatus: s.user.notifyStatus
    };
  },

  'login:updateProfile': (s, data) => {
    if (data.nickname !== undefined) {
      const n = String(data.nickname || '').trim();
      if (!n) throw blocked('昵称不能为空');
      if (n.length > 20) throw blocked('昵称不能超过 20 个字');
      s.user.nickname = n;
      const me = s.members.find(m => m.userId === s.openid);
      if (me) me.nickname = n;
    }
    if (data.avatarUrl !== undefined) {
      s.user.avatarUrl = data.avatarUrl || '';
      const me = s.members.find(m => m.userId === s.openid);
      if (me) me.avatarUrl = data.avatarUrl || '';
    }
    if (data.birthday !== undefined) {
      s.user.birthday = data.birthday || null;
    }
    return {
      nickname: s.user.nickname,
      avatarUrl: s.user.avatarUrl || '',
      birthday: s.user.birthday || null
    };
  },

  // getAppConfig 走真实链路也没问题（只读 app_config），但游客模式不该碰云端，
  // 直接返回 null → 协议页用内置兜底文本
  'login:getAppConfig': () => ({ privacy: null }),

  // ---------- family 云函数 ----------
  'family:list': s => [clone(s.family)],

  'family:members': s => s.members.map(m => ({
    userId: m.userId,
    nickname: m.nickname,
    avatarUrl: m.avatarUrl || '',
    role: m.role,
    joinedAt: m.joinedAt
  })),

  'family:switch': (s, data) => ({ familyId: data.familyId || FAMILY_ID }),

  'family:updateRole': (s, data) => {
    const role = data.role === 'chef' ? 'chef' : 'eater';
    s.family.role = role;
    const me = s.members.find(m => m.userId === s.openid);
    if (me) me.role = role;
    return { familyId: FAMILY_ID, role };
  },

  'family:updateMemberRole': (s, data) => {
    const member = s.members.find(m => m.userId === data.userId);
    if (!member) throw blocked('体验家庭里没有这位成员');
    const role = data.role === 'chef' ? 'chef' : 'eater';
    member.role = role;
    return { familyId: FAMILY_ID, userId: member.userId, role };
  },

  // 真正建家 / 加入别人的家 / 退出家庭属于云端写入，体验模式一律拒绝
  'family:create': () => {
    throw blocked('体验家庭仅供参观，退出体验后才能创建自己的家庭');
  },
  'family:joinByCode': () => {
    throw blocked('体验家庭仅供参观，退出体验后才能加入真实家庭');
  },
  'family:leave': () => {
    throw blocked('体验家庭无法退出，点「退出体验」即可回到登录');
  },
  'family:removeMember': () => {
    throw blocked('体验家庭的成员是示例数据，无法移除');
  },
  'family:transferCreator': () => {
    throw blocked('体验家庭无法转让创建者身份');
  },

  // ---------- dish 云函数 ----------
  'dish:list': (s, data) => {
    const page = Number(data.page) || 1;
    const pageSize = Number(data.pageSize) || 20;
    const category = data.category || '';
    const includeHidden = data.includeHidden === true;

    const filtered = visibleDishes(s, includeHidden)
      .filter(d => !category || d.category === category);

    const start = (page - 1) * pageSize;
    return {
      list: clone(filtered.slice(start, start + pageSize)),
      total: filtered.length,
      page,
      pageSize
    };
  },

  'dish:add': (s, data) => {
    const name = String(data.name || '').trim();
    if (!name) throw blocked('菜名不能为空');
    const dish = {
      _id: nextId('gd'),
      familyId: FAMILY_ID,
      name,
      category: data.category || '',
      imageUrl: data.imageUrl || '',
      isHidden: false,
      cookCount: 0,
      createdAt: new Date().toISOString()
    };
    s.dishes.push(dish);
    return { dishId: dish._id };
  },

  'dish:update': (s, data) => {
    const dish = s.dishes.find(d => d._id === data.dishId);
    if (!dish) throw blocked('体验家庭里没有这道菜');
    ['name', 'category', 'imageUrl', 'isHidden'].forEach(key => {
      if (data[key] !== undefined) dish[key] = data[key];
    });
    return { dishId: dish._id };
  },

  'dish:delete': (s, data) => {
    const idx = s.dishes.findIndex(d => d._id === data.dishId);
    if (idx < 0) throw blocked('体验家庭里没有这道菜');
    s.dishes.splice(idx, 1);
    // 同步摘掉今日票，避免汇总页留下「已删除菜品」的幽灵项
    Object.keys(s.votes).forEach(date => { delete s.votes[date][data.dishId]; });
    return { dishId: data.dishId };
  },

  'dish:toggleHidden': (s, data) => {
    const dish = s.dishes.find(d => d._id === data.dishId);
    if (!dish) throw blocked('体验家庭里没有这道菜');
    dish.isHidden = data.isHidden === true;
    return { dishId: dish._id, isHidden: dish.isHidden };
  },

  'dish:categories': s => ({ categories: clone(s.family.categories) }),

  'dish:addCategory': (s, data) => {
    const name = String(data.name || '').trim();
    if (!name) throw blocked('分类名不能为空');
    if (name.length > categoryUtil.CATEGORY_NAME_MAX) {
      throw blocked('分类名不能超过 ' + categoryUtil.CATEGORY_NAME_MAX + ' 个字');
    }
    if (s.family.categories.length >= categoryUtil.CATEGORY_MAX) {
      throw blocked('分类最多 ' + categoryUtil.CATEGORY_MAX + ' 个');
    }
    if (s.family.categories.some(c => c.name === name)) {
      throw blocked('已经有同名分类了');
    }
    const item = {
      key: 'c_' + Date.now().toString(36),
      name,
      emoji: data.emoji || categoryUtil.matchEmoji(name),
      dishCount: 0
    };
    s.family.categories.push(item);
    return { categories: clone(s.family.categories) };
  },

  'dish:removeCategory': (s, data) => {
    const idx = s.family.categories.findIndex(c => c.key === data.categoryKey);
    if (idx < 0) throw blocked('体验家庭里没有这个分类');
    if (s.family.categories.length <= 1) {
      throw blocked('至少保留一个分类');
    }
    if ((s.family.categories[idx].dishCount || 0) > 0) {
      throw blocked('分类下还有菜，先移走再删除');
    }
    s.family.categories.splice(idx, 1);
    return { categories: clone(s.family.categories) };
  },

  // ---------- vote 云函数 ----------
  'vote:todayList': s => {
    const date = util.today();
    return {
      date,
      groups: buildGroups(s, date),
      submitCount: (s.submissions[date] || []).length
    };
  },

  'vote:add': (s, data) => {
    const date = util.today();
    const dishId = data.dishId;
    if (!dishId) throw blocked('缺少菜品 ID');
    if (!s.votes[date]) s.votes[date] = {};
    const list = s.votes[date][dishId] || (s.votes[date][dishId] = []);
    if (list.indexOf(s.openid) < 0) list.push(s.openid);
    return { familyId: FAMILY_ID, dishId, date };
  },

  'vote:cancel': (s, data) => {
    const date = util.today();
    const dishId = data.dishId;
    const list = (s.votes[date] || {})[dishId];
    if (list) {
      const idx = list.indexOf(s.openid);
      if (idx > -1) list.splice(idx, 1);
    }
    return { familyId: FAMILY_ID, dishId, date };
  },

  'vote:chefCancel': (s, data) => {
    const date = util.today();
    const dishId = data.dishId;
    const before = ((s.votes[date] || {})[dishId] || []).slice();
    const affectedCount = before.filter(id => id !== s.openid).length;
    delete (s.votes[date] || {})[dishId];
    const decided = s.decided[date] || [];
    const pos = decided.indexOf(dishId);
    if (pos > -1) decided.splice(pos, 1);
    return { familyId: FAMILY_ID, dishId, affectedCount };
  },

  'vote:decideMenu': (s, data) => {
    const date = util.today();
    const dishId = data.dishId;
    const decided = s.decided[date] || (s.decided[date] = []);
    const idx = decided.indexOf(dishId);
    if (data.decided === true || data.decided === 1 || data.decided === '1') {
      if (idx < 0) decided.push(dishId);
      return { familyId: FAMILY_ID, dishId, decided: true };
    }
    if (idx > -1) decided.splice(idx, 1);
    return { familyId: FAMILY_ID, dishId, decided: false };
  },

  'vote:submitMenu': (s, data) => {
    const date = util.today();
    const meal = data.meal || 'lunch';
    // 本人在体验家庭里点过的菜 = 今日提交内容（与真实链路「提交当前已点」一致）
    const dishIds = Object.keys(s.votes[date] || {})
      .filter(id => ((s.votes[date] || {})[id] || []).indexOf(s.openid) > -1);
    const subs = s.submissions[date] || (s.submissions[date] = []);
    const mine = subs.find(item => item.userId === s.openid);
    if (mine) {
      mine.dishIds = dishIds;
      mine.dishCount = dishIds.length;
      mine.meal = meal;
    } else {
      subs.push({
        _id: nextId('gs'),
        familyId: FAMILY_ID,
        date,
        userId: s.openid,
        userName: s.user.nickname || GUEST_NICKNAME,
        meal,
        dishIds,
        dishCount: dishIds.length,
        submittedAt: new Date().toISOString()
      });
    }
    return { date, meal, dishCount: dishIds.length };
  },

  'vote:todaySubmissions': (s, data) => buildSubmissions(s, data.date || util.today()),

  'vote:history': (s, data) => {
    const date = data.date || util.yesterday();
    const today = util.today();
    const hit = SEED_HISTORY.find(h => shiftDate(today, -h.offset) === date);
    if (!hit) return { date, groups: [] };
    // 历史是「只读快照」：直接按种子数据构造 groups，不落进 s.votes
    const groups = Object.keys(hit.votes)
      .map(dishId => {
        const dish = s.dishes.find(d => d._id === dishId) || {};
        return {
          dishId,
          dishName: dish.name || '已删除菜品',
          category: dish.category || '',
          imageUrl: dish.imageUrl || '',
          isHidden: !!dish.isHidden,
          decided: true,
          createdAt: dish.createdAt || '',
          voters: hit.votes[dishId].map(id => ({
            openid: id === ME ? s.openid : id,
            nickname: nickOf(s, id === ME ? s.openid : id),
            avatarUrl: avatarOf(s, id === ME ? s.openid : id),
            votedAt: date
          }))
        };
      })
      .sort((a, b) => b.voters.length - a.voters.length);
    return { date, groups };
  },

  'vote:recommend': s => {
    const today = util.today();
    const month = Number(today.split('-')[1]) || 1;
    const season = seasonOfMonth(month);
    const candidates = visibleDishes(s, false);

    // 取「今天还没点」的前 3 道作为推荐项；不够时用已点的补齐，保证卡片不空
    const votedIds = Object.keys(s.votes[today] || {});
    const unvoted = candidates.filter(d => votedIds.indexOf(d._id) < 0);
    const pool = unvoted.concat(candidates.filter(d => votedIds.indexOf(d._id) > -1));
    const items = pool.slice(0, 3).map((d, i) => ({
      dishId: d._id,
      name: d.name,
      category: d.category,
      imageUrl: d.imageUrl || '',
      reason: '',
      // 三类理由轮换，让三张卡片句式不重样（文案主体由 recommend-copy 生成）
      reasonType: ['frequent', 'seasonal', 'diverse'][i % 3],
      festivalId: '',
      days: (d.cookCount || 0) % 7,
      food: SEASON_FOODS[season][i % SEASON_FOODS[season].length] || '',
      seasonal: i === 1,
      voted: votedIds.indexOf(d._id) > -1
    }));

    return {
      today,
      ready: candidates.length > 0,
      items,
      todayDishIds: votedIds,
      notifyShortage: false,
      festival: null,
      weather: { city: '体验城市', weather: '晴', temperature: 22 },
      // 演示生日提醒条（BIRTHDAY-001）：明天是妈妈的生日
      birthday: {
        days: 1,
        date: shiftDate(today, 1),
        names: ['妈妈'],
        selfIncluded: false
      },
      season: {
        season,
        label: { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[season],
        term: '',
        foods: SEASON_FOODS[season].slice(),
        tip: SEASON_TIPS[season]
      },
      progress: {
        dishCount: candidates.length,
        historyDays: SEED_HISTORY.length,
        minDishes: 3,
        minHistoryDays: 2
      }
    };
  },

  // ---------- weather 云函数 ----------
  'weather:now': () => ({
    city: '体验城市',
    weather: '晴',
    temperature: 22,
    humidity: '55',
    windpower: '≤3'
  }),
  'weather:future': () => [
    { date: shiftDate(util.today(), 0), dayWeather: '晴', nightWeather: '多云', dayTemp: 24, nightTemp: 14 },
    { date: shiftDate(util.today(), 1), dayWeather: '多云', nightWeather: '阴', dayTemp: 22, nightTemp: 13 },
    { date: shiftDate(util.today(), 2), dayWeather: '小雨', nightWeather: '阴', dayTemp: 19, nightTemp: 12 }
  ]
};

/**
 * 游客模式下应答一次云函数调用。
 *
 * @param {string} name 云函数名
 * @param {object} data 调用参数（action / type 决定分支）
 * @returns {*} 应答体；返回 undefined 表示该 action 不在游客模式内（走真实链路）
 * @throws {{errorCode:string, message:string}} 体验模式不支持的操作
 */
function handle(name, data) {
  const payload = data || {};
  const action = payload.action || payload.type || '';
  const fn = handlers[name + ':' + action];
  if (typeof fn !== 'function') return undefined;
  return fn(ensure(), payload);
}

/**
 * 把「我」的身份登记进体验数据（真实登录成功后调用，保证投票人能对上号）。
 * @param {string} openid
 * @param {object} userInfo
 */
function setMe(openid, userInfo) {
  const s = ensure();
  const prev = s.openid;
  const next = openid || prev || FALLBACK_OPENID;
  if (next === prev) {
    if (userInfo) {
      s.user = { ...s.user, ...userInfo, _id: next, openid: next };
      const me = s.members.find(m => m.userId === next);
      if (me && userInfo.nickname) me.nickname = userInfo.nickname;
    }
    return s;
  }
  // openid 变了：把种子数据里旧的「我」迁移到新身份
  Object.keys(s.votes).forEach(date => {
    Object.keys(s.votes[date]).forEach(dishId => {
      s.votes[date][dishId] = s.votes[date][dishId].map(id => (id === prev ? next : id));
    });
  });
  (s.submissions[util.today()] || []).forEach(item => {
    if (item.userId === prev) item.userId = next;
  });
  const me = s.members.find(m => m.userId === prev);
  if (me) me.userId = next;
  s.openid = next;
  s.user = { ...s.user, ...(userInfo || {}), _id: next, openid: next };
  return s;
}

/** 当前体验家庭（含角色，供 app.js 写入 families） */
function family() {
  return clone(ensure().family);
}

/** 当前体验用户资料（供 app.js 写入 userInfo） */
function me() {
  const s = ensure();
  return clone(s.user);
}

/** 游客模式下「我」的角色：固定大厨，方便一次性看到全部功能 */
function role() {
  return 'chef';
}

module.exports = {
  FAMILY_ID,
  FALLBACK_OPENID,
  GUEST_NICKNAME,
  GUEST_FAMILY_NAME,
  GUEST_JOIN_CODE,
  GUEST_BLOCKED_CODE,
  handle,
  setMe,
  family,
  me,
  role,
  // 测试用：把体验数据恢复到初始状态
  __reset() {
    _state = null;
  }
};
