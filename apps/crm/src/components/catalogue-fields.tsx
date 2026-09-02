'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/styles';

interface Make { id: string; name: string }
interface Model { id: string; name: string }
interface Variant { id: string; name: string; label: string }

/**
 * Cascading make → model → derivative from the platform catalogue.
 *
 * Hidden inputs keep the existing form field names so book-in and
 * appraisals do not grow a second contract. The dealer picks; we do not
 * invent a trim. Long lists (650 makes, hundreds of trims) are typed to
 * filter — a native select of 46,000 options is not a search.
 */
export function CatalogueFields({
  make,
  model,
  derivative,
  makeError,
  derivativeError,
}: {
  make: string;
  model: string;
  derivative: string;
  makeError?: string | undefined;
  derivativeError?: string | undefined;
}) {
  const makeId = useId();
  const modelId = useId();
  const variantId = useId();

  const [makes, setMakes] = useState<Make[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [makeName, setMakeName] = useState(make);
  const [modelName, setModelName] = useState(model);
  const [variantLabel, setVariantLabel] = useState(derivative);
  const [selectedMakeId, setSelectedMakeId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/catalogue?kind=makes')
      .then((r) => r.json())
      .then((body: { makes?: Make[] }) => {
        if (cancelled) return;
        const list = body.makes ?? [];
        setMakes(list);
        setLoaded(true);
        const match = list.find((m) => m.name.toLowerCase() === make.trim().toLowerCase());
        if (match) setSelectedMakeId(match.id);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [make]);

  useEffect(() => {
    if (!selectedMakeId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/catalogue?kind=models&makeId=${encodeURIComponent(selectedMakeId)}`)
      .then((r) => r.json())
      .then((body: { models?: Model[] }) => {
        if (cancelled) return;
        const list = body.models ?? [];
        setModels(list);
        const match = list.find((m) => m.name.toLowerCase() === modelName.trim().toLowerCase());
        setSelectedModelId(match?.id ?? '');
      });
    return () => { cancelled = true; };
  }, [selectedMakeId, modelName]);

  useEffect(() => {
    if (!selectedModelId) {
      setVariants([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/catalogue?kind=variants&modelId=${encodeURIComponent(selectedModelId)}`)
      .then((r) => r.json())
      .then((body: { variants?: Variant[] }) => {
        if (cancelled) return;
        const list = body.variants ?? [];
        setVariants(list);
        const match = list.find((v) =>
          v.label.toLowerCase() === variantLabel.trim().toLowerCase()
          || v.name.toLowerCase() === variantLabel.trim().toLowerCase());
        if (match) setVariantLabel(match.label);
      });
    return () => { cancelled = true; };
  }, [selectedModelId, variantLabel]);

  const empty = loaded && makes.length === 0;

  return (
    <>
      <input type="hidden" name="make" value={makeName} />
      <input type="hidden" name="model" value={modelName} />
      <input type="hidden" name="derivative" value={variantLabel} />

      <FilterablePick
        id={makeId}
        label="Make"
        error={makeError}
        value={selectedMakeId}
        options={makes.map((m) => ({ id: m.id, name: m.name, label: m.name }))}
        placeholder={empty ? 'Catalogue not loaded yet' : 'Select a make'}
        hint={empty
          ? 'The vehicle list has not been loaded. Run pnpm db:seed:catalogue, then refresh.'
          : undefined}
        onChange={(id, option) => {
          setSelectedMakeId(id);
          setMakeName(option?.name ?? '');
          setSelectedModelId('');
          setModelName('');
          setVariantLabel('');
          setVariants([]);
        }}
      />

      <FilterablePick
        id={modelId}
        label="Model"
        value={selectedModelId}
        options={models.map((m) => ({ id: m.id, name: m.name, label: m.name }))}
        disabled={!selectedMakeId}
        placeholder={selectedMakeId ? 'Select a model' : 'Pick the make first'}
        onChange={(id, option) => {
          setSelectedModelId(id);
          setModelName(option?.name ?? '');
          setVariantLabel('');
        }}
      />

      <FilterablePick
        id={variantId}
        label="Derivative"
        error={derivativeError}
        value={variants.find((v) => v.label === variantLabel)?.id ?? ''}
        options={variants.map((v) => ({ id: v.id, name: v.name, label: v.label }))}
        disabled={!selectedModelId}
        placeholder={selectedModelId ? 'Select the trim — do not guess' : 'Pick the model first'}
        hint="The trim sets the price and the description. If more than one matches the plate, pick — never guess."
        wide
        onChange={(_id, option) => {
          setVariantLabel(option?.label ?? '');
        }}
      />
    </>
  );
}

function FilterablePick({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder,
  error,
  hint,
  wide,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { id: string; name: string; label: string }[];
  onChange: (id: string, option: { id: string; name: string; label: string } | undefined) => void;
  disabled?: boolean;
  placeholder: string;
  error?: string | undefined;
  hint?: string | undefined;
  wide?: boolean;
}) {
  const filterId = useId();
  const [q, setQ] = useState('');
  const searchable = options.length > 16;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(needle) || o.name.toLowerCase().includes(needle),
    );
  }, [options, q]);

  useEffect(() => { setQ(''); }, [options]);

  return (
    <div className={`grid content-start gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      {searchable && !disabled && (
        <input
          id={filterId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Type to find a ${label.toLowerCase()}`}
          className={INPUT_CLASS}
          autoComplete="off"
        />
      )}
      <select
        id={id}
        className={`${INPUT_CLASS} ${error ? 'border-critical' : ''}`}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = options.find((o) => o.id === e.target.value);
          onChange(e.target.value, next);
        }}
      >
        <option value="">{placeholder}</option>
        {shown.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
        {value && !shown.some((o) => o.id === value) && (() => {
          const selected = options.find((o) => o.id === value);
          return selected ? <option value={selected.id}>{selected.label}</option> : null;
        })()}
      </select>
      {hint && <p className="text-[12px] leading-4 text-ink-subtle">{hint}</p>}
      {error && <p role="alert" className="text-[12px] leading-4 text-critical">{error}</p>}
    </div>
  );
}
