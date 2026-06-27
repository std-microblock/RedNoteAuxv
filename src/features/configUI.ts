import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse } from "../lib/scan";
import { loadConfig, saveConfig, initPrefs } from "../lib/config";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

/**
 * 插件配置页入口:在小红书「设置」页右上角放一个"插件"文字按钮,
 * 用原生 setOnClickListener(event listener),不碰他的 RxJava/reativity。
 * 点击弹出配置 AlertDialog。
 *
 * 入口 Activity: com.xingin.matrix.setting.SettingActivityV2
 *   onWindowFocusChanged(true) 时 View 树建好,找 ActionBarCommon,
 *   setRightText("插件"),给 rightTextView 设 OnClickListener。
 *
 * 配置存储:文件。实时生效:保存后对新开的 feature 立即 install。
 */
const CFG_TITLE = "插件";

export const configUI: Feature = {
    key: "copyUnrestrict", // 占位;configUI 总是安装,enable 永真
    enable(_cfg) { return true; },
    install() {
        hookSettingActivityForEntry();
    },
};

function hookSettingActivityForEntry() {
    const SettingActivityV2 = tryUse("com.xingin.matrix.setting.SettingActivityV2");
    if (!SettingActivityV2) { warn("[cfg] SettingActivityV2 not found"); return; }
    try {
        const oc = SettingActivityV2.onWindowFocusChanged;
        if (!oc) { warn("[cfg] onWindowFocusChanged not found"); return; }
        oc.implementation = function (z: boolean) {
            oc.call(this, z);
            if (!z) return;
            try {
                initPrefs(this);
                ensureActionBarButton(this);
            } catch (e) { warn("[cfg] onWindowFocusChanged inject failed:", String(e)); }
        };
        log("[cfg] hooked SettingActivityV2.onWindowFocusChanged");
    } catch (e) { warn("[cfg] hook failed:", String(e)); }
}

const attachedTags = new WeakSet();
function ensureActionBarButton(activity: any) {
    try {
        const Activity = Java.use("android.app.Activity");
        const act = Java.cast(activity, Activity);
        const root = act.getWindow().getDecorView();
        if (attachedTags.has(root)) return;
        attachedTags.add(root);
        const ActionBarCommon = tryUse("com.xingin.redview.acitonbar.ActionBarCommon");
        if (!ActionBarCommon) { warn("[cfg] ActionBarCommon not found"); return; }

        Java.scheduleOnMainThread(() => {
            try {
                const header = findView(root, ActionBarCommon);
                if (!header) { warn("[cfg] ActionBarCommon instance not found"); return; }
                const headerC = Java.cast(header, ActionBarCommon);
                headerC.setRightText(Java.use("java.lang.String").$new(CFG_TITLE));
                const rightTv = headerC.getRightTextview();
                if (!rightTv) { warn("[cfg] rightTextview null"); return; }
                rightTv.setOnClickListener(Java.registerClass({
                    name: "cc.microblock.rednoteauxv.CfgClick" + nonce(),
                    implements: [Java.use("android.view.View$OnClickListener")],
                    methods: {
                        onClick(_v: any) {
                            log("[cfg] button clicked");
                            try { showConfigDialog(act); } catch (e) { warn("[cfg] onClick:", String(e), (e as any).stack); }
                        },
                    },
                }).$new());
                log("[cfg] '插件' button set on actionbar right");
            } catch (e) { warn("[cfg] ensureActionBarButton failed:", String(e), (e as any).stack); }
        });
    } catch (e) { warn("[cfg] ensureActionBarButton failed:", String(e)); }
}

/** 递归在 View 树里找指定类的实例。 */
function findView(view: any, targetClass: any): any | null {
    try {
        if (targetClass.class.isInstance(view)) return view;
    } catch { /* ignore */ }
    try {
        const ViewGroup = Java.use("android.view.ViewGroup");
        if (ViewGroup.class.isInstance(view)) {
            const vg = Java.cast(view, ViewGroup);
            const n = vg.getChildCount();
            for (let i = 0; i < n; i++) {
                const r = findView(vg.getChildAt(i), targetClass);
                if (r) return r;
            }
        }
    } catch { /* ignore */ }
    return null;
}

/** 保存配置后的实时生效回调(由 main.ts 设置)。 */
let liveApplyFn: ((cfg: FeatureConfig) => void) | null = null;
export function setLiveApply(fn: (cfg: FeatureConfig) => void) { liveApplyFn = fn; }

function showConfigDialog(activity: any) {
    log("[cfg] showConfigDialog start");
    try {
        const Builder = Java.use("android.app.AlertDialog$Builder");
        const builder = Builder.$new(activity);
        log("[cfg] builder created");
        builder.setTitle(Java.use("java.lang.String").$new("RedNoteAuxv 配置"));
        const config = loadConfig();
        log("[cfg] config loaded:", JSON.stringify(config));
        const items = featureLabels();
        const checked = items.map(it => (config as any)[it.key] as boolean);
        log("[cfg] checked:", JSON.stringify(checked));
        const zArr = Java.array("boolean", checked);
        log("[cfg] boolean array created");
        builder.setMultiChoiceItems(
            Java.array("java.lang.String", items.map(it => Java.use("java.lang.String").$new(it.label))),
            zArr,
            Java.registerClass({
                name: "cc.microblock.rednoteauxv.CfgChoice" + nonce(),
                implements: [Java.use("android.content.DialogInterface$OnMultiChoiceClickListener")],
                methods: {
                    onClick(_d: any, which: number, isChecked: boolean) {
                        const key = items[which].key;
                        (config as any)[key] = isChecked;
                        log("[cfg] toggle", key, "=", isChecked);
                    },
                },
            }).$new(),
        );
        builder.setPositiveButton(Java.use("java.lang.String").$new("保存并实时生效"), Java.registerClass({
            name: "cc.microblock.rednoteauxv.CfgSave" + nonce(),
            implements: [Java.use("android.content.DialogInterface$OnClickListener")],
            methods: {
                onClick(_d: any, _w: number) {
                    saveConfig(config);
                    if (liveApplyFn) { try { liveApplyFn(config); } catch (e) { warn("[cfg] live apply failed:", String(e)); } }
                    log("[cfg] config saved + applied");
                },
            },
        }).$new());
        builder.setNegativeButton(Java.use("java.lang.String").$new("取消"), null);
        builder.show();
    } catch (e) { warn("[cfg] showConfigDialog failed:", String(e)); }
}

let nonceCounter = 0;
function nonce(): string { return String(nonceCounter++); }

interface Item { key: keyof FeatureConfig; label: string; }
function featureLabels(): Item[] {
    const map: Record<keyof FeatureConfig, string> = {
        copyUnrestrict: "解除复制限制",
        downloadNoWatermark: "下载去水印",
        unrestrictDownload: "解除下载限制",
        feedSortByDateAsc: "信息流按日期升序(早的在前)",
        feedShowDate: "把日期写在帖子上",
        autoPreloadOnRefresh: "自动预载刷新",
        hideLikeRedDot: "点赞红点消掉",
    };
    return (Object.keys(map) as (keyof FeatureConfig)[]).map(k => ({ key: k, label: map[k] }));
}

void loadConfig; void saveConfig;
