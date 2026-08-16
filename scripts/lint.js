#!/usr/bin/env node
// scripts/lint.js - 项目级静态检查（零依赖）
// 1. 所有 JSON 文件可解析
// 2. 云函数源码禁止硬编码内部密钥/占位模板 ID/浮动依赖版本
// 3. 小程序侧禁止引用不存在的本地资源路径
// 用法：npm run lint
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const SKIP_DIRS = ['node_modules', '.git', '.ui-check'];

// ---------- 1. JSON 可解析 ----------
function collectJson(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJson(full));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}
for (const file of collectJson(ROOT)) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${path.relative(ROOT, file)}: JSON 解析失败 ${e.message}`);
  }
}

// ---------- 2. 云函数安全规范 ----------
const FORBIDDEN_PATTERNS = [
  // 内部密钥硬编码（SEC-002）
  { pattern: /family-dining-internal-2026/, file: /cloudfunctions\//, msg: '禁止硬编码内部密钥' },
  // 占位模板 ID（NOTIFY-001）
  { pattern: /TEMPLATE_ID_PLACEHOLDER/, file: /cloudfunctions\//, msg: '禁止占位模板 ID 写入业务代码' }
];

function collectJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

for (const file of collectJs(path.join(ROOT, 'cloudfunctions'))) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.pattern.test(content)) {
      errors.push(`${rel}: ${rule.msg}（命中：${rule.pattern}）`);
    }
  }
}

// ---------- 3. 云函数依赖必须固定版本（ENG-001） ----------
const fnDir = path.join(ROOT, 'cloudfunctions');
for (const entry of fs.readdirSync(fnDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgPath = path.join(fnDir, entry.name, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    for (const [dep, version] of Object.entries(pkg.dependencies || {})) {
      if (/[~^><*]/.test(version)) {
        errors.push(`cloudfunctions/${entry.name}/package.json: ${dep} 依赖版本 ${version} 不是固定版本，请使用精确版本`);
      }
    }
  } catch (e) {
    errors.push(`cloudfunctions/${entry.name}/package.json: 解析失败`);
  }
}

// ---------- 4. 小程序侧不引用不存在的本地资源（ASSET-001） ----------
function collectFiles(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}
const wxssContent = collectFiles(path.join(ROOT, 'miniprogram'), '.wxss')
  .map(f => fs.readFileSync(f, 'utf8'))
  .join('\n');
// 检查 CSS url() 引用本地资源是否存在
for (const m of wxssContent.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
  const url = m[2];
  if (/^(https?:)?\/\//.test(url) || /^data:/.test(url)) continue;
  const localPath = path.join(ROOT, 'miniprogram', url.replace(/^\//, ''));
  if (!fs.existsSync(localPath)) {
    errors.push(`app.wxss: 引用了不存在的本地资源 ${url}`);
  }
}

if (errors.length > 0) {
  console.error('Lint 未通过：');
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}
console.log('Lint 通过：JSON 合法、无硬编码密钥/占位模板、依赖版本固定、资源引用有效');
