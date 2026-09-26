#!/usr/bin/env node
// scripts/check-syntax.js - 对项目全部 JS 文件做语法检查（只解析，不执行）
// 用法：npm run check:syntax
//
// 说明：早期版本对每个文件 `execFileSync(node, ['--check', file])`，等价于逐个起 151 个
// 子进程——慢，且在某些受限环境（子进程被禁）里会全部误报 FAIL，导致 `npm run predeploy`
// 整条门禁无法执行。改用进程内 `new vm.Script(code)`：同样只做解析、不执行代码，
// 能捕获相同的 SyntaxError，且零进程、秒级完成。
const vm = require('node:vm');
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
    // 与 `node --check` 等价：解析成脚本、不运行。filename 用于报错时定位文件。
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    console.log(`OK  ${path.relative(ROOT, file)}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${path.relative(ROOT, file)}`);
    const out = String((e && e.stack) || e || '').trim();
    if (out) console.error(out.split('\n').slice(0, 8).join('\n'));
  }
}

if (failed > 0) {
  console.error(`\n语法检查失败：${failed}/${files.length}`);
  process.exit(1);
}
console.log(`\n语法检查通过：${files.length} 个文件`);
