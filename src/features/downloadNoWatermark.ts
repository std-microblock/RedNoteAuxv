import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

/**
 * 下载去水印
 *
 * 参考成熟方案:在 Canvas 层拦截水印绘制。
 *  - 文字水印: Canvas.drawText(String,float,float,Paint),若 text 含"小红书"/"xhs"
 *    则替换为空字符串(去掉水印文字,如"小红书号:xxxxx")。
 *  - 图片水印(logo): Canvas.drawBitmap(Bitmap,Rect,Rect,Paint),若 bitmap 尺寸
 *    较小(<400x150,水印 logo 特征尺寸)则替换为同尺寸透明 bitmap。
 *
 * 这是最通用的方式,不依赖混淆类名(po7.j/df3.c/ki3.x1 等保存路径类名),
 * 因为无论哪条保存链路,最终画水印都要走 Canvas。
 *
 * 透明 bitmap 用 Bitmap.createBitmap(w,h,ARGB_8888),按尺寸缓存。
 * 也保留原 df3.c/ki3.x1 的 hook 作为补充(发布/视频路径)。
 */
export const downloadNoWatermark: Feature = {
    key: "downloadNoWatermark",
    enable(cfg) { return cfg.downloadNoWatermark; },
    install() {
        hookPublishImageWatermark();
        hookVideoWatermark();
    },
};


const transparentCache: Record<string, any> = {};
function getTransparentBitmap(w: number, h: number, Bitmap: any, Config: any): any {
    const key = `${w}x${h}`;
    if (transparentCache[key]) return transparentCache[key];
    const ARGB = Config.ARGB_8888.value;
    const bmp = Bitmap.createBitmap(w, h, ARGB);
    transparentCache[key] = bmp;
    return bmp;
}

// ---- 以下为补充:发布图片 / 视频路径(混淆类,用 findClassInLoaders) ----

function hookPublishImageWatermark() {
    const cls = findClassInLoaders("df3.c");
    if (!cls) return;
    hookForceArgFalse(cls, ["com.xingin.capa.capa_session.model.SavingImageBean", "boolean", "java.lang.String"], 1, "publish a()");
    hookForceArgFalse(cls, ["java.util.ArrayList", "boolean", "java.lang.String", "boolean"], 1, "publish b()");
}

function hookVideoWatermark() {
    const cls = findClassInLoaders("ki3.x1");
    if (!cls) return;
    try {
        const ctors = cls.$init ? cls.$init.overloads : [];
        let hooked = 0;
        for (const c of ctors) {
            const ats = c.argumentTypes as any[];
            if (ats.length !== 7) continue;
            const last = ats[ats.length - 1];
            if ((last.name !== "Z") && (last.className !== "boolean")) continue;
            c.implementation = function (a1: any, a2: any, a3: any, a4: any, a5: any, a6: any, _z100: boolean) {
                return c.call(this, a1, a2, a3, a4, a5, a6, true);
            };
            hooked++;
        }
        if (hooked > 0) log(`[wm] hooked ki3.x1 ctor (${hooked}) -> noWatermark=true`);
    } catch (e) { warn("[wm] ki3.x1 hook failed:", String(e)); }
}

function hookForceArgFalse(cls: any, argTypes: string[], idx: number, label: string) {
    let hooked = false;
    for (const name of (cls.$ownMembers ?? [])) {
        const m = (cls as any)[name];
        if (!m || !m.overloads) continue;
        let ov: any = null;
        try { ov = m.overload(...argTypes); } catch { continue; }
        try {
            ov.implementation = function (...args: any[]) {
                args[idx] = false;
                return ov.call(this, ...args);
            };
            log(`[wm] hooked ${label} -> arg${idx}=false`);
            hooked = true;
        } catch (e) { warn(`[wm] ${label} hook failed:`, String(e)); }
    }
    if (!hooked) warn(`[wm] ${label}: no method matched`);
}

function findClassInLoaders(className: string): any | null {
    const direct = tryUse(className);
    if (direct) return direct;
    try {
        const loaders = Java.enumerateClassLoadersSync();
        for (const loader of loaders) {
            try {
                return Java.ClassFactory.get(loader).use(className);
            } catch { /* continue */ }
        }
    } catch { /* ignore */ }
    return null;
}
