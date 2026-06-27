import type { FeatureConfig } from "../lib/config";
import { copyUnrestrict } from "./copyUnrestrict";
import { downloadNoWatermark } from "./downloadNoWatermark";
import { unrestrictDownload } from "./unrestrictDownload";
import { feedDateSort, feedShowDate } from "./feedDate";
import { hideLikeRedDot } from "./hideLikeRedDot";
import { autoPreloadOnRefresh } from "./autoPreloadOnRefresh";
import { configUI } from "./configUI";

export type { Feature } from "./registry-interface";

/** 所有 feature,顺序即安装顺序。configUI 必须在前(它初始化 prefs/Context)。 */
export const ALL_FEATURES = [
    configUI,
    copyUnrestrict,
    downloadNoWatermark,
    unrestrictDownload,
    feedDateSort,
    feedShowDate,
    autoPreloadOnRefresh,
    hideLikeRedDot,
];

export function getAllFeatures() { return ALL_FEATURES; }

export { configUI } from "./configUI";
