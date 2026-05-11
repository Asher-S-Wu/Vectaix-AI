import { ImageResponse } from 'next/og';
import GeminiColorIcon from '@/lib/server/branding/GeminiColorIcon';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
        }}
      >
        <GeminiColorIcon size={28} />
      </div>
    ),
    { ...size }
  );
}
