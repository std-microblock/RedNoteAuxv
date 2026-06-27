import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

/**
 * 下载去水印
 *
 * 三条保存链路,全部覆盖:
 *  1. 浏览笔记时保存图片(最常用)  → po7.j (SaveImagesHelper)
 *     - j.a(bmp, stdWm, ?, aiWm, z90, z100) 合成水印位图。
 *       z90/z100 = 标准水印 / AI 水印开关(false=显示)。
 *       bitmap2 = 标准水印(右下), bitmap4 = AI 水印(左下)。
 *     - 最稳妥:直接 hook j.a 返回原图(第一个参数),整个合成(含白底+水印)全跳过。
 *     - 备选:hook j.b / j.c 返回 null(它们生成 AI / 标准水印位图),
 *       j.a 里 `!z && bitmap!=null` 的分支就什么都不画。
 *  2. 发布图片保存   → df3.c (ImageAlbumSaveUtils):arg1(use_water_marker)→false
 *  3. 视频保存       → ki3.x1 ctor 第7参 z100(noWatermark 字段)→true
 *
 * po7.j / df3.c / ki3.x1 都在子 classloader,必须用 findClassInLoaders。
 */
export const downloadNoWatermark: Feature = {
    key: "downloadNoWatermark",
    enable(cfg) { return cfg.downloadNoWatermark; },
    install() {
        hookBrowseImageWatermark();
        hookPublishImageWatermark();
        hookVideoWatermark();
    },
};

// ---- 1. 浏览图片保存水印(po7.j) ----

function hookBrowseImageWatermark() {
    const cls = findClassInLoaders("po7.j");
    if (!cls) { warn("[wm] po7.j not found in any loader"); return; }

    // j.a(Bitmap, Bitmap, Bitmap, Bitmap, boolean, boolean) -> Bitmap
    const ARG_TYPES = [
        "android.graphics.Bitmap", "android.graphics.Bitmap",
        "android.graphics.Bitmap", "android.graphics.Bitmap",
        "boolean", "boolean",
    ];
    let hooked = false;
    for (const name of (cls.$ownMembers ?? [])) {
        const m = (cls as any)[name];
        if (!m || !m.overloads) continue;
        let ov: any = null;
        try { ov = m.overload(...ARG_TYPES); } catch { continue; }
        try {
            ov.implementation = function (bitmap: any, _std: any, _b3: any, _ai: any, _z90: boolean, _z100: boolean) {
                // 直接返回原图,跳过白底 + 标准水印 + AI 水印合成
                return bitmap;
            };
            log(`[wm] hooked po7.j.${name}(Bitmap×4,Z,Z) -> return original`);
            hooked = true;
        } catch (e) { warn(`[wm] po7.j.${name} hook failed:`, String(e)); }
    }
    if (!hooked) {
        // 备选:让水印生成方法返回 null
        hookReturnNull(cls, ["android.content.Context", "boolean"], "j.b");
        hookReturnNull(cls, ["android.content.Context", "java.lang.String", "boolean"], "j.c");
    }
}

function hookReturnNull(cls: any, argTypes: string[], label: string) {
    for (const name of (cls.$ownMembers ?? [])) {
        const m = (cls as any)[name];
        if (!m || !m.overloads) continue;
        let ov: any = null;
        try { ov = m.overload(...argTypes); } catch { continue; }
        try {
            ov.implementation = function (..._args: any[]) { return null; };
            log(`[wm] hooked ${label} -> return null`);
        } catch (e) { warn(`[wm] ${label} hook failed:`, String(e)); }
    }
}

// ---- 2. 发布图片保存水印(df3.c) ----

function hookPublishImageWatermark() {
    const cls = findClassInLoaders("df3.c");
    if (!cls) { warn("[wm] df3.c not found in any loader"); return; }
    hookForceArgFalse(cls, ["com.xingin.capa.capa_session.model.SavingImageBean", "boolean", "java.lang.String"], 1, "publish a()");
    hookForceArgFalse(cls, ["java.util.ArrayList", "boolean", "java.lang.String", "boolean"], 1, "publish b()");
}

// ---- 3. 视频保存水印(ki3.x1) ----

function hookVideoWatermark() {
    const cls = findClassInLoaders("ki3.x1");
    if (!cls) { warn("[wm] ki3.x1 not found in any loader"); return; }
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
        else warn("[wm] ki3.x1: no matching 7-arg ctor");
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
