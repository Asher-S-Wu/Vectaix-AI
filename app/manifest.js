export default function manifest() {
    return {
        name: 'Vectaix AI',
        short_name: 'Vectaix AI',
        description: 'Experience the next generation of AI with Gemini, Claude, GPT, Seed, and more.',
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






