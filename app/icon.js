import { ImageResponse } from 'next/og';
import BrandMark from '@/app/components/common/BrandMark';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';
export default function Icon() {
  return new ImageResponse(<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F7F8F5', borderRadius: 6 }}><BrandMark size={32} /></div>, size);
}
