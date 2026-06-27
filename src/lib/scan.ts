import Java from "frida-java-bridge";
import { log, warn } from "./log";

/**
 * 符号扫描工具 —— 避免 hardcode 混淆后的类名/方法名。
 *
 * 策略:
 * 1. 优先用非混淆的稳定类名直接 Java.use (NoteItemBean / MsgUnreadCount / TextComponent 等)
 * 2. 对混淆类,通过 enumerateMethods / 反射字段 / 字符串常量运行时定位
 * 3. 同一个 hook 点给出"稳定锚点"(字段名、注解、字符串、签名),即使类名变了也能重新定位
 */

/** 安全地 use 一个类,失败返回 null 并告警。 */
export function tryUse(className: string): any | null {
    try {
        return Java.use(className);
    } catch (e) {
        warn(`tryUse(${className}) failed:`, String(e));
        return null;
    }
}

/**
 * 在所有 classloader 里查找一个类(按全限定名)。
 * 用于类不在默认 loader 下的情况(如 RN bundle 类)。
 */
export function findClassInLoaders(className: string): any | null {
    // 默认 loader 先试
    const direct = tryUse(className);
    if (direct) return direct;
    try {
        const loaders = Java.enumerateClassLoadersSync();
        for (const loader of loaders) {
            try {
                const factory = Java.ClassFactory.get(loader);
                return factory.use(className);
            } catch {
                // continue
            }
        }
    } catch (e) {
        warn(`findClassInLoaders(${className}) failed:`, String(e));
    }
    return null;
}

/**
 * 通过 Java.enumerateMethods 用 glob 查方法,返回匹配到的类名列表。
 * query 例: "*!saveImage*"  或 "com.xingin.*!*"
 * 修饰符: i(忽略大小写) s(带签名) u(仅用户类)
 */
export function findMethodsByGlob(query: string): { className: string; methods: string[] }[] {
    const out: { className: string; methods: string[] }[] = [];
    try {
        const groups = Java.enumerateMethods(query);
        for (const g of groups) {
            for (const c of g.classes) {
                out.push({ className: c.name, methods: c.methods as string[] });
            }
        }
    } catch (e) {
        warn(`findMethodsByGlob(${query}) failed:`, String(e));
    }
    return out;
}

/**
 * 给定一个类的 wrapper,按方法名+参数类型签名找具体 overload。
 * 返回 Method 对象,失败返回 null。
 * 例: pickOverload(clazz, "a", ["com.xingin.capa.capa_session.model.SavingImageBean", "boolean", "java.lang.String"])
 */
export function pickOverload(clazz: any, methodName: string, argTypes: string[]): any | null {
    try {
        const m = clazz[methodName];
        if (!m || !m.overloads) return null;
        if (argTypes.length === 0) {
            // 无参 overload
            const zero = m.overloads.find((o: any) => o.argumentTypes.length === 0);
            return zero || null;
        }
        return m.overload(...argTypes);
    } catch (e) {
        warn(`pickOverload(${methodName}, [${argTypes.join(",")}]) failed:`, String(e));
        return null;
    }
}

/**
 * 判断一个方法是否匹配某参数类型组合(运行时反射,不依赖混淆名)。
 * 用于扫描出候选方法后再用签名筛选。
 */
export function methodMatchesArgTypes(method: any, argTypeNames: string[]): boolean {
    try {
        const types = method.argumentTypes as any[];
        if (types.length !== argTypeNames.length) return false;
        return types.every((t, i) => {
            // t.className 对引用类型可用,基本类型用 t.name(I/Z/J...)
            const cn = t.className ?? t.name;
            return cn === argTypeNames[i];
        });
    } catch {
        return false;
    }
}

/** 在一个类的所有方法里,按参数类型组合找候选方法(返回方法名数组)。 */
export function findMethodsByArgTypes(clazz: any, argTypeNames: string[]): string[] {
    const result: string[] = [];
    try {
        const members = clazz.$ownMembers ?? [];
        for (const name of members) {
            const m = clazz[name];
            if (!m || !m.overloads) continue;
            for (const ov of m.overloads) {
                if (methodMatchesArgTypes(ov, argTypeNames)) {
                    result.push(name);
                    break;
                }
            }
        }
    } catch (e) {
        warn(`findMethodsByArgTypes failed:`, String(e));
    }
    return result;
}

/**
 * 读取一个类的字段值(反射,避免混淆字段名)。
 * 用 Android Class.getDeclaredField + Field.setAccessible。
 */
export function readField(instance: any, fieldName: string): any | null {
    try {
        const Field = Java.use("java.lang.reflect.Field");
        const clazz = instance.getClass();
        const field = clazz.getDeclaredField(Java.use("java.lang.String").$new(fieldName));
        field.setAccessible(true);
        const raw = field.get(instance);
        return raw;
    } catch (e) {
        warn(`readField(${fieldName}) failed:`, String(e));
        return null;
    }
}

/** 写入字段(反射)。 */
export function writeField(instance: any, fieldName: string, value: any): boolean {
    try {
        const clazz = instance.getClass();
        const field = clazz.getDeclaredField(Java.use("java.lang.String").$new(fieldName));
        field.setAccessible(true);
        field.set(instance, value);
        return true;
    } catch (e) {
        warn(`writeField(${fieldName}) failed:`, String(e));
        return false;
    }
}

/**
 * 判断一个实例是否是某类的实例(用 Class.isInstance,避免 Java.cast 抛异常)。
 * classWrapper 是 Java.use() 返回的类;取其 .class 拿 Class 对象。
 */
export function isInstanceOf(instance: any, classWrapper: any): boolean {
    try {
        const clazz = classWrapper.class;
        return clazz.isInstance(instance);
    } catch (e) {
        return false;
    }
}
