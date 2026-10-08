type Props = {
  score?: number;
  max?: number;
};

/**
 * 0–max stars with exact partial fill: a grey row of ★ with a gold row clipped to score/max on top.
 * (The half-star glyph ⯨ isn't in the UI font and rendered as a box.)
 */
export function StarRating({ score, max = 5 }: Props) {
  if (score == null || !Number.isFinite(score)) {
    return <span className="star-rating star-rating-empty">No rating</span>;
  }
  const clamped = Math.max(0, Math.min(max, score));
  const stars = '★'.repeat(max);
  return (
    <span className="star-rating" title={`${clamped.toFixed(1)} / ${max}`}>
      <span className="star-rating-track" aria-hidden>
        <span className="star-rating-base">{stars}</span>
        <span className="star-rating-fill" style={{ width: `${(clamped / max) * 100}%` }}>
          {stars}
        </span>
      </span>
      <span className="star-rating-num">{clamped.toFixed(1)}</span>
    </span>
  );
}
