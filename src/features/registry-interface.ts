import type { FeatureConfig } from "../lib/config";

/** Feature 注册接口。每个功能实现一份,在 registry 里挂载。 */
export interface Feature {
    /** 对应 FeatureConfig 的 key;configUI 这种总开关型的可随意占位 */
    key: keyof FeatureConfig;
    /** 根据当前配置决定是否安装 */
    enable(cfg: FeatureConfig): boolean;
    /** 安装 hook(只在 enable 返回 true 时调用) */
    install(): void;
    /** 可选:卸载(实现复杂可留空,重启生效) */
    teardown?(): void;
}
