/** Ilustração do cartão principal: uma janela sendo transmitida e quem está assistindo. */
export function ShareIllustration() {
  return (
    <svg viewBox="44 6 384 170" fill="none" className="telae-share-illustration" aria-hidden="true">
      <defs>
        <linearGradient id="share-screen" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#211E16" />
          <stop offset="1" stopColor="#14130F" />
        </linearGradient>
        <linearGradient id="share-accent" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#F2C985" />
          <stop offset="1" stopColor="#D19A45" />
        </linearGradient>
      </defs>
      <rect x="56" y="14" width="300" height="154" rx="14" fill="url(#share-screen)" stroke="#3D3220" />
      <path d="M56 44H356" stroke="#2D281C" />
      <circle cx="74" cy="29" r="3.5" fill="#E0AE5E" />
      <circle cx="87" cy="29" r="3.5" fill="#3A3528" />
      <circle cx="100" cy="29" r="3.5" fill="#3A3528" />
      <rect x="290" y="21" width="52" height="16" rx="8" fill="#E0AE5E" fillOpacity=".14" stroke="#E0AE5E" strokeOpacity=".35" />
      <circle cx="301" cy="29" r="3" fill="#E0AE5E" />
      <path d="M309 29H331" stroke="#E0AE5E" strokeOpacity=".7" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="74" y="58" width="72" height="94" rx="8" fill="#1B1912" stroke="#2D281C" />
      <path d="M88 76H130M88 90H120M88 104H126M88 118H112" stroke="#4A4231" strokeWidth="3" strokeLinecap="round" />
      <rect x="160" y="58" width="180" height="58" rx="8" fill="#26211A" stroke="#35301F" />
      <rect x="174" y="72" width="62" height="8" rx="4" fill="url(#share-accent)" fillOpacity=".8" />
      <path d="M174 94H300M174 104H268" stroke="#5E5339" strokeWidth="3" strokeLinecap="round" />
      <rect x="160" y="126" width="84" height="26" rx="7" fill="#1B1912" stroke="#2D281C" />
      <rect x="256" y="126" width="84" height="26" rx="7" fill="#1B1912" stroke="#2D281C" />
      <path d="M268 82 269 111 276 104 281 115 287 112 282 101H293L268 82Z" fill="#F4F3EF" stroke="#14130F" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="388" cy="64" r="17" fill="#1F1B13" stroke="#E0AE5E" strokeOpacity=".45" />
      <circle cx="388" cy="59" r="5.5" fill="#E0AE5E" fillOpacity=".75" />
      <path d="M377 76C379 69 397 69 399 76" stroke="#E0AE5E" strokeOpacity=".75" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="404" cy="102" r="14" fill="#1F1B13" stroke="#3D3220" />
      <circle cx="404" cy="98" r="4.5" fill="#B6B5AF" fillOpacity=".55" />
      <path d="M395 111C397 105 411 105 413 111" stroke="#B6B5AF" strokeOpacity=".55" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M358 74C366 74 370 72 371 66M358 94C372 94 380 98 389 100" stroke="#E0AE5E" strokeOpacity=".4" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" />
    </svg>
  )
}
