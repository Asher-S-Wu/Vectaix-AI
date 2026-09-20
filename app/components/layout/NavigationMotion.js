"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const NavigationContext = createContext(null);
let localTransition;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Local changes complete synchronously, so both snapshots represent committed UI.
export function animateChange(update, kind = "panel") {
  if (reduceMotion()) { update(); return; }
  localTransition?.skipTransition();
  document.documentElement.dataset.navigationKind = kind;
  const transition = document.startViewTransition(() => flushSync(update));
  localTransition = transition;
  const finish = () => {
    if (localTransition !== transition) return;
    localTransition = null;
    if (document.documentElement.dataset.navigationKind === kind) delete document.documentElement.dataset.navigationKind;
  };
  transition.finished.then(finish, finish);
}

export function NavigationMotionProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState(null);
  const navigation = useRef(null);

  const entryTimer = useRef(null);

  useEffect(() => () => clearTimeout(entryTimer.current), []);

  const finishNavigation = useCallback(() => {
    const operation = navigation.current;
    if (!operation?.committed || !operation.animationDone) return;
    navigation.current = null;
    setPendingHref(null);
    delete document.documentElement.dataset.routeLeaving;
    document.documentElement.dataset.routeEntering = "true";
    delete document.documentElement.dataset.navigationKind;
    entryTimer.current = setTimeout(() => {
      delete document.documentElement.dataset.routeEntering;
    }, 320);
  }, []);

  useLayoutEffect(() => {
    if (!navigation.current) return;
    navigation.current.committed = true;
    finishNavigation();
  }, [pathname, finishNavigation]);

  const navigate = (href, { mode = false } = {}) => {
    if (navigation.current || href === window.location.pathname + window.location.search) return;
    if (reduceMotion()) { router.push(href); return; }
    clearTimeout(entryTimer.current);
    delete document.documentElement.dataset.routeEntering;
    const operation = { committed: false, animationDone: false };
    navigation.current = operation;
    router.prefetch(href);
    document.documentElement.dataset.navigationKind = mode ? "mode" : "page";
    // Capture only the synchronous departure. Never freeze rendering for a route request.
    const transition = document.startViewTransition(() => {
      flushSync(() => setPendingHref(href));
      document.documentElement.dataset.routeLeaving = "true";
      router.push(href);
    });
    const finish = () => {
      operation.animationDone = true;
      finishNavigation();
    };
    transition.finished.then(finish, finish);
  };

  return <NavigationContext.Provider value={{ navigate, pendingHref }}>
    {children}
    {pendingHref && <div role="status" aria-label="正在切换页面" className="route-progress pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"><span className="block h-full w-1/3 bg-primary" /></div>}
  </NavigationContext.Provider>;
}

export function useMotionNavigation() {
  return useContext(NavigationContext);
}

export default function TransitionLink({ href, mode = false, onNavigate, ...props }) {
  const { navigate } = useMotionNavigation();
  return <Link prefetch={true} {...props} href={href} onNavigate={event => {
    onNavigate?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    navigate(href, { mode });
  }} />;
}
