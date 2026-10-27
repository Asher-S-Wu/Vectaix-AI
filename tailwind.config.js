/** @type {import('tailwindcss').Config} */
// 中性灰带一点鼠尾草绿，和品牌主色同一色相，深浅模式下的面板、边框、文字保持一致。
const sage = {
    50: '#F6F8F6',
    100: '#EDF1EE',
    200: '#DDE4DF',
    300: '#C3CEC7',
    400: '#95A59B',
    500: '#637369',
    600: '#4D5E54',
    700: '#3B4B42',
    800: '#2A3830',
    900: '#1A231E',
    950: '#111815',
};

module.exports = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    darkMode: ['class', '.dark-mode'],
    theme: {
        extend: {
            colors: {
                primary: 'rgb(var(--primary-rgb) / <alpha-value>)',
                zinc: sage,
                slate: sage,
                gray: sage,
            },
        },
    },
    plugins: [],
};
