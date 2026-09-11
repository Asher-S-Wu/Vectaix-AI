export default function manifest() {
    return {
        name: 'Vectaix AI',
        short_name: 'Vectaix AI',
        description: 'Vectaix AI 支持多模型对话、联网搜索，以及图片、视频和语音创作。',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#38bdf8',
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






