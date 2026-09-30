// utils/privacy-content.js — 《隐私协议》内容单源 + 云端实时更新（PRIV-002）
//
// 背景：协议页此前整页硬编码在 WXML 里，改一个字都要重新发版。
// 现在内容改为「云端 app_config 集合下发 + 本文件内置兜底」：
//   1. BUILTIN 是随代码发布的兜底快照——云端未配置/结构非法/网络失败时用它渲染，
//      协议页永远不会开天窗；
//   2. 云端文档（app_config 集合，_id = privacy_agreement）是**运行期的唯一事实源**，
//      在云开发控制台改文档即全网实时生效，无需发版（操作手册见
//      docs/deployment/privacy-agreement.md §8）；
//   3. normalizePrivacyDoc 对云端数据做**严格校验**，任何字段不合结构一律返回 null
//      （fail closed 回退内置文本），绝不把半截 JSON 渲染给用户；
//   4. 拉取成功后写入本地缓存，下次进入先用缓存渲染再静默刷新，避免闪变。
//
// 本文件保持纯函数、顶层不触碰 wx（存储封装内部再判），可直接 Node 单测
// （tests/unit/privacy-content.test.js）。

// 渲染所需的数据结构（JSON 可序列化，控制台可直接编辑）：
//   {
//     version: 2,                          // 每次在控制台更新时 +1（诊断/缓存用）
//     effectiveDate: '2026-09-30',         // 展示为「更新日期」，必须是 YYYY-MM-DD
//     title: '隐私协议',
//     lead: ['段落1', '段落2'],             // 头卡片引言段
//     sections: [{
//       heading: '一、我们收集哪些信息',
//       blocks: [
//         { t: 'item', title: '小标题', paras: ['段落' | { strong: '加粗前缀', text: '正文' }] },
//         { t: 'para', paras: ['段落' | { strong, text }] },   // 无小标题的普通段
//         { t: 'note', text: '灰底补充说明' }
//       ]
//     }],
//     footer: '页脚'
//   }
const BUILTIN = {
  version: 2,
  effectiveDate: '2026-09-30',
  title: '隐私协议',
  lead: [
    '「筷点吃饭」是一款家庭内部使用的点菜工具。我们深知个人信息对你很重要，因此只收集让这个家能正常点菜所必需的最少信息。',
    '本协议与你在微信中看到的《小程序用户隐私保护指引》内容一致；后者由我们在微信公众平台配置并同步，具有同等效力。'
  ],
  sections: [
    {
      heading: '一、我们收集哪些信息',
      blocks: [
        {
          t: 'item',
          title: '微信身份标识（openid）',
          paras: [
            '你打开小程序时由微信自动提供，用于识别你的身份、把你和你的家庭关联起来。它不包含你的手机号、微信号或真实姓名。'
          ]
        },
        {
          t: 'item',
          title: '微信头像与昵称',
          paras: [
            '仅在你主动点击头像或填写昵称时获取，用于让家人认出「这道菜是谁点的」。不填也不影响点菜，我们会用昵称首字和颜色生成一个默认头像。'
          ]
        },
        {
          t: 'item',
          title: '生日（仅月与日）',
          paras: [
            '仅在你主动前往「我的 → 生日」设置时获取，你可以选择按公历或农历填写。',
            {
              strong: '我们只保存「月」和「日」，不保存年份',
              text: '，因此无法据此推算你的年龄，也不做任何生日营销。'
            },
            {
              strong: '用途与可见范围',
              text: '：我们只在你的生日「前一天」于家庭菜单页提示一句、生日「当天」显示一句祝福，不做更早的预告；若家人此前开启过订阅通知，他们还会在当天收到一条同样内容的推送。其余任何时间，你的生日都不会出现在家人可见的界面里，我们也不会告知具体日期。'
            },
            {
              strong: '是否展示给家人，需要你明确同意',
              text: '：保存生日时我们会单独征求你的同意。若你选择「仅自己可见」或事后关闭该开关，家人不会看到、也不会收到与你的生日有关的任何提示；你仍能在「我的」页看到自己的生日。你也可以随时清除生日。'
            }
          ]
        },
        {
          t: 'item',
          title: '菜品图片',
          paras: [
            '由你主动拍照或从相册选择上传，仅用于家庭菜谱展示。不上传时会使用分类占位插画。'
          ]
        },
        {
          t: 'item',
          title: '家庭加入码（来自剪贴板）',
          paras: [
            '仅当你主动点击「粘贴」时，我们才读取剪贴板内容，用于快速填入家人分享的家庭加入码。我们不会在后台持续读取剪贴板，也不会保存你复制的其他内容。'
          ]
        },
        {
          t: 'item',
          title: '网络地址（IP）与大致城市',
          paras: [
            '你能在小程序里看到「今天天气」，是因为服务器会根据本次请求的网络地址（IP）判断一个大致城市，再取该城市的天气。这一步不需要你授权定位，也拿不到街道级位置。',
            {
              strong: 'IP 地址本身不会被我们保存',
              text: '，它仅用于当次换算出城市，服务于推荐区的天气展示与「雨天喝热汤」这类应季推荐。若不希望使用该功能，忽略天气提示即可，其余功能不受影响。'
            }
          ]
        }
      ]
    },
    {
      heading: '二、我们会申请哪些系统权限',
      blocks: [
        {
          t: 'para',
          paras: [
            '以下权限均由你主动触发，我们不会在后台静默调用；你可以随时在系统设置中关闭，关闭后对应功能将不可用。'
          ]
        },
        {
          t: 'para',
          paras: [{ strong: '· 相册 / 摄像头', text: '：在你上传菜品图片时申请，仅用于选取或拍摄这一张图。' }]
        },
        {
          t: 'para',
          paras: [{ strong: '· 剪贴板', text: '：在你点击「粘贴家庭加入码」时申请，仅读取一次。' }]
        },
        {
          t: 'para',
          paras: [{
            strong: '· 头像昵称填写能力',
            text: '：在你点击头像或昵称时申请，由微信提供，我们不接触你的微信密码等任何其他信息。'
          }]
        },
        {
          t: 'para',
          paras: [{
            strong: '我们不会申请定位权限',
            text: '。天气所依据的城市来自服务器对网络地址的粗略判断，不会调用微信的定位接口，因此不会弹出定位授权框；相应地，天气城市可能与你所在位置存在偏差，属正常现象。'
          }]
        },
        {
          t: 'note',
          text: '说明：上述能力属于微信定义的隐私接口。若你未阅读并同意隐私协议，微信会拦截这些接口，对应功能（上传菜品图、粘贴加入码、设置头像）将暂时不可用。'
        }
      ]
    },
    {
      heading: '三、我们如何使用这些信息',
      blocks: [
        {
          t: 'para',
          paras: [
            '上述信息只服务于一个目的：让你和家人能在同一个家里点菜、看到彼此点了什么，并在节日、生日与天气变化时给出应季提示。'
          ]
        },
        {
          t: 'para',
          paras: [
            '数据存放在微信云开发（腾讯云）的数据库中，只有同一个家庭的成员可以看到本家庭内的头像、昵称、生日和菜品图片。其他人无法访问。'
          ]
        },
        {
          t: 'para',
          paras: [
            '推荐区的顶部一句话可能由 AI 模型辅助生成。生成时只发送当季节气、时令食材与家中常点的菜品名称，不会发送你的 openid、昵称、头像或手机号。'
          ]
        }
      ]
    },
    {
      heading: '四、信息的存储与保护',
      blocks: [
        {
          t: 'para',
          paras: [
            '数据存储于微信云开发（腾讯云）境内节点，传输与存储均通过云平台的安全机制保护。'
          ]
        },
        {
          t: 'para',
          paras: [{
            strong: '存储期限',
            text: '：账号信息与家庭数据在你使用期间持续保留；当你退出家庭、删除菜品或家庭解散时，对应数据会被同步删除，我们不做额外留存。'
          }]
        },
        {
          t: 'para',
          paras: [{
            strong: '第三方共享',
            text: '：我们不会向任何第三方出售或共享你的个人信息。仅为实现下述具体功能，我们会借助以下服务提供方处理必要的最少信息：'
          }]
        },
        {
          t: 'para',
          paras: [{
            strong: '· 微信云开发（腾讯云）',
            text: '：承载数据存储与云函数运行，本小程序的全部业务数据都存放于此。'
          }]
        },
        {
          t: 'para',
          paras: [{
            strong: '· 腾讯位置服务',
            text: '：在你浏览推荐区时，用当次请求的网络地址换取一个大致城市与当地天气。仅传递网络地址，不含任何身份标识。'
          }]
        },
        {
          t: 'para',
          paras: [{
            strong: '· AI 模型服务（腾讯云）',
            text: '：用于生成一句应季推荐语。仅传递节气、时令食材与常点菜品名称，不含身份标识。'
          }]
        },
        {
          t: 'para',
          paras: [{
            strong: '· 微信内容安全接口',
            text: '：当你提交昵称、头像、菜名或家庭名称时，我们会上送这些内容做合规校验，用于拦截违规信息。这是微信平台对含用户生成内容的小程序的强制要求。'
          }]
        },
        {
          t: 'note',
          text: '上述服务均在中华人民共和国境内处理数据，我们不进行数据出境。'
        }
      ]
    },
    {
      heading: '五、我们不会做什么',
      blocks: [
        { t: 'para', paras: ['· 不调用微信定位接口获取你的精确地理位置（天气只用网络地址粗略判断城市，见第一节）'] },
        { t: 'para', paras: ['· 不收集手机号、身份证号等任何证件信息，也不获取通讯录、相册全部内容或聊天记录'] },
        { t: 'para', paras: ['· 不保存你的生日年份，不据此推算年龄'] },
        { t: 'para', paras: ['· 不用于广告投放或用户画像'] },
        { t: 'para', paras: ['· 本小程序不含支付功能，不会收集任何支付信息'] }
      ]
    },
    {
      heading: '六、你可以随时管理自己的信息',
      blocks: [
        { t: 'para', paras: ['· 在「我的」页轻触头像或昵称，可随时更换或删除'] },
        { t: 'para', paras: ['· 在「我的 → 生日」可随时修改或清除生日；清除后不再收到生日祝福'] },
        { t: 'para', paras: ['· 在「我的 → 生日」可关闭「在家人生日提醒中展示」，关闭后家人看不到你的生日、也收不到相关推送，你自己仍能看到'] },
        { t: 'para', paras: ['· 在「我的 → 家庭管理」可退出当前家庭，退出后你在本家庭的点菜记录会一并清理'] },
        { t: 'para', paras: ['· 当家庭最后一名成员退出时，该家庭及其全部数据（含菜品图片）会被自动删除'] },
        {
          t: 'para',
          paras: [{
            strong: '· 撤回同意',
            text: '：你可在微信中删除本小程序（微信下拉 → 最近 → 最近使用的小程序中移除），这将同时清空你的隐私协议授权状态；再次使用时可重新选择是否同意。你也可以在小程序的授权弹窗中选择「暂不使用」'
          }]
        }
      ]
    },
    {
      heading: '七、关于未成年人',
      blocks: [
        {
          t: 'para',
          paras: [
            '本小程序面向家庭日常使用。若你是未成年人，建议在家人陪同下阅读本协议并使用；生日等个人信息请在家人的指导下填写。'
          ]
        }
      ]
    },
    {
      heading: '八、协议的更新',
      blocks: [
        {
          t: 'para',
          paras: [
            '如果我们调整了信息收集方式，会更新本协议并修改顶部日期。若涉及新增收集的信息类型，我们会重新征得你的同意后再使用。'
          ]
        },
        {
          t: 'para',
          paras: [
            '本协议的最新内容实时托管在云端：我们更新协议后，你重新打开本页即可看到最新版本，无需等待小程序发版。'
          ]
        },
        {
          t: 'para',
          paras: [
            '本次更新（2026 年 9 月 26 日）新增说明了「生日（仅月与日）」与「网络地址（IP）与大致城市」两项，并补充了第三方服务提供方的共享说明。'
          ]
        }
      ]
    }
  ],
  footer: '如对本协议有疑问，或需要查询、更正、删除你的个人信息，可通过小程序「我的 → 关于」中的信息与我们联系。'
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_KEY = 'privacyContentCache';

function isPlainObject(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}

/**
 * 段落归一化：字符串 → { strong:'', text }；对象 → 只取 strong/text。
 * 返回 null 表示该段落非法（整个文档将回退内置文本，而不是渲染半截内容）。
 */
function normalizePara(p) {
  if (typeof p === 'string') {
    const text = p.trim();
    return text ? { strong: '', text } : null;
  }
  if (!isPlainObject(p)) return null;
  const strong = typeof p.strong === 'string' ? p.strong.trim() : '';
  const text = typeof p.text === 'string' ? p.text.trim() : '';
  if (!text) return null;
  return { strong, text };
}

/**
 * 归一化一个协议文档。严格校验，任何结构性问题返回 null（fail closed）。
 * 成功时输出可直接 setData 的渲染模型：所有列表项补上 _k 供 wx:key 使用，
 * 段落统一为 { strong, text } 对象。
 */
function normalizePrivacyDoc(raw) {
  if (!isPlainObject(raw)) return null;
  if (!Number.isInteger(raw.version) || raw.version < 1) return null;
  if (typeof raw.effectiveDate !== 'string' || !DATE_RE.test(raw.effectiveDate)) return null;
  if (typeof raw.title !== 'string' || !raw.title.trim()) return null;
  if (!Array.isArray(raw.lead) || !Array.isArray(raw.sections) || raw.sections.length === 0) return null;

  const lead = [];
  raw.lead.forEach((p) => {
    const n = normalizePara(p);
    if (n) lead.push({ _k: lead.length, text: n.text });
  });

  const sections = [];
  raw.sections.forEach((s) => {
    if (!isPlainObject(s)) return;
    if (typeof s.heading !== 'string' || !s.heading.trim()) return;
    if (!Array.isArray(s.blocks) || s.blocks.length === 0) return;

    const blocks = [];
    s.blocks.forEach((b) => {
      if (!isPlainObject(b)) return;
      if (b.t === 'note') {
        const text = typeof b.text === 'string' ? b.text.trim() : '';
        if (!text) return;
        blocks.push({ _k: blocks.length, t: 'note', text });
        return;
      }
      if (b.t !== 'item' && b.t !== 'para') return;
      if (!Array.isArray(b.paras) || b.paras.length === 0) return;

      const paras = [];
      b.paras.forEach((p) => {
        const n = normalizePara(p);
        if (n) paras.push({ _k: paras.length, strong: n.strong, text: n.text });
      });
      if (paras.length === 0) return;

      const block = { _k: blocks.length, t: b.t, paras };
      const title = typeof b.title === 'string' ? b.title.trim() : '';
      if (b.t === 'item' && title) block.title = title;
      blocks.push(block);
    });
    if (blocks.length === 0) return;

    sections.push({ _k: sections.length, heading: s.heading.trim(), blocks });
  });
  if (sections.length === 0) return null;

  return {
    version: raw.version,
    effectiveDate: raw.effectiveDate,
    title: raw.title.trim(),
    lead,
    sections,
    footer: typeof raw.footer === 'string' ? raw.footer.trim() : ''
  };
}

/**
 * '2026-09-30' → '2026 年 9 月 30 日'；非法输入原样返回（不抛错）。
 */
function formatEffectiveDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return date || '';
  const parts = date.split('-');
  return `${parts[0]} 年 ${parseInt(parts[1], 10)} 月 ${parseInt(parts[2], 10)} 日`;
}

/** 拉取成功后缓存归一化文档（失败静默：缓存不可用只是多一次闪变，不影响功能） */
function saveCache(doc) {
  try {
    if (typeof wx === 'undefined' || !wx.setStorageSync) return;
    wx.setStorageSync(CACHE_KEY, doc);
  } catch (e) {
    // 存储失败可接受
  }
}

/**
 * 读取本地缓存。取出后重新走一遍归一化：
 * 缓存可能来自旧版本代码/被篡改/损坏，绝不能因为「是自己写的缓存」就跳过校验。
 */
function loadCache() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return null;
    return normalizePrivacyDoc(wx.getStorageSync(CACHE_KEY));
  } catch (e) {
    return null;
  }
}

module.exports = {
  BUILTIN,
  normalizePrivacyDoc,
  formatEffectiveDate,
  saveCache,
  loadCache
};
