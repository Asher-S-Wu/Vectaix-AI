export default function BrandMark({ size = 32, className = '', pose, expression = 'smile', faceTransform, children }) {
  return <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <path className="huajuan-shadow" d="M12 58c8 13 45 15 57-1-9-5-45-7-57 1Z" fill="#D9E8D9" />
    <g className="huajuan-bounce">
      <g transform={pose}>
        <g className="huajuan-body">
          <path d="M15 47C10 34 20 22 31 21c1-10 15-14 23-7 12 2 17 12 13 22 10 16-1 29-25 29-18 0-31-5-27-18Z" fill="#FFFDF3" stroke="#426955" strokeWidth="3" strokeLinejoin="round" />
          <path d="M30 22c11-6 26 1 24 11-2 11-24 11-26 0-1-6 10-10 15-6 5 5-2 9-6 5M19 43c7 9 24 11 36 3M54 17c11 9 10 21 4 26" stroke="#B9C9A9" strokeWidth="3" strokeLinecap="round" />
          <g transform={faceTransform}>
            <g className="huajuan-eyes">
              {expression === 'happy' ? <path d="M27 52q3-5 6 0M48 52q3-5 6 0" stroke="#263B32" strokeWidth="2.5" strokeLinecap="round" /> : <>
                <circle cx="30" cy="51" r="2.5" fill="#263B32" />
                {expression === 'wink' ? <path d="m48 50 5 2-5 2" stroke="#263B32" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /> : <circle cx="51" cy="51" r="2.5" fill="#263B32" />}
              </>}
            </g>
            <path className="huajuan-smile" d={expression === 'thinking' ? 'M38 57h5' : 'M37 56c2 3 5 3 7 0'} stroke="#263B32" strokeWidth="2.5" strokeLinecap="round" />
            <g className="huajuan-cheeks"><ellipse cx="24" cy="55" rx="3.5" ry="2" fill="#EDCA75" /><ellipse cx="57" cy="55" rx="3.5" ry="2" fill="#EDCA75" /></g>
          </g>
          {children}
        </g>
      </g>
    </g>
  </svg>;
}
