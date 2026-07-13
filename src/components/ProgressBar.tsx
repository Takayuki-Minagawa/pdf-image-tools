interface ProgressBarProps {
  progress: number;
  label?: string;
}

export function ProgressBar({ progress, label }: ProgressBarProps) {
  const normalizedProgress = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress))
    : 0;
  const roundedProgress = Math.round(normalizedProgress);

  return (
    <div className="w-full">
      {label && <p className="mb-2 text-sm text-gray-600">{label}</p>}
      <div
        role="progressbar"
        aria-label={label ?? '処理の進捗'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedProgress}
        aria-valuetext={`${roundedProgress}% 完了`}
        className="h-3 w-full overflow-hidden rounded-full bg-gray-200"
      >
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${normalizedProgress}%` }}
        />
      </div>
      <p className="mt-1 text-right text-sm text-gray-500" aria-hidden="true">
        {roundedProgress}%
      </p>
    </div>
  );
}
