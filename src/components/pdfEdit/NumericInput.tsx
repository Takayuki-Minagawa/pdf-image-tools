import { useState } from 'react';

/** Keep intermediate input such as "-" or a leading digit while editing. */
export function NumericInput({ label, value, min = 0, max = 14400, step = 0.1, onChange }: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <input
        type="number" min={min} max={max} step={step}
        value={draft ?? Math.round(value * 100) / 100}
        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        onFocus={(event) => setDraft(event.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onChange={(event) => {
          setDraft(event.target.value);
          const number = event.target.valueAsNumber;
          if (Number.isFinite(number)) onChange(Math.min(max, Math.max(min, number)));
        }}
      />
    </label>
  );
}
