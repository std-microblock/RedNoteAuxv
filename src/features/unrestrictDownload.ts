import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { findClassInLoaders } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

/**
 * 解除下载限制
 *
 * 机制(与复制限制同源):作者发布时可关闭"允许下载",笔记详情页长按弹出的
 * 顶部按钮栏里,"保存"按钮若是 disabled,点击弹 toast "作者已设置不可下载"。
 *
 * 判定: com.xingin.longpress.dialog.item.topbutton.ItemTopButtonPresenter.Z9()
 *   行 361: if (ga().d() == Boolean.TRUE) -> k.h(ga().e()) 显示 disableToast,
 *   不触发下载。ga() 返回 u68.l。
 * u68.l.d() 返回 @cd.c("disable") Boolean disable 字段。
 *
 * 策略:hook u68.l.d() 强制返回 Boolean.FALSE(非 disabled),
 *       使点击走 else 分支正常触发下载。
 *
 * 锚点:u68.l 类(包路径稳定),d() 是无参返回 java.lang.Boolean 的方法。
 *      u68.l 可能在子 loader,用 findClassInLoaders。
 */
export const unrestrictDownload: Feature = {
    key: "unrestrictDownload",
    enable(cfg) { return cfg.unrestrictDownload; },
    install() {
        hookIsDisabled();
    },
};

function hookIsDisabled() {
    const cls = findClassInLoaders("u68.l");
    if (!cls) { warn("[dl] u68.l not found"); return; }
    let hooked = false;
    try {
        for (const name of (cls.$ownMembers ?? [])) {
            const m = (cls as any)[name];
            if (!m || !m.overloads) continue;
            for (const ov of m.overloads) {
                if (ov.argumentTypes.length !== 0) continue;
                const rt = ov.returnType;
                if (rt.className !== "java.lang.Boolean") continue;
                try {
                    ov.implementation = function () {
                        return false; // 返回 Boolean.FALSE
                    };
                    log("[dl] hooked u68.l." + name + "() -> disable=false");
                    hooked = true;
                } catch (e) { warn("[dl] hook " + name + " failed:", String(e)); }
            }
        }
    } catch (e) { warn("[dl] scan failed:", String(e)); }
    if (!hooked) warn("[dl] no u68.l.d() matched");
}
