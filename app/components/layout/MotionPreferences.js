"use client";

import { MotionConfig } from "framer-motion";

// 系统开启“减少动态效果”时，framer-motion 动画只保留透明度变化。
export default function MotionPreferences({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
