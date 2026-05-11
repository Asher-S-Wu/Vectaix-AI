import './globals.css';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import { headers } from 'next/headers';
import { ToastProvider } from './components/common/ToastProvider';
import FadeScrollbarGlobal from './components/layout/FadeScrollbarGlobal';
import { UI_THEME_MODE_KEY } from '@/lib/shared/storageKeys';

export const metadata = {
    title: 'Vectaix AI',
    description: 'Experience the next generation of AI with Gemini, Claude, GPT, Seed, and more.',
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
    themeColor: '#f8fafc',
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
      document.documentElement.style.backgroundColor = '#18181b';
    }
  } catch (e) {}
})();
`;

    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
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
