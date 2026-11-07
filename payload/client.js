/**
 * dsh-see-now —— 浏览器半身。
 *
 * 只做一件事：在 DSH 设置里放一页「看你在干什么」，让 `~/.dsh/see-now.json`
 * 里那九个值从"要改源码"变成"看得见、改得动、改错了会告诉你为什么"。
 *
 * ## 为什么这件事必须有界面
 *
 * 这些值原本写死在 `loop.js` 里。作者在 `tuning.js` 的注释里自己记着这件事
 * （读过源码的人只会在那儿看到一个 issue 编号），后来抽出了配置层和校验，
 * 但用户要动它仍然得手写 JSON —— 而写错一个类型就是"永远不停"或"立刻停"。
 *
 * ## 数据从哪来
 *
 * 走本插件自己的同源 `/api/see-now/*` 路由：`GET /status` 读、`POST /config` 写。
 * 校验规则**一条都不在这里**——全在 `src/tuning.js` 的 `readTuning` 里，
 * 前端只负责显示它给出的 `warnings`。前端另写一套规则，就一定会和宿主吵起来。
 *
 * ## 手写 ModuleLoader 包
 *
 * 不需要构建步骤，除 shell 已提供的 `react` 之外没有依赖。
 *
 * @module client.js
 */

window.__ModuleLoader__.load({
  // 必须是包名，不是插件的短名。client-modules 的 `arrive()` 拿着包名去查已经
  // 注册的 factory，名字对不上就一路抛 `loaded without registering "dsh-see-now"`，
  // 而那条错误只进浏览器控制台 —— 宿主那头毫无异样，设置里就是干脆没有这一栏。
  id: 'dsh-see-now',
  factory: require => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const { createElement: h, useState, useEffect, useCallback, useRef, Fragment } = React;

    const NS = 'settings.seeNow';
    /** 路由前缀；与 `src/settings-api.mjs` 的 `ROUTE_PREFIX` 必须一致。 */
    const API = '/api/see-now';
    const inject = ['slots', 'locale'];

    // ── 文案 ──────────────────────────────────────────────────────────────────
    // 先只写中文：这一版的目标是"跑通"，双语等它成立之后再补一份 en 字典。
    const TEXT = {
      nav: '看你看的东西',
      title: '看你看的东西',
      sub: '让 AI 实时看屏幕、听声音，只在画面真的变了才交图。这里调的是"陪多久、多久看一次、一句听到哪儿算完"。',
      'state.loading': '读取中…',
      'state.reload': '重新读取',
      'state.save': '保存',
      'state.saving': '保存中…',
      'state.saved': '已保存。',
      'state.savedLocal': '已保存。下一次转写就用新地址。',
      'state.nosave': '没有改动。',
      'sec.common': '常用',
      'sec.advanced': '高级（一般不用动）',
      'field.prefer': '用哪个转写服务',
      'field.prefer.hint': '宿主自带的是 SenseVoice（桌面版内置、零配置、不占显存）。下面那块 asr.json 是可选的自建或在线服务 —— 选「只用宿主自带的」时它不参与，那块配置会收起来。',
      'prefer.auto': '自动 —— 宿主自带的优先',
      'prefer.host': '只用宿主自带的（SenseVoice）',
      'prefer.local': '只用下面那个服务（asr.json）',
      'local.title': '转写服务（asr.json）',
      'local.sub': '这个文件决定"声音用谁听写"。它与 video-storyboard 共用一份 —— 两个插件都读它，所以改这里对两边都生效。',
      'local.api': '接口形态',
      'local.api.hint': '多数服务是音频接口。只有聊天接口的服务（小米 MiMo 这类）才选第二种 —— 端点不一样，选错会 404。',
      'local.api.openai': '音频接口 /audio/transcriptions',
      'local.api.chat': '聊天接口 /chat/completions',
      'local.baseUrl': '服务地址',
      'local.baseUrl.hint': '要带版本路径，例如 https://api.example.com/v1。留空 = 不用这个文件。',
      'local.baseUrl.ph': 'https://api.example.com/v1',
      'local.model': '模型名',
      'local.model.hint': '按服务方的文档填。',
      'local.language': '语言',
      'local.language.hint': 'auto / zh / en，按服务支持的填。',
      'local.key': '密钥',
      'local.key.hint': '只写不读：文件里的 key 不会回显到页面上。留空表示不改。',
      'local.key.keep': '已设置，留空不改',
      'local.key.ph': '没设置',
      'local.empty': '这里还是空的。填了地址就能用；留空则由上面「用哪个转写服务」的规则决定。',
      'local.save': '保存转写服务',
      'local.sample': '看看这个文件长什么样',
      'local.sample.body': '{\n  "api": "openai-audio",\n  "baseUrl": "http://127.0.0.1:8000/v1",\n  "model": "paraformer-zh-2024-03-09",\n  "language": "auto"\n}',
      'local.manage': '文件里还有 manage（怎么把服务拉起来）一类的键，面板不动它们，原样保留。',
      'local.env': '环境变量正在覆盖这些字段',
      'field.pace': '场景变换侦测灵敏度',
      'field.pace.hint': '决定"多大的画面变化才算换了一个场景"。分数越低越敏感：切点更密、醒得更勤、话也多；'
        + '分数越高越只挑大变化。',
      'pace.calm': '低 —— 20 分以上的变化才算（很久才出声）',
      'pace.normal': '中 —— 12 分（默认）',
      'pace.dense': '高 —— 7 分就算（反应快，话也多）',
      'pace.game-economic': '只挑大动作 —— 80 分（游戏省流）',
      'field.batch': '超省模式（攒几张再交）',
      'field.batch.hint': '攒够几张图才叫醒你一次。1 张 = 攒满就交（默认，最及时）。'
        + '调到 3 张：模型一次看三张，少两轮请求 —— 省的是"每轮都要把整个上下文重过一遍"那笔，'
        + '一张图本身只要 222 token，多带两张几乎不要钱。代价是画面更晚到：'
        + '每张要 15~40 秒，攒 3 张就是 1~2 分钟。会话越长越值。',
      'batch.1': '1 张 —— 攒满就交（默认）',
      'batch.2': '2 张',
      'batch.3': '3 张 —— 省得明显',
      'batch.4': '4 张 —— 最省，也最慢',
      'field.idleStop': '空闲多久自己收工',
      'field.idleStop.hint': '单位分钟。0 = 关掉这条线，你不理它它就一直陪着（会一直花 token）。',
      'field.pacing': '说话停顿跟着句长走',
      'field.pacing.hint': '长句之后多留一点，短句之后紧一点。',
      'pacing.follow': '跟随句长（默认）',
      'pacing.guard': '取更晚的那个',
      'pacing.off': '关掉，固定间隔',
      'field.silence': '静音多久算一句说完',
      'field.silence.hint': '单位秒。0.35 是人喘口气的下限 —— 再低会把一句话从中间切开，后半截被当成新的一句。',
      'field.maxSeg': '一句最长多久',
      'field.maxSeg.hint': '单位秒。说到这么久还没停就强行断开，否则一句话一直不断，字幕永远出不来。',
      'field.tierStyle': '每帧多大（档位）',
      'field.tierStyle.hint': '档位 1 = 一格占满，8 = 只占 1/8 边。'
        + '默认「标准」：按变化密度算出档位后，1 档压成 1/2 —— 不然那几帧几乎没变的画面'
        + '会各占满一整张图，张数白涨。想要 1 档也占满就选「原生」。'
        + '换「灵敏度」时格子会跟着变（帧越密格子越小），那是设计，不是错。',
      'tier.standard': '标准 —— 1 档压成 1/2（默认）',
      'tier.native': '原生 —— 算出几档就是几档，1 档也占满',
      'tier.full': '更大 —— 在密度基础上整体降一档',
      'tier.compact': '更小 —— 在密度基础上整体升一档',
      'tier.custom': '自定义 —— 逐档指定映射',
      'field.fillTierMap': '一键填满',
      'field.fillTierMap.pick': '全设成…',
      'field.fillTierMap.hint': '选一个档位，八项一起改成它。八项全一样 = 密度不再影响尺寸，'
        + '灵敏度怎么改格子都是这么大。代价：帧很稀的时候一格只放一两帧，剩下画布是空的。',
      'field.tierMap': '逐档映射',
      'field.tierMap.hint': '左边是算出来的档位，右边选它实际落到哪一档。'
        + '想把"1 档"也缩小就把它改成 2；想让 8 档别那么碎就改成 6。',
      'field.tierMode': '格子大小按什么算',
      'field.tierMode.hint': '模型看的是一张静态拼图，格子大小是唯一能告诉它"这一刻值不值得端详"的通道。'
        + '「密度」看这一带节奏快不快；「变化」按这一帧变了多少分地方 —— 只有它能做出'
        + '同一张图里的大小对比（代价：省 token，但一张图覆盖的时长变长、出图变慢）。',
      'mode.density': '密度 —— 每秒几帧（默认）',
      'mode.weight': '变化 —— 变化越大格越大',
      'field.tierCurve': '七道阈值的取法',
      'field.tierCurve.hint': '阈值决定"多密的画面该用几档"。'
        + '「docx」是原始那套；「感知」按人眼瞬时记忆定标（一格最多 3 秒、最少 0.3 秒）；'
        + '「自定义」自己填七个数。',
      'curve.docx': '原始（docx）',
      'curve.perceptual': '感知定标（3 s ~ 0.3 s）',
      'curve.custom': '自定义七个阈值',
      'field.tierThresholds': '七道阈值（帧/秒）',
      'field.tierThresholds.hint': '从左到右必须严格递增。第 i 个数 = "多密算第 i+1 档"，'
        + '所以数字越大越晚才切到小格子。默认 0.26 / 0.6 / 0.9 / 1.2 / 1.8 / 2.4 / 3.0。',
      'tier.from': '档',
      'field.wakes': '自主唤醒上限',
      'field.wakes.hint': '你一句话都没说，它自己最多醒几次就收工。',
      'field.imageTrigger': '涨到多少张就动手省',
      'field.imageTrigger.hint': '会话里的图涨到这个数，就把更早的一次性省略掉（省到下面那个留底数）。'
        + '0 = 关闭这个功能。',
      'field.imageKeep': '省完保留最近几张',
      'field.imageKeep.hint': '被省掉的图会变成一段文字：不再发给模型，磁盘上那份也能删。'
        + '100 张约 2.2 万 token。**必须小于上面那个触发线**。'
        + '⚠ 每省略一次，前缀缓存要全量重算一遍 —— 所以触发线和留底的差越大，重算越少。',
      'field.live': '说长句时先出半截字幕',
      'field.live.hint': '关掉的话，一句话必须等说完才显示 —— 说满十几秒的时候屏幕上一个字都没有。',
      'field.liveMin': '多长开始给半截',
      'field.liveMin.hint': '单位秒。说满这么久先生成一份快照去转写。',
      'field.liveStep': '半截多久更新一次',
      'field.liveStep.hint': '单位秒。越小字幕跟得越紧，转写次数也越多。不能超过「一句最长」。',
      'field.pollMs': '多久查一次有没有新声音',
      'field.pollMs.hint': '单位毫秒。这个不是转写的开销，主要成本是等断句。',
      'hint.restart': '「小窗与快捷键」那张卡片改完立刻生效；其余这些值决定的是循环的收工线和断句节奏，'
        + '插件在启动时读一次 —— 保存后重开 DSH 才生效。',
      'hint.path': '配置文件',
      'hint.origin': '这里显示的默认值直接来自插件源码，不是在界面里另写一套。',
      'warn.title': '配置里有几处它没接受，用的是默认值',
      'err.rejected': '这几项没通过校验，文件没有被改动：',
      'err.load': '读不到配置',
      'err.save': '保存失败',
      'note.file': '文件还不存在。现在保存会新建它，只写你改过的那几项。',
      'win.title': '悬浮窗样式',
      'win.sub': '一直挂在屏幕上的那个小窗长什么样。改完立刻生效，不用重开 DSH。',
      'win.style': '外观预设',
      'win.style.auto': '自动 —— 远程/录屏用纯色，其余实时玻璃',
      'win.style.live': '实时玻璃 —— 跟着桌面模糊（好看，吃 CPU）',
      'win.style.frost': '静态磨砂 —— 不吃性能（低配机选这个）',
      'win.style.solid': '纯色 —— 最省，背后不透',
      'win.style.hint': '实时玻璃每帧都要抓一次屏再模糊 —— 低配机、高分屏上「卡」就是这么来的。'
        + '静态磨砂不抓屏，只画一张预生成的底板，CPU 占用接近 0；纯色连渐变都不要。',
      'win.applied': '已应用，窗口下一拍就换过来。',
      'win.path': '配置文件',
      'win.game': '打游戏的时候',
      'win.mode': '窗口',
      'win.mode.full': '正常显示',
      'win.mode.hidden': '最小化到托盘（完全不占屏幕）',
      'win.mode.hint': '最小化是真的从屏幕上消失，不是缩成一条。右下角托盘图标、或 Ctrl+Alt+W 叫回来；'
        + '采集照常，台词照念。',
      'win.danmaku': '弹幕',
      'win.danmaku.off': '关',
      'win.danmaku.on': '开 —— 台词从屏幕顶部飘过',
      'win.danmaku.hint': '只飘它说的话；你自己发的不飘。窗口最小化之后，这是唯一还看得见消息的通道。',
      'win.game.hint': '边打游戏边听：窗口选「最小化到托盘」+ 弹幕「开」+ 外观选「静态磨砂」—— 0 占屏、0 抓屏。',
      // ── 小窗与快捷键（这四项改完立刻生效，不用重开 DSH）──
      'talk.title': '小窗与快捷键',
      'talk.sub': '这个小窗到底在跟谁说话、怎么一键开关、你回来用它的时候它该不该让开。这三件事都不用重开 DSH：改完点保存就生效。',
      'talk.session': '小窗交流绑定到',
      'talk.session.hint': '不绑定 = 跟着"最后说话的那个会话"走 —— 同时开几个窗口时它会被拽来拽去'
        + '（你在这个窗口打字，话跑到另一个窗口回答）。绑定了就钉在那一个：小窗里打的字、'
        + '陪看的叫醒、它的回答记进小窗 —— 全走这一个会话。',
      'talk.follow': '不绑定 —— 跟随当前会话',
      'talk.current': '（当前）',
      'talk.missing': '（这个会话现在找不到了）',
      'talk.empty': '没读到会话列表',
      'talk.hotkey': '开关陪看的快捷键',
      'talk.hotkey.hint': '点框子，然后按下你要的组合：1~3 个键，至少一个不是修饰键。'
        + '录的时候一个一个按也行（先按 Ctrl、松开，再按 K），按完停一下就定下来 —— 不用抢。'
        + '**用的时候要同时按住**：选了“7 + 8”这种两个普通键，就得真的两只手一起按，'
        + '所以更推荐 Ctrl / Alt / Shift 起头的组合。'
        + '全屏有效，在别的窗口里也能按，不用先切回 DSH。按 Esc 取消录制。',
      'talk.hotkey.unset': '还没设 —— 点这里录一个',
      'talk.hotkey.rec': '现在按（Esc 取消）',
      'talk.hotkey.clear': '清掉',
      'talk.hotkey.warn': '别用 Ctrl+W / Ctrl+R / Ctrl+Q / F11 这类被宿主或系统先占住的组合：'
        + '它们会被系统先吃掉，结果往往是"窗口关了、陪看没开"。',
      'talk.focusPause': '我在用 DSH 的时候，停一下陪看',
      'talk.focusPause.hint': '开着的话：DSH 一拿到焦点就停（我切回来是要跟你说话，不是让你在后台一直烧 token）。'
        + '只在你确实在看的时候才停 —— 没在陪看就不会动任何东西。',
      'talk.focusResume': '我切走之后，自己接着看',
      'talk.focusResume.hint': '只在上面那条开着时有意义。关掉 = 被打断就真的收工，想接着看得按快捷键或跟它说一声；'
        + '开着 = 你忙完切走，它自己回来接着看（回到被打断时那个会话）。',
      'talk.hotkeyWindow': '按快捷键开陪看时，顺手把小窗拉起来',
      'talk.hotkeyWindow.hint': '开着 = 一按快捷键窗就出来（关掉了也能开，快捷键的默认期待就是"我来陪你了"）；'
        + '关掉 = 只开始看，不硬拉窗 —— 你刚把窗关掉、只想让它在后台跟着的时候选这个。',
      'talk.companion': '快捷键服务',
      'talk.companion.running': '运行中',
      'talk.companion.off': '没启用（没设快捷键，也没开焦点暂停）',
      'talk.companion.unsupported': '这台机器上还没有 —— 前台窗口检测目前只做了 Windows',
      'talk.companion.bad': '起不来',
      'talk.companion.noFocus': '快捷键能用；「前台窗口」这条在这台机器上没有实现',
      'talk.note': '会话列表是打开这一页现取的；新开的会话刷新一下就能看见。',
      'talk.search': '搜标题或 id…',
      'talk.pick': '选一个会话',
      'talk.idhint': '右边是会话 id 的前 8 位 —— 标题重名时靠它对号。',
    };

    const t = key => TEXT[key] ?? key;

    // ── 样式 ──────────────────────────────────────────────────────────────────
    const CSS = `
.sn_root{display:flex;flex-direction:column;gap:14px;padding:2px 0 8px}
.sn_hero{display:flex;flex-direction:column;gap:8px;padding:18px 20px;border-radius:16px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);
  background:linear-gradient(165deg,color-mix(in srgb,var(--dsw-alias-bg-layer-3) 86%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 80%,transparent))}
.sn_title{margin:0;font-size:19px;font-weight:740;letter-spacing:-.3px;color:var(--dsw-alias-label-primary)}
.sn_sub{margin:0;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary);max-width:78ch}
.sn_card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border-radius:14px;
  border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.sn_cardhd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.sn_cardname{font-size:13.5px;font-weight:660;color:var(--dsw-alias-label-primary)}
.sn_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.sn_field{display:flex;flex-direction:column;gap:5px;min-width:0}
.sn_label{font-size:12px;font-weight:620;color:var(--dsw-alias-label-primary)}
.sn_hint{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.sn_input,.sn_select{height:32px;padding:0 10px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.sn_input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.sn_select{cursor:pointer}
.sn_input:focus-visible,.sn_select:focus-visible{outline:none;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 70%,transparent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
.sn_check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}
.sn_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sn_btn{height:30px;padding:0 14px;border-radius:8px;font-size:12px;font-weight:620;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 80%,transparent);
  color:var(--dsw-alias-label-primary)}
.sn_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-border-l2)}
.sn_btn.primary{border-color:transparent;color:#fff;background:var(--dsw-alias-state-business-primary)}
.sn_btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 86%,#fff)}
.sn_btn:disabled{opacity:.5;cursor:not-allowed}
.sn_ok{font-size:11.5px;color:var(--dsw-alias-state-success-primary)}
.sn_note{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.sn_mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.sn_box{padding:10px 12px;border-radius:10px;font-size:11.5px;line-height:1.6;word-break:break-word}
.sn_box.warn{border:1px solid color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 8%,transparent);color:var(--dsw-alias-state-warning-primary,#f0a441)}
.sn_box.bad{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary)}
.sn_box ul{margin:4px 0 0;padding-left:18px}
.sn_box li{margin:2px 0}
.sn_det summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:2px 0}
.sn_pre{margin:8px 0 0;padding:10px 12px;border-radius:8px;overflow-x:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.sn_cap{min-width:196px;height:32px;padding:0 12px;border-radius:8px;font-size:12px;cursor:pointer;
  text-align:left;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  border:1px dashed color-mix(in srgb,var(--dsw-alias-border-l2) 92%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 60%,transparent);color:var(--dsw-alias-label-primary)}
.sn_cap:hover{border-color:var(--dsw-alias-border-l2)}
.sn_cap.on{border-style:solid;border-color:var(--dsw-alias-state-business-primary);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
/* 会话选择器：原生 <select> 没法把 id 排到右边，只能自绘一层。 */
.sn_pick{position:relative}
.sn_pickbtn{display:flex;align-items:center;gap:10px;width:100%;height:32px;padding:0 10px;
  border-radius:8px;font-size:13px;cursor:pointer;text-align:left;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary)}
.sn_pickbtn:hover{border-color:var(--dsw-alias-border-l2)}
.sn_picktitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sn_pickid{flex:none;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--dsw-alias-label-tertiary)}
.sn_caret{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.sn_panel{position:absolute;z-index:30;left:0;right:0;top:36px;padding:6px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);
  box-shadow:0 12px 32px rgba(0,0,0,.38)}
.sn_filter{width:100%;height:28px;margin-bottom:6px;padding:0 8px;border-radius:6px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary)}
.sn_list{max-height:264px;overflow:auto}
.sn_opt{display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border:0;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;text-align:left;cursor:pointer}
.sn_opt:hover{background:var(--dsw-alias-bg-layer-3)}
.sn_opt.on{background:var(--dsw-alias-state-business-primary);color:#fff}
.sn_opttitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sn_optid{flex:none;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--dsw-alias-label-tertiary)}
.sn_opt.on .sn_optid{color:rgba(255,255,255,.82)}
.sn_none{padding:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
`;

    /**
     * 一个带超时的 JSON 请求。
     *
     * 没有超时的话，Host 正忙时一次挂起的 fetch 会让整页永远停在"读取中"。
     */
    async function api(path, options) {
      const { timeout = 15000, ...rest } = options ?? {};
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(API + path, { ...rest, signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const why = body && Array.isArray(body.rejected) ? body.rejected.join('；') : `HTTP ${res.status}`;
          throw new Error(why);
        }
        if (body === null) throw new Error('返回值不是 JSON');
        return body;
      } finally {
        clearTimeout(timer);
      }
    }

    /**
     * 表单草稿：扁平结构，读起来比嵌套少一层心智负担。
     *
     * **必须把「界面上渲染过的每一项」都种进来**，一项不落。`patchOf` 是按
     * 「draft 与 values 逐项比较、不等即视为用户改过」算补丁的：种子缺了谁，
     * draft 那边就是 `undefined`，与真实值永远不等，于是每次保存都会捎上一个
     * 空值幽灵字段（`tierStyle: ""` / `tierMap: []`）。而 `tuning.js` 的规矩是
     * 「本次提交让警告变多 → 整笔拒绝、文件不动」，所以只要缺一项，用户改什么都存不下去。
     */
    function draftOf(values) {
      const listen = values?.listen ?? {};
      return {
        maxAutonomousWakes: values.maxAutonomousWakes,
        imageTrigger: values.imageTrigger,
        imageKeep: values.imageKeep,
        idleStopMin: values.idleStopMin,
        wakeBatch: values.wakeBatch,
        defaultPace: values.defaultPace,
        speechPacing: values.speechPacing,
        // tierMap 是数组：给引用即可，patchOf 用 JSON.stringify 比内容，没有原地改的风险
        tierStyle: values.tierStyle,
        tierMap: values.tierMap,
        // 数组同理给引用（patchOf 用 JSON.stringify 比内容）
        tierMode: values.tierMode,
        tierCurve: values.tierCurve,
        tierThresholds: values.tierThresholds,
        prefer: listen.prefer,
        live: listen.live,
        liveMin: listen.liveMin,
        liveStep: listen.liveStep,
        silence: listen.silence,
        maxSeg: listen.maxSeg,
        pollMs: listen.pollMs,
        // 小窗绑谁 / 快捷键 / 焦点：四项都存 see-now.json，改完立刻生效
        talkSession: values.talkSession ?? 'follow',
        // 数组给引用即可（patchOf 用 JSON.stringify 比内容，理由同 tierMap）
        hotkey: values.hotkey ?? [],
        focusPause: values.focusPause === true,
        focusResume: values.focusResume !== false,
        hotkeyWindow: values.hotkeyWindow !== false,
      };
    }

    /**
     * 按段浅合并两份 values。
     *
     * 宿主 `/config` 的回包现在给的是**写完之后文件里的完整快照**，但面板不该赌
     * 宿主一定是新版 —— 老实现回的是 `writeTuning().values`，按"只写提交过的键"
     * 的语义只有本次提交的那几个，合并一次两种都能用。
     */
    function mergeValues(prev, next) {
      const base = prev ?? {};
      const patch = next ?? {};
      return {
        ...base,
        ...patch,
        listen: { ...(base.listen ?? {}), ...(patch.listen ?? {}) },
      };
    }

    /** 输入框里的字符串换成数字；空串或非数就原样交给宿主去判（它会拒，并给出原因）。 */
    const num = value => {
      if (typeof value === 'number') return value;
      const text = String(value ?? '').trim();
      if (text === '') return Number.NaN;
      return Number(text);
    };

    /**
     * 只把**改过**的键做成补丁。
     *
     * 整体提交虽然也能跑，但它会在用户什么都没动的情况下把一整份默认值写进文件 ——
     * 而 `tuning.js` 的初衷是"用户只写自己想改的那几项"。
     */
    function patchOf(draft, values) {
      // `draftOf` 对空 values 有兜底（`values?.listen ?? {}`），这里也不能假设一定齐全：
      // 老宿主回的包只带本次提交过的键，没提交过 listen 段时它就是 undefined。
      const base = values ?? {};
      const patch = {};
      for (const key of ['maxAutonomousWakes', 'imageTrigger', 'imageKeep', 'idleStopMin', 'wakeBatch', 'defaultPace', 'speechPacing']) {
        if (draft[key] !== base[key]) patch[key] = key === 'defaultPace' || key === 'speechPacing'
          ? draft[key]
          : num(draft[key]);
      }
      if (draft.tierStyle !== base.tierStyle) patch.tierStyle = String(draft.tierStyle ?? '');
      if (draft.tierMode !== base.tierMode) patch.tierMode = String(draft.tierMode ?? '');
      if (draft.tierCurve !== base.tierCurve) patch.tierCurve = String(draft.tierCurve ?? '');
      // 数组比引用永远不等，只能比内容；顺序有意义（第 i 个 = 档位 i+1）
      if (JSON.stringify(draft.tierMap ?? null) !== JSON.stringify(base.tierMap ?? null)) {
        patch.tierMap = (Array.isArray(draft.tierMap) ? draft.tierMap : []).map((n) => num(n));
      }
      if (JSON.stringify(draft.tierThresholds ?? null) !== JSON.stringify(base.tierThresholds ?? null)) {
        patch.tierThresholds = (Array.isArray(draft.tierThresholds) ? draft.tierThresholds : []).map((n) => num(n));
      }
      const cur = base.listen ?? {};
      const listen = {};
      for (const key of ['prefer', 'live', 'liveMin', 'liveStep', 'silence', 'maxSeg', 'pollMs']) {
        if (draft[key] === cur[key]) continue;
        // prefer 是枚举字符串，不能交给 num()（那会把 'host' 换成 NaN）
        listen[key] = key === 'live' ? draft[key] === true
          : key === 'prefer' ? String(draft[key] ?? '')
          : num(draft[key]);
      }
      if (Object.keys(listen).length > 0) patch.listen = listen;
      /**
       * 小窗与快捷键这四项**不在 listen 段里**，也不走 num()：两个字符串、一个数组、
       * 两个布尔。逐项比过才提交 —— 补丁只该带用户真改过的那几个键。
       */
      if ((draft.talkSession ?? 'follow') !== (base.talkSession ?? 'follow')) {
        patch.talkSession = String(draft.talkSession ?? 'follow').trim() || 'follow';
      }
      if (JSON.stringify(draft.hotkey ?? []) !== JSON.stringify(base.hotkey ?? [])) {
        patch.hotkey = Array.isArray(draft.hotkey) ? draft.hotkey.map(k => String(k)) : [];
      }
      // 布尔不能直接比 `!==`：draft 里可能是 `undefined`（老宿主回的包没这个键），
      // 那和"用户去掉了勾"不是一回事。先归一到「它到底开没开」。
      if ((draft.focusPause === true) !== (base.focusPause === true)) {
        patch.focusPause = draft.focusPause === true;
      }
      if ((draft.focusResume !== false) !== (base.focusResume !== false)) {
        patch.focusResume = draft.focusResume !== false;
      }
      if ((draft.hotkeyWindow !== false) !== (base.hotkeyWindow !== false)) {
        patch.hotkeyWindow = draft.hotkeyWindow !== false;
      }
      return patch;
    }

    // ── 快捷键的显示与录制 ────────────────────────────────────────────────────
    /** 修饰键的固定次序：显示、提交都用这一份，否则 `Shift+Ctrl+K` 与 `Ctrl+Shift+K` 会来回抖。 */
    const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Win'];

    /**
     * 录完最后一个键之后，等这么久没人再按才定稿。
     *
     * 以前是"第一个非修饰键按下去就提交"——想设 `Ctrl+Alt+K` 的人刚按到 K 就被收走了，
     * 第二个第三个键根本来不及按。0.7 秒是"手停下来了"和"别让人干等"之间的折中。
     */
    const HOTKEY_SETTLE_MS = 700;

    /**
     * 把这一下按到的键并进已经攒下的键里。
     *
     * 必须并进去而不是覆盖：用户很可能是**一次一个**地按（按住 Ctrl → 松开 → 再按 K），
     * 那样每个 keydown 事件里只有当时还按着的修饰键，覆盖就会把前面的丢了。
     * 修饰键排前面、其余保持按下顺序（`hotkeyText` 显示时也会这么排）。
     */
    function mergeHotkeyKeys(prev, pressed) {
      const out = [];
      for (const k of [...(Array.isArray(prev) ? prev : []), ...(Array.isArray(pressed) ? pressed : [])]) {
        if (!out.includes(k)) out.push(k);
      }
      return out.sort((a, b) => {
        const ia = MOD_ORDER.indexOf(a);
        const ib = MOD_ORDER.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return 0;
      });
    }

    /**
     * 浏览器给的事件键名 → 存盘的键名。
     *
     * 存**物理键**的名字（`Minus` 而不是 `-`）：`src/hotkeys.js` 和
     * `examples/floating-chat/companion.py` 共用同一张名字表，Python 那边靠名字查 VK 码。
     * 这里漏一个，用户在界面上按得出来、存下去却按不动 —— 所以不做"猜"，认不出就返回 null。
     */
    const KEY_ALIASES = {
      Control: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Win', OS: 'Win', Super: 'Win',
      // 单按修饰键不该被当成一个"组合"，但**必须认得出来**：录制时要靠它
      // 走"只更新预览、不提交"那条分支，否则按 Ctrl 会被当成一个叫 Control 的键。
      Alt: 'Alt', AltGraph: 'Alt', Shift: 'Shift',
      Escape: 'Esc', Esc: 'Esc',
      ' ': 'Space', Space: 'Space', Spacebar: 'Space',
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
      '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote',
      ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote',
    };

    function keyNameOf(event) {
      const raw = String(event?.key ?? '');
      if (!raw) return null;
      if (KEY_ALIASES[raw]) return KEY_ALIASES[raw];
      if (/^[a-zA-Z]$/.test(raw)) return raw.toUpperCase();
      if (/^[0-9]$/.test(raw)) return raw;
      if (/^F([1-9]|1[0-2])$/.test(raw)) return raw;
      if (/^(Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/.test(raw)) return raw;
      return null;
    }

    /** `['Ctrl','Alt','K']` → `'Ctrl+Alt+K'`；空数组给空串（界面上显示「还没设」）。 */
    function hotkeyText(keys) {
      const list = Array.isArray(keys) ? keys.map(k => String(k)) : [];
      if (list.length === 0) return '';
      const mods = MOD_ORDER.filter(m => list.includes(m));
      const rest = list.filter(k => !MOD_ORDER.includes(k));
      return [...mods, ...rest].join('+');
    }

    // ── asr.json 的那一份草稿 ─────────────────────────────────────────────────
    // 单独一套，因为它写的是另一个文件：改了立刻对下一次转写生效，不用重开 DSH。
    // key 永远是空串起步 —— 后端不回传密钥，所以"草稿里没有 key" 与 "文件里没有 key"
    // 是两件事，靠 hasKey 区分。
    const ASR_FIELDS = ['api', 'baseUrl', 'model', 'language'];

    function localDraftOf(local) {
      if (!local || typeof local !== 'object') return null;
      return {
        api: local.api || 'openai-audio',
        baseUrl: local.baseUrl || '',
        model: local.model || '',
        language: local.language || '',
        key: '',
      };
    }

    /** 只提交真的改过的那几个键；key 只在用户真填了的时候才带。 */
    function localPatchOf(draft, local) {
      const patch = {};
      if (!draft || !local) return patch;
      for (const key of ASR_FIELDS) {
        const next = String(draft[key] ?? '').trim();
        if (next !== String(local[key] ?? '').trim()) patch[key] = next;
      }
      const key = String(draft.key ?? '').trim();
      if (key !== '') patch.key = key;
      return patch;
    }

    /**
     * asr.json 那块只在**可能用到它**的时候出现。
     *
     * 原来它顶在最上面，看起来像"转写已经换成这个自建服务了"——实际上宿主自带的
     * SenseVoice 一直在，选了 local 才轮到 asr.json。所以：选「只用宿主自带的」
     * 时整块收起来，别让配置项的存在暗示了不存在的替换关系。
     */
    const shouldShowLocal = (prefer) => prefer !== 'host';

    // ── 设置页 ────────────────────────────────────────────────────────────────
    function SettingsPage() {
      const [data, setData] = useState(null);
      const [draft, setDraft] = useState(null);
      const [error, setError] = useState('');
      const [rejected, setRejected] = useState([]);
      const [busy, setBusy] = useState(true);
      const [savedAt, setSavedAt] = useState(0);
      // asr.json 那一套是独立的：不同文件、不同生效方式（改完立刻生效）。
      const [localDraft, setLocalDraft] = useState(null);
      const [localRejected, setLocalRejected] = useState([]);
      const [localAt, setLocalAt] = useState(0);
      // 悬浮窗样式又是另一个文件（watch-window.json）：也是改完立刻生效，所以单独一套状态
      const [windowStyle, setWindowStyleState] = useState('');
      const [windowAt, setWindowAt] = useState(0);
      // 快捷键录制：开着的时候整页都在听 keydown（见下面的 effect）
      const [capturing, setCapturing] = useState(false);
      const [capturePreview, setCapturePreview] = useState('');
      // 录的时候按下的键先攒在这儿，手停下来（HOTKEY_SETTLE_MS 内没人再按）才定稿。
      // 不能"一按就定"：想设 Ctrl+Alt+K 的人得能一个键一个键按完。
      const captureKeys = useRef([]);
      const captureTimer = useRef(null);
      // 会话选择器自己展开一层面板：原生 <select> 没地方放"右边的 id"，也没法加搜索框。
      const [pickOpen, setPickOpen] = useState(false);
      const [pickQuery, setPickQuery] = useState('');
      // 面板的范围：点在外面就收起来（见下面的 effect）。用 ref 而不是给 document
      // 挂一堆选择器 —— 面板是 React 渲染的，只有它能告诉我们"这是自己人"。
      const pickBox = useRef(null);
      const clearCaptureTimer = () => {
        if (captureTimer.current !== null) {
          clearTimeout(captureTimer.current);
          captureTimer.current = null;
        }
      };

      const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
          const next = await api('/status');
          setData(next);
          setDraft(draftOf(next.values));
          setLocalDraft(localDraftOf(next.local));
          setWindowStyleState(next.window?.style ?? 'auto');
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const set = (key, value) => {
        setSavedAt(0);
        setRejected([]);
        setDraft(current => ({ ...current, [key]: value }));
      };

      /**
       * 改逐档映射里的一项。
       *
       * 必须**整份数组换新**（不能原地改）：`patchOf` 靠比较两份 draft 来算补丁，
       * 原地改会让"改过"和"没改"看起来一样，那一项就永远提交不上去。
       */
      const setTierMap = (i, v) => {
        const base = Array.isArray(draft?.tierMap) ? draft.tierMap : [1, 2, 3, 4, 5, 6, 7, 8];
        const next = base.map((x) => Number(x));
        next[i] = Number(v);
        set('tierMap', next);
      };

      /**
       * 改七道阈值里的一道。同样整份换新（理由同 `setTierMap`）。
       * 输入框存**字符串**：空串和非数字都留给宿主去拒，前端不替它猜。
       */
      const setThreshold = (i, v) => {
        const base = Array.isArray(draft?.tierThresholds)
          ? draft.tierThresholds
          : (data?.defaults?.tierThresholds ?? []);
        const next = base.slice();
        next[i] = v;
        set('tierThresholds', next);
      };

      const save = async () => {
        if (data === null || draft === null) return;
        const patch = patchOf(draft, data.values);
        if (Object.keys(patch).length === 0 && patch.listen === undefined) {
          setSavedAt(-1);
          return;
        }
        setBusy(true);
        setError('');
        setRejected([]);
        try {
          const result = await api('/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch }),
          });
          if (result.ok) {
            // 用宿主回的值重建，而不是把草稿当成新真相：这样面板显示的永远是
            // "文件里实际是什么"，连派生值（idleStopMs）都对。合并是因为回包
            // 可能是增量（见 mergeValues）。
            const merged = mergeValues(data.values, result.values);
            setData(current => ({ ...current, values: merged, warnings: result.warnings, path: result.path }));
            setDraft(draftOf(merged));
            setSavedAt(Date.now());
          } else {
            setRejected(result.rejected ?? []);
          }
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      const setLocal = (key, value) => {
        setLocalAt(0);
        setLocalRejected([]);
        setLocalDraft(current => ({ ...(current ?? {}), [key]: value }));
      };

      const saveLocal = async () => {
        if (data === null || localDraft === null) return;
        const patch = localPatchOf(localDraft, data.local);
        if (Object.keys(patch).length === 0) {
          setLocalAt(-1);
          return;
        }
        setBusy(true);
        setError('');
        setLocalRejected([]);
        try {
          const result = await api('/local', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch }),
          });
          if (result.ok) {
            // 同 save()：以宿主回的快照为准，别把草稿当真相。
            setData(current => ({ ...current, local: result.local }));
            setLocalDraft(localDraftOf(result.local));
            setLocalAt(Date.now());
          } else {
            setLocalRejected(result.rejected ?? []);
          }
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      /**
       * 换悬浮窗样式：单独一条路由，**不跟主表单一起提交**。
       *
       * 它写的是 watch-window.json（窗口自己也在写 geometry/name/hidden），
       * 和 see-now.json 不是一份文件；而且窗口盯着这个文件的 mtime，改完就换 ——
       * 没有必要让用户再点一次「保存」。
       */
      const applyWindow = async (patch) => {
        if (patch.style !== undefined) setWindowStyleState(patch.style);
        setWindowAt(0);
        setError('');
        try {
          const result = await api('/window', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch }),
          });
          if (result.ok) {
            setData(current => (current ? { ...current, window: result.window } : current));
            setWindowAt(Date.now());
          } else {
            setError((result.rejected ?? []).join('；'));
          }
        } catch (err) {
          setError(String(err?.message ?? err));
        }
      };

      /**
       * 录制快捷键：整页接管 keydown。
       *
       * 四个细节：
       *  - **capture 阶段 + preventDefault**：`Ctrl+W` / `Ctrl+R` 这类宿主加速键平时
       *    会先被吃掉，只有在这里抢在它们前面拦一道，用户按下的组合才可能记下来；
       *  - 只按了修饰键（Ctrl/Alt/Shift/Win）时不提交，只把预览拼出来 —— 否则
       *    "按下 Ctrl" 就会被记成 `Ctrl`，而那不是一个能用的开关；
       *  - **攒着 + 静默之后才定稿**：每按一下就重置 `HOTKEY_SETTLE_MS` 的定时器，
       *    手停下来才提交。一按就提交的话，想设三键组合的人第二个键还没按到就被收走了；
       *  - 用 `e.code` 的思路不行：我们要的是显示名，`e.key` 在各种输入法/布局下更稳，
       *    认不出来的一律忽略（不猜）。
       */
      useEffect(() => {
        if (!capturing) return undefined;
        const onKey = (e) => {
          if (e.repeat) return;
          const name = keyNameOf(e);
          if (!name) return;
          e.preventDefault();
          e.stopPropagation();
          if (name === 'Esc') {
            clearCaptureTimer();
            captureKeys.current = [];
            setCapturing(false);
            setCapturePreview('');
            return;
          }
          const mods = [];
          if (e.ctrlKey) mods.push('Ctrl');
          if (e.altKey) mods.push('Alt');
          if (e.shiftKey) mods.push('Shift');
          if (e.metaKey) mods.push('Win');
          const isModifier = MOD_ORDER.includes(name);
          const pressed = isModifier ? mods : [...mods.filter(m => m !== name), name];
          const next = mergeHotkeyKeys(captureKeys.current, pressed);
          // 上限三个键：多余的按键**直接不收**（而不是收下再让宿主整笔拒掉 ——
          // 那样用户只会在保存时看到一句"被拒绝"，还看不出是哪个键多的）
          if (next.length > 3) return;
          captureKeys.current = next;
          setCapturePreview(hotkeyText(next));
          clearCaptureTimer();
          // 还只有修饰键：继续等真正的那个键，不定稿
          if (!next.some(k => !MOD_ORDER.includes(k))) return;
          captureTimer.current = setTimeout(() => {
            captureTimer.current = null;
            const keys = captureKeys.current;
            captureKeys.current = [];
            setCapturing(false);
            setCapturePreview('');
            if (keys.length > 0) set('hotkey', keys);
          }, HOTKEY_SETTLE_MS);
        };
        window.addEventListener('keydown', onKey, true);
        return () => {
          window.removeEventListener('keydown', onKey, true);
          // 卸载/关闭录制时把没定稿的定时器收掉，别在组件没了之后还 setState
          clearCaptureTimer();
        };
        // `set` 每次渲染都是新的闭包，但它只碰 draft；这里只该在开关变化时重挂监听
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [capturing]);

      /**
       * 会话面板：点在外面就收起来。
       *
       * 用 capture 阶段监听 `mousedown` 而不是 `click`：点别处的按钮时先收起面板，
       * 那个按钮自己那一下照常生效（换成 click 的话，有的控件会先吃掉这一下）。
       * `pickBox.current.contains` 判断"是不是自己人"—— 面板里的搜索框、选项、
       * 滚动条都算，点在它们上面不会误收。
       */
      useEffect(() => {
        if (!pickOpen) return undefined;
        const onDown = (e) => {
          if (pickBox.current && !pickBox.current.contains(e.target)) {
            setPickOpen(false);
            setPickQuery('');
          }
        };
        window.addEventListener('mousedown', onDown, true);
        return () => window.removeEventListener('mousedown', onDown, true);
      }, [pickOpen]);

      if (data === null || draft === null) {
        return h('div', { className: 'sn_root' },
          h('div', { className: 'sn_hero' },
            h('h2', { className: 'sn_title' }, t('title')),
            h('p', { className: 'sn_sub' }, t('sub'))),
          error !== '' ? h('div', { className: 'sn_box bad' }, `${t('err.load')}：${error}`) : h('div', { className: 'sn_note' }, t('state.loading')),
          h('div', { className: 'sn_row' }, h('button', { className: 'sn_btn', onClick: load, disabled: busy }, t('state.reload'))));
      }

      const field = (key, labelKey, hintKey, props) => h('label', { className: 'sn_field', key },
        h('span', { className: 'sn_label' }, t(labelKey)),
        h('input', {
          className: 'sn_input',
          type: 'number',
          value: String(draft[key] ?? ''),
          onChange: e => set(key, e.target.value),
          ...props,
        }),
        h('span', { className: 'sn_hint' }, t(hintKey)));

      const select = (key, labelKey, hintKey, options) => h('label', { className: 'sn_field', key },
        h('span', { className: 'sn_label' }, t(labelKey)),
        h('select', {
          className: 'sn_select',
          // 缺种时给空串：`String(undefined)` 会让下拉框渲染出一个名为 "undefined" 的选项
          value: String(draft[key] ?? ''),
          onChange: e => set(key, e.target.value === 'true' ? true : e.target.value === 'false' ? false : e.target.value),
        }, options.map(([value, text]) => h('option', { key: String(value), value: String(value) }, text))),
        h('span', { className: 'sn_hint' }, t(hintKey)));

      // asr.json 那一套的控件：数据源是 localDraft，不是 draft（两个不同的文件）。
      const localField = (key, labelKey, hintKey, props) => h('label', { className: 'sn_field', key: `l_${key}` },
        h('span', { className: 'sn_label' }, t(labelKey)),
        h('input', {
          className: 'sn_input',
          value: String(localDraft?.[key] ?? ''),
          onChange: e => setLocal(key, e.target.value),
          ...props,
        }),
        h('span', { className: 'sn_hint' }, t(hintKey)));

      const localSelect = (key, labelKey, hintKey, options) => h('label', { className: 'sn_field', key: `l_${key}` },
        h('span', { className: 'sn_label' }, t(labelKey)),
        h('select', {
          className: 'sn_select',
          value: String(localDraft?.[key] ?? ''),
          onChange: e => setLocal(key, e.target.value),
        }, options.map(([value, text]) => h('option', { key: String(value), value: String(value) }, text))),
        h('span', { className: 'sn_hint' }, t(hintKey)));

      // ── 小窗与快捷键：下拉选项 + 伴生进程状态 ──
      //
      // 会话列表来自 `/status`（打开面板那一刻现取）。取不到时不能只显示空下拉 ——
      // 那看起来像"没有任何会话可绑"，而其实只是这一版的宿主没给列表。
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      const boundId = String(draft.talkSession ?? 'follow');
      const sessionOptions = [
        ['follow', t('talk.follow')],
        ...sessions.map((s) => {
          // 名字优先：光给 id 前缀谁认得出哪个是哪个。真没名字（还没起标题的新会话）
          // 才退回 id 前缀，至少还能对上眼。
          const label = s.title ? String(s.title) : `${String(s.id).slice(0, 8)}…`;
          return [s.id, s.active ? `${label}${t('talk.current')}` : label];
        }),
      ];
      /**
       * 绑的那个会话可能已经关了，也可能这次的列表根本没取到。
       *
       * 这时**必须把它补进选项**：不补的话下拉框会落到第一项「不绑定」上 ——
       * 用户只是来改个快捷键，一保存就把绑定悄悄取消了，而且看不出来为什么。
       */
      if (boundId !== 'follow' && !sessionOptions.some(([value]) => value === boundId)) {
        sessionOptions.push([boundId, `${boundId.slice(0, 8)}… ${t('talk.missing')}`]);
      }
      const boundLabel = (() => {
        const hit = sessionOptions.find(([value]) => String(value) === boundId);
        if (hit) return hit[1];
        return boundId === 'follow' ? t('talk.follow') : `${boundId.slice(0, 8)}…`;
      })();
      // 会话多的时候（几百个）光靠滚动是找不着东西的 —— 面板顶上给个过滤框，
      // 标题和 id 都参与匹配，粘一段 id 也能定位。
      const pickRows = (() => {
        const q = pickQuery.trim().toLowerCase();
        if (!q) return sessionOptions;
        return sessionOptions.filter(([value, label]) =>
          String(label).toLowerCase().includes(q) || String(value).toLowerCase().includes(q));
      })();

      const comp = data.companion ?? null;
      const companionStatus = (() => {
        const status = comp?.status ?? 'unknown';
        if (status === 'running') return t('talk.companion.running');
        if (status === 'off') return t('talk.companion.off');
        if (status === 'unsupported') return t('talk.companion.unsupported');
        if (status === 'starting') return t('state.loading');
        return `${t('talk.companion.bad')}：${comp?.reason ?? '未知'}`;
      })();

      // ── 转写服务：asr.json ──
      // 放在「常用」**下面**：先看"用哪个"，再看"那个服务的细节"。顶在最上面会让
      // 人以为这是在替换宿主自带的转写 —— 它只是备选，选「只用宿主的」时整块收起。
      const localCard = data.local && localDraft && shouldShowLocal(draft.prefer)
        ? h('div', { className: 'sn_card' },
          h('div', { className: 'sn_cardhd' }, h('span', { className: 'sn_cardname' }, t('local.title'))),
          h('p', { className: 'sn_note', style: { margin: '0 0 10px' } }, t('local.sub')),
          h('div', { className: 'sn_mono', style: { marginBottom: '10px' } }, data.local.path),
          !data.local.exists ? h('div', { className: 'sn_hint', style: { marginBottom: '10px' } }, t('local.empty')) : null,
          h('div', { className: 'sn_grid' },
            localSelect('api', 'local.api', 'local.api.hint', [
              ['openai-audio', t('local.api.openai')],
              ['chat-audio', t('local.api.chat')],
            ]),
            localField('baseUrl', 'local.baseUrl', 'local.baseUrl.hint', { type: 'text', placeholder: t('local.baseUrl.ph') }),
            localField('model', 'local.model', 'local.model.hint', { type: 'text' }),
            localField('language', 'local.language', 'local.language.hint', { type: 'text' }),
            localField('key', 'local.key', 'local.key.hint', {
              type: 'password',
              autoComplete: 'off',
              placeholder: data.local.hasKey ? t('local.key.keep') : t('local.key.ph'),
            })),

          data.local.manage ? h('div', { className: 'sn_hint', style: { marginTop: '8px' } }, t('local.manage')) : null,
          data.local.envKeys && data.local.envKeys.length > 0
            ? h('div', { className: 'sn_box warn', style: { marginTop: '10px' } },
              `${t('local.env')}：${data.local.envKeys.join('、')}`)
            : null,

          localRejected.length > 0
            ? h('div', { className: 'sn_box bad', style: { marginTop: '10px' } },
              t('err.rejected'),
              h('ul', {}, localRejected.map((line, i) => h('li', { key: i }, line))))
            : null,

          h('div', { className: 'sn_row', style: { marginTop: '10px' } },
            h('button', { className: 'sn_btn', onClick: saveLocal, disabled: busy }, t('local.save')),
            localAt > 0 ? h('span', { className: 'sn_ok' }, t('state.savedLocal')) : null,
            localAt < 0 ? h('span', { className: 'sn_note' }, t('state.nosave')) : null),

          h('details', { className: 'sn_det', style: { marginTop: '10px' } },
            h('summary', {}, t('local.sample')),
            h('pre', { className: 'sn_pre' }, t('local.sample.body'))))
        : null;

      return h('div', { className: 'sn_root' },
        h('div', { className: 'sn_hero' },
          h('h2', { className: 'sn_title' }, t('title')),
          h('p', { className: 'sn_sub' }, t('sub')),
          h('div', { className: 'sn_mono' }, `${t('hint.path')}：${data.path}`)),

        data.warnings.length > 0
          ? h('div', { className: 'sn_box warn', role: 'status' },
            t('warn.title'),
            h('ul', {}, data.warnings.map((line, i) => h('li', { key: i }, line))))
          : null,

        h('div', { className: 'sn_box' }, t('hint.restart')),

        // ── 悬浮窗样式 ──
        // 放在「常用」上面：它是这一页唯一"改完立刻能看见"的东西，也最常被调
        h('div', { className: 'sn_card' },
          h('div', { className: 'sn_cardhd' }, h('span', { className: 'sn_cardname' }, t('win.title'))),
          h('p', { className: 'sn_note', style: { margin: 0 } }, t('win.sub')),
          h('div', { className: 'sn_grid' },
            h('label', { className: 'sn_field' },
              h('span', { className: 'sn_label' }, t('win.style')),
              h('select', {
                className: 'sn_select',
                value: windowStyle || 'auto',
                onChange: e => { void applyWindow({ style: e.target.value }); },
              }, ['auto', 'live', 'frost', 'solid'].map(value =>
                h('option', { key: value, value }, t('win.style.' + value)))),
              h('span', { className: 'sn_hint' }, t('win.style.hint')))),
          h('div', { className: 'sn_grid' },
            h('label', { className: 'sn_field' },
              h('span', { className: 'sn_label' }, t('win.mode')),
              h('select', {
                className: 'sn_select',
                value: data.window?.mode || 'full',
                onChange: e => { void applyWindow({ mode: e.target.value }); },
              }, ['full', 'hidden'].map(value =>
                h('option', { key: value, value }, t('win.mode.' + value)))),
              h('span', { className: 'sn_hint' }, t('win.mode.hint'))),
            h('label', { className: 'sn_field' },
              h('span', { className: 'sn_label' }, t('win.danmaku')),
              h('select', {
                className: 'sn_select',
                value: data.window?.danmaku ? 'on' : 'off',
                onChange: e => { void applyWindow({ danmaku: e.target.value === 'on' }); },
              }, ['off', 'on'].map(value =>
                h('option', { key: value, value }, t('win.danmaku.' + value)))),
              h('span', { className: 'sn_hint' }, t('win.danmaku.hint')))),
          h('p', { className: 'sn_note', style: { margin: 0 } }, t('win.game.hint')),
          data.window && data.window.path
            ? h('div', { className: 'sn_mono' }, `${t('win.path')}：${data.window.path}`)
            : null,
          windowAt > 0 ? h('span', { className: 'sn_ok', role: 'status' }, t('win.applied')) : null),

        // ── 小窗与快捷键 ──
        // 紧跟在悬浮窗卡片后面：两张都是"改完立刻生效"的，也都是关于"这个小窗本身"的。
        h('div', { className: 'sn_card' },
          h('div', { className: 'sn_cardhd' }, h('span', { className: 'sn_cardname' }, t('talk.title'))),
          h('p', { className: 'sn_note', style: { margin: 0 } }, t('talk.sub')),

          h('div', { className: 'sn_field', key: 'talkSession' },
            h('span', { className: 'sn_label' }, t('talk.session')),
            h('div', { className: 'sn_pick', ref: pickBox },
              h('button', {
                type: 'button',
                className: 'sn_pickbtn',
                title: t('talk.pick'),
                onClick: () => {
                  setPickOpen(v => !v);
                  setPickQuery('');
                },
              },
              h('span', { className: 'sn_picktitle' }, boundLabel),
              // 缩成前 8 位，但 `title` 挂完整 id —— 鼠标停上去就能核对是哪一个
              boundId === 'follow'
                ? null
                : h('span', { className: 'sn_pickid', title: boundId }, boundId.slice(0, 8)),
              h('span', { className: 'sn_caret' }, pickOpen ? '▴' : '▾')),

              pickOpen ? h('div', { className: 'sn_panel' },
                sessionOptions.length > 6
                  ? h('input', {
                    className: 'sn_filter',
                    value: pickQuery,
                    placeholder: t('talk.search'),
                    onChange: e => setPickQuery(e.target.value),
                  })
                  : null,
                h('div', { className: 'sn_list' },
                  pickRows.length === 0
                    ? h('div', { className: 'sn_none' }, t('talk.empty'))
                    : pickRows.map(([value, text]) => h('button', {
                      type: 'button',
                      key: String(value),
                      className: `sn_opt${String(value) === boundId ? ' on' : ''}`,
                      onClick: () => {
                        set('talkSession', value);
                        setPickOpen(false);
                        setPickQuery('');
                      },
                    },
                    h('span', { className: 'sn_opttitle' }, text),
                    String(value) === 'follow'
                      ? null
                      : h('span', { className: 'sn_optid', title: String(value) }, String(value).slice(0, 8)))))) : null),
            h('span', { className: 'sn_hint' }, t('talk.session.hint')),
            sessions.length === 0
              ? h('span', { className: 'sn_hint' },
                data.sessionsNote ? `${t('talk.empty')}（${data.sessionsNote}）` : t('talk.empty'))
              : null,
            sessions.length > 0 ? h('span', { className: 'sn_hint' }, t('talk.idhint')) : null),

          h('div', { className: 'sn_field', key: 'hotkey' },
            h('span', { className: 'sn_label' }, t('talk.hotkey')),
            h('div', { className: 'sn_row' },
              h('button', {
                type: 'button',
                className: `sn_cap${capturing ? ' on' : ''}`,
                onClick: () => {
                  // 点框子 = 「就这样吧」：攒着的键够用就直接定稿，别让用户白按一遍
                  const pending = captureKeys.current;
                  const usable = capturing && pending.length > 0
                    && pending.some(k => !MOD_ORDER.includes(k));
                  clearCaptureTimer();
                  captureKeys.current = [];
                  setCapturePreview('');
                  if (usable) {
                    setCapturing(false);
                    set('hotkey', pending);
                    return;
                  }
                  setCapturing(v => !v);
                },
              },
              capturing
                ? (capturePreview || t('talk.hotkey.rec'))
                : (hotkeyText(draft.hotkey) || t('talk.hotkey.unset'))),
              hotkeyText(draft.hotkey)
                ? h('button', {
                  type: 'button',
                  className: 'sn_btn',
                  onClick: () => {
                    clearCaptureTimer();
                    captureKeys.current = [];
                    set('hotkey', []);
                    setCapturing(false);
                    setCapturePreview('');
                  },
                }, t('talk.hotkey.clear'))
                : null),
            h('span', { className: 'sn_hint' }, t('talk.hotkey.hint')),
            h('span', { className: 'sn_hint' }, t('talk.hotkey.warn'))),

          // 两条焦点开关：上面那条关着时下面这条置灰而不是藏起来 ——
          // 藏起来的话用户不知道"为什么我切走它不回来"，置灰至少能看出因果
          h('label', { className: 'sn_check', key: 'focusPause' },
            h('input', {
              type: 'checkbox',
              checked: draft.focusPause === true,
              onChange: e => set('focusPause', e.target.checked),
            }),
            h('span', {}, t('talk.focusPause'))),
          h('span', { className: 'sn_hint' }, t('talk.focusPause.hint')),

          h('label', {
            className: 'sn_check',
            key: 'focusResume',
            style: draft.focusPause === true ? undefined : { opacity: 0.55 },
          },
          h('input', {
            type: 'checkbox',
            checked: draft.focusResume !== false,
            disabled: draft.focusPause !== true,
            onChange: e => set('focusResume', e.target.checked),
          }),
          h('span', {}, t('talk.focusResume'))),
          h('span', { className: 'sn_hint' }, t('talk.focusResume.hint')),

          // 第三条：按快捷键时拉不拉窗。它和上面两条不是一回事（那两条管"什么时候停"，
          // 这条管"开的时候要不要在屏幕上出现"），所以不加缩进层级，平铺着排。
          h('label', { className: 'sn_check', key: 'hotkeyWindow' },
            h('input', {
              type: 'checkbox',
              checked: draft.hotkeyWindow !== false,
              onChange: e => set('hotkeyWindow', e.target.checked),
            }),
            h('span', {}, t('talk.hotkeyWindow'))),
          h('span', { className: 'sn_hint' }, t('talk.hotkeyWindow.hint')),

          h('div', { className: 'sn_row', style: { marginTop: '2px' } },
            h('span', { className: 'sn_mono' }, `${t('talk.companion')}：${companionStatus}`),
            comp && comp.canHotkey === false
              ? h('span', { className: 'sn_hint' }, t('talk.companion.noFocus'))
              : null),
          comp && comp.status === 'error'
            ? h('div', { className: 'sn_box warn', role: 'status' }, `${t('talk.companion.bad')}：${comp.reason ?? '未知'}`)
            : null),

        // ── 常用 ──
        h('div', { className: 'sn_card' },
          h('div', { className: 'sn_cardhd' }, h('span', { className: 'sn_cardname' }, t('sec.common'))),
          h('div', { className: 'sn_grid' },
            select('prefer', 'field.prefer', 'field.prefer.hint', [
              ['auto', t('prefer.auto')],
              ['host', t('prefer.host')],
              ['local', t('prefer.local')],
            ]),
            select('defaultPace', 'field.pace', 'field.pace.hint', [
              ['calm', t('pace.calm')],
              ['normal', t('pace.normal')],
              ['dense', t('pace.dense')],
              ['game-economic', t('pace.game-economic')],
            ]),
            select('wakeBatch', 'field.batch', 'field.batch.hint', [
              [1, t('batch.1')],
              [2, t('batch.2')],
              [3, t('batch.3')],
              [4, t('batch.4')],
            ]),
            field('idleStopMin', 'field.idleStop', 'field.idleStop.hint', { min: 0, max: 1440, step: 1 }),
            select('speechPacing', 'field.pacing', 'field.pacing.hint', [
              [true, t('pacing.follow')],
              ['guard', t('pacing.guard')],
              [false, t('pacing.off')],
            ]),
            field('silence', 'field.silence', 'field.silence.hint', { min: 0.15, max: 1.5, step: 0.05 }),
            field('maxSeg', 'field.maxSeg', 'field.maxSeg.hint', { min: 0.8, max: 15, step: 0.1 }))),

        localCard,

        // ── 高级 ──
        h('details', { className: 'sn_det sn_card' },
          h('summary', {}, t('sec.advanced')),
          h('div', { className: 'sn_grid', style: { marginTop: '12px' } },
            select('tierStyle', 'field.tierStyle', 'field.tierStyle.hint', [
              ['standard', t('tier.standard')],
              ['native', t('tier.native')],
              ['full', t('tier.full')],
              ['compact', t('tier.compact')],
              ['custom', t('tier.custom')],
            ]),
            select('tierMode', 'field.tierMode', 'field.tierMode.hint', [
              ['density', t('mode.density')],
              ['weight', t('mode.weight')],
            ]),
            select('tierCurve', 'field.tierCurve', 'field.tierCurve.hint', [
              ['docx', t('curve.docx')],
              ['perceptual', t('curve.perceptual')],
              ['custom', t('curve.custom')],
            ]),
            field('maxAutonomousWakes', 'field.wakes', 'field.wakes.hint', { min: 1, max: 200, step: 1 }),
            field('imageTrigger', 'field.imageTrigger', 'field.imageTrigger.hint', { min: 0, max: 2000, step: 10 }),
            field('imageKeep', 'field.imageKeep', 'field.imageKeep.hint', { min: 0, max: 2000, step: 10 }),
            field('liveMin', 'field.liveMin', 'field.liveMin.hint', { min: 0.8, max: 6, step: 0.1 }),
            field('liveStep', 'field.liveStep', 'field.liveStep.hint', { min: 0.4, max: 4, step: 0.1 }),
            field('pollMs', 'field.pollMs', 'field.pollMs.hint', { min: 50, max: 1000, step: 10 })),

          /**
           * 选了「自定义」才展开这 8 个下拉。
           *
           * 左边是**算出来的档位**，右边选它实际落到哪一档 —— 不是"把第 i 格画多大"，
           * 是"这一档的帧应该长多大"。两者容易搞混，所以第一列写 `i →` 而不是"第 i 档"。
           */
          draft.tierStyle === 'custom'
            ? h('div', { className: 'sn_grid', style: { marginTop: '12px' } },
              h('span', { className: 'sn_label', style: { gridColumn: '1 / -1' } }, t('field.tierMap')),
              /**
               * 一键填满：把八项一起改成同一个档。
               *
               * 这就是"每帧固定这么大"的做法 —— 八项都指向同一档时，密度算出来的档位
               * 被整表吃掉，节奏怎么改都不影响尺寸。**不做成独立选项**：它和逐档自定义
               * 是同一件事，多一个概念只会让人以为还有别的能力。
               */
              h('label', { className: 'sn_field', key: 'fill', style: { gridColumn: '1 / -1' } },
                h('span', { className: 'sn_label' }, t('field.fillTierMap')),
                h('select', {
                  className: 'sn_select',
                  defaultValue: '',
                  onChange: (e) => {
                    const v = Number(e.target.value);
                    if (v >= 1 && v <= 8) set('tierMap', Array.from({ length: 8 }, () => v));
                    e.target.selectedIndex = 0;
                  },
                },
                h('option', { value: '' }, t('field.fillTierMap.pick')),
                [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('option', { key: n, value: String(n) }, `${n} 档`))),
                h('span', { className: 'sn_hint' }, t('field.fillTierMap.hint'))),
              [0, 1, 2, 3, 4, 5, 6, 7].map((i) => h('label', { className: 'sn_field', key: `tm${i}` },
                h('span', { className: 'sn_label' }, `${i + 1} →`),
                h('select', {
                  className: 'sn_select',
                  value: String(draft.tierMap?.[i] ?? i + 1),
                  onChange: (e) => setTierMap(i, e.target.value),
                }, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('option', { key: n, value: String(n) }, String(n)))))))
            : null,
          draft.tierStyle === 'custom'
            ? h('span', { className: 'sn_hint' }, t('field.tierMap.hint'))
            : null,
          /**
           * 七道阈值自己填。**只在选「自定义」时出现** —— 选 docx / 感知时那套数字是
           * 代码定的，露出来只会让人以为改得动。
           *
           * 顺序有意义：第 i 个是"多密算第 i+1 档"，必须严格递增。前端不拦，
           * 交给 `tuning.js` 统一判（那边拒了会把原话显示在下面）。
           */
          draft.tierCurve === 'custom'
            ? h('div', { className: 'sn_grid', style: { marginTop: '12px' } },
              h('span', { className: 'sn_label', style: { gridColumn: '1 / -1' } }, t('field.tierThresholds')),
              [0, 1, 2, 3, 4, 5, 6].map((i) => h('label', { className: 'sn_field', key: `th${i}` },
                h('span', { className: 'sn_label' }, `第 ${i + 1} 道`),
                h('input', {
                  className: 'sn_input',
                  type: 'number',
                  step: '0.01',
                  min: '0.01',
                  value: String(draft.tierThresholds?.[i] ?? ''),
                  onChange: (e) => setThreshold(i, e.target.value),
                }))),
              h('span', { className: 'sn_hint', style: { gridColumn: '1 / -1' } }, t('field.tierThresholds.hint')))
            : null,
          h('label', { className: 'sn_check', style: { marginTop: '12px' } },
            h('input', {
              type: 'checkbox',
              checked: draft.live === true,
              onChange: e => set('live', e.target.checked),
            }),
            h('span', {}, t('field.live'))),
          h('span', { className: 'sn_hint' }, t('field.live.hint'))),

        // ── 保存 ──
        rejected.length > 0
          ? h('div', { className: 'sn_box bad', role: 'alert' },
            t('err.rejected'),
            h('ul', {}, rejected.map((line, i) => h('li', { key: i }, line))))
          : null,

        error !== ''
          ? h('div', { className: 'sn_box bad', role: 'alert' }, `${t('err.save')}：${error}`)
          : null,

        h('div', { className: 'sn_row' },
          h('button', { className: 'sn_btn primary', onClick: save, disabled: busy },
            busy ? t('state.saving') : t('state.save')),
          h('button', { className: 'sn_btn', onClick: load, disabled: busy }, t('state.reload')),
          savedAt > 0 ? h('span', { className: 'sn_ok', role: 'status' }, t('state.saved')) : null,
          savedAt < 0 ? h('span', { className: 'sn_note' }, t('state.nosave')) : null),

        h('div', { className: 'sn_note' }, t('hint.origin')));
    }

    // ── 接进 shell ────────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style');
        style.setAttribute('data-plugin', 'dsh-see-now');
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'dsh-see-now: styles');

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'see-now',
        order: 43,
        label: () => t('nav'),
        locale: NS,
      }, () => h(SettingsPage)));
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = 'dsh-see-now';
    exports.__test = { draftOf, mergeValues, patchOf, num, TEXT, localDraftOf, localPatchOf, shouldShowLocal,
      hotkeyText, keyNameOf };
    return module.exports;
  },
});
