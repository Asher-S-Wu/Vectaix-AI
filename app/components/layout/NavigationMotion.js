"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
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

  useLayoutEffect(() => {
    navigation.current?.commit?.();
  }, [pathname]);

  const navigate = async (href, { mode = false } = {}) => {
    if (navigation.current || href === window.location.pathname + window.location.search) return;
    if (reduceMotion()) { router.push(href); return; }
    const operation = {};
    navigation.current = operation;
    setPendingHref(href);
    // Let the thumb reach its destination before moving the surrounding workspace.
    if (mode) await new Promise(resolve => setTimeout(resolve, 180));
    document.documentElement.dataset.navigationKind = mode ? "mode" : "page";
    const transition = document.startViewTransition(() => new Promise(resolve => {
      operation.commit = resolve;
      router.push(href);
    }));
    const finish = () => {
      operation.commit?.();
      navigation.current = null;
      setPendingHref(null);
      delete document.documentElement.dataset.navigationKind;
    };
    transition.finished.then(finish, finish);
  };

  return <NavigationContext.Provider value={{ navigate, pendingHref }}>{children}</NavigationContext.Provider>;
}

export function useMotionNavigation() {
  return useContext(NavigationContext);
}

export default function TransitionLink({ href, mode = false, onNavigate, ...props }) {
  const { navigate } = useMotionNavigation();
  return <Link {...props} href={href} onNavigate={event => {
    onNavigate?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    navigate(href, { mode });
  }} />;
}
