import Java from "frida-java-bridge";
import { log, warn } from "./log";

/**
 * 配置持久化:直接写文件,不依赖 SharedPreferences / MMKV。
 *
 * 文件路径:用 app 的 filesDir (com.xingin.xhs 私有目录) 下的 rednote_auxv_config.json
 *   /data/data/com.xingin.xhs/files/rednote_auxv_config.json
 *
 * 需要 Context 拿 filesDir。通过 hook 一个早期执行点(Activity onResume)拿到 Context 后初始化。
 * 在 prefs 未初始化前,loadConfig 返回默认值(所有功能默认开启,见下)。
 *
 * 文件格式:简单 JSON { "copyUnrestrict": true, ... }
 */

export interface FeatureConfig {
    /** 解除复制限制 */
    copyUnrestrict: boolean;
    /** 下载去水印 */
    downloadNoWatermark: boolean;
    /** 解除下载限制(作者禁下载) */
    unrestrictDownload: boolean;
    /** 信息流优先显示日期早的帖子 */
    feedSortByDateAsc: boolean;
    /** 把发布日期写在帖子上 */
    feedShowDate: boolean;
    /** 自动预载一组刷新 */
    autoPreloadOnRefresh: boolean;
    /** 点赞红点直接消掉 */
    hideLikeRedDot: boolean;
}

export const DEFAULT_CONFIG: FeatureConfig = {
    copyUnrestrict: true,
    downloadNoWatermark: true,
    unrestrictDownload: true,
    feedSortByDateAsc: false,
    feedShowDate: true,
    autoPreloadOnRefresh: false,
    hideLikeRedDot: true,
};

const CONFIG_FILENAME = "rednote_auxv_config.json";

let filesDir: string | null = null;

/** 用一个 Context(Activity 或 Application)初始化 filesDir 路径。 */
export function initPrefs(context: any): void {
    if (filesDir !== null) return;
    try {
        const Context = Java.use("android.content.Context");
        const ctx = Java.cast(context, Context);
        const dir = ctx.getFilesDir();
        filesDir = String(dir.getAbsolutePath());
        log("config dir:", filesDir);
    } catch (e) {
        warn("initPrefs failed:", String(e));
    }
}

function configPath(): string {
    return filesDir ? `${filesDir}/${CONFIG_FILENAME}` : CONFIG_FILENAME;
}

/** 读取整份配置。读不到文件或解析失败返回默认值。 */
export function loadConfig(): FeatureConfig {
    const cfg: FeatureConfig = { ...DEFAULT_CONFIG };
    if (filesDir === null) return cfg;
    try {
        const File = Java.use("java.io.File");
        const f = File.$new(Java.use("java.lang.String").$new(configPath()));
        if (!f.exists()) return cfg;
        // 读全部内容
        const FileInputStream = Java.use("java.io.FileInputStream");
        const fis = FileInputStream.$new(f);
        try {
            const ByteArrayOutputStream = Java.use("java.io.ByteArrayOutputStream");
            const baos = ByteArrayOutputStream.$new();
            const buf = Java.array("byte", new Array(4096).fill(0));
            let n;
            while ((n = fis.read(buf)) > 0) {
                baos.write(buf, 0, n);
            }
            const StringCls = Java.use("java.lang.String");
            const text = StringCls.$new(baos.toByteArray());
            const json = JSON.parse(text.toString());
            for (const k of Object.keys(DEFAULT_CONFIG) as (keyof FeatureConfig)[]) {
                if (typeof json[k] === "boolean") (cfg as any)[k] = json[k];
            }
        } finally {
            fis.close();
        }
    } catch (e) {
        warn("loadConfig failed:", String(e));
    }
    return cfg;
}

/** 一次性写入整份配置。 */
export function saveConfig(cfg: FeatureConfig): void {
    if (filesDir === null) { warn("saveConfig but filesDir not init"); return; }
    try {
        const File = Java.use("java.io.File");
        const f = File.$new(Java.use("java.lang.String").$new(configPath()));
        const FileOutputStream = Java.use("java.io.FileOutputStream");
        const fos = FileOutputStream.$new(f);
        try {
            const String = Java.use("java.lang.String");
            const text = String.$new(JSON.stringify(cfg));
            fos.write(text.getBytes());
        } finally {
            fos.close();
        }
        log("config saved to", configPath());
    } catch (e) {
        warn("saveConfig failed:", String(e));
    }
}
