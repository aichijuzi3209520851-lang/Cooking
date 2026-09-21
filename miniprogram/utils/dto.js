// utils/dto.js - 云函数返回 DTO → 页面展示数据的转换层（纯函数，可单测）
// 契约约定：
//   - vote.todayList 返回 { date, groups[] }，group 字段：dishId/dishName/category/imageUrl/isHidden/voters[]
//   - voter 字段：openid/nickname/avatarUrl/votedAt
//   - 展示层统一使用 dishId 作为业务 ID，禁止页面再猜测 _id / list / Array.isArray 等格式
// 分类名/图标统一走 utils/category.js（家庭可自定义分类，不能再用静态 map）。

const category = require('./category.js');

/**
 * 获取分类 emoji（家庭自定义分类由 category.js 缓存解析，未知分类回退默认）
 */
function emojiOf(categoryKey) {
  return category.emojiOf(categoryKey);
}

/**
 * 把 createdAt 归一化为毫秒时间戳，用于跨端比较排序。
 * 云函数返回的 Date 经 wx.cloud.callFunction 序列化后可能是
 * Date / ISO 字符串 / 时间戳 / { $date } 等多种形态，统一兜底；解析失败返回 0。
 */
function toMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === 'object' && value.$date) {
    const t = Date.parse(value.$date);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/**
 * 归一化 vote.todayList 返回值，始终返回 { date, groups[], submitCount }
 * submitCount = 今日已提交菜单的人数，供厨师端「有新提交」角标使用
 * （NOTIFY-003：点菜不再逐条推送，角标是主要的应用内提示渠道）
 */
function normalizeTodayList(voteData) {
  if (!voteData || typeof voteData !== 'object') {
    return { date: '', groups: [], submitCount: 0 };
  }
  return {
    date: typeof voteData.date === 'string' ? voteData.date : '',
    groups: Array.isArray(voteData.groups) ? voteData.groups : [],
    submitCount: typeof voteData.submitCount === 'number' ? voteData.submitCount : 0
  };
}

/**
 * 归一化单个投票分组，缺失字段补默认值，过滤非法 voter
 */
function normalizeGroup(group) {
  const g = group && typeof group === 'object' ? group : {};
  return {
    dishId: typeof g.dishId === 'string' ? g.dishId : '',
    dishName: typeof g.dishName === 'string' ? g.dishName : '',
    category: typeof g.category === 'string' ? g.category : '',
    imageUrl: typeof g.imageUrl === 'string' ? g.imageUrl : '',
    isHidden: !!g.isHidden,
    decided: !!g.decided,
    createdAt: g.createdAt || '',
    voters: Array.isArray(g.voters)
      ? g.voters.filter(v => v && typeof v.openid === 'string')
      : []
  };
}

/**
 * 归一化菜品库条目：统一把 _id 映射为 dishId
 */
function normalizeDish(dish) {
  const d = dish && typeof dish === 'object' ? dish : {};
  const dishId = typeof d._id === 'string' ? d._id : (typeof d.dishId === 'string' ? d.dishId : '');
  return {
    dishId,
    name: typeof d.name === 'string' ? d.name : '',
    category: typeof d.category === 'string' ? d.category : '',
    imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : '',
    isHidden: !!d.isHidden,
    cookCount: typeof d.cookCount === 'number' ? d.cookCount : 0,
    createdAt: d.createdAt || ''
  };
}

/**
 * 菜单页数据合并：
 * 菜品库列表 + 今日投票 groups，按 dishId 关联，
 * 有投票但不在菜品库的 group（隐藏/已删除菜品）追加在末尾，
 * 排序：票数降序，同票按菜品 createdAt 降序（新菜靠前），再以 dishId 兜底保证顺序确定。
 * 返回展示数组，每项含 dishId/name/category/imageUrl/isHidden/cookCount/createdAt/categoryEmoji/voters
 */
function buildMenuList(dishList, groups, category = '') {
  const groupMap = {};
  groups.forEach(g => {
    const norm = normalizeGroup(g);
    if (norm.dishId) groupMap[norm.dishId] = norm;
  });

  const list = (dishList || []).map(raw => {
    const d = normalizeDish(raw);
    const g = groupMap[d.dishId];
    return {
      ...d,
      categoryEmoji: emojiOf(d.category),
      voters: g ? g.voters : []
    };
  });

  groups.forEach(g => {
    const norm = normalizeGroup(g);
    if (!norm.dishId) return;
    if (category && norm.category !== category) return;
    if (!list.some(item => item.dishId === norm.dishId)) {
      list.push({
        dishId: norm.dishId,
        name: norm.dishName || '已删除菜品',
        category: norm.category,
        imageUrl: norm.imageUrl,
        isHidden: norm.isHidden,
        cookCount: 0,
        createdAt: norm.createdAt,
        categoryEmoji: emojiOf(norm.category),
        voters: norm.voters
      });
    }
  });

  sortByVotes(list);
  return list;
}

/**
 * 汇总页数据：groups → 展示数组（过滤无投票项，按票数降序）
 * 每项含 dishId/name/category/imageUrl/categoryEmoji/isHidden/voters/voterCount
 */
function buildSummaryList(groups) {
  const list = groups.map(g => {
    const norm = normalizeGroup(g);
    return {
      dishId: norm.dishId,
      name: norm.dishName || '已删除菜品',
      category: norm.category,
      imageUrl: norm.imageUrl,
      categoryEmoji: emojiOf(norm.category),
      isHidden: norm.isHidden,
      decided: norm.decided,
      createdAt: norm.createdAt,
      voters: norm.voters.map(v => ({
        openid: v.openid,
        nickname: (typeof v.nickname === 'string' && v.nickname) ? v.nickname : '微信用户',
        avatarUrl: typeof v.avatarUrl === 'string' ? v.avatarUrl : '',
        votedAt: v.votedAt
      })),
      voterCount: 0
    };
  }).filter(item => item.voters.length > 0);

  list.forEach(item => {
    item.voterCount = item.voters.length;
  });
  sortByVotes(list);
  return list;
}

/**
 * 统计：已点菜数（有票的菜）与参与人数
 */
function calcVoteStats(list) {
  const voterSet = {};
  list.forEach(item => {
    (item.voters || []).forEach(v => {
      if (v && v.openid) voterSet[v.openid] = true;
    });
  });
  return {
    dishCount: (list || []).filter(item => (item.voters || []).length > 0).length,
    voterCount: Object.keys(voterSet).length
  };
}

// 票数降序 → 同票按菜品创建时间降序（新菜靠前） → 再按 dishId 兜底，保证顺序完全确定
//
// 说明：不再用 cookCount 做同票次级排序。cookCount 是「历史累计被点次数」，
// 取消/撤菜/隐藏均不扣减，用它排序会让「被误点又取消」的菜长期占前排，语义错配。
// cookCount 现降为独立展示指标（菜品库列表页「已被点 N 次」）。
function sortByVotes(list) {
  list.sort((a, b) => {
    const va = (a.voters || []).length;
    const vb = (b.voters || []).length;
    if (vb !== va) return vb - va;
    const ta = toMs(a.createdAt);
    const tb = toMs(b.createdAt);
    if (tb !== ta) return tb - ta;
    return String(a.dishId || '').localeCompare(String(b.dishId || ''));
  });
}

/**
 * 保持现有展示顺序合并两次加载结果（防止投票/实时刷新导致卡片跳位）：
 * 旧列表中的项按原顺序保留（内容更新为最新），已消失的项移除，新出现的项追加在末尾。
 */
function mergePreservingOrder(prevList, newList) {
  const newMap = {};
  (newList || []).forEach(d => {
    if (d && d.dishId) newMap[d.dishId] = d;
  });
  const ordered = [];
  (prevList || []).forEach(old => {
    if (old && old.dishId && newMap[old.dishId]) {
      ordered.push(newMap[old.dishId]);
      delete newMap[old.dishId];
    }
  });
  Object.keys(newMap).forEach(id => ordered.push(newMap[id]));
  return ordered;
}

module.exports = {
  emojiOf,
  toMs,
  normalizeTodayList,
  normalizeGroup,
  normalizeDish,
  buildMenuList,
  buildSummaryList,
  calcVoteStats,
  sortByVotes,
  mergePreservingOrder
};
