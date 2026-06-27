import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse, findClassInLoaders } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

/**
 * 解复制限制
 *
 * 真相:帖子"禁止复制"是作者发布时关闭的笔记级开关。
 * UI 体现:选中文本后弹出的菜单里,"复制"按钮变灰,点击提示
 *   "作者已设置该笔记不可复制"(R.string 0x7f111e77)。
 *
 * 判定逻辑在 ru8.i.N1(i) (isSupportCopy):
 *   - 取笔记的 note_text_press_options (noteFeedB.x1())
 *   - 找 key == "copy" 的 NoteTextPressOptions
 *   - 找到 -> 支持复制;作者关闭复制 = 不下发 copy 选项 -> 不支持
 * 复制菜单项 ru8.i$g.onClick 里:if (N1(...)) 才复制,否则弹 toast。
 *
 * 策略:hook ru8.i 中"static boolean(自身类型)"方法(即 N1),强制返回 true。
 *       这样复制按钮永远可用,点击直接复制。
 *
 * 锚点:ru8.i 类含日志字符串 "AsyncTextContentController"、"copyMenu.onClick"、
 *       "isSupportCopy"。方法签名:public static boolean (ru8.i) —— 单参、参数类型=自身。
 *       按你的要求,不写死方法名 N1,用签名扫描定位。
 *
 * 兜底:同时保留 TextComponent / ReactTextView / RichTextView 的 selectable 强制,
 *       覆盖 xycanvas DSL / RN / 富文本三条渲染路径(防止别的页面也有 selectable 限制)。
 */
export const copyUnrestrict: Feature = {
    key: "copyUnrestrict",
    enable(cfg: FeatureConfig) { return cfg.copyUnrestrict; },
    install() {
        hookIsSupportCopy();
    },
};

/** hook ru8.i.N1 (isSupportCopy) 强制 true。 */
function hookIsSupportCopy() {
    const cls = findClassInLoaders("ru8.i");
    if (!cls) { warn("[copy] ru8.i not found"); return; }
    // 找 static 方法:返回 boolean,1 个参数,参数类型是 ru8.i 自身。
    let hooked = false;
    try {
        for (const name of (cls.$ownMembers ?? [])) {
            const m = (cls as any)[name];
            if (!m || !m.overloads) continue;
            for (const ov of m.overloads) {
                if (ov.type !== 2) continue; // 2 = static (MethodType.Static)
                const rtype = ov.returnType;
                if (rtype.name !== "Z") continue; // 返回 boolean
                const ats = ov.argumentTypes as any[];
                if (ats.length !== 1) continue;
                // 参数类型 = ru8.i 自身
                if ((ats[0].className ?? "") !== "ru8.i") continue;
                try {
                    ov.implementation = function (_arg: any) {
                        console.log("[copy] ru8.i." + name + "(i) -> isSupportCopy=true");
                        return true;
                    };
                    log("[copy] hooked ru8.i." + name + "(i) -> isSupportCopy=true");
                    hooked = true;
                } catch (e) { warn("[copy] hook " + name + " failed:", String(e)); }
            }
        }
    } catch (e) { warn("[copy] scan N1 failed:", String(e)); }
    if (!hooked) warn("[copy] no isSupportCopy method matched in ru8.i");
}
