export default function AudioSliderField({ id, label, valueLabel, icon: Icon, ...inputProps }) {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {label}
        </label>
        <output htmlFor={id} className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
          {valueLabel}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="h-2 w-full cursor-pointer accent-primary"
        {...inputProps}
      />
    </div>
  );
}
