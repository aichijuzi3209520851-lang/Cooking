#!/usr/bin/env node
// scripts/check-page-urls.js - 校验所有页面跳转 URL 是否精确命中 app.json 注册的页面
// 用法：npm run check:routes
//
// 背景：跳转到「未注册」的页面路径时，小程序会静默失败——不跳转、不报错提示，
// 只在控制台输出错误，功能测试与代码审查都极难发现。
// 曾出现 `/pages/agreement/privacy` 漏掉末段目录（正确为 `/pages/agreement/privacy/privacy`），
// 导致登录页与「我的」页的《隐私协议》入口点击无任何反应。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
const pages = new Set((appJson.pages || []).map(p => '/' + p));

function collect(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// 采集两类引用：wxml 的 <navigator url="...">、js 的 url: '...'
const refs = [];
for (const file of collect(MP, '.wxml')) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/url\s*=\s*"([^"{}]+)"/g)) {
    const raw = m[1].trim();
    if (raw.startsWith('/') || raw.startsWith('pages')) refs.push({ file, raw });
  }
}
for (const file of collect(MP, '.js')) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/url\s*:\s*['"`]([^'"`]+)['"`]/g)) {
    const raw = m[1].trim();
    if (raw.startsWith('/') || raw.startsWith('pages')) refs.push({ file, raw });
  }
}

if (refs.length === 0) {
  console.error(`未找到任何页面跳转引用（app.json 已注册 ${pages.size} 个页面）`);
  process.exit(1);
}

const failed = [];
for (const ref of refs) {
  const clean = ref.raw.split('?')[0];
  const normalized = clean.startsWith('/') ? clean : '/' + clean;
  if (pages.has(normalized)) {
    console.log(`OK   ${path.relative(ROOT, ref.file)}  ->  ${ref.raw}`);
  } else {
    failed.push(ref);
    console.error(`FAIL ${path.relative(ROOT, ref.file)}  ->  ${ref.raw}   （未在 app.json pages 中注册）`);
  }
}

if (failed.length > 0) {
  console.error(`\n页面路径检查失败：${failed.length}/${refs.length} 处跳转指向未注册页面`);
  process.exit(1);
}
console.log(`\n页面路径检查通过：${refs.length} 处跳转全部命中已注册页面`);
