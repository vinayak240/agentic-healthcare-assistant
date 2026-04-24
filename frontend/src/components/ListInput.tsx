interface ListInputProps {
  id: string;
  label: string;
  helper: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function ListInput({ id, label, helper, placeholder, value, onChange }: ListInputProps) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <label className="block space-y-2" htmlFor={id}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
      />
      <p className="text-xs text-slate-500">{helper}</p>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="rounded-full border border-cyan-100 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </label>
  );
}
