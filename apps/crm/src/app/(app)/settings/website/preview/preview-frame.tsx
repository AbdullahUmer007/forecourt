 'use client';
import { useState } from 'react';
export function PreviewFrame({ html }: { html: string }) {
  const [mobile, setMobile] = useState(false);
  return <div className="grid gap-4">
    <div role="group" aria-label="Preview size" className="flex gap-2">
      {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={mobile === value} onClick={() => setMobile(value)} className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-4 font-medium aria-pressed:border-brand-600 aria-pressed:text-link">{value ? 'Phone' : 'Desktop'}</button>)}
    </div>
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-3 p-2 sm:p-4">
      <iframe title="Saved website preview" sandbox="" srcDoc={html.replace(/<body(?=[ >])/, '<body inert')} className="mx-auto block h-[80vh] max-w-full rounded-md border border-edge bg-white" style={{ width: mobile ? 375 : '100%' }} />
    </div>
  </div>;
}
