#!/usr/bin/env node
// 打印 app_config 集合中 privacy_agreement 文档的种子 JSON（PRIV-002）。
//
// 用途：隐私协议实时更新的初装/重置——把输出整体粘到
//   云开发控制台 → 数据库 → app_config → 添加/编辑文档
// （添加时 _id 一并写为 privacy_agreement，login.getAppConfig 按固定 _id 读取）。
// 内容与 miniprogram/utils/privacy-content.js 的 BUILTIN 完全一致，
// 此后想改协议直接在控制台改这份 JSON 并把 version +1（操作手册：
// docs/deployment/privacy-agreement.md §8）。
//
// 用法：node scripts/privacy-config.js [--check]
//   --check  校验内置内容可被 normalizePrivacyDoc 接受（CI/门禁外的人工自检）

const path = require('path');
const privacyContent = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'privacy-content.js'));

const doc = privacyContent.normalizePrivacyDoc(privacyContent.BUILTIN);
if (!doc) {
  console.error('[privacy-config] BUILTIN 内容未通过归一化校验，请检查 privacy-content.js');
  process.exit(1);
}

if (process.argv.includes('--check')) {
  console.log(`[privacy-config] BUILTIN 合法：version=${doc.version} effectiveDate=${doc.effectiveDate}`
    + ` sections=${doc.sections.length}`);
  process.exit(0);
}

console.log(JSON.stringify(doc, null, 2));
