import MediaHeader from '@/app/components/media/MediaHeader';
export default function MediaLayout({ children }) {
  return <><MediaHeader /><div className="media-admin-content">{children}</div></>;
}
