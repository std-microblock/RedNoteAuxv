/**
 * Frida 日志输出 —— 统一前缀,方便 adb logcat 过滤
 * logcat FriPackInject:D *:S 已经能看到;这里同时用 console 输出。
 */
const TAG = "[RedNoteAuxv]";

export function log(...args: unknown[]): void {
    const msg = args.map(a => typeof a === "object" ? safeStringify(a) : String(a)).join(" ");
    console.log(`${TAG} ${msg}`);
}

export function warn(...args: unknown[]): void {
    const msg = args.map(a => typeof a === "object" ? safeStringify(a) : String(a)).join(" ");
    console.log(`${TAG} [WARN] ${msg}`);
}

export function err(...args: unknown[]): void {
    const msg = args.map(a => typeof a === "object" ? safeStringify(a) : String(a)).join(" ");
    console.log(`${TAG} [ERR] ${msg}`);
}

function safeStringify(o: unknown): string {
    try {
        return JSON.stringify(o);
    } catch {
        return String(o);
    }
}
