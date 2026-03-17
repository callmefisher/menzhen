import { useState, useEffect } from 'react';
import { Image, Spin } from 'antd';
import { fetchFileBlob } from '../api/upload';

/** Hook: loads an authenticated blob URL for a file key, with auto-cleanup on unmount. */
export function useAuthUrl(key: string | null): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!key) { setUrl(undefined); return; }
    let cancelled = false;
    let blobUrl: string | undefined;

    fetchFileBlob(key).then(u => {
      if (cancelled) { URL.revokeObjectURL(u); return; }
      blobUrl = u;
      setUrl(u);
    }).catch(() => { /* fallback will show */ });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [key]);

  return url;
}

/** Image component that loads via authenticated blob URL, with antd Image preview. */
export function AuthImage({ fileKey, alt, width, height, style, fallback }: {
  fileKey: string;
  alt: string;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
  fallback?: string;
}) {
  const blobUrl = useAuthUrl(fileKey);

  if (!blobUrl) {
    return (
      <div style={{ width: width ?? 120, height: height ?? 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', borderRadius: 4 }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <Image
      src={blobUrl}
      alt={alt}
      width={width}
      height={height}
      style={style}
      fallback={fallback}
    />
  );
}

/** Audio component that loads via authenticated blob URL. */
export function AuthAudio({ fileKey, style }: {
  fileKey: string;
  style?: React.CSSProperties;
}) {
  const blobUrl = useAuthUrl(fileKey);

  if (!blobUrl) return <Spin size="small" />;

  return (
    <audio controls src={blobUrl} style={style}>
      您的浏览器不支持音频播放
    </audio>
  );
}

/** Video component that loads via authenticated blob URL. */
export function AuthVideo({ fileKey, style }: {
  fileKey: string;
  style?: React.CSSProperties;
}) {
  const blobUrl = useAuthUrl(fileKey);

  if (!blobUrl) return <Spin size="small" />;

  return (
    <video controls src={blobUrl} style={style}>
      您的浏览器不支持视频播放
    </video>
  );
}
