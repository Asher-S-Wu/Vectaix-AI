import './globals.css';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { ToastProvider } from './components/common/ToastProvider';
import FadeScrollbarGlobal from './components/layout/FadeScrollbarGlobal';
import { UI_THEME_MODE_KEY } from '@/lib/shared/storageKeys';

const inter = Inter({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    display: 'swap',
    variable: '--font-inter',
});

export const metadata = {
    title: 'Vectaix AI',
    description: 'Vectaix AI —— 支持 Gemini、Claude、GPT、Seed 等多种模型的新一代智能对话平台。',
    manifest: '/manifest.webmanifest',
    icons: {
        shortcut: '/favicon.ico',
        icon: '/icon',
        apple: '/apple-icon',
    },
    other: {
        'mobile-web-app-capable': 'yes',
    },
};

export const viewport = {
    themeColor: '#ffffff',
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    viewportFit: 'cover',
    userScalable: false, // Prevent zooming on inputs in iOS
};

export default async function RootLayout({ children }) {
    const nonce = (await headers()).get('x-csp-nonce');
    // Script to prevent theme flash by setting the theme class before React hydration
    const themeScript = `
 (function() {
   try {
     var mode = localStorage.getItem('${UI_THEME_MODE_KEY}');
    // null means no preference set, treat as 'system' (the default)
    var isDark = mode === 'dark' || ((mode === 'system' || mode === null) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark-mode');
      document.documentElement.style.colorScheme = 'dark';
      document.documentElement.style.backgroundColor = '#09090b';
    }
  } catch (e) {}
})();
`;

    return (
        <html lang="zh-CN" className={inter.variable} suppressHydrationWarning>
            <head>
                <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
            </head>
            <body>
                <FadeScrollbarGlobal />
                <ToastProvider>
                    <div className="main-layout h-full">
                        {children}
                    </div>
                </ToastProvider>
            </body>
        </html>
    );
}
