import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
          borderRadius: 36,
        }}
      >
        <svg width="128" height="128" viewBox="0 0 32 32" fill="none">
          <defs>
            <linearGradient id="vb-apple" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#0ea5e9" />
              <stop offset="55%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#7dd3fc" />
            </linearGradient>
          </defs>
          <path
            d="M16 2C16.9 8.6 20.4 12.1 27 13C20.4 13.9 16.9 17.4 16 24C15.1 17.4 11.6 13.9 5 13C11.6 12.1 15.1 8.6 16 2Z"
            fill="url(#vb-apple)"
          />
          <path
            d="M24.5 20.5C24.9 22.7 26.3 24.1 28.5 24.5C26.3 24.9 24.9 26.3 24.5 28.5C24.1 26.3 22.7 24.9 20.5 24.5C22.7 24.1 24.1 22.7 24.5 20.5Z"
            fill="url(#vb-apple)"
            opacity="0.85"
          />
          <circle cx="7.5" cy="24" r="1.6" fill="url(#vb-apple)" opacity="0.7" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
