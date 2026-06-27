import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse, isInstanceOf } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

/**
 * 信息流日期排序 + 把日期写在帖子上
 *
 * 首页推荐流是原生 RecyclerView:
 *   com.drakeet.multitype.MultiTypeAdapter.setItems(List)  —— 第三方库,非混淆,稳定。
 *   数据元素类型: com.xingin.entities.NoteItemBean (非混淆)。
 *
 * 策略: hook MultiTypeAdapter.setItems(List),若 list 元素是 NoteItemBean:
 *   - 排序: 按 createTime / postTime / timestamp 升序(早的在前)
 *   - 写日期: 把 timeDesc / 格式化日期拼进 displayTitle(角标式)
 *
 * 只在首页推荐流生效(通过 NoteItemBean 类型筛选,搜索/相册用的是别的 bean)。
 *
 * 注意:hook 全局 setItems 会捕获到非 feed 的 multitype 列表,
 *       但只有 list 元素是 NoteItemBean 才动手,其它直接放行。
 */

const NOTE_ITEM_BEAN = "com.xingin.entities.NoteItemBean";

export const feedDateSort: Feature = {
  key: "feedSortByDateAsc",
  enable(cfg) {
    return cfg.feedSortByDateAsc;
  },
  install() {
    const MultiTypeAdapter = Java.use("com.drakeet.multitype.MultiTypeAdapter");

    MultiTypeAdapter.onBindViewHolder.overload(
      "androidx.recyclerview.widget.RecyclerView$ViewHolder",
      "int",
      "java.util.List",
    ).implementation = function (holder, pos, payloads) {
      this.onBindViewHolder(holder, pos, payloads);

      try {
        const items = this.items.value;
        if (items == null || pos >= items.size()) return;
        const item = items.get(pos);
        const className = item.getClass().getName();

        let timeStr = null;

        if (className == "com.xingin.entities.NoteItemBean") {
          const bean = Java.cast(
            item,
            Java.use("com.xingin.entities.NoteItemBean"),
          );
          const ts = bean.timestamp.value;
          timeStr = formatFeedTime(ts);
        }

        if (!timeStr || timeStr == "") return;

        const itemView = Java.cast(
          holder.itemView.value,
          Java.use("android.widget.FrameLayout"),
        );
        const context = itemView.getContext();

        let bottomBar = null;
        if (itemView.getChildCount() > 0) {
          const inner = Java.cast(
            Java.cast(
              itemView.getChildAt(0),
              Java.use(
                "com.xingin.xhs.note.noteitem.child.NewNoteItemChildView",
              ),
            ).getChildAt(0),
            Java.use("android.view.ViewGroup"),
          );
          if (inner != null && inner.getChildCount() >= 3) {
            bottomBar = Java.cast(
              inner.getChildAt(3),
              Java.use("android.view.ViewGroup"),
            );
          }
        }
        if (bottomBar == null) return;

        // 尝试寻找已有的 TextView
        let found = null;
        for (let i = 0; i < bottomBar.getChildCount(); i++) {
          const child = bottomBar.getChildAt(i);
          if (child.getTag() == "RedNoteAuxv_feedDate") {
            found = child;
            break;
          }
        }

        if (found != null) {
          console.log("[feedShowDate] pos=" + pos + " found existing TextView");
          const textView = Java.cast(
            found,
            Java.use("android.widget.TextView"),
          );
          textView.setText(Java.use("java.lang.String").$new(timeStr));
        } else {
          // 创建时间 TextView
          const TextView = Java.use("android.widget.TextView");
          const tv = TextView.$new(context);
          tv.setTag("RedNoteAuxv_feedDate");
          tv.setText(Java.use("java.lang.String").$new(timeStr));
          tv.setTextSize(0, 22.0);
          tv.setTextColor(
            Java.use("android.graphics.Color").parseColor("#999999"),
          );

          const nameTv = bottomBar.getChildAt(1);

          const ConstraintLayout$LayoutParams = Java.use(
            "androidx.constraintlayout.widget.ConstraintLayout$LayoutParams",
          );
          const nameLp = Java.cast(
            nameTv.getLayoutParams(),
            ConstraintLayout$LayoutParams,
          );
          nameLp.topMargin.value = -30;
          nameTv.setLayoutParams(nameLp);

          const textLp = ConstraintLayout$LayoutParams.$new(
            ConstraintLayout$LayoutParams.WRAP_CONTENT.value,
            ConstraintLayout$LayoutParams.WRAP_CONTENT.value,
          );

          textLp.topToBottom.value = nameTv.getId();
          textLp.startToStart.value = nameTv.getId();
          textLp.topMargin.value = 0;

          tv.setLayoutParams(textLp);

          bottomBar.addView(tv, 3);
        }
      } catch (e) {
        console.log("[feedShowDate] error: " + e, (e as any).stack);
      }
    };

    function formatFeedTime(ts) {
      if (!ts || ts <= 0) return "";
      const now = Math.floor(Date.now() / 1000);
      const diff = now - ts;
      if (diff < 120) return "刚刚";
      if (diff < 3600) return Math.floor(diff / 60) + "分钟前";
      if (diff < 86400) return Math.floor(diff / 3600) + "小时前";
      const d = new Date(ts * 1000);
      const yd = new Date();
      yd.setDate(yd.getDate() - 1);
      if (d.toDateString() == yd.toDateString()) return "昨天";
      if (diff < 7 * 86400) return Math.floor(diff / 86400) + "天前";
      const m = d.getMonth() + 1;
      const day = d.getDate();
      return (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
    }
  },
};

export const feedShowDate: Feature = {
  key: "feedShowDate",
  enable(cfg) {
    return cfg.feedShowDate;
  },
  install() {
    hookMultiTypeAdapterSetItems();
  },
};

// 两个 feature 共用同一个 hook;用计数避免重复 attach。
let hooked = false;
function hookMultiTypeAdapterSetItems() {
  if (hooked) return;
  const Adapter = tryUse("com.drakeet.multitype.MultiTypeAdapter");
  if (!Adapter) {
    warn("[feed] MultiTypeAdapter not found");
    return;
  }
  try {
    const ov = Adapter.setItems.overload("java.util.List");
    ov.implementation = function (list: any) {
      try {
        const rewritten = maybeRewriteFeed(list);
        if (rewritten) return ov.call(this, rewritten);
      } catch (e) {
        warn("[feed] rewrite failed:", String(e));
      }
      return ov.call(this, list);
    };
    hooked = true;
    log("[feed] hooked MultiTypeAdapter.setItems(List)");
  } catch (e) {
    warn("[feed] hook setItems failed:", String(e));
  }
}

/** 若 list 是 NoteItemBean 列表,按需排序 + 写日期,返回新 List;否则返回 null。 */
function maybeRewriteFeed(list: any): any | null {
  if (!list || list.size === undefined) return null;
  const size = list.size();
  if (size === 0) return null;

  const NoteItemBean = tryUse(NOTE_ITEM_BEAN);
  if (!NoteItemBean) return null;

  // 取第一个非 null 元素判断类型
  let first: any = null;
  for (let i = 0; i < size; i++) {
    const e = list.get(i);
    if (e !== null) {
      first = e;
      break;
    }
  }
  if (!first) return null;

  // 诊断:记录列表元素类型 + 大小,确认首页 feed 是否走这里
  try {
    const cn = first.getClass().getName();
    log(
      "[feed] setItems size=" +
        size +
        " firstType=" +
        cn +
        " isNote=" +
        isInstanceOf(first, NoteItemBean),
    );
  } catch {
    /* ignore */
  }

  // 用 instanceof 判断,而非 Java.cast(cast 对非匹配类型会抛异常)
  if (!isInstanceOf(first, NoteItemBean)) return null;

  // 确认是 NoteItemBean 列表 -> 转成 JS 数组处理
  const arr: any[] = [];
  for (let i = 0; i < size; i++) arr.push(list.get(i));

  // 排序(升序,早的在前)
  arr.sort((a, b) => {
    const ta = parseTime(a);
    const tb = parseTime(b);
    return ta - tb;
  });

  // 写日期到 displayTitle(角标式)
  for (const item of arr) {
    try {
      stampDateOnItem(item);
    } catch {
      /* ignore */
    }
  }

  // 重建 ArrayList
  const ArrayList = Java.use("java.util.ArrayList");
  const out = ArrayList.$new();
  for (const item of arr) out.add(item);
  return out;
}

/** 从 NoteItemBean 取时间戳(秒),按优先级: timestamp > createTime > postTime。 */
function parseTime(bean: any): number {
  try {
    const ts = strField(bean, "timestamp");
    if (ts) {
      const n = Number(ts);
      if (!isNaN(n)) return n;
    }
    const ct = strField(bean, "createTime");
    if (ct) {
      const n = Number(ct);
      if (!isNaN(n)) return n;
    }
    const pt = strField(bean, "postTime");
    if (pt) {
      const n = Number(pt);
      if (!isNaN(n)) return n;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/** 读取 NoteItemBean 的 String 字段(字段名非混淆)。 */
function strField(bean: any, name: string): string | null {
  try {
    const v = bean[name];
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

/** 把日期角标写到 displayTitle 前面。timeDesc 已是格式化字符串。 */
function stampDateOnItem(bean: any): void {
  let date = strField(bean, "timeDesc");
  if (!date) {
    // 用 timestamp 格式化
    const ts = parseTime(bean);
    if (ts > 0) date = formatTime(ts);
  }
  if (!date) return;
  const cur = strField(bean, "displayTitle") ?? "";
  // 避免重复添加
  if (cur.startsWith("[")) return;
  const marked = `[${date}] ${cur}`;
  try {
    bean.displayTitle = Java.use("java.lang.String").$new(marked);
  } catch {
    /* ignore */
  }
}

/** 简单格式化:秒级时间戳 -> "MM-dd" 形式。用 Java SimpleDateFormat 保持稳定。 */
function formatTime(tsSeconds: number): string {
  try {
    const SimpleDateFormat = Java.use("java.text.SimpleDateFormat");
    const sdf = SimpleDateFormat.$new(
      Java.use("java.lang.String").$new("MM-dd HH:mm"),
    );
    const DateCls = Java.use("java.util.Date");
    const date = DateCls.$new(tsSeconds * 1000);
    return String(sdf.format(date));
  } catch {
    return String(tsSeconds);
  }
}
