// miniprogram/utils/birthday.js - 生日展示与选项（BIRTHDAY-001）
//
// 职责：把「月 + 日」翻成给人看的字，并生成选择器选项。**纯函数，可直接 Node 单测。**
//
// ⚠️ 与云函数 cloudfunctions/shared/lunar.js 是**同一套名称约定**，两端必须一致：
//    这里只放「展示需要的名称」，不放农历换算表（换算只在云函数做，前端不需要）。
//    tests/unit/lunar.test.js 会断言两端名称数组完全相同——改一边必须改另一边。
//
// 存储结构（与云端一致）：{ calendar: 'solar' | 'lunar', month: 1-12, day: 1-31 }

const CALENDAR_SOLAR = 'solar';
const CALENDAR_LUNAR = 'lunar';

// 农历月份汉字：正月、二月…十月、冬月（十一月）、腊月（十二月）
const LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

// 农历日期汉字：初一…初十、十一…十九、二十、廿一…廿九、三十
const DAY_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const LUNAR_DAY_NAMES = (function buildDayNames() {
  const names = [];
  for (let d = 1; d <= 30; d++) {
    if (d <= 10) names.push('初' + DAY_DIGITS[d - 1]);
    else if (d < 20) names.push('十' + DAY_DIGITS[d - 11]);
    else if (d === 20) names.push('二十');
    else if (d < 30) names.push('廿' + DAY_DIGITS[d - 21]);
    else names.push('三十');
  }
  return names;
})();

/** 农历月选项（picker-view 用） */
const LUNAR_MONTH_OPTIONS = LUNAR_MONTH_NAMES.map((n, i) => ({
  value: i + 1,
  label: n + '月'
}));

/** 农历日选项（picker-view 用） */
const LUNAR_DAY_OPTIONS = LUNAR_DAY_NAMES.map((n, i) => ({
  value: i + 1,
  label: n
}));

/** 公历月份选项（自建选择器用；公历也可直接用 picker mode=date） */
const SOLAR_MONTH_OPTIONS = (function () {
  const out = [];
  for (let m = 1; m <= 12; m++) out.push({ value: m, label: m + '月' });
  return out;
})();

function isBirthday(b) {
  return !!b && (b.calendar === CALENDAR_SOLAR || b.calendar === CALENDAR_LUNAR) &&
    Number.isInteger(b.month) && Number.isInteger(b.day);
}

/** 农历月汉字，如 12 → 「腊月」 */
function lunarMonthName(month) {
  const n = LUNAR_MONTH_NAMES[month - 1];
  return n ? n + '月' : '';
}

/** 农历日汉字，如 29 → 「廿九」 */
function lunarDayName(day) {
  return LUNAR_DAY_NAMES[day - 1] || '';
}

/**
 * 生日的展示文本。
 *   公历 → 常规数字「8月15日」
 *   农历 → 传统汉字「腊月廿九」
 * @returns {string} 未设置返回空串
 */
function formatBirthday(b) {
  if (!isBirthday(b)) return '';
  if (b.calendar === CALENDAR_LUNAR) {
    return lunarMonthName(b.month) + lunarDayName(b.day);
  }
  return b.month + '月' + b.day + '日';
}

/** 生日的历法标签：「公历」/「农历」，未设置返回空串 */
function calendarLabel(b) {
  if (!isBirthday(b)) return '';
  return b.calendar === CALENDAR_LUNAR ? '农历' : '公历';
}

/**
 * 把昵称数组拼成一句话。**点名而不是说「N 位家人」**——「有 2 位家人过生日」
 * 看不出是谁，家人之间的祝福本来就要说出名字才有温度。
 * @param {string[]} names
 * @param {number} [max] 超过这个数量才退化成「等 N 位家人」
 */
function joinNames(names, max) {
  const list = (names || []).filter(n => typeof n === 'string' && n.trim());
  if (list.length === 0) return '家人';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + '和' + list[1];
  const cap = max || 2;
  if (list.length <= cap) return list.join('、');
  return list.slice(0, cap).join('、') + '等 ' + list.length + ' 位家人';
}

/**
 * 菜单页顶部提醒条文案（BIRTHDAY-001）。
 *
 * ⚠️ 两条硬约束：
 *   1. **不复述具体日期**（不写「9月29日」）——平台运营规范 5.12.6 不允许向其他用户
 *      显示出生日期，只说「今天 / 明天」不构成展示月日；
 *   2. **只认 0 和 1 两天**，其余一律返回空串 —— 即使上游误开了更早的预告，
 *      界面也不会把日期漏出去（上游 `BIRTHDAY_LOOKAHEAD_DAYS` 锁死为 1，有测试锁）。
 *
 * @param {number} days 0 = 今天，1 = 明天
 * @param {string[]} names 当天/次日的寿星昵称
 */
function formatNoticeText(days, names) {
  const who = joinNames(names, 2);
  if (days === 0) return '今天是' + who + '的生日，快来说声生日快乐';
  if (days === 1) return '明天是' + who + '的生日，要不要提前备道硬菜？';
  return '';
}

/**
 * 生日当天弹窗的内容（BIRTHDAY-003）。
 *
 * 设计要点：**寿星与家人看到的内容完全不同**。
 *   - 寿星：用第二人称「你」，给主角感与归属感，落款是品牌对他的祝福；
 *   - 家人：点名是谁，且给一个**当天就能做**的动作（点一道他爱吃的菜），
 *     落款是「替全家人说一句」，把祝福落到「全家」这个主语上。
 *
 * 只在当天（days === 0）出弹窗；提前一天只走顶部提醒条，不打扰。
 *
 * @param {{days:number, names:string[], selfIncluded:boolean}} info
 * @returns {{title:string, body:string, blessing:string}|null}
 */
function buildPopupContent(info) {
  if (!info || info.days !== 0) return null;
  const names = (info.names || []).filter(n => typeof n === 'string' && n.trim());
  const who = joinNames(names, 2);

  if (info.selfIncluded) {
    return {
      title: names.length > 1 ? '今天，你们是主角' : '今天，你是主角',
      body: '生日这天不用客气 —— 想吃什么就点什么，家里人都等着给你捧场。',
      blessing: '「筷点吃饭」祝你生日快乐：愿你顿顿有热饭，日日有笑声。'
    };
  }

  return {
    title: '今天是' + who + '的生日',
    body: '过生日得吃点像样的。点一道 TA 爱吃的菜，把心意先端上桌。',
    blessing: '「筷点吃饭」替全家人说一句：生日快乐，往后都是好日子。'
  };
}

module.exports = {
  CALENDAR_SOLAR,
  CALENDAR_LUNAR,
  LUNAR_MONTH_NAMES,
  LUNAR_DAY_NAMES,
  LUNAR_MONTH_OPTIONS,
  LUNAR_DAY_OPTIONS,
  SOLAR_MONTH_OPTIONS,
  isBirthday,
  lunarMonthName,
  lunarDayName,
  formatBirthday,
  calendarLabel,
  joinNames,
  formatNoticeText,
  buildPopupContent
};
