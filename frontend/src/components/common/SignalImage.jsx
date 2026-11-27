import { useEffect, useState } from 'react';
import { apiFetch, resolveMediaUrl } from '../../services/apiClient';

export function SignalImage({ mediaPath, alt = 'Signal screenshot' }) {
  const resolved = resolveMediaUrl(mediaPath);
  const isNgrok = Boolean(resolved && resolved.includes('ngrok'));

  const [ngrokBlob, setNgrokBlob] = useState({ forUrl: '', src: '', failed: false });
  const [failedDirectUrl, setFailedDirectUrl] = useState('');

  useEffect(() => {
    if (!isNgrok || !resolved) return undefined;
    let objectUrl = null;
    let cancelled = false;

    apiFetch(resolved)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setNgrokBlob({ forUrl: resolved, src: objectUrl, failed: false });
      })
      .catch(() => {
        if (!cancelled) setNgrokBlob({ forUrl: resolved, src: '', failed: true });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isNgrok, resolved]);

  if (!mediaPath || !resolved) return null;

  if (isNgrok) {
    if (ngrokBlob.forUrl !== resolved || ngrokBlob.failed || !ngrokBlob.src) return null;
    return (
      <div className="img-wrap">
        <img
          src={ngrokBlob.src}
          alt={alt}
          className="raw-image-thumb"
          loading="lazy"
          onClick={() => window.open(ngrokBlob.src, '_blank', 'noopener,noreferrer')}
          title="Click to view full image"
          onError={() => setNgrokBlob({ forUrl: resolved, src: '', failed: true })}
        />
      </div>
    );
  }

  if (failedDirectUrl === resolved) return null;

  return (
    <div className="img-wrap">
      <img
        src={resolved}
        alt={alt}
        className="raw-image-thumb"
        loading="lazy"
        onClick={() => window.open(resolved, '_blank', 'noopener,noreferrer')}
        title="Click to view full image"
        onError={() => setFailedDirectUrl(resolved)}
      />
    </div>
  );
}
