"use client";
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { apiJson } from '@/lib/client/apiClient';

const active = new Set(['queued','running','waiting_media','waiting_approval']);
export default function TaskNotifications({userId}) {
  const pathname = usePathname();
  useEffect(()=>{
    if (!userId || !('Notification' in window)) return;
    let disposed = false, timer;
    const states = new Map();
    const poll = async () => {
      try {
        const {settings} = await apiJson('/api/settings');
        if (disposed) return;
        if (!settings.permissions.notifications || Notification.permission !== 'granted') { timer = setTimeout(poll,10000); return; }
        const {tasks} = await apiJson('/api/tasks/activity');
        if (disposed) return;
        for (const task of tasks) {
          const previous = states.get(task._id);
          if (previous && active.has(previous) && !active.has(task.status)) {
            const notification = new Notification('Vectaix 任务更新',{body:task.status==='completed'?'任务已完成，打开对话查看结果。':'任务已结束，打开对话查看详情。',tag:task._id});
            notification.onclick = () => { window.focus(); window.localStorage.setItem('vectaix-current-conversation',task.conversationId); window.location.assign('/'); notification.close(); };
          }
          states.set(task._id,task.status);
        }
        timer = setTimeout(poll,10000);
      } catch { /* 当前页面的通知检查失败后停止，不自动重试。 */ }
    };
    void poll();
    return ()=>{disposed=true;clearTimeout(timer);};
  },[userId,pathname]);
  return null;
}
