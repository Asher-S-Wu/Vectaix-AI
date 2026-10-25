import { ImageResponse } from 'next/og';
import BrandMark from '@/app/components/common/BrandMark';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
export default function Icon() {
  return new ImageResponse(<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F7F8F5', borderRadius: 36 }}><BrandMark size={144} /></div>, size);
}
