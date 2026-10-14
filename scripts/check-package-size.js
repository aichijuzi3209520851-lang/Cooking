#!/usr/bin/env node
/**
 * 复刻开发者工具的打包范围，校验主包体积与媒体资源是否达标。
 *
 * ⚠️ 关键语义（官方社区已确认，工具提示有歧义）：
 *   微信开发者工具「代码质量」里「图片和音频资源大小应不超过 200 K」
 *   这条检查指的是【代码包内所有图片 + 音频的总和 ≤ 200KB】，
 *   **不是**单张图片不超过 200KB。
 *   官方回复原文：「这个工具报警的是所有图片大小总和不能超 200kb」。
 *   所以本脚本两个口径都查：总和（主判据）+ 单文件上限（额外保险）。
 *
 * 另外校验主包总体积 ≤ 2MB。
 *
 * 按 project.config.json 的 miniprogramRoot + packOptions.ignore
 * 计算真实打包范围，无需上传即可自查。
 *
 * 退出码 0 = 全部合规；1 = 存在超标项。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 微信限制
const MEDIA_SUM_LIMIT = 200 * 1024;   // 图片+音频总和 200 KB（真正会拦的那条）
const MAIN_LIMIT = 2 * 1024 * 1024;   // 主包 2 MB
const SINGLE_FILE_LIMIT = 200 * 1024; // 单文件额外保险上限

// 计入「图片和音频资源」总和的后缀
const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.svg', '.ico',
  '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
]);
// 留 10% 余量，避免贴着红线反复告警
const MEDIA_SUM_WARN = MEDIA_SUM_LIMIT * 0.9;

const human = (n) => `${(n / 1024).toFixed(1)} KB`;

function loadCfg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
}

function collect(cfg) {
  const rootDir = cfg.miniprogramRoot || '';
  const ignDirs = new Set();
  const ignFiles = new Set();
  for (const r of (cfg.packOptions && cfg.packOptions.ignore) || []) {
    if (r.type === 'folder') ignDirs.add(r.value);
    else if (r.type === 'file') ignFiles.add(r.value);
  }

  const files = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    for (const name of fs.readdirSync(abs)) {
      const full = path.join(abs, name);
      const child = path.join(rel, name).replace(/\\/g, '/');
      if (fs.statSync(full).isDirectory()) {
        if (ignDirs.has(name)) continue;
        walk(child);
      } else {
        if (ignFiles.has(name)) continue;
        files.push([fs.statSync(full).size, child]);
      }
    }
  };
  walk(rootDir);
  files.sort((a, b) => b[0] - a[0]);
  return { files, ignDirs: [...ignDirs].sort() };
}

function main() {
  const cfg = loadCfg();
  const { files, ignDirs } = collect(cfg);
  if (!files.length) {
    console.error('未找到任何打包文件，请检查 miniprogramRoot 配置。');
    return 1;
  }

  const pkgTotal = files.reduce((s, x) => s + x[0], 0);
  const media = files.filter(([, p]) => MEDIA_EXTS.has(path.extname(p).toLowerCase()));
  const mediaSum = media.reduce((s, x) => s + x[0], 0);

  const overSum = mediaSum > MEDIA_SUM_LIMIT;
  const overPkg = pkgTotal > MAIN_LIMIT;
  const overSingle = media.filter(([s]) => s > SINGLE_FILE_LIMIT);

  console.log(`miniprogramRoot : ${cfg.miniprogramRoot}`);
  console.log(`已排除目录     : ${ignDirs.length ? ignDirs.join(', ') : '(无)'}`);
  console.log(`打包文件数     : ${files.length}`);
  console.log('-'.repeat(56));

  // 主判据：图片+音频总和
  const sumMark = overSum ? 'X 超限' : (mediaSum > MEDIA_SUM_WARN ? '! 临界' : 'OK');
  console.log(`图片音频总和   : ${human(mediaSum)} / ${human(MEDIA_SUM_LIMIT)}  ${sumMark}`);
  console.log(`  （${media.length} 个媒体文件；这是「代码质量」真正检查的判据）`);

  // 额外保险：单文件上限
  if (overSingle.length) {
    console.log(`单文件超过 ${human(SINGLE_FILE_LIMIT)}：`);
    overSingle.forEach(([s, p]) => console.log(`  ${human(s)}  ${p}`));
  } else {
    console.log(`单文件最大值   : ${human(media.length ? media[0][0] : 0)}  OK`);
  }

  // 主包总体积
  console.log(`主包体积       : ${human(pkgTotal)} / ${human(MAIN_LIMIT)}  ${overPkg ? 'X 超限' : 'OK'}`);

  if (!overSum && !overPkg && !overSingle.length) {
    console.log('\n最大的 6 个媒体文件：');
    media.slice(0, 6).forEach(([s, p]) => console.log(`  ${human(s)}  ${p}`));
  }

  if (overSum) {
    console.error(`\n图片+音频总和超出 ${human(MEDIA_SUM_LIMIT)}，需压缩 ${human(mediaSum - MEDIA_SUM_LIMIT)} 以上。`);
    console.error('压缩方向：按实际显示尺寸反推源图尺寸（保留 2~3 倍余量即可），');
    console.error('只降分辨率、不改画面内容。原图备份在 D:/we-chat/design-archive/miniprogram-11/images-backup/');
  }
  if (overPkg) console.error('\n主包超过 2MB，需拆分分包。');
  if (overSingle.length) console.error('\n存在单文件超过 200KB 的媒体资源。');

  if (overSum || overPkg || overSingle.length) return 1;
  console.log('\n全部合规。');
  return 0;
}

process.exit(main());