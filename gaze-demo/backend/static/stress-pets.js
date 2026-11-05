/** Hand-drawn local SVG; no network assets or user HTML. */
export function petMarkup(animation){
  if(animation==='cat_yawn')return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="200" cy="193" rx="132" ry="12" fill="#dcd8cc"/>
    <path class="cat-tail" d="M285 166 Q352 178 344 132 Q340 113 325 123" fill="none" stroke="#d9a56b" stroke-width="25" stroke-linecap="round"/>
    <ellipse class="pet-breathe" cx="226" cy="153" rx="81" ry="43" fill="#e9bc88"/>
    <path d="M210 178 Q244 170 268 185" fill="none" stroke="#bd8753" stroke-width="12" stroke-linecap="round"/>
    <g class="cat-head"><path d="M103 128 L92 66 L138 88 Q161 78 184 91 L217 63 L211 126Z" fill="#e9bc88"/>
    <path d="M104 96 L102 80 L122 93 M191 93 L204 78 L203 104" fill="#e4a6a1"/>
    <ellipse cx="156" cy="129" rx="62" ry="52" fill="#efc796"/>
    <path d="M119 118 Q131 109 141 118 M169 118 Q181 109 193 118" fill="none" stroke="#574739" stroke-width="4" stroke-linecap="round"/>
    <path d="M150 129 Q156 124 162 129 L156 135Z" fill="#ae7c74"/>
    <ellipse class="cat-yawn" cx="156" cy="149" rx="10" ry="7" fill="#74514d"/><ellipse class="cat-yawn" cx="156" cy="153" rx="6" ry="3" fill="#e9a4a3"/>
    <path d="M117 135 L87 130 M117 144 L83 147 M191 135 L221 129 M192 144 L225 147" stroke="#8e7259" stroke-width="2" stroke-linecap="round"/></g>
    <text class="sleep-mark" x="240" y="66" fill="#9b9b86" font-size="24" font-family="sans-serif">z</text></svg>`;
  if(animation==='dog_stretch')return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="200" cy="195" rx="139" ry="11" fill="#dcd8cc"/>
    <path class="dog-tail" d="M284 113 Q329 82 327 54" fill="none" stroke="#b98c65" stroke-width="20" stroke-linecap="round"/>
    <path class="dog-body" d="M151 136 Q202 114 249 91 Q277 82 290 110 L286 185 Q275 196 264 185 L255 136 Q212 164 168 165Z" fill="#d2ac84"/>
    <path class="dog-paws" d="M177 156 L133 184 L95 184 M154 150 L111 177 L77 177" fill="none" stroke="#b98c65" stroke-width="16" stroke-linecap="round"/>
    <g class="dog-head"><ellipse cx="132" cy="138" rx="46" ry="38" fill="#ddba94"/>
    <path d="M156 114 Q190 111 174 158 Q163 171 151 155Z" fill="#99734f"/>
    <ellipse cx="103" cy="150" rx="29" ry="22" fill="#ead1b0"/><ellipse cx="87" cy="142" rx="9" ry="6" fill="#574739"/>
    <path d="M116 128 Q127 120 137 128 M99 158 Q114 170 125 155" fill="none" stroke="#574739" stroke-width="3" stroke-linecap="round"/></g>
    <path d="M54 93 L60 107 M74 85 L75 101" stroke="#b8bca0" stroke-width="4" stroke-linecap="round"/></svg>`;
  return '';
}
