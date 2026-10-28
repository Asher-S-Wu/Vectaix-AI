'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { animateChange, useMotionNavigation } from './NavigationMotion';

export default function useWorkspaceNavigation(user) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const parentNavigation = useMotionNavigation();
  const [view, setView] = useState({ pathname, search, revision: 0 });

  const syncLocation = useEffectEvent((fromHistory = false) => {
    const url = new URL(window.location.href);
    if (!['/', '/settings'].includes(url.pathname)) return;
    if (url.pathname === view.pathname && url.searchParams.toString() === view.search) return;
    const update = () => setView(current => ({ pathname: url.pathname, search: url.searchParams.toString(), revision: current.revision + Number(fromHistory) }));
    if (fromHistory) animateChange(update, 'workspace');
    else update();
  });
  useEffect(() => { syncLocation(); }, [pathname, search]);
  useEffect(() => {
    const onPopState = () => syncLocation(true);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (href, options) => {
    const target = new URL(href, window.location.href);
    if (!user || target.origin !== window.location.origin || !['/', '/settings'].includes(target.pathname)) {
      parentNavigation.navigate(href, options);
      return;
    }
    if (target.pathname === '/settings' && target.searchParams.get('section') === 'admin' && !user.isAdmin) return;
    if (target.href === window.location.href) return;
    animateChange(() => {
      window.history.pushState(null, '', target);
      setView(current => ({ pathname: target.pathname, search: target.searchParams.toString(), revision: current.revision + 1 }));
    }, 'workspace');
  };

  return { view, navigate };
}
