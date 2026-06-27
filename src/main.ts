import Java from "frida-java-bridge";
import { log, warn } from "./lib/log";
import { loadConfig, initPrefs, type FeatureConfig } from "./lib/config";
import { ALL_FEATURES } from "./features/registry";
import { setLiveApply } from "./features/configUI";
import type { Feature } from "./features/registry-interface";

/**
 * RedNoteAuxv 入口。在 com.xingin.xhs 进程内执行(fripack xposed 注入)。
 */
function main() {
    if (!Java.available) {
        warn("Java not available, abort");
        return;
    }
    log("RedNoteAuxv starting in com.xingin.xhs, features:", ALL_FEATURES.length);

    Java.perform(() => {
        // 尽早拿 filesDir 初始化配置文件路径
        try {
            const app = Java.use("android.app.ActivityThread").currentApplication();
            if (app) initPrefs(app);
        } catch (e) {
            warn("[boot] initPrefs via ActivityThread failed:", String(e));
        }

        const cfg = loadConfig();

        // 记录每个 feature 是否已安装(hook 无法撤销,只能装不能卸)
        const installed = new Map<string, boolean>();
        for (const f of ALL_FEATURES) {
            const enabled = f.enable(cfg);
            log(`[boot] feature ${f.key}: ${enabled ? "ON" : "off"}`);
            if (!enabled) {
                installed.set(f.key, false);
                continue;
            }
            try {
                f.install();
                installed.set(f.key, true);
            } catch (e) {
                warn(`[boot] feature ${f.key} install failed:`, String(e));
            }
        }

        // 实时生效:配置保存后,对新开启的 feature 立即 install。
        // 已开启的保持;关掉的需重启生效(hook 不可逆)。
        setLiveApply((newCfg: FeatureConfig) => {
            for (const f of ALL_FEATURES) {
                const wasInstalled = installed.get(f.key) ?? false;
                const wantOn = f.enable(newCfg);
                if (wantOn && !wasInstalled) {
                    try {
                        f.install();
                        installed.set(f.key, true);
                        log(`[live] feature ${f.key} installed (newly enabled)`);
                    } catch (e) {
                        warn(`[live] feature ${f.key} install failed:`, String(e));
                    }
                } else if (!wantOn && wasInstalled) {
                    log(`[live] feature ${f.key} was on, now off — needs app restart to take effect`);
                }
            }
        });

        log("RedNoteAuxv boot complete");
    });
}

main();
