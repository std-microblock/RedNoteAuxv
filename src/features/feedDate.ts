import Java from "frida-java-bridge";
import { log, warn } from "../lib/log";
import { tryUse, isInstanceOf } from "../lib/scan";
import type { FeatureConfig } from "../lib/config";
import type { Feature } from "./registry-interface";

const NOTE_ITEM_BEAN = "com.xingin.entities.NoteItemBean";

export const feedDateSort: Feature = {
  key: "feedSortByDateAsc",
  enable(cfg) {
    return cfg.feedSortByDateAsc;
  },
  install() {},
};

export const feedShowDate: Feature = {
  key: "feedShowDate",
  enable(cfg) {
    return cfg.feedShowDate;
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
