// tests/unit/privacy-content.test.js - 隐私协议内容单源与云端实时更新契约（PRIV-002）
// 覆盖：BUILTIN 兜底内容合法性（含合规关键条目防误删）、normalizePrivacyDoc 严格校验、
//       日期格式化、本地缓存封装（wx 缺失/损坏缓存均不抛错）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const privacyContent = require('../../miniprogram/utils/privacy-content.js');

function makeValidDoc(overrides = {}) {
  return {
    version: 3,
    effectiveDate: '2026-10-01',
    title: '隐私协议',
    lead: ['第一段', ''],
    sections: [
      {
        heading: '一、测试',
        blocks: [
          { t: 'item', title: '小标题', paras: ['段落一', { strong: '加粗', text: '正文' }, '   '] },
          { t: 'para', paras: ['普通段'] },
          { t: 'note', text: '补充说明' },
          { t: 'item', paras: [{ strong: '', text: '无标题条目' }] }
        ]
      },
      { heading: '二、空节会被丢弃', blocks: [{ t: 'para', paras: ['  '] }] }
    ],
    footer: '页脚',
    ...overrides
  };
}

test('BUILTIN：可被 normalizePrivacyDoc 接受（发版兜底内容永远合法）', () => {
  const doc = privacyContent.normalizePrivacyDoc(privacyContent.BUILTIN);
  assert.ok(doc, 'BUILTIN 结构非法');
  assert.equal(doc.version, privacyContent.BUILTIN.version);
  assert.equal(doc.sections.length, privacyContent.BUILTIN.sections.length);
});

test('BUILTIN：合规关键内容不得随重构丢失（防误删锁）', () => {
  const doc = privacyContent.normalizePrivacyDoc(privacyContent.BUILTIN);
  const headings = doc.sections.map((s) => s.heading).join('\n');
  for (const key of ['我们收集哪些信息', '系统权限', '如何使用', '存储与保护', '不会做什么', '管理自己的信息', '未成年人', '协议的更新']) {
    assert.ok(headings.includes(key), `缺少章节：${key}`);
  }
  const allText = JSON.stringify(doc);
  // 2026-09-26 起的合规红线（docs/deployment/privacy-agreement.md §2.3）
  assert.ok(allText.includes('生日'), '缺少「生日」说明');
  assert.ok(allText.includes('网络地址（IP）'), '缺少「IP/大致城市」说明');
  assert.ok(allText.includes('不保存年份'), '缺少「不存年份」红线');
  assert.ok(allText.includes('撤回同意'), '缺少「撤回同意」指引');
  assert.ok(allText.includes('我们不进行数据出境'), '缺少「数据不出境」说明');
  // 运营规范 5.12.6 相关：不得出现具体出生日期的示例
  assert.ok(!/\d{1,2}\s*月\s*\d{1,2}\s*日生日/.test(allText), '协议文本不得含具体生日日期');
});

test('normalizePrivacyDoc：合法文档归一化（段落转对象、补 _k、丢弃空段）', () => {
  const doc = privacyContent.normalizePrivacyDoc(makeValidDoc());
  assert.ok(doc);
  assert.deepEqual(doc.lead.map((l) => l.text), ['第一段'], '空 lead 段应被丢弃');
  const blocks = doc.sections[0].blocks;
  // 第二节整节只剩空段 → 被整节丢弃
  assert.equal(doc.sections.length, 1);
  assert.deepEqual(blocks.map((b) => b.t), ['item', 'para', 'note', 'item'], '空段条目应被丢弃');
  assert.deepEqual(blocks[0].paras[1], { _k: 1, strong: '加粗', text: '正文' });
  assert.deepEqual(blocks[0].paras[0], { _k: 0, strong: '', text: '段落一' }, '字符串段落应转对象');
  assert.ok(!('title' in blocks[3]), '空标题不应输出');
  assert.ok(doc.sections.every((s) => typeof s._k === 'number'));
  assert.ok(blocks.every((b) => typeof b._k === 'number'));
});

test('normalizePrivacyDoc：结构性非法一律返回 null（fail closed 回退内置）', () => {
  const invalids = [
    null,
    'x',
    42,
    [],
    makeValidDoc({ version: 0 }),
    makeValidDoc({ version: 2.5 }),
    makeValidDoc({ version: '3' }),
    makeValidDoc({ effectiveDate: '2026/10/01' }),
    makeValidDoc({ effectiveDate: '2026-10-1' }),
    makeValidDoc({ effectiveDate: '' }),
    makeValidDoc({ title: '   ' }),
    makeValidDoc({ lead: 'x' }),
    makeValidDoc({ sections: [] }),
    makeValidDoc({ sections: 'x' }),
    makeValidDoc({ sections: [{ heading: 'h' }] }), // 缺 blocks
    makeValidDoc({ sections: [{ blocks: [{ t: 'para', paras: ['x'] }] }] }), // 缺 heading
    makeValidDoc({ sections: [{ heading: 'h', blocks: [{ t: 'unknown', paras: ['x'] }] }] }),
    makeValidDoc({ sections: [{ heading: 'h', blocks: [{ t: 'item', title: 't' }] }] }), // 缺 paras
    makeValidDoc({ sections: [{ heading: 'h', blocks: [{ t: 'note' }] }] }), // note 缺 text
    makeValidDoc({ sections: [{ heading: 'h', blocks: [{ t: 'para', paras: ['  '] }] }] }), // 全空段
    makeValidDoc({ sections: [{ heading: 'h', blocks: [{ t: 'para', paras: [42] }] }] }),
    makeValidDoc({ sections: [{ heading: 'h', blocks: [{ t: 'para', paras: [{ text: '  ' }] }] }] }),
    makeValidDoc({ sections: [{ heading: 'h', blocks: [{ t: 'para', paras: [{ strong: '只有前缀' }] }] }] })
  ];
  for (const bad of invalids) {
    assert.equal(privacyContent.normalizePrivacyDoc(bad), null, `应拒绝：${JSON.stringify(bad)}`);
  }
});

test('normalizePrivacyDoc：normalize(normalize(x)) 幂等（渲染模型可回炉重校验）', () => {
  const once = privacyContent.normalizePrivacyDoc(makeValidDoc());
  const twice = privacyContent.normalizePrivacyDoc(once);
  assert.deepEqual(twice, once);
});

test('formatEffectiveDate：YYYY-MM-DD 转中文展示，去前导零；非法原样返回', () => {
  assert.equal(privacyContent.formatEffectiveDate('2026-09-30'), '2026 年 9 月 30 日');
  assert.equal(privacyContent.formatEffectiveDate('2026-12-05'), '2026 年 12 月 5 日');
  assert.equal(privacyContent.formatEffectiveDate(''), '');
  assert.equal(privacyContent.formatEffectiveDate('garbage'), 'garbage');
  assert.equal(privacyContent.formatEffectiveDate(null), '');
});

test('saveCache/loadCache：wx 存在时读写回环，损坏缓存返回 null 而不是抛错', () => {
  const store = new Map();
  global.wx = {
    setStorageSync: (k, v) => store.set(k, v),
    getStorageSync: (k) => (store.has(k) ? store.get(k) : '')
  };
  try {
    assert.equal(privacyContent.loadCache(), null, '无缓存时返回 null');
    const doc = privacyContent.normalizePrivacyDoc(privacyContent.BUILTIN);
    privacyContent.saveCache(doc);
    assert.deepEqual(privacyContent.loadCache(), doc);

    store.set('privacyContentCache', { broken: true });
    assert.equal(privacyContent.loadCache(), null, '损坏缓存应被拒绝');
    store.set('privacyContentCache', 'not-an-object');
    assert.equal(privacyContent.loadCache(), null, '非对象缓存应被拒绝');
  } finally {
    delete global.wx;
  }
});

test('saveCache/loadCache：wx 缺失（Node 环境）不抛错', () => {
  assert.equal(privacyContent.loadCache(), null);
  assert.doesNotThrow(() => privacyContent.saveCache({ version: 1 }));
});

test('saveCache/loadCache：wx 抛异常时不向上传播', () => {
  global.wx = {
    setStorageSync: () => { throw new Error('storage full'); },
    getStorageSync: () => { throw new Error('storage broken'); }
  };
  try {
    assert.equal(privacyContent.loadCache(), null);
    assert.doesNotThrow(() => privacyContent.saveCache({ version: 1 }));
  } finally {
    delete global.wx;
  }
});
