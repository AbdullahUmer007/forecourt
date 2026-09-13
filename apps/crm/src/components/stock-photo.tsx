'use client';

import { useEffect, useRef, useState } from 'react';
import { StockIcon } from './icons';

/** Failed/missing media is honest: never substitute a different vehicle's photograph. */
export function StockPhoto({ url, description }: { url: string | null; description: string }) {
  const [failed, setFailed] = useState(false);
  const photo = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setFailed(Boolean(photo.current?.complete && photo.current.naturalWidth === 0));
  }, [url]);
  return <div className="stock-photo">
    {url && !failed ? <img ref={photo} src={url} alt={description} loading="lazy" onError={() => setFailed(true)} />
      : <div className="grid justify-items-center gap-3 py-8 text-ink-subtle"><StockIcon size={48} /><span className="text-[12px]">{failed ? 'Photo unavailable' : 'Add vehicle photographs'}</span></div>}
  </div>;
}
