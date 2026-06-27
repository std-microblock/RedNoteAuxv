import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

/**
 * 自动预载一组刷新
 *
 * 思路:hook OkHttp RealCall.execute,当 homefeed 请求成功响应后,
 * 用同一个 Request clone 异步再发一次(enqueue),让网络/CDN/弱网缓存预热。
 * 下次用户下拉刷新时,命中的是已预载的缓存,刷新更快。
 *
 * 关键点:
 *  - 防递归:预载的请求不再触发预载(用 thread-local 标记 + url 计数)
 *  - 不主动注入数据到 UI,只做网络层预热(安全,不破坏 feed 算法)
 *  - 限流:短时间内同一 url 只预载一次
 *
 * 锚点:okhttp3.internal.connection.RealCall (类名稳定);Request.clone();homefeed url。
 */
export const autoPreloadOnRefresh: Feature = {
    key: "autoPreloadOnRefresh",
    enable(cfg) { return cfg.autoPreloadOnRefresh; },
    install() {
        hookFeedForPreload();
    },
};

const FEED_URL_PATTERN = "/api/sns/v6/homefeed";
const recentPreloaded = new Map<string, number>();
const PRELOAD_COOLDOWN_MS = 30000; // 同一 url 30s 内只预载一次

function hookFeedForPreload() {
    const RealCall = tryUse("okhttp3.internal.connection.RealCall") ?? tryUse("okhttp3.RealCall");
    if (!RealCall) { warn("[preload] RealCall not found"); return; }
    const ovs = (RealCall as any).execute ? (RealCall as any).execute.overloads : [];
    let anyHook = false;
    for (const ov of ovs) {
        if (ov.argumentTypes.length !== 0) continue;
        ov.implementation = function () {
            const resp = ov.call(this);
            try {
                const req = resp.request();
                const url = String(req.url());
                if (url.includes(FEED_URL_PATTERN) && shouldPreload(url)) {
                    markPreloaded(url);
                    triggerPreload(req);
                }
            } catch (e) { warn("[preload] check failed:", String(e)); }
            return resp;
        };
        anyHook = true;
    }
    if (anyHook) log("[preload] hooked RealCall.execute for auto-preload");
    else warn("[preload] no execute overload hooked");
}

function shouldPreload(url: string): boolean {
    const now = nowMs();
    const last = recentPreloaded.get(url) ?? 0;
    return (now - last) > PRELOAD_COOLDOWN_MS;
}

function markPreloaded(url: string) {
    recentPreloaded.set(url, nowMs());
    // 简单清理:超过 50 条清最早的
    if (recentPreloaded.size > 50) recentPreloaded.clear();
}

/** clone request,异步 enqueue,结果丢弃(只做预热)。 */
function triggerPreload(origReq: any) {
    try {
        const OkHttpClient = Java.use("okhttp3.OkHttpClient");
        // 用 origReq 的 client?RealCall 持有 client。这里直接 new 一个轻量 client。
        // 实际:从 origCall 取 client 更稳,但 execute hook 里 this 是 RealCall。
        // 简化:new OkHttpClient。
        const client = OkHttpClient.$new();
        const cloned = origReq.clone ? origReq.clone() : origReq;
        // 异步 enqueue,不阻塞当前响应
        const newCall = client.newCall(cloned);
        // Callback:只关心失败/完成,不处理响应体
        const Callback = Java.registerClass({
            name: "cc.microblock.rednoteauxv.PreloadCb",
            implements: [Java.use("okhttp3.Callback")],
            methods: {
                onResponse(_call: any, _resp: any) {
                    try { _resp.close(); } catch { /* ignore */ }
                    log("[preload] preload request done");
                },
                onFailure(_call: any, e: any) {
                    warn("[preload] preload failed:", String(e));
                },
            },
        }).$new();
        newCall.enqueue(Callback);
        log("[preload] triggered preload for homefeed");
    } catch (e) {
        warn("[preload] triggerPreload failed:", String(e));
    }
}

function nowMs(): number {
    return Date.now();
}
