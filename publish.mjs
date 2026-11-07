// 把 release/dsh-see-now-extras 推上 GitHub，并发一个 Release（挂 tgz）
//
// 用法： node publish.mjs --token github_pat_xxx [--repo dsh-see-now-extras] [--private]
//
// 为什么不写成 .ps1：PowerShell 5.1 的 here-string / 执行策略在这台机器上都不配合，
// 而且中文字面量过一遍 shell 容易变乱码。Node 里 fetch + execFile 一次到底。

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.github.com';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const token = arg('token');
if (!token || token === true) {
  console.error('用法：node publish.mjs --token <PAT> [--repo <名字>] [--private]');
  process.exit(2);
}
const repoName = String(arg('repo', 'dsh-see-now-extras'));
const isPrivate = arg('private', false) === true;

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'see-now-extras',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function call(method, path, body, extra = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: { ...headers, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text };
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: HERE, encoding: 'utf8', stdio: opts.show ? 'inherit' : 'pipe' });
}

const me = await call('GET', '/user');
if (!me.ok) {
  console.error(`token 用不了（HTTP ${me.status}）：${me.text.slice(0, 200)}`);
  process.exit(1);
}
const owner = me.json.login;
const full = `${owner}/${repoName}`;
console.log(`账号：${owner}`);

// 仓库：有就复用，没有就建
const existing = await call('GET', `/repos/${full}`);
if (existing.ok) {
  console.log(`仓库已存在：https://github.com/${full}`);
} else {
  const created = await call('POST', '/user/repos', {
    name: repoName,
    description: '给 dsh-see-now 加：小窗会话绑定 / 1~3 键全局快捷键 / DSH 获焦停止 / 被打断续看 / 顶栏状态与静音',
    private: isPrivate,
    has_issues: true,
  });
  if (!created.ok) {
    console.error(`建仓库失败（HTTP ${created.status}）：${created.text.slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`已建仓库：https://github.com/${full}`);
}

// package.json 补上仓库地址（只在占位符还在时改）
const pkgPath = join(HERE, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const wantRepo = `git+https://github.com/${full}.git`;
if (pkg.repository !== wantRepo || pkg.homepage !== `https://github.com/${full}`) {
  pkg.repository = wantRepo;
  pkg.homepage = `https://github.com/${full}`;
  pkg.bugs = { url: `https://github.com/${full}/issues` };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  git(['add', 'package.json']);
  git(['-c', 'user.name=see-now extras', '-c', 'user.email=extras@localhost', 'commit', '-q', '-m', `补充仓库地址：${full}`]);
  console.log('package.json 已补 repository/homepage');
}

// 推送（token 只出现在这一条命令的 URL 里，推完立刻改回干净地址）
const auth = `https://x-access-token:${token}@github.com/${full}.git`;
try { git(['remote', 'remove', 'origin']); } catch { /* 没有 origin 正常 */ }
git(['remote', 'add', 'origin', auth]);
git(['push', '-u', 'origin', 'main', '--quiet'], { show: true });
git(['remote', 'set-url', 'origin', `https://github.com/${full}.git`]);
console.log(`已推送：https://github.com/${full}`);

// Release
const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const tag = `v${version}`;
const notes = [
  '给已经装好的 `dsh-see-now@0.2.0` 打一层补丁，加上五个开关：',
  '',
  '- **小窗交流绑定到某个会话**：钉死之后，小窗里打的字、陪看的叫醒、写进小窗的回答，全都归这一个会话',
  '- **自定义快捷键（1~3 键）**：全局按一下就开/关陪看（Windows，全屏也有效）',
  '- **DSH 一到前台就停陪看**：你切回来用 DSH，它先停手，不抢你的键盘和屏幕',
  '- **被打断后自动续看**',
  '- **按快捷键时顺手拉起小窗**',
  '',
  '另外：悬浮窗顶栏多一行状态（`陪看中 / 焦点DSH，暂停 · 已开启恢复陪看`），右上角多一个 ♪ 静音键 —— 只关声音，聊天照旧。',
  '',
  '装法：先 `dsh plugin --profile <p> add dsh-see-now`，再 `dsh plugin --profile <p> add` 本页附件里的 tgz，然后对 DSH 说一句「把 see-now 的补丁装上」。',
  '改了 11 个文件，`revert` 能一字不差回到原版。',
].join('\n');

let rel = (await call('GET', `/repos/${full}/releases/tags/${tag}`));
if (rel.ok) {
  console.log(`Release 已存在：${rel.json.html_url}`);
} else {
  rel = await call('POST', `/repos/${full}/releases`, {
    tag_name: tag,
    name: `dsh-see-now-extras ${version}`,
    body: notes,
    draft: false,
    prerelease: false,
  });
  if (!rel.ok) {
    console.error(`发 Release 失败（HTTP ${rel.status}）：${rel.text.slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`已发 Release：${rel.json.html_url}`);
}

const tgz = join(HERE, `dsh-see-now-extras-${version}.tgz`);
if (existsSync(tgz)) {
  const bytes = readFileSync(tgz);
  const res = await fetch(
    `https://uploads.github.com/repos/${full}/releases/${rel.json.id}/assets?name=${encodeURIComponent(basename(tgz))}`,
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/gzip' }, body: bytes },
  );
  if (!res.ok) {
    console.error(`挂附件失败（HTTP ${res.status}）：${await res.text()}`);
    process.exit(1);
  }
  console.log(`已挂附件：${basename(tgz)}`);
} else {
  console.log(`（没找到 ${tgz}，跳过附件）`);
}

console.log(`\n完成：https://github.com/${full}`);
