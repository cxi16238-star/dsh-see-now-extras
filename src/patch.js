/**
 * patch.js — 把补丁写进**已装好的** `dsh-see-now`，以及撤回来。
 *
 * ## 为什么是"改别人包里那几个文件"
 *
 * 我们加的四样东西（小窗绑定会话、自定义快捷键、DSH 获焦就停、被打断自动续看）
 * 都不是靠 `see_now` 的公开参数能做到的：它们要改**采集/循环的会话归属**、
 * 要读宿主的会话列表、要在设置页里多一张卡片。也就是说必须动 see-now 自己的源码。
 *
 * 于是有两条路：fork 一份（用户得多装一个同名包，将来官方更新就分叉），
 * 或者**对已装的官方包打补丁**（用户先装官方包，再装这个补丁包，`apply` 一次）。
 * 这里走第二条：补丁包自己只有几百 KB 的文本，官方包照旧由 npm 管；
 * 想还原随时 `revert`，连官方包都不用重装。
 *
 * ## 三条硬规矩
 *
 * 1. **先验版本，再动手**。清单里记了每个"要被覆盖的文件"的 sha256（官方原版）。
 *    对不上就说明用户装的不是我们认识的那个版本 —— 直接拒绝，一个字都不写。
 *    宁可让用户看到"版本不对"，也不要把他那份改成一个四不像。
 * 2. **先备份，再覆盖**。备份放在 `~/.dsh/see-now-extras/backup/`（**不放在包目录里**：
 *    pnpm 一重装/一清理，包目录就没了，备份不能跟着陪葬）。
 * 3. **写文件用"临时文件 + rename"**。pnpm 的 `node_modules` 里是 store 的**硬链接**，
 *    直接 `writeFileSync` 会写穿到 store 里（别的项目、别的 profile 跟着变脏）；
 *    rename 换的是目录项，store 里那份原封不动。
 *
 * 所有函数都**只回结果、不抛**（除非真的是磁盘炸了）：调它们的是一张工具卡，
 * 抛出去的异常只会变成一句看不懂的 "tool failed"。
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 补丁包自己的根（`.../dsh-see-now-extras`）。 */
export const PKG_ROOT = resolve(HERE, '..');
const PAYLOAD = join(PKG_ROOT, 'payload');
/** 清单：哪些文件覆盖、哪些新增、官方原版长什么样。 */
export const MANIFEST = JSON.parse(readFileSync(join(PKG_ROOT, 'patch.json'), 'utf8'));

/** `~/.dsh`，和插件里的算法保持一致（DSH_HOME 优先）。 */
export function dshHome(env = process.env) {
  const raw = env?.DSH_HOME;
  if (typeof raw === 'string' && raw.trim()) return raw;
  const home = env?.USERPROFILE || env?.HOME || homedir();
  return join(home, '.dsh');
}

const sha256 = (file) => {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

/**
 * 目标包在哪。
 *
 * 顺序有讲究：先看显式环境变量（用户可能装在一个奇怪的地方），再看**同级的
 * `node_modules/dsh-see-now`** —— 补丁包和它都是同一个 profile 的依赖，pnpm 会把
 * 两个软链并排放；最后才去翻 `~/.dsh/profiles/*`（这是"补丁只装在一个 profile、
 * 另一个 profile 里也有 see-now"时的兜底）。
 */
export function findTarget(env = process.env) {
  const candidates = [];
  if (typeof env?.DSH_SEENOW_DIR === 'string' && env.DSH_SEENOW_DIR.trim()) {
    candidates.push(env.DSH_SEENOW_DIR.trim());
  }
  candidates.push(join(PKG_ROOT, '..', 'dsh-see-now'));
  let dir = PKG_ROOT;
  for (let i = 0; i < 6; i += 1) {
    dir = dirname(dir);
    if (dir === dirname(dir)) break;
    candidates.push(join(dir, 'node_modules', 'dsh-see-now'));
  }
  const profiles = join(dshHome(env), 'profiles');
  try {
    for (const name of readdirSync(profiles)) {
      candidates.push(join(profiles, name, 'node_modules', 'dsh-see-now'));
    }
  } catch { /* 没有 profiles 目录就算了 */ }

  for (const candidate of candidates) {
    const pkgFile = join(candidate, 'package.json');
    if (!existsSync(pkgFile)) continue;
    try {
      const info = JSON.parse(readFileSync(pkgFile, 'utf8'));
      if (info?.name === 'dsh-see-now') return { dir: candidate, version: String(info.version ?? '?') };
    } catch { /* 读不出来的候选继续看下一个 */ }
  }
  return null;
}

/**
 * 每个文件现在是什么状态。
 *
 * `pristine` 官方原样 / `patched` 已经是我们的 / `absent` 还没建 / `foreign` 谁改过
 * （既不是原版也不是我们的那份）/ `missing` 该在却不在。
 */
export function inspect(target) {
  const rows = [];
  for (const entry of MANIFEST.replace) {
    const cur = sha256(join(target.dir, entry.path));
    rows.push({
      path: entry.path,
      kind: cur === null ? 'missing' : cur === entry.payloadSha256 ? 'patched' : cur === entry.upstreamSha256 ? 'pristine' : 'foreign',
      sha256: cur,
    });
  }
  for (const entry of MANIFEST.add) {
    const cur = sha256(join(target.dir, entry.path));
    rows.push({
      path: entry.path,
      kind: cur === null ? 'absent' : cur === entry.payloadSha256 ? 'patched' : 'foreign',
      sha256: cur,
    });
  }
  return rows;
}

function summarize(version, rows) {
  if (version !== MANIFEST.baseVersion) return 'version-mismatch';
  const kinds = rows.map((row) => row.kind);
  if (kinds.every((k) => k === 'patched')) return 'applied';
  if (kinds.every((k) => k === 'pristine' || k === 'absent')) return 'ready';
  return 'partial';
}

/** 备份放在包**外面**：pnpm 重装会整目录替换，备份跟着包走就没了。 */
const backupRoot = (env) => join(dshHome(env), 'see-now-extras', 'backup', MANIFEST.baseVersion);
const statePath = (env) => join(backupRoot(env), 'state.json');

export function readState(env = process.env) {
  try {
    return JSON.parse(readFileSync(statePath(env), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 看一眼能不能打、打了没。
 * @returns {{state:string, target:object|null, version:string|null, rows:Array, backup:string}}
 */
export function status(env = process.env) {
  const target = findTarget(env);
  if (!target) {
    return {
      state: 'no-target', target: null, version: null, rows: [], backup: backupRoot(env),
      message: `没找到 dsh-see-now。先把官方包装上（dsh plugin --profile <名字> add dsh-see-now），再回来打补丁。`,
    };
  }
  const rows = inspect(target);
  const state = summarize(target.version, rows);
  return { state, target: target.dir, version: target.version, rows, backup: backupRoot(env) };
}

/** 临时文件 + rename：断开 pnpm 硬链接，别写穿到 store。 */
function writeAtomic(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.seextras.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

/**
 * 打补丁。
 *
 * 只写"该写"的文件：已经是我们的那份就跳过（重复调用是安全的），
 * 原版没动过的先备份再覆盖，任何一个文件对不上就整笔放弃。
 */
export function applyPatch(env = process.env) {
  const st = status(env);
  if (st.state === 'no-target') return { ok: false, ...st };
  if (st.state === 'version-mismatch') {
    return {
      ok: false, ...st,
      message: `版本对不上：装的是 dsh-see-now@${st.version}，这份补丁是照着 ${MANIFEST.baseVersion} 写的。`
        + `没动任何文件。要么装 ${MANIFEST.baseVersion}，要么等这份补丁跟上新版。`,
    };
  }
  if (st.state === 'applied') return { ok: true, already: true, ...st, message: '已经打过了，文件都是我们那份，没有改动。' };

  const foreign = st.rows.filter((row) => row.kind === 'foreign' || row.kind === 'missing');
  if (foreign.length > 0) {
    return {
      ok: false, ...st,
      message: `这些文件既不是官方原版、也不是我们的补丁，多半被别的工具改过：${foreign.map((row) => row.path).join('、')}。`
        + '没动任何文件。确认要覆盖的话，先自己备份它们。',
    };
  }

  const target = { dir: st.target };
  const state = readState(env) ?? {
    target: st.target, version: st.version, appliedAt: null, files: {},
  };
  const written = [];
  for (const entry of [...MANIFEST.replace, ...MANIFEST.add]) {
    const abs = join(target.dir, entry.path);
    const current = sha256(abs);
    if (current === entry.payloadSha256) continue; // 已经是我们的
    if (entry.upstreamSha256) {
      // 原版：留着原样再覆盖（state 里记一份，revert 就靠它）
      const backup = join(backupRoot(env), 'files', entry.path);
      mkdirSync(dirname(backup), { recursive: true });
      if (current !== null) copyFileSync(abs, backup);
      state.files[entry.path] = { backup: entry.path, original: current };
    } else {
      state.files[entry.path] = { backup: null, original: null };
    }
    writeAtomic(abs, readFileSync(join(PAYLOAD, entry.path)));
    written.push(entry.path);
  }
  state.appliedAt = new Date().toISOString();
  state.version = st.version;
  mkdirSync(backupRoot(env), { recursive: true });
  writeFileSync(statePath(env), `${JSON.stringify(state, null, 2)}\n`);

  const after = status(env);
  const bad = after.rows.filter((row) => row.kind !== 'patched');
  return {
    ok: bad.length === 0, written, ...after,
    message: bad.length === 0
      ? `打好了：改了 ${written.length} 个文件。**重启 DSH** 之后设置页里会多一张「小窗与快捷键」卡片。`
      : `写了 ${written.length} 个文件，但校验没全过：${bad.map((row) => `${row.path}(${row.kind})`).join('、')}。`,
  };
}

/** 撤回：把备份放回去，把新增的文件删掉（只删还是我们那份的）。 */
export function revertPatch(env = process.env) {
  const st = status(env);
  if (st.state === 'no-target') return { ok: false, ...st };
  const state = readState(env);
  if (!state) {
    return { ok: false, ...st, message: '没有备份记录 —— 这个补丁不是在这台机器的这个位置装过的，不敢乱删。要还原就直接重装 dsh-see-now。' };
  }
  const restored = [];
  const removed = [];
  const skipped = [];
  for (const entry of MANIFEST.replace) {
    const rec = state.files?.[entry.path];
    const abs = join(st.target, entry.path);
    const backup = rec?.backup ? join(backupRoot(env), 'files', rec.backup) : null;
    if (!backup || !existsSync(backup)) { skipped.push(entry.path); continue; }
    writeAtomic(abs, readFileSync(backup));
    restored.push(entry.path);
  }
  for (const entry of MANIFEST.add) {
    const abs = join(st.target, entry.path);
    if (sha256(abs) !== entry.payloadSha256) { skipped.push(entry.path); continue; }
    rmSync(abs, { force: true });
    removed.push(entry.path);
  }
  rmSync(statePath(env), { force: true });
  return {
    ok: skipped.length === 0, restored, removed, skipped, ...status(env),
    message: skipped.length === 0
      ? `还原好了：放回 ${restored.length} 个、删掉 ${removed.length} 个。重启 DSH 生效。`
      : `还原了一部分，这些跳过（备份不在、或文件已经不是我们那份了）：${skipped.join('、')}。`,
  };
}

/** 状态的中文一句话 —— 工具卡和日志共用。 */
export function describe(st) {
  if (st.state === 'no-target') return '没装 dsh-see-now';
  const done = st.rows.filter((row) => row.kind === 'patched').length;
  switch (st.state) {
    case 'applied': return `已打补丁（dsh-see-now@${st.version}）`;
    case 'ready': return `可以打（dsh-see-now@${st.version}，原版文件都在）`;
    case 'partial': return `打了一半（${done}/${st.rows.length}）`;
    case 'version-mismatch': return `版本对不上：装着 ${st.version}，补丁是照着 ${MANIFEST.baseVersion} 写的`;
    default: return st.state;
  }
}
