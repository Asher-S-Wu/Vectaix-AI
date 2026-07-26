/**
 * Vectaix 原创品牌标识：四芒星 + 轨道光点。
 * 纯 SVG，无任何第三方品牌元素。
 */
export default function BrandMark({
  size = 24,
  gradientId = "vectaix-brand-gradient",
  className = "",
  withGlow = false,
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="4"
          y1="28"
          x2="28"
          y2="4"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="55%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#7dd3fc" />
        </linearGradient>
      </defs>
      {withGlow ? (
        <circle cx="16" cy="16" r="15" fill={`url(#${gradientId})`} opacity="0.14" />
      ) : null}
      {/* 四芒星：上下左右四条弧线汇聚 */}
      <path
        d="M16 2C16.9 8.6 20.4 12.1 27 13C20.4 13.9 16.9 17.4 16 24C15.1 17.4 11.6 13.9 5 13C11.6 12.1 15.1 8.6 16 2Z"
        fill={`url(#${gradientId})`}
      />
      {/* 右下小星 */}
      <path
        d="M24.5 20.5C24.9 22.7 26.3 24.1 28.5 24.5C26.3 24.9 24.9 26.3 24.5 28.5C24.1 26.3 22.7 24.9 20.5 24.5C22.7 24.1 24.1 22.7 24.5 20.5Z"
        fill={`url(#${gradientId})`}
        opacity="0.85"
      />
      {/* 轨道光点 */}
      <circle cx="7.5" cy="24" r="1.6" fill={`url(#${gradientId})`} opacity="0.7" />
    </svg>
  );
}
