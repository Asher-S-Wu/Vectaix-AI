"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ChatApp from "@/app/ChatApp";
import MediaLayout from "@/app/media/layout";
import ImagePage from "@/app/media/image/page";
import VideoPage from "@/app/media/video/page";
import AudioPage from "@/app/media/audio/page";
import MinimaxAudioPage from "@/app/media/minimax-audio/page";
import DoubaoAudioPage from "@/app/media/doubao-audio/page";
import VideoEnhancementPage from "@/app/media/video-enhancement/page";
import { useGuestSession } from "@/lib/client/GuestSession";
import { getGuestEntryPath, getGuestModels } from "@/lib/shared/guestModels";
import { guestWorkspaceHref } from "@/lib/client/guestAccess";
import GuestToolbar from "./GuestToolbar";

const WORKSPACES = { "media/image": ImagePage, "media/video": VideoPage, "media/audio": AudioPage, "media/minimax-audio": MinimaxAudioPage, "media/doubao-audio": DoubaoAudioPage, "media/video-enhancement": VideoEnhancementPage };

export default function GuestWorkspace({ workspace }) {
  const guest = useGuestSession();
  const router = useRouter();
  const search = useSearchParams();
  const models = getGuestModels(guest.user.allowedModelIds);
  const viewingConversation = Boolean(search.get("conversation"));
  const [entryPath] = useState(() => !workspace && !viewingConversation ? getGuestEntryPath(guest.id, guest.user.allowedModelIds) : null);
  const basePath = `/guest/${encodeURIComponent(guest.id)}`;
  const effectiveWorkspace = workspace || (!viewingConversation && entryPath && entryPath !== basePath ? entryPath.slice(basePath.length + 1) : "");
  useEffect(() => {
    if (!workspace && entryPath && entryPath !== basePath && !viewingConversation) router.replace(entryPath);
  }, [basePath, entryPath, router, viewingConversation, workspace]);
  if (!workspace && entryPath && entryPath !== basePath && !viewingConversation) {
    return <main className="grid min-h-dvh place-items-center bg-app px-6 text-sm text-zinc-500" role="status">正在打开工作台…</main>;
  }
  if (!effectiveWorkspace && (viewingConversation || models.some((model) => model.type === "chat"))) return <ChatApp guestConversationId={search.get("conversation")} guestModelId={search.get("model")} />;
  const Page = WORKSPACES[effectiveWorkspace];
  const permitted = models.some((model) => model.href === `/${effectiveWorkspace}`);
  if (Page && permitted) return <MediaLayout><Page /></MediaLayout>;
  return <div className="min-h-dvh bg-app p-5 text-zinc-900 dark:text-zinc-100"><div className="mx-auto max-w-4xl"><GuestToolbar /><section className="py-20 text-center"><h1 className="text-xl font-semibold">{models.length ? "当前工作台已不再开放" : "暂未开放任何模型"}</h1><p className="mt-3 text-sm text-zinc-500">已有记录仍可在共享历史中查看和下载。{models.length ? "请自行选择一个可用模型继续。" : ""}</p><div className="mt-6 flex flex-wrap justify-center gap-3">{models.map((model) => <Link key={model.id} href={`${guestWorkspaceHref(model.href)}?model=${encodeURIComponent(model.id)}`} className="rounded-xl border border-zinc-200 px-4 py-3 text-sm hover:border-primary dark:border-zinc-700">{model.name}</Link>)}</div></section></div></div>;
}
