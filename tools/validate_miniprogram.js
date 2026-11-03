#!/usr/bin/env node
/**
 * 轻量静态校验：JSON、JS 语法、WXML 标签配对、事件处理函数、WXSS 花括号、Tab 图标。
 * 不替代微信开发者工具的编译与真机测试。
 */
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'miniprogram');
const errors = [];
let checks = 0;

function fail(message) {
  errors.push(message);
}

function walk(dir, predicate) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full, predicate));
    else if (predicate(full)) result.push(full);
  }
  return result;
}

function validateJson() {
  const files = walk(miniRoot, (file) => file.endsWith('.json'));
  files.push(path.join(root, 'project.config.json'));
  for (const file of files) {
    try {
      JSON.parse(readFileSync(file, 'utf8'));
      checks += 1;
    } catch (error) {
      fail(`JSON 解析失败：${path.relative(root, file)} — ${error.message}`);
    }
  }
}

function validateJsSyntax() {
  const files = walk(miniRoot, (file) => file.endsWith('.js'));
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      fail(`JS 语法错误：${path.relative(root, file)} — ${result.stderr.trim()}`);
    } else {
      checks += 1;
    }
  }
}

function loadWxmlHandlers(file) {
  const source = readFileSync(file, 'utf8');
  const handlers = new Set();
  const pattern = /\b(?:bind|catch)[a-zA-Z]+="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) handlers.add(match[1]);
  return handlers;
}

function loadExportedMethods(file, kind) {
  let captured = null;
  const previousPage = global.Page;
  const previousComponent = global.Component;
  const previousWx = global.wx;
  global.Page = (definition) => {
    captured = definition;
  };
  global.Component = (definition) => {
    captured = definition.methods || definition;
  };
  global.wx = {
    getStorageSync() {
      return '';
    },
    setStorageSync() {},
  };
  try {
    delete require.cache[require.resolve(file)];
    require(file);
  } catch (error) {
    fail(`加载 ${path.relative(root, file)} 失败：${error.message}`);
  } finally {
    global.Page = previousPage;
    global.Component = previousComponent;
    global.wx = previousWx;
  }
  if (!captured) {
    fail(`${kind} 未正确注册：${path.relative(root, file)}`);
    return new Set();
  }
  return new Set(Object.keys(captured).filter((key) => typeof captured[key] === 'function'));
}

function validateWxml(file, methods) {
  let source = readFileSync(file, 'utf8');
  source = source.replace(/<!--[\s\S]*?-->/g, '');
  source = source.replace(/\{\{[\s\S]*?\}\}/g, 'EXPR');
  const stack = [];
  const tagPattern = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const raw = match[0];
    const name = match[1];
    if (raw.startsWith('</')) {
      const open = stack.pop();
      if (open !== name) {
        fail(
          `WXML 标签不匹配：${path.relative(root, file)} 期望关闭 <${open || '?'}>，实际 </${name}>`,
        );
        return;
      }
    } else if (!/\/\s*$/.test(match[2])) {
      stack.push(name);
    }
  }
  if (stack.length) {
    fail(`WXML 存在未闭合标签：${path.relative(root, file)} — ${stack.join(', ')}`);
  }
  for (const handler of loadWxmlHandlers(file)) {
    if (!methods.has(handler)) {
      fail(`WXML 事件处理函数缺失：${path.relative(root, file)} → ${handler}`);
    }
  }
  checks += 1;
}

function validatePages() {
  const pages = walk(path.join(miniRoot, 'pages'), (file) => file.endsWith('.wxml'));
  for (const wxml of pages) {
    const js = wxml.replace(/\.wxml$/, '.js');
    const methods = existsSync(js) ? loadExportedMethods(js, 'Page') : new Set();
    validateWxml(wxml, methods);
  }
  const tabBarWxml = path.join(miniRoot, 'custom-tab-bar', 'index.wxml');
  const tabBarJs = path.join(miniRoot, 'custom-tab-bar', 'index.js');
  validateWxml(tabBarWxml, loadExportedMethods(tabBarJs, 'Component'));
}

function validateWxss() {
  const files = walk(miniRoot, (file) => file.endsWith('.wxss'));
  for (const file of files) {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const opens = (source.match(/\{/g) || []).length;
    const closes = (source.match(/\}/g) || []).length;
    if (opens !== closes) {
      fail(`WXSS 花括号不配对：${path.relative(root, file)}（{ ${opens} / } ${closes}）`);
    } else {
      checks += 1;
    }
  }
}

function validateAssets() {
  const app = JSON.parse(readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
  for (const item of app.tabBar?.list ?? []) {
    for (const key of ['iconPath', 'selectedIconPath']) {
      if (item[key] && !existsSync(path.join(miniRoot, item[key]))) {
        fail(`Tab 图标缺失：${item[key]}`);
      }
    }
    if (item.pagePath && !existsSync(path.join(miniRoot, `${item.pagePath}.wxml`))) {
      fail(`Tab 页面缺失：${item.pagePath}`);
    }
  }
  checks += 1;
}

validateJson();
validateJsSyntax();
validatePages();
validateWxss();
validateAssets();

if (errors.length) {
  console.error(`✗ 小程序静态校验失败（${errors.length} 项）`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✓ 小程序静态校验通过：${checks} 项检查`);
