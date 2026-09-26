#!/usr/bin/env node
// scripts/lint.js - 项目级静态检查（零依赖）
// 1. 所有 JSON 文件可解析
// 2. 云函数源码禁止硬编码内部密钥/占位模板 ID/浮动依赖版本
// 3. 云函数依赖必须固定版本
// 4. shared 模块必须与 cloudfunctions/shared/ 严格同步（不得缺失/多余/不一致）
// 5. 小程序侧禁止引用不存在的本地资源路径
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

// ---------- 4. shared 模块必须与权威源严格同步（SHARED-SYNC-001） ----------
// 背景：cloudfunctions/shared/*.js 是权威源，各函数内的 shared/ 是逐文件拷贝，
// 函数统一用相对路径 require('./shared/xxx')。改了源却忘了同步 → 云端
// `Cannot find module './shared/...'` 或跑旧代码（踩过：7 个白盒测试因 names undefined 全崩）。
// scripts/uploadCloudFunction.sh 的实际行为是「rm -rf shared → 只拷 *.js」，
// 所以各函数 shared/ 里**不该存在任何非 .js 文件**（比如误拷进去的 package.json）。
const SHARED_SRC = path.join(fnDir, 'shared');
const FN_NAMES = fs.readdirSync(fnDir, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== 'shared')
  .map(e => e.name);

/** 归一化行尾后再比较，避免 git autocrlf 造成假失败 */
function readNorm(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

if (fs.existsSync(SHARED_SRC)) {
  const srcJs = fs.readdirSync(SHARED_SRC).filter(f => f.endsWith('.js')).sort();

  for (const fn of FN_NAMES) {
    const fnShared = path.join(fnDir, fn, 'shared');
    // 函数是否真的引用了 shared（未引用就不强制，例如 weather）
    const fnJs = fs.existsSync(path.join(fnDir, fn))
      ? fs.readdirSync(path.join(fnDir, fn)).filter(f => f.endsWith('.js'))
      : [];
    const usesShared = fnJs.some(f =>
      /require\(\s*['"]\.\/shared\//.test(fs.readFileSync(path.join(fnDir, fn, f), 'utf8')));

    if (!fs.existsSync(fnShared)) {
      if (usesShared) errors.push(`cloudfunctions/${fn}/shared: 目录缺失（代码引用了 ./shared/，请先同步）`);
      continue;
    }

    const have = fs.readdirSync(fnShared).sort();

    // (a) 缺失的源文件
    for (const f of srcJs) {
      if (!have.includes(f)) {
        errors.push(`cloudfunctions/${fn}/shared/${f}: 缺失（未从 cloudfunctions/shared/ 同步）`);
      }
    }
    // (b) 多余文件（含误拷的 package.json —— 部署脚本只拷 *.js）
    for (const f of have) {
      if (!srcJs.includes(f)) {
        errors.push(`cloudfunctions/${fn}/shared/${f}: 多余文件（部署脚本只拷 *.js，不应存在于此）`);
      }
    }
    // (c) 内容不一致
    for (const f of srcJs) {
      const a = path.join(SHARED_SRC, f);
      const b = path.join(fnShared, f);
      if (fs.existsSync(b) && readNorm(a) !== readNorm(b)) {
        errors.push(`cloudfunctions/${fn}/shared/${f}: 内容与 cloudfunctions/shared/${f} 不一致`);
      }
    }
  }
}

// ---------- 5. 小程序侧不引用不存在的本地资源（ASSET-001） ----------
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
