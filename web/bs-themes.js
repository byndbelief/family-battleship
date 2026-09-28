// Battleship themes (027): the water under a board and the ships on it, drawn top-down.
// Each fleet is drawn in its owner's theme (profiles.bs_theme), so everyone sees everyone's.
// Ships are inline SVG sized to the squares they cover: vesselSVG(theme, length, horizontal).

export const THEMES = {
  sea: { icon: '🌊', name: 'Classic Sea', lock: null },
  pirate: { icon: '🏴‍☠️', name: 'Pirate Cove', lock: { wins: 3 } },
  viking: { icon: '⚔️', name: 'Viking Fjord', lock: { wins: 10 } },
  ufo: { icon: '👽', name: 'UFO', lock: { secret: true } },
};
export const themeOf = (t) => (THEMES[t] ? t : 'sea');

// ---------------------------------------------------------------- ships, in a box L*100 wide, 100 tall (bow to the right)
const hullPath = (W, inset = 12) => `M${inset + 6},${inset} L${W - 34},${inset} Q${W - 6},50 ${W - 34},${100 - inset} L${inset + 6},${100 - inset} Q${inset - 4},50 ${inset + 6},${inset} Z`;
const ART = {
  sea(L) {
    const W = L * 100;
    let s = `<path d="${hullPath(W, 14)}" fill="#5E6C80" stroke="#2C3542" stroke-width="3"/>`
      + `<path d="M${24},50 L${W - 26},50" stroke="#8796AB" stroke-width="3" stroke-dasharray="6 7"/>`
      + `<rect x="${W / 2 - 18}" y="34" width="36" height="32" rx="5" fill="#9AA8BC" stroke="#3A4452" stroke-width="2"/>`
      + `<rect x="${W / 2 - 10}" y="41" width="20" height="18" rx="3" fill="#C9D3E0"/>`;
    for (let k = 0; k < L - 1; k++) {   // gun turrets fore and aft of the bridge
      const x = k % 2 ? W / 2 + 46 + Math.floor(k / 2) * 70 : W / 2 - 46 - Math.floor(k / 2) * 70;
      if (x < 34 || x > W - 40) continue;
      const dir = x > W / 2 ? 1 : -1;
      s += `<line x1="${x}" y1="50" x2="${x + dir * 30}" y2="50" stroke="#2C3542" stroke-width="6" stroke-linecap="round"/><circle cx="${x}" cy="50" r="13" fill="#7A889C" stroke="#2C3542" stroke-width="2.5"/>`;
    }
    return s;
  },
  pirate(L) {
    const W = L * 100;
    let s = `<path d="${hullPath(W, 12)}" fill="#7A4A22" stroke="#3B2210" stroke-width="3"/>`
      + `<path d="${hullPath(W, 22)}" fill="#A0673A"/>`;
    for (let x = 30; x < W - 30; x += 16) s += `<line x1="${x}" y1="25" x2="${x}" y2="75" stroke="#7A4A22" stroke-width="1.5" opacity=".6"/>`;
    s += `<path d="${hullPath(W, 12)}" fill="none" stroke="#D9A441" stroke-width="2.5" opacity=".9"/>`;
    const masts = Math.max(1, L - 1);
    for (let k = 0; k < masts; k++) {
      const x = 40 + ((W - 90) * (k + 0.5)) / masts;
      s += `<path d="M${x - 4},4 Q${x + 22},50 ${x - 4},96 L${x - 14},96 Q${x + 6},50 ${x - 14},4 Z" fill="#F4ECD8" stroke="#BFB39A" stroke-width="2"/>`   // a sail bellied by the wind
        + `<line x1="${x - 9}" y1="4" x2="${x - 9}" y2="96" stroke="#5A3A1A" stroke-width="3"/>`   // its yard
        + `<circle cx="${x}" cy="50" r="6" fill="#3B2210"/>`;
      if (k === 0) s += `<path d="M${x},50 L${x - 26},38 L${x - 26},52 Z" fill="#111"/><circle cx="${x - 17}" cy="44" r="3" fill="#fff"/>`;   // the Jolly Roger
    }
    return s;
  },
  viking(L) {
    const W = L * 100;
    const hull = `M14,50 Q20,18 60,16 L${W - 60},16 Q${W - 20},18 ${W - 14},50 Q${W - 20},82 ${W - 60},84 L60,84 Q20,82 14,50 Z`;
    let s = '';
    for (let x = 48; x < W - 48; x += 22) s += `<line x1="${x}" y1="18" x2="${x - 8}" y2="2" stroke="#6B4A2A" stroke-width="3"/><line x1="${x}" y1="82" x2="${x - 8}" y2="98" stroke="#6B4A2A" stroke-width="3"/>`;   // oars
    s += `<path d="${hull}" fill="#8A5A2E" stroke="#3B2410" stroke-width="3"/>`
      + `<path d="M${W - 14},50 q10,-10 4,-20 q-8,4 -4,12" fill="#3B2410"/><circle cx="${W - 8}" cy="40" r="2.5" fill="#E53935"/>`   // the dragon's head
      + `<path d="M14,50 q-8,8 -2,16" fill="none" stroke="#3B2410" stroke-width="4" stroke-linecap="round"/>`;
    const cols = ['#C62828', '#F2C230', '#1E6FB8', '#EDEDED'];
    for (let x = 56, k = 0; x < W - 56; x += 26, k++) s += `<circle cx="${x}" cy="22" r="9" fill="${cols[k % 4]}" stroke="#3B2410" stroke-width="2"/><circle cx="${x}" cy="78" r="9" fill="${cols[(k + 2) % 4]}" stroke="#3B2410" stroke-width="2"/>`;
    const sx = W / 2;   // one striped square sail
    s += `<rect x="${sx - 14}" y="10" width="28" height="80" rx="3" fill="#EDEDED" stroke="#8C1B1B" stroke-width="2"/>`;
    for (let y = 18; y < 88; y += 16) s += `<rect x="${sx - 14}" y="${y}" width="28" height="8" fill="#C62828"/>`;
    return s;
  },
  ufo(L) {
    const W = L * 100;
    let s = `<ellipse cx="${W / 2}" cy="50" rx="${W / 2 - 8}" ry="38" fill="url(#ufoMetal)" stroke="#5B6B7E" stroke-width="3"/>`
      + `<ellipse cx="${W / 2}" cy="50" rx="${W / 2 - 22}" ry="24" fill="none" stroke="#9FB3C8" stroke-width="2" opacity=".7"/>`;
    const domes = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k < domes; k++) {
      const x = ((k + 0.5) * W) / domes;
      s += `<circle cx="${x}" cy="50" r="16" fill="url(#ufoDome)" stroke="#2BD9A0" stroke-width="2"/><circle cx="${x - 5}" cy="44" r="4" fill="#fff" opacity=".8"/>`;
    }
    for (let x = 22, k = 0; x < W - 16; x += 24, k++) s += `<circle class="ufolight" style="animation-delay:${(k % 5) * 0.2}s" cx="${x}" cy="${50 + (k % 2 ? 26 : -26) * Math.sin(Math.PI * (x / W))}" r="4" fill="${['#FFD54F', '#FF5FA2', '#5FE3FF'][k % 3]}"/>`;
    return s;
  },
};
const DEFS = `<defs><linearGradient id="ufoMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E3EAF2"/><stop offset=".55" stop-color="#9AA9BA"/><stop offset="1" stop-color="#6B7B8D"/></linearGradient>`
  + `<radialGradient id="ufoDome" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#C8FFE9"/><stop offset="1" stop-color="#1FAE7A"/></radialGradient></defs>`;

// A ship covering `L` squares, pointing right (horizontal) or down.
export function vesselSVG(theme, L, horizontal) {
  const art = ART[themeOf(theme)](L), W = L * 100;
  return horizontal
    ? `<svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">${DEFS}${art}</svg>`
    : `<svg viewBox="0 0 100 ${W}" preserveAspectRatio="none" aria-hidden="true">${DEFS}<g transform="translate(100 0) rotate(90)">${art}</g></svg>`;
}

// The theme's own styles, added once: the water (.sea-<theme>) and the markers on it.
const css = document.createElement('style');
css.textContent = `
  .board.seaview{gap:0;position:relative;isolation:isolate}
  .board.seaview .sea{border-radius:10px;z-index:0;overflow:hidden;box-shadow:inset 0 0 0 2px #0003,0 4px 14px #0003}
  .board.seaview .vessel{z-index:1;pointer-events:none;display:block;padding:2px;filter:drop-shadow(0 3px 3px #0006)}
  .board.seaview .vessel svg{display:block;width:100%;height:100%}
  .board.seaview .vessel.wreck{filter:grayscale(.75) brightness(.6) drop-shadow(0 2px 2px #0008);opacity:.9}
  .board.seaview .cell{z-index:2;background:transparent!important;border-radius:0;box-shadow:inset 0 0 0 .5px #ffffff26;animation:none}
  .board.seaview button.cell:hover{background:#ffffff26!important}
  .board.seaview .cell.aim{background:#F2C230aa!important;animation:lockon .8s ease-in-out infinite alternate}
  .board.seaview .cell.miss::after{width:44%;height:44%;background:transparent;border:2.5px solid #ffffffd9;box-shadow:0 0 0 3px #ffffff40;animation:ripple 2.4s ease-out infinite}
  .board.seaview .cell.hit{background:transparent!important}
  .board.seaview .cell.hit::after{width:52%;height:52%;background:radial-gradient(circle,#FFE08A,#FF7A30 45%,#D8403A 75%,#D8403A00)}
  .board.seaview .cell.sunk{background:#D8403A38!important;animation:none}
  .board.seaview .cell.sunk::after{content:'';width:62%;height:62%;border-radius:50%;background:radial-gradient(circle,#FFB347,#FF5A1F 50%,#5A141000 75%);animation:burn .9s ease-in-out infinite alternate}
  .board.seaview .cell.new{box-shadow:inset 0 0 0 2px #F2C230}
  @keyframes ripple{0%{transform:scale(.7);opacity:1}70%{transform:scale(1.15);opacity:.7}100%{transform:scale(.7);opacity:1}}
  .sea{background-size:cover}
  .sea-sea{background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Cpath d='M0 30 Q15 22 30 30 T60 30 T90 30 T120 30' fill='none' stroke='%23ffffff' stroke-opacity='.16' stroke-width='2'/%3E%3C/svg%3E") 0 0/120px 60px,
      linear-gradient(170deg,#2F79B8,#154C80 60%,#0D3560)}
  .sea-pirate{background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E%3Cpath d='M10 20 q20 -10 40 0 M50 60 q20 -10 35 0 M0 75 q15 -8 30 0' fill='none' stroke='%23ffffff' stroke-opacity='.28' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E") 0 0/90px 90px,
      radial-gradient(ellipse at 15% 10%,#F2D59866,transparent 30%),
      linear-gradient(165deg,#2EC4C0,#118E98 55%,#0A5E6E)}
  .sea-viking{background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Ccircle cx='12' cy='18' r='1.6' fill='%23fff' fill-opacity='.55'/%3E%3Ccircle cx='52' cy='40' r='1.2' fill='%23fff' fill-opacity='.45'/%3E%3Ccircle cx='30' cy='66' r='1.8' fill='%23fff' fill-opacity='.5'/%3E%3Cpath d='M58 12 l10 3 l-4 6 l-9 -2 z' fill='%23E8F3FA' fill-opacity='.35'/%3E%3C/svg%3E") 0 0/80px 80px,
      linear-gradient(175deg,#4E6E80,#2B4555 55%,#172833)}
  .sea-ufo{background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='70' height='70'%3E%3Ccircle cx='8' cy='12' r='1' fill='%23fff'/%3E%3Ccircle cx='40' cy='30' r='.8' fill='%23fff' fill-opacity='.8'/%3E%3Ccircle cx='60' cy='58' r='1.2' fill='%23fff'/%3E%3Ccircle cx='22' cy='52' r='.7' fill='%23BFE6FF'/%3E%3C/svg%3E") 0 0/70px 70px,
      radial-gradient(ellipse at 70% 30%,#8A3FD166,transparent 45%),radial-gradient(ellipse at 20% 80%,#1FAE7A40,transparent 40%),
      linear-gradient(160deg,#1A0F3A,#0B0620)}
  .board.seaview.t-ufo .cell.miss::after{border-color:#5FFFC4;box-shadow:0 0 8px #5FFFC4}
  .board.seaview.t-viking .cell{box-shadow:inset 0 0 0 .5px #ffffff1f}
  .ufolight{animation:blink 1s ease-in-out infinite alternate}
  @keyframes blink{from{opacity:.35}to{opacity:1}}
  @media (prefers-reduced-motion:no-preference){.sea{animation:drift 14s linear infinite}.sea-ufo{animation-duration:40s}}
  @keyframes drift{from{background-position:0 0,0 0,0 0,0 0}to{background-position:120px 12px,0 0,0 0,0 0}}
  @media (prefers-reduced-motion:reduce){.board.seaview .cell.miss::after,.ufolight,.board.seaview .cell.sunk::after{animation:none}}`;
document.head.appendChild(css);
