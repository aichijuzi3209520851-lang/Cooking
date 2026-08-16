#!/usr/bin/env node
// scripts/check-syntax.js - 对项目全部 JS 文件执行 node --check 语法检查
// 用法：npm run check:syntax
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// 需要检查的目录（排除 node_modules / .git）
const SCAN_DIRS = ['miniprogram', 'cloudfunctions', 'scripts', 'tests'];

function collectJs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJs(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap(d => collectJs(path.join(ROOT, d)));
if (files.length === 0) {
  console.error('未找到任何 JS 文件');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`OK  ${path.relative(ROOT, file)}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${path.relative(ROOT, file)}`);
    const out = String(e.stderr || e.stdout || '').trim();
    if (out) console.error(out.split('\n').slice(0, 8).join('\n'));
  }
}

if (failed > 0) {
  console.error(`\n语法检查失败：${failed}/${files.length}`);
  process.exit(1);
}
console.log(`\n语法检查通过：${files.length} 个文件`);
