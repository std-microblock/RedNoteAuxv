import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

export const hideLikeRedDot: Feature = {
  key: "hideLikeRedDot",
  enable(cfg) {
    return cfg.hideLikeRedDot;
  },
  install() {
    /*
    public final synchronized void c(int i7, int i42, int i100) {
        try {
            if (PatchProxy.proxyVoid3Para(new Integer(i7), new Integer(i42), new Integer(i100), this, t.class, 203742)) {
                return;
            }
            if (i7 != -1) {
                this.f191493b.H(i7);
            }
            if (i42 != -1) {
                this.f191493b.D(i42);
            }
            if (i100 != -1) {
                this.f191493b.B(i100);
            }
            e.d(this.f191492a, this.f191493b.y() + this.f191493b.q() + this.f191493b.p(), false, 2, null);
            p3.b("ChatBadgeManager", "update msgHeaderNodeCount = " + this.f191492a.f191461b + " likes:" + this.f191493b.y() + " fans:" + this.f191493b.q() + " comment:" + this.f191493b.p());
        } catch (Throwable th10) {
            throw th10;
        }
    }
         */
    const ge4T = tryUse('ge4.t')
    ge4T.c.implementation = function(i7: number, i42: number, i100: number) {
        console.log("[hideLikeRedDot] ge4.t.c(" + i7 + ", " + i42 + ", " + i100 + ") -> likes=0");
        return this.c(0 , i42, i100); // 强制把 likes 置 0
    }
  },
};
