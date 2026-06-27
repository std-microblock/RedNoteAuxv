import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

/**
 * 点赞红点直接消掉
 *
 * 未读计数来源(非混淆,稳定):
 *   com.xingin.chatbase.bean.MsgUnreadCount   (含 UnreadCountBean userSelfCnt)
 *   com.xingin.chatbase.bean.UnreadCountBean   (字段: likes / mentions / connections)
 * API: com.xingin.chatbase.manager.MsgServices.getMsgUnreadCount()  -> Observable<MsgUnreadCount>
 *      @f("api/sns/v6/message/get_unread_count")
 *
 * likes>0 -> "赞和收藏" tab 出红点。
 * 策略: hook MsgUnreadCount / UnreadCountBean 构造或反序列化,把 likes 强制为 0。
 *       这样消息 tab 不会因为点赞显示红点;mentions/connections 不动。
 *
 * 消掉红点对应的"已读上报"路径(MsgServices.a.g("you/likes"))较深且混淆,
 * 直接在数据源把 likes 置 0 更简单可靠,等效于"红点不出现"。
 */
export const hideLikeRedDot: Feature = {
    key: "hideLikeRedDot",
    enable(cfg) { return cfg.hideLikeRedDot; },
    install() {
        // UnreadCountBean 构造函数: (int likes, int mentions, int connections)
        // 以及带 DefaultConstructorMarker 的合成构造。hook 把 likes(第1参)置 0。
        const Bean = tryUse("com.xingin.chatbase.bean.UnreadCountBean");
        if (!Bean) { warn("[like] UnreadCountBean not found"); return; }
        const ctors = Bean.$init ? Bean.$init.overloads : [];
        let hooked = 0;
        for (const c of ctors) {
            const ats = c.argumentTypes as any[];
            // 目标 ctor: (int, int, int) 或 (int,int,int,int,DefaultConstructorMarker)
            if (ats.length < 3) continue;
            // 前三个应为 int (I)
            if (ats[0].name !== "I" || ats[1].name !== "I" || ats[2].name !== "I") continue;
            c.implementation = function (...args: any[]) {
                console.log("[like] UnreadCountBean ctor called, args:", args);
                args[0] = 0; // likes = 0
                return c.call(this, ...args);
            };
            hooked++;
        }
        if (hooked > 0) log(`[like] hooked UnreadCountBean.<init> (${hooked}) -> likes=0`);
        else warn("[like] no UnreadCountBean ctor matched");

        // 兜底:hook 字段写入路径(parcel 读回)。writeToParcel 不影响红点显示(那是序列化)。
        // 若服务端通过 setter/Gson 反射直接写字段,上面 ctor 已覆盖 Gson 走的 (int,int,int)。
    },
};
