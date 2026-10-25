import './globals.css';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import { headers } from 'next/headers';
import { ToastProvider } from './components/common/ToastProvider';
import { NavigationMotionProvider } from './components/layout/NavigationMotion';
import FadeScrollbarGlobal from './components/layout/FadeScrollbarGlobal';
import { UI_THEME_MODE_KEY } from '@/lib/shared/storageKeys';
import { I18nProvider } from '@/lib/client/i18n';
import { getLocale } from '@/lib/server/i18n';
import { localeTag, translate } from '@/lib/shared/i18n.mjs';
import { AppearanceProvider } from '@/lib/client/theme';
import { getAuthPayload } from '@/lib/auth';
import UserSettings from '@/models/UserSettings';


export async function generateMetadata() {
    const locale = await getLocale();
    return {
    title: translate(locale, '花卷 · AI 工作助手', 'Huajuan · AI workspace'),
    description: translate(locale, '让花卷帮你查资料、分析文件、拆解任务并调用工具完成工作。', 'Research, analyze files, and complete tasks with Huajuan, an AI assistant that works with tools.'),
    manifest: '/manifest.webmanifest',
    icons: {
        shortcut: '/icon',
        icon: '/icon',
        apple: '/apple-icon',
    },
    other: {
        'mobile-web-app-capable': 'yes',
    },
    };
}

export const viewport = {
    themeColor: '#ffffff',
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
};

export default async function RootLayout({ children }) {
    const nonce = (await headers()).get('x-csp-nonce');
    const locale = await getLocale();
    // Script to prevent theme flash by setting the theme class before React hydration
    const auth = await getAuthPayload();
    const settings = auth ? await UserSettings.findOne({ userId: auth.userId }).select('appearance.themeMode').lean() : null;
    const accountTheme = auth ? (settings?.appearance?.themeMode || 'system') : null;
    const themeScript = `
 (function() {
   try {
     var accountMode = ${JSON.stringify(accountTheme)};
     var mode = accountMode || localStorage.getItem('${UI_THEME_MODE_KEY}');
     if (accountMode) localStorage.setItem('${UI_THEME_MODE_KEY}', accountMode);
    // null means no preference set, treat as 'system' (the default)
    var isDark = mode === 'dark' || ((mode === 'system' || mode === null) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark-mode');
      document.documentElement.style.colorScheme = 'dark';
      document.documentElement.style.backgroundColor = '#111815';
    }
  } catch (e) {}
})();
`;

    return (
        <html lang={localeTag(locale)} suppressHydrationWarning>
            <head>
                <script
                    nonce={nonce}
                    suppressHydrationWarning
                    dangerouslySetInnerHTML={{ __html: themeScript }}
                />
            </head>
            <body>
                <FadeScrollbarGlobal />
                <I18nProvider initialLocale={locale}><AppearanceProvider><ToastProvider>
                        <NavigationMotionProvider><div className="main-layout h-full">
                            {children}
                        </div></NavigationMotionProvider>
                </ToastProvider></AppearanceProvider></I18nProvider>
            </body>
        </html>
    );
}
