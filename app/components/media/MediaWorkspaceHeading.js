export default function MediaWorkspaceHeading({ title, description, modelLabel }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 max-w-prose text-sm leading-6 text-zinc-500">{description}</p>
      </div>
      {modelLabel ? <span className="w-fit shrink-0 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700">{modelLabel}</span> : null}
    </header>
  );
}
