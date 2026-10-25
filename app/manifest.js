import { getLocale } from '@/lib/server/i18n';
import { localeTag, translate } from '@/lib/shared/i18n.mjs';

export default async function manifest() {
    const locale = await getLocale();
    return {
        name: translate(locale, '花卷', 'Huajuan'),
        short_name: translate(locale, '花卷', 'Huajuan'),
        lang: localeTag(locale),
        description: translate(locale, '查资料、分析文件，让花卷帮你完成工作。', 'Research, analyze files, and complete tasks with Huajuan.'),
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#426955',
        icons: [
            {
                src: '/icon',
                sizes: '32x32',
                type: 'image/png',
            },
            {
                src: '/apple-icon',
                sizes: '180x180',
                type: 'image/png',
            },
        ],
    };
}






