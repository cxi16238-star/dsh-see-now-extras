/**
 * index.js — `dsh-see-now-extras`：给官方 `dsh-see-now` 打补丁的那一层。
 *
 * ## 它为什么存在
 *
 * 「小窗绑定会话 / 自定义快捷键 / DSH 获焦就停 / 被打断自动续看」这四样，
 * 都要动 see-now 自己的采集循环、会话归属和设置页，靠它的公开参数做不到。
 * fork 一份的代价是：用户得记住"别装官方那个"，官方一升级就分叉。
 *
 * 所以这里只做一件事：**把改动写进用户已经装好的官方包里**。
 * - 官方包照旧由 npm/pnpm 管，升级、卸载都不受影响；
 * - 我们这份补丁只有几百 KB 文本，自带 `apply` / `revert`，随时能回到原版；
 * - 写之前逐个文件核对 sha256（官方原版的指纹），版本对不上就一个字都不写。
 *
 * ## 为什么"打补丁"是一个工具，而不是装上就自动改
 *
 * 自动改别人装好的包是**越界**的：用户可能只是想装来看看这是什么，
 * 也可能 profile 里有五份 see-now。这里把动作交给一次显式调用：
 * 用户说"打上"，模型才调 `apply`；说"还原"，才调 `revert`。
 * 插件自己每次启动只报告状态，不动文件。
 */
import { defineToolCompat } from './define-tool.js';
import {
  MANIFEST, describe, applyPatch, revertPatch, status,
} from './patch.js';

/** 插件名。cordis 用它认人。 */
export const name = 'dsh-see-now-extras';

/**
 * 只依赖 `tools`：补丁全是文件系统操作，不碰会话、不碰采集。
 * （少声明一个服务，就少一个"宿主没装那个服务 → 整个插件不加载"的理由。）
 */
export const inject = ['tools'];

/** 工具名。和 `see_now` 成对出现：一个看屏幕，一个管补丁。 */
export const TOOL_NAME = 'see_now_extras';

/**
 * 宿主 `@deepseek-ai/dsh-tools` 在 `app.asar` 里，插件侧经常解析不到；
 * 兜底顺序和 see-now 自己那套一致：先宿主 → 再 DSH_TOOLS_PATH → 最后内置。
 */
async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    if (mod?.defineTool) return mod.defineTool;
  } catch { /* 解析不到是常态 */ }
  const override = process.env.DSH_TOOLS_PATH;
  if (override) {
    try {
      const { pathToFileURL } = await import('node:url');
      const mod = await import(pathToFileURL(override).href);
      if (mod?.defineTool) return mod.defineTool;
    } catch { /* 路径写错不该拖垮插件 */ }
  }
  return defineToolCompat;
}

const KIND_MARK = {
  patched: '✓',
  pristine: '·',
  absent: '·',
  foreign: '!',
  missing: '!',
};

/** 把一次操作的结果排成人能读的几行。 */
function report(title, result) {
  const lines = [`${title}：${describe(result)}`];
  if (result.target) lines.push(`目标：${result.target}（dsh-see-now@${result.version}）`);
  lines.push(`补丁：${MANIFEST.replace.length} 个覆盖 + ${MANIFEST.add.length} 个新增（照着 ${MANIFEST.baseVersion} 写的）`);
  if (Array.isArray(result.rows) && result.rows.length > 0) {
    lines.push('文件：');
    for (const row of result.rows) {
      lines.push(`  ${KIND_MARK[row.kind] ?? '?'} ${row.path}（${row.kind}）`);
    }
  }
  if (Array.isArray(result.written) && result.written.length > 0) lines.push(`写入：${result.written.join('、')}`);
  if (Array.isArray(result.restored) && result.restored.length > 0) lines.push(`还原：${result.restored.join('、')}`);
  if (Array.isArray(result.removed) && result.removed.length > 0) lines.push(`删除：${result.removed.join('、')}`);
  if (result.message) lines.push('', result.message);
  if (result.state === 'applied' || result.written?.length || result.restored?.length) {
    lines.push('', '（客户端的设置页是打包进宿主的，改完要重启 DSH 才看得到新卡片。）');
  }
  return lines.join('\n');
}

const toolSpec = () => ({
  name: TOOL_NAME,
  description:
    'Manage the `dsh-see-now-extras` patch: it adds four settings to the **installed** `dsh-see-now` '
    + '(floating-window session binding, a custom 1–3 key hotkey that starts/stops watching, '
    + '"stop when DSH is focused", and "resume after that interruption").\n\n'
    + 'This tool never watches the screen — `see_now` does that, and it stops working normally only if the '
    + 'patch half-applied (then `status` shows it).\n\n'
    + '- `action:"status"` — is `dsh-see-now` installed, which version, applied or not, which files differ. '
    + 'Start here when unsure.\n'
    + '- `action:"apply"` — **when the user asks for the patch ("装上补丁" / "加那几个设置")**. '
    + 'Refuses when `dsh-see-now` is missing, when its version is not the one this patch was built for, or '
    + 'when a target file was modified by someone else. It backs up before writing, so `revert` works.\n'
    + '- `action:"revert"` — put the original files back and delete the files this patch added.\n\n'
    + 'Both `apply` and `revert` need a **DSH restart** to take effect (the settings page ships inside the '
    + 'host bundle). Say so when you report back.',
  parameters: {
    action: {
      type: 'string',
      enum: ['status', 'apply', 'revert'],
      description: 'status (default) | apply | revert',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', required: true },
        meta: { type: 'json' },
      },
    },
    render(_args, value) {
      return [{ type: 'text', text: value.text }];
    },
  },
  timeoutMs: 30_000,
  isConcurrencySafe() {
    return false; // 写的是同一批文件，两笔并发会互相覆盖
  },
});

/**
 * 插件入口。
 *
 * `apply` 里不做任何文件操作 —— 装上一个插件就把别人包改了，这事必须由用户点头。
 */
export async function apply(ctx) {
  const log = (...args) => {
    try { ctx?.logger?.info?.('[see-now-extras]', ...args); } catch { /* 没 logger 就算了 */ }
  };
  const disposers = [];

  // 启动时只报告，不动手：用户从日志里就能看出"装了 / 打了 / 版本不对"。
  try {
    const st = status();
    log(describe(st), st.target ? `target=${st.target}` : '');
  } catch (err) {
    log('状态读不出来：', err?.message ?? String(err));
  }

  try {
    const defineTool = await loadDefineTool();
    const tool = defineTool({
      ...toolSpec(),
      async execute(args) {
        const action = String(args?.action ?? 'status').toLowerCase();
        try {
          if (action === 'apply') {
            const result = applyPatch();
            return { text: report('打补丁', result), meta: { action, state: result.state, ok: result.ok } };
          }
          if (action === 'revert') {
            const result = revertPatch();
            return { text: report('还原', result), meta: { action, state: result.state, ok: result.ok } };
          }
          const result = status();
          return { text: report('补丁状态', result), meta: { action: 'status', state: result.state } };
        } catch (err) {
          // 工具卡里抛异常只会变成一句看不懂的 "tool failed"，这里兜成人话。
          return {
            text: `出错了：${err?.message ?? String(err)}`,
            meta: { action, error: String(err?.message ?? err) },
          };
        }
      },
    });
    disposers.push(ctx.tools.register(tool));
  } catch (err) {
    log('注册工具失败：', err?.message ?? String(err));
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      try { dispose?.(); } catch { /* 卸载时别抛 */ }
    }
  };
}
