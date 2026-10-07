type Props = {
  score?: number;
  max?: number;
};

export function StarRating({ score, max = 5 }: Props) {
  if (score == null || !Number.isFinite(score)) {
    return <span className="star-rating star-rating-empty">No rating</span>;
  }
  const clamped = Math.max(0, Math.min(max, score));
  const full = Math.floor(clamped);
  const half = clamped - full >= 0.35 ? 1 : 0;
  const empty = max - full - half;
  return (
    <span className="star-rating" title={`${clamped.toFixed(1)} / ${max}`}>
      {'★'.repeat(full)}
      {half ? '⯨' : ''}
      {'☆'.repeat(empty)}
      <span className="star-rating-num">{clamped.toFixed(1)}</span>
    </span>
  );
}
