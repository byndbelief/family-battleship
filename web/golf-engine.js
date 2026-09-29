// Putt Post engine: the 18 holes, random obstacles, physics, sneak-attack effects and drawing.
// Shared by every player's browser, so a stored putt replays identically everywhere.
// (Ported unchanged from the link version of Putt Post.)
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ================================================================= course
// Logical course space is 360 x 560. Rects are [x, y, w, h].
// Spinners are windmills: [cx, cy, blade length, blade count, turn per tick].
const BW=360, BH=560;   // the holes are drawn up in this space (and random obstacles placed in it)
// The course size (036): 4+ players get a bigger course, every hole scaled up around the same
// ball and cup, so the page shows more green, zoomed out (golf_games.course: 120 / 135 / 150 %).
// Putts go that much faster, so the same drag reaches the same share of the hole. LW/LH are the
// course as played and drawn; the page sets it with setCourse() for the game it shows.
let LW=BW, LH=BH, COURSE=1;
function setCourse(s){ COURSE=s||1; LW=BW*COURSE; LH=BH*COURSE; }
const rect = (x,y,w,h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const BOX = rect(40,40,280,480);
const HOLES = [
  { name:'First Tee',     par:2, outline:rect(60,40,240,480), tee:[180,470], cup:[180,100] },
  { name:'The Dogleg',    par:3, outline:[[40,40],[320,40],[320,170],[170,170],[170,520],[40,520]], tee:[105,470], cup:[268,100] },
  { name:'Bumper Garden', par:3, outline:BOX, tee:[180,480], cup:[180,95], bumpers:[[120,300,16],[240,300,16],[180,225,16],[180,375,16]] },
  { name:'The Gap',       par:3, outline:BOX, tee:[180,480], cup:[180,100], blocks:[[40,300,110,18],[210,300,110,18]], sand:[[120,150,120,70]] },
  { name:'Creek Bridge',  par:3, outline:BOX, tee:[180,480], cup:[118,100], water:[[40,250,125,70],[195,250,125,70]] },
  { name:'Side Hill',     par:3, outline:BOX, tee:[270,480], cup:[92,100], slopes:[{r:[40,170,280,220], a:[0.035,0]}] },
  { name:'Zigzag',        par:4, outline:BOX, tee:[80,480], cup:[280,98], blocks:[[40,360,210,18],[110,190,210,18]] },
  { name:'The Funnel',    par:3, outline:BOX, tee:[180,490], cup:[180,118],
    slopes:[{r:[40,40,140,200], a:[0.03,0.008]},{r:[180,40,140,200], a:[-0.03,0.008]}], bumpers:[[132,190,12],[228,190,12]], sand:[[40,410,90,60],[230,410,90,60]] },
  { name:'Lakeside',      par:4, outline:BOX, tee:[180,500], cup:[180,82],
    water:[[40,300,120,56],[200,300,120,56]], bumpers:[[180,205,14],[108,150,12],[252,150,12]], sand:[[140,410,80,40]], slopes:[{r:[40,370,280,30], a:[0,0.02]}] },
  // ---- back nine
  { name:'The Windmill',  par:3, outline:BOX, tee:[180,490], cup:[180,90], spinners:[[180,290,72,4,0.03]], bumpers:[[180,290,10]] },
  { name:'Twin Creeks',   par:4, outline:BOX, tee:[180,490], cup:[180,90], water:[[40,180,120,40],[200,180,120,40],[40,360,60,40],[140,360,180,40]] },
  { name:'Pinball',       par:3, outline:BOX, tee:[180,490], cup:[180,90],
    bumpers:[[100,180,11],[180,180,11],[260,180,11],[140,260,11],[220,260,11],[100,340,11],[180,340,11],[260,340,11]] },
  { name:'The S-Bend',    par:4, outline:BOX, tee:[80,490], cup:[100,90], blocks:[[40,420,200,16],[120,300,200,16],[40,170,200,16]] },
  { name:'Sand Sea',      par:3, outline:BOX, tee:[180,490], cup:[180,90], sand:[[40,200,280,170]], bumpers:[[180,285,14]] },
  { name:'Spinner Alley', par:3, outline:rect(80,40,200,480), tee:[180,495], cup:[180,80], spinners:[[180,200,52,2,-0.04],[180,380,52,2,0.04]] },
  { name:'Downhill Run',  par:3, outline:BOX, tee:[90,490], cup:[270,100], slopes:[{r:[40,290,280,230], a:[0,-0.02]}],
    blocks:[[40,250,120,16],[200,250,120,16]], sand:[[210,150,110,40]] },
  { name:'The Diamond',   par:3, outline:[[180,40],[320,280],[180,520],[40,280]], tee:[180,475], cup:[180,90], bumpers:[[180,280,18]] },
  { name:'The Castle',    par:4, outline:BOX, tee:[180,495], cup:[180,85],
    water:[[40,140,125,30],[195,140,125,30]], spinners:[[180,310,60,3,0.025]], bumpers:[[180,310,9],[90,230,12],[270,230,12]], blocks:[[110,55,14,70],[236,55,14,70]] },
];
const N_HOLES = HOLES.length;

// ================================================================= random obstacles
// Integer-only generator, so every browser builds the same course from a seed.
function rng(seed){ let x=(seed>>>0)||1; return ()=>{ x^=x<<13; x>>>=0; x^=x>>>17; x^=x<<5; x>>>=0; return x/4294967296; }; }
function inPoly(x,y,pts){ let c=false; for(let i=0,j=pts.length-1;i<pts.length;j=i++){ const [xi,yi]=pts[i],[xj,yj]=pts[j]; if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) c=!c; } return c; }
const inRect = (x,y,[rx,ry,rw,rh]) => x>=rx && x<=rx+rw && y>=ry && y<=ry+rh;
function segDist(x,y,[x1,y1,x2,y2]){ const dx=x2-x1, dy=y2-y1, L2=dx*dx+dy*dy; let t=((x-x1)*dx+(y-y1)*dy)/L2; t=t<0?0:t>1?1:t; const px=x1+t*dx-x, py=y1+t*dy-y; return Math.sqrt(px*px+py*py); }

function buildHole(base, extra){
  const h={...base};
  ['blocks','bumpers','sand','water','slopes','spinners'].forEach(k=>h[k]=[...(base[k]||[]), ...((extra&&extra[k])||[])]);
  h.extra=extra||null;
  h.segs=[];
  const add=pts=>pts.forEach((p,i)=>{ const q=pts[(i+1)%pts.length]; h.segs.push([p[0],p[1],q[0],q[1]]); });
  add(h.outline); h.blocks.forEach(b=>add(rect(...b)));
  return h;
}
// Can a ball get from tee to cup? Flood fill on a 5px grid, ignoring windmills.
function reachable(h){
  const S=5, W=Math.ceil(BW/S), Hh=Math.ceil(BH/S), seen=new Uint8Array(W*Hh);
  const ok=(gx,gy)=>{ const x=gx*S+S/2, y=gy*S+S/2;
    if(!inPoly(x,y,h.outline)) return false;
    for(const s of h.segs) if(segDist(x,y,s)<R+0.5) return false;
    for(const w of h.water) if(inRect(x,y,w)) return false;
    for(const [cx,cy,cr] of h.bumpers){ const dx=x-cx, dy=y-cy; if(dx*dx+dy*dy<(cr+R)*(cr+R)) return false; }
    return true; };
  const start=[Math.floor(h.tee[0]/S), Math.floor(h.tee[1]/S)], goal=[Math.floor(h.cup[0]/S), Math.floor(h.cup[1]/S)];
  const q=[start]; seen[start[1]*W+start[0]]=1;
  while(q.length){ const [x,y]=q.pop(); if(Math.abs(x-goal[0])<=1 && Math.abs(y-goal[1])<=1) return true;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=x+dx, ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=Hh||seen[ny*W+nx]) continue; seen[ny*W+nx]=1; if(ok(nx,ny)) q.push([nx,ny]); } }
  return false;
}
function randomExtras(seed, hi){
  const base=HOLES[hi];
  for(let attempt=0; attempt<14; attempt++){
    const r=rng((seed*7919 + hi*104729 + attempt*31337) >>> 0);
    const extra={blocks:[],bumpers:[],sand:[],water:[]};
    const count=1+Math.floor(r()*3);
    const xs=base.outline.map(p=>p[0]), ys=base.outline.map(p=>p[1]);
    const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
    const clearOf=(x,y,rad)=>{
      const far=(px,py,d)=>{ const dx=x-px, dy=y-py; return dx*dx+dy*dy>d*d; };
      if(!far(base.tee[0],base.tee[1],rad+46) || !far(base.cup[0],base.cup[1],rad+42)) return false;
      if((base.spinners||[]).some(([cx,cy,len])=>!far(cx,cy,len+rad+10))) return false;
      if((base.bumpers||[]).concat(extra.bumpers).some(([cx,cy,cr])=>!far(cx,cy,cr+rad+14))) return false;
      return true;
    };
    for(let i=0;i<count;i++){
      for(let tries=0; tries<25; tries++){
        const roll=r(), x=Math.round(x0+20+r()*(x1-x0-40)), y=Math.round(y0+20+r()*(y1-y0-40));
        if(roll<0.4){ const cr=10+Math.floor(r()*7); if(!inPoly(x,y,base.outline)||!clearOf(x,y,cr)) continue; extra.bumpers.push([x,y,cr]); break; }
        const horiz=r()<0.5, w=horiz?40+Math.floor(r()*50):14, hh=horiz?14:40+Math.floor(r()*50);
        const bx=x-Math.round(w/2), by=y-Math.round(hh/2);
        const corners=[[bx,by],[bx+w,by],[bx,by+hh],[bx+w,by+hh]];
        if(!corners.every(([cx,cy])=>inPoly(cx,cy,base.outline))) continue;
        if(!clearOf(x,y,Math.max(w,hh)/2)) continue;
        if(roll<0.7) extra.blocks.push([bx,by,w,hh]);
        else if(roll<0.9) extra.sand.push([x-30,y-20,60+Math.floor(r()*30),40]);
        else extra.water.push([x-22,y-16,44,32]);
        break;
      }
    }
    const h=buildHole(base, extra);
    if(reachable(h)) return h;
  }
  return buildHole(base, null);
}
const holeCache=new Map();
function holeFor(seed, hi){
  const key=seed+':'+hi;
  if(!holeCache.has(key)) holeCache.set(key, seed ? randomExtras(seed,hi) : buildHole(HOLES[hi], null));
  return holeCache.get(key);
}

// ================================================================= physics
// Only + - * / and sqrt (plus sin/cos for windmills, from the same tick count),
// so a stored putt replays the same way on the other player's phone.
const R = 6, CUP_R = 9, MAX_STROKES = 8;
function collideSeg(b,[x1,y1,x2,y2]){
  const dx=x2-x1, dy=y2-y1, L2=dx*dx+dy*dy;
  let t=((b.x-x1)*dx+(b.y-y1)*dy)/L2; t=t<0?0:t>1?1:t;
  const px=x1+t*dx, py=y1+t*dy; let nx=b.x-px, ny=b.y-py;
  const d=Math.sqrt(nx*nx+ny*ny); if(d>=R||d===0) return false;
  nx/=d; ny/=d; b.x=px+nx*R; b.y=py+ny*R;
  const vn=b.vx*nx+b.vy*ny; if(vn<0){ b.vx-=1.78*vn*nx; b.vy-=1.78*vn*ny; }
  return true;
}
function collideBumper(b,[cx,cy,cr]){
  let nx=b.x-cx, ny=b.y-cy; const d=Math.sqrt(nx*nx+ny*ny), rr=cr+R;
  if(d>=rr||d===0) return false;
  nx/=d; ny/=d; b.x=cx+nx*rr; b.y=cy+ny*rr;
  const vn=b.vx*nx+b.vy*ny; if(vn<0){ b.vx-=2.2*vn*nx; b.vy-=2.2*vn*ny; }
  const sp=Math.sqrt(b.vx*b.vx+b.vy*b.vy); if(sp>12){ b.vx*=12/sp; b.vy*=12/sp; }
  return true;
}
// Windmill blades are a fixed table of angles per tick, not live trig, to keep replays exact.
const TRIG_STEPS=4096, SIN=new Float64Array(TRIG_STEPS), COS=new Float64Array(TRIG_STEPS);
for(let i=0;i<TRIG_STEPS;i++){ SIN[i]=Math.round(Math.sin(i/TRIG_STEPS*2*Math.PI)*1e6)/1e6; COS[i]=Math.round(Math.cos(i/TRIG_STEPS*2*Math.PI)*1e6)/1e6; }
function bladeSegs(sp, clock){
  const [cx,cy,len,n,speed]=sp, out=[];
  for(let k=0;k<n;k++){
    const idx=((Math.round(clock*speed/(2*Math.PI)*TRIG_STEPS) + Math.round(k*TRIG_STEPS/n)) % TRIG_STEPS + TRIG_STEPS) % TRIG_STEPS;
    out.push([cx, cy, cx+COS[idx]*len, cy+SIN[idx]*len]);
  }
  return out;
}
// Advances the ball one tick. Returns null, 'bump', 'wall', 'cup', 'water' or 'stop'.
// A chipped ball (043) flies CHIP_AIR ticks over everything, then lands at half speed and rolls;
// landing off the course, in water or in a hedge counts as water (back to where it was hit, +1).
const CHIP_AIR=20, GOPH_R=7;
function tick(b, h){
  if(b.air>0){
    b.x+=b.vx; b.y+=b.vy; b.clock++; b.ticks++;
    if(--b.air===0){ b.vx*=0.55; b.vy*=0.55;
      if(!inPoly(b.x,b.y,h.outline) || h.blocks.some(q=>inRect(b.x,b.y,q)) || h.water.some(q=>inRect(b.x,b.y,q))) return 'water'; }
    return null;
  }
  let ev=null;
  const blades=h.spinners.flatMap(s=>bladeSegs(s,b.clock));
  const sp=Math.sqrt(b.vx*b.vx+b.vy*b.vy), n=Math.max(1,Math.ceil(sp/2));
  for(let i=0;i<n;i++){
    b.x+=b.vx/n; b.y+=b.vy/n;
    for(const s of h.segs) if(collideSeg(b,s)) ev=ev||'wall';
    for(const s of blades) if(collideSeg(b,s)) ev=ev||'wall';
    for(const c of h.bumpers) if(collideBumper(b,c)) ev='bump';
  }
  b.clock++;
  const sand=h.sand.some(r=>inRect(b.x,b.y,r));
  const f=sand?0.93:(h.friction||0.984); b.vx*=f; b.vy*=f;
  if(h.wind && b.vx*b.vx+b.vy*b.vy>0.16){ b.vx+=h.wind[0]; b.vy+=h.wind[1]; }
  let sloped=false;
  for(const s of h.slopes) if(inRect(b.x,b.y,s.r)){ b.vx+=s.a[0]; b.vy+=s.a[1]; sloped=true; }
  if(h.water.some(r=>inRect(b.x,b.y,r))) return 'water';
  // Gopher holes (043) come in pairs: in one, out of the other at 70% speed, heading the same way.
  if(b.gcool>0) b.gcool--;
  else if(h.gophers) for(let i=0;i<h.gophers.length;i++){ const [gx,gy]=h.gophers[i];
    if((b.x-gx)*(b.x-gx)+(b.y-gy)*(b.y-gy)<GOPH_R*GOPH_R){ const [ox,oy]=h.gophers[i^1], sp=Math.sqrt(b.vx*b.vx+b.vy*b.vy)||1;
      b.vx*=0.7; b.vy*=0.7; b.x=ox+b.vx/sp*(GOPH_R+R+1); b.y=oy+b.vy/sp*(GOPH_R+R+1); b.gcool=12; return 'gopher'; } }
  const cx=b.x-h.cup[0], cy=b.y-h.cup[1], s2=Math.sqrt(b.vx*b.vx+b.vy*b.vy);
  const cr=h.cupR||CUP_R; if(cx*cx+cy*cy<cr*cr && s2<(h.cupSpeed||5.5)) return 'cup';
  if(s2<0.06){ b.still=(b.still||0)+1; if(!sloped || b.still>40) return 'stop'; } else b.still=0;
  if(++b.ticks>2400) return 'stop';
  return ev;
}
const q20 = v => Math.round(v*20)/20;     // stored ball position precision
const q100 = v => Math.round(v*100)/100;  // stored velocity precision

// ================================================================= sneak attacks
// One can be planted per target; it hits the target's next hole and is revealed only then.
const ATTACKS=[null,
  {name:'Ice Rink',        icon:'🧊', desc:'The green freezes. Every putt slides much farther.'},
  {name:'Gusty Wind',      icon:'🌬️', desc:'A crosswind shoves the ball sideways while it rolls.'},
  {name:'Tiny Cup',        icon:'🕳️', desc:'The cup shrinks and only takes gentle putts.'},
  {name:'Surprise Bumpers',icon:'💥', desc:'Two bumpers pop up right beside the cup.'},
  {name:'Butterfingers',   icon:'🧈', desc:'The putter loses a third of its power.'},
];
const attackCache=new Map();
// Every part of a hole, scaled by s around the origin (the ball and cup keep their size).
const scaledCache=new Map();
function scaleHole(h, s){
  const P=([x,y])=>[x*s,y*s], Rc=([x,y,w,hh])=>[x*s,y*s,w*s,hh*s];
  return {...h, outline:h.outline.map(P), tee:P(h.tee), cup:P(h.cup), segs:h.segs.map(([a,b,c,d])=>[a*s,b*s,c*s,d*s]),
    blocks:h.blocks.map(Rc), sand:h.sand.map(Rc), water:h.water.map(Rc), bumpers:h.bumpers.map(([x,y,r])=>[x*s,y*s,r*s]),
    slopes:h.slopes.map(sl=>({...sl, r:Rc(sl.r), a:[sl.a[0]*s, sl.a[1]*s]})), spinners:h.spinners.map(([x,y,len,n,turn])=>[x*s,y*s,len*s,n,turn]),
    wind:h.wind?[h.wind[0]*s,h.wind[1]*s]:h.wind, cupSpeed:(h.cupSpeed||5.5)*s, scale:s, gophers:h.gophers?.map(P)};
}
// ================================================================= chaos twists on a hole (043)
// golf_games.twists = { "<hole>": [{ k: 'cup' | 'gopher', s: seed, t: from turn }] }. The ones with
// t <= the turn being played apply in order, placed in the base course (so reachable() can check
// them) by the same seeded search on every device, then scaled like the rest of the hole.
//   cup:    the cup moves to a clear spot at least 140 from the tee that can still be reached
//   gopher: a pair of holes on the fairway, linked underground (see tick)
const twistsFor=(all, hi, t)=>((all||{})[hi]||[]).filter(tw=>tw.t<=t);
function spotFor(h, r, avoid){
  const xs=h.outline.map(p=>p[0]), ys=h.outline.map(p=>p[1]), x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
  for(let k=0;k<80;k++){
    const x=Math.round(x0+20+r()*(x1-x0-40)), y=Math.round(y0+20+r()*(y1-y0-40));
    if(!inPoly(x,y,h.outline) || h.segs.some(sg=>segDist(x,y,sg)<18)) continue;
    if([...h.water,...h.sand,...h.slopes.map(sl=>sl.r)].some(q=>inRect(x,y,[q[0]-12,q[1]-12,q[2]+24,q[3]+24]))) continue;
    if(h.bumpers.some(([bx,by,br])=>Math.hypot(x-bx,y-by)<br+18) || h.spinners.some(([sx,sy,len])=>Math.hypot(x-sx,y-sy)<len+14)) continue;
    if(avoid.some(([ax,ay,d])=>Math.hypot(x-ax,y-ay)<d)) continue;
    return [x,y];
  }
  return null;
}
function twistHole(base, list){
  let h={...base, gophers:[...(base.gophers||[])]};
  for(const tw of list){
    const r=rng((tw.s>>>0)||1), dug=h.gophers.map(g=>[g[0],g[1],40]);
    if(tw.k==='cup'){
      for(let i=0;i<8;i++){ const p=spotFor(h,r,[[h.tee[0],h.tee[1],140],[h.cup[0],h.cup[1],70],...dug]); if(!p) break;
        const trial={...h,cup:p}; if(reachable(trial)){ h=trial; break; } }
    } else if(tw.k==='gopher'){
      const avoid=[[h.tee[0],h.tee[1],50],[h.cup[0],h.cup[1],50],...dug];
      const a=spotFor(h,r,avoid), b=a&&spotFor(h,r,[...avoid,[a[0],a[1],120]]);
      if(a&&b) h.gophers=[...h.gophers,a,b];
    }
  }
  return h;
}
const twistCache=new Map();
function holeWithTwists(seed, hi, type, all, t){
  const list=twistsFor(all, hi, t);
  if(!list.length) return holeWithAttack(seed, hi, type);
  const key=seed+':'+hi+':'+type+':'+COURSE+':'+JSON.stringify(list);
  if(!twistCache.has(key)){ const h=twistHole(holeAt(seed, hi, type), list); twistCache.set(key, COURSE===1?h:scaleHole(h, COURSE)); }
  return twistCache.get(key);
}
function holeWithAttack(seed, hi, type){
  if(COURSE===1) return holeAt(seed, hi, type);
  const key=seed+':'+hi+':'+type+':'+COURSE;
  if(!scaledCache.has(key)) scaledCache.set(key, scaleHole(holeAt(seed, hi, type), COURSE));
  return scaledCache.get(key);
}
function holeAt(seed, hi, type){
  const base=holeFor(seed, hi);
  if(!type) return base;
  const key=seed+':'+hi+':'+type;
  if(attackCache.has(key)) return attackCache.get(key);
  const h={...base, bumpers:[...base.bumpers], attack:type};
  if(type===1){ h.friction=0.991; h.ice=true; }
  if(type===2){ h.wind=[(seed+hi)%2 ? 0.02 : -0.02, 0]; }
  if(type===3){ h.cupR=6.5; h.cupSpeed=3.6; }
  if(type===4){
    const r=rng((seed*131+hi*977+5)>>>0), [cx,cy]=h.cup;
    for(let tries=0;tries<30;tries++){
      const a0=Math.floor(r()*8), cand=[a0,(a0+3+Math.floor(r()*3))%8].map(k=>[Math.round(cx+Math.round(COS[k*512]*1e3)/1e3*34), Math.round(cy+Math.round(SIN[k*512]*1e3)/1e3*34), 10]);
      if(!cand.every(([x,y])=>inPoly(x,y,h.outline))) continue;
      const trial={...h, bumpers:[...base.bumpers, ...cand]};
      if(reachable(trial)){ h.bumpers=trial.bumpers; break; }
    }
  }
  attackCache.set(key,h);
  return h;
}


// Looks (drawing only; the physics is the same): 'classic' mini golf (wooden rails on felt) or
// 'natural', a real course (rough edges, a mown fairway, a green round the cup, trees, hedges,
// boulders, bunkers and ponds). Chosen per device (golfTheme() in common.js).
let THEME='classic';
function setGolfTheme(v){ THEME=v==='natural'?'natural':'classic'; }
// Trees in the rough round a hole, placed once per hole: clear of the course and of each other.
const treeCache=new WeakMap();
function treesFor(h){
  if(treeCache.has(h)) return treeCache.get(h);
  const r=rng(((h.tee[0]*31+h.cup[1]*17+h.outline.length*977)|0)>>>0), out=[], S=COURSE;
  const segs=h.outline.map((p,i)=>[...p,...h.outline[(i+1)%h.outline.length]]);
  for(let k=0;k<160 && out.length<22;k++){
    const x=r()*LW, y=r()*LH, rad=(16+r()*18)*S;
    if(inPoly(x,y,h.outline) || segs.some((sg)=>segDist(x,y,sg)<rad+10*S) || out.some(t=>Math.hypot(t.x-x,t.y-y)<t.r+rad)) continue;
    out.push({x,y,r:rad,shade:r()});
  }
  treeCache.set(h,out); return out;
}
function pathPts(c,pts){ c.beginPath(); pts.forEach(([x,y],i)=>c[i?'lineTo':'moveTo'](x,y)); c.closePath(); }
function drawHole(c, h, t, scene={}){
  const nat=THEME==='natural', S=COURSE;
  if(nat){
    // the rough: long olive grass, tufts, and trees standing in it
    c.fillStyle='#4B7A33'; c.fillRect(0,0,LW,LH);
    c.fillStyle='#55883A'; for(let i=0;i<90;i++){ const x=(i*97)%LW, y=(i*151)%LH; c.beginPath(); c.ellipse(x,y,(10+(i%5)*5)*S,(6+(i%3)*3)*S,i,0,7); c.fill(); }
    c.strokeStyle='#3C6628'; c.lineWidth=1.5; for(let i=0;i<140;i++){ const x=(i*61)%LW, y=(i*113)%LH; c.beginPath(); c.moveTo(x,y); c.lineTo(x-2,y-6); c.moveTo(x+3,y); c.lineTo(x+4,y-5); c.stroke(); }
    treesFor(h).forEach(tr=>{ c.fillStyle='#0003'; c.beginPath(); c.ellipse(tr.x+tr.r*.35,tr.y+tr.r*.45,tr.r,tr.r*.8,0,0,7); c.fill(); });
    // the fairway's own soft shadow on the rough
    c.save(); c.shadowColor='#0006'; c.shadowBlur=14; c.shadowOffsetY=5; c.fillStyle='#3F6E2A'; pathPts(c,h.outline); c.fill(); c.restore();
    c.save(); pathPts(c,h.outline); c.clip();
    // fairway, cross-mown in a diamond pattern
    c.fillStyle='#6FBE4F'; c.fillRect(0,0,LW,LH);
    c.save(); c.translate(LW/2,LH/2); c.rotate(Math.PI/4); const D=Math.hypot(LW,LH);
    c.fillStyle='#7ACB59'; for(let x=-D;x<D;x+=64*S) c.fillRect(x,-D,32*S,2*D);
    c.fillStyle='#0000000d'; for(let y=-D;y<D;y+=64*S) c.fillRect(-D,y,2*D,32*S);
    c.restore();
    // the green round the cup: finer, lighter, with a fringe
    const [gx,gy]=h.cup, gr=64*S;
    c.fillStyle='#5DAA43'; c.beginPath(); c.arc(gx,gy,gr+7*S,0,7); c.fill();
    const gg=c.createRadialGradient(gx,gy,4,gx,gy,gr); gg.addColorStop(0,'#9BE07A'); gg.addColorStop(1,'#86D366');
    c.fillStyle=gg; c.beginPath(); c.arc(gx,gy,gr,0,7); c.fill();
  } else {
  // rough
  c.fillStyle='#1F5B3A'; c.fillRect(0,0,LW,LH);
  c.fillStyle='#246843'; for(let i=0;i<60;i++){ const x=(i*97)%LW, y=(i*151)%LH; c.beginPath(); c.arc(x,y,14+(i%5)*4,0,7); c.fill(); }
  // wooden rail shadow, then felt
  c.save(); c.shadowColor='#0009'; c.shadowBlur=18; c.shadowOffsetY=8; c.fillStyle='#7A4E2B'; pathPts(c,h.outline); c.fill(); c.restore();
  c.save(); pathPts(c,h.outline); c.clip();
  c.fillStyle='#46A75A'; c.fillRect(0,0,LW,LH);
  c.fillStyle='#4FB464'; for(let y=0;y<LH;y+=56) c.fillRect(0,y,LW,28);   // mowing stripes
  }
  if(h.ice){ c.fillStyle='#CFF3FF55'; c.fillRect(0,0,LW,LH); c.strokeStyle='#ffffff66'; c.lineWidth=1;
    for(let i=0;i<40;i++){ const x=(i*83)%LW, y=(i*137)%LH; c.beginPath(); c.moveTo(x,y); c.lineTo(x+14,y-6); c.stroke(); } }
  if(h.wind){ c.strokeStyle='#ffffff55'; c.lineWidth=2; c.lineCap='round'; const dir=Math.sign(h.wind[0]);
    for(let i=0;i<14;i++){ const y=(i*41)%LH+10, off=reduceMotion?0:((t/6)*dir+i*57)%(LW+80); const x=dir>0?off-40:LW+40-off;
      c.beginPath(); c.moveTo(x,y); c.lineTo(x+26*dir,y); c.stroke(); } }
  // slopes: drifting chevrons
  h.slopes.forEach(s=>{
    const [x,y,w,hh]=s.r, ang=Math.atan2(s.a[1],s.a[0]); c.save(); c.beginPath(); c.rect(x,y,w,hh); c.clip();
    c.fillStyle='#ffffff10'; c.fillRect(x,y,w,hh);
    c.strokeStyle='#ffffff38'; c.lineWidth=3; c.lineCap='round';
    const off=reduceMotion?0:(t/40)%36;
    for(let gx=x-36;gx<x+w+36;gx+=36) for(let gy=y+18;gy<y+hh;gy+=36){
      c.save(); c.translate(gx+Math.cos(ang)*off, gy+Math.sin(ang)*off); c.rotate(ang);
      c.beginPath(); c.moveTo(-5,-7); c.lineTo(3,0); c.lineTo(-5,7); c.stroke(); c.restore();
    }
    c.restore();
  });
  // sand
  if(nat) h.sand.forEach(([x,y,w,hh])=>{   // a bunker: raked sand under a grassy lip
    const rr=Math.min(w,hh)/2.2;
    c.save(); c.beginPath(); c.roundRect(x,y,w,hh,rr); c.fillStyle='#EFE0B0'; c.fill(); c.clip();
    c.fillStyle='#D8C48E'; c.fillRect(x,y,w,5*S);   // shade under the top lip
    c.strokeStyle='#DCC894'; c.lineWidth=1.2; for(let k=6;k<hh;k+=7) { c.beginPath(); for(let xx=x;xx<=x+w;xx+=8) c.lineTo(xx,y+k+Math.sin(xx/9+k)*1.5); c.stroke(); }
    c.restore(); c.strokeStyle='#4F8A36'; c.lineWidth=3; c.beginPath(); c.roundRect(x,y,w,hh,rr); c.stroke();
  });
  else h.sand.forEach(([x,y,w,hh])=>{
    c.save(); c.beginPath(); c.roundRect(x,y,w,hh,Math.min(22,hh/2)); c.fillStyle='#E8D39A'; c.fill(); c.clip();
    c.fillStyle='#D4BC7E'; for(let i=0;i<w*hh/60;i++){ const px=x+((i*37)%w), py=y+((i*53)%hh); c.fillRect(px,py,1.5,1.5); }
    c.restore(); c.strokeStyle='#C9AE6B'; c.lineWidth=2; c.beginPath(); c.roundRect(x,y,w,hh,Math.min(22,hh/2)); c.stroke();
  });
  // water
  h.water.forEach(([x,y,w,hh])=>{
    const g=c.createLinearGradient(0,y,0,y+hh); g.addColorStop(0,nat?'#3C8FB0':'#3FA7E0'); g.addColorStop(1,nat?'#1E5A78':'#1F6FB0');
    if(nat){ c.strokeStyle='#6B5A3A'; c.lineWidth=5; c.beginPath(); c.roundRect(x,y,w,hh,10); c.stroke(); }   // a muddy bank
    c.fillStyle=g; c.beginPath(); c.roundRect(x,y,w,hh,nat?10:6); c.fill();
    if(nat){ c.strokeStyle='#3F6B2A'; c.lineWidth=1.5; [[x+3,y+hh-2],[x+w-6,y+4]].forEach(([rx,ry])=>{ for(let k=0;k<4;k++){ c.beginPath(); c.moveTo(rx+k*2.5,ry); c.lineTo(rx+k*2.5+(k-1.5),ry-7-(k%2)*3); c.stroke(); } }); }   // reeds
    c.save(); c.beginPath(); c.rect(x,y,w,hh); c.clip(); c.strokeStyle='#BFE9FF66'; c.lineWidth=1.5;
    for(let k=0;k*16+12<hh;k++){ const yy=y+12+k*16, ph=reduceMotion?0:t/500+k; c.beginPath(); for(let xx=x;xx<=x+w;xx+=6) c.lineTo(xx, yy+Math.sin(xx/14+ph)*2.5); c.stroke(); }
    c.restore();
  });
  c.restore();
  // rails
  c.lineJoin='round';
  if(nat){
    // the edge: a band of longer grass (it plays like the rails did)
    c.strokeStyle='#3F6E2A'; c.lineWidth=13; pathPts(c,h.outline); c.stroke();
    c.strokeStyle='#5C9A3F'; c.lineWidth=4; pathPts(c,h.outline); c.stroke();
    // the trees' canopies over everything outside
    treesFor(h).forEach(tr=>{
      const g=c.createRadialGradient(tr.x-tr.r*.3,tr.y-tr.r*.35,2,tr.x,tr.y,tr.r); g.addColorStop(0,tr.shade>.5?'#5E9A42':'#4F8C3A'); g.addColorStop(1,tr.shade>.5?'#2C5A22':'#264F1E');
      c.fillStyle=g; c.beginPath(); c.arc(tr.x,tr.y,tr.r,0,7); c.fill();
      c.fillStyle='#ffffff14'; [[-.35,-.3,.35],[.25,-.1,.3],[-.05,.3,.28]].forEach(([dx,dy,k])=>{ c.beginPath(); c.arc(tr.x+dx*tr.r,tr.y+dy*tr.r,tr.r*k,0,7); c.fill(); });
    });
    // blocks are hedges
    h.blocks.forEach(([x,y,w,hh])=>{
      c.save(); c.shadowColor='#0007'; c.shadowBlur=8; c.shadowOffsetY=4; c.fillStyle='#2E5E24'; c.beginPath(); c.roundRect(x,y,w,hh,6); c.fill(); c.restore();
      c.fillStyle='#3F7A30'; const n=Math.max(2,Math.round(Math.max(w,hh)/9)); for(let k=0;k<n;k++){ const f=(k+.5)/n, bx=w>=hh?x+f*w:x+w/2, by=w>=hh?y+hh/2:y+f*hh; c.beginPath(); c.arc(bx,by,Math.min(w,hh)*.42,0,7); c.fill(); }
    });
  } else {
  c.strokeStyle='#8B5A2B'; c.lineWidth=12; pathPts(c,h.outline); c.stroke();
  c.strokeStyle='#B07A45'; c.lineWidth=4; pathPts(c,h.outline); c.stroke();
  }
  if(!nat) h.blocks.forEach(([x,y,w,hh])=>{
    c.save(); c.shadowColor='#0008'; c.shadowBlur=8; c.shadowOffsetY=4; c.fillStyle='#8B5A2B'; c.beginPath(); c.roundRect(x,y,w,hh,5); c.fill(); c.restore();
    c.fillStyle='#B07A45'; if(w>=hh) c.fillRect(x+3,y+3,w-6,4); else c.fillRect(x+3,y+3,4,hh-6);
  });
  // bumpers
  h.bumpers.forEach(([x,y,r],i)=>{
    const lit=scene.bumpLit && scene.bumpLit[i]>t;
    if(nat){   // a boulder
      c.save(); c.shadowColor=lit?'#FFF3C4':'#0008'; c.shadowBlur=lit?20:8; c.shadowOffsetY=lit?0:4;
      const g=c.createRadialGradient(x-r*.35,y-r*.4,1,x,y,r); g.addColorStop(0,lit?'#E6E2D6':'#B9B6AA'); g.addColorStop(1,'#6F6C62');
      c.fillStyle=g; c.beginPath(); c.arc(x,y,r,0,7); c.fill(); c.restore();
      c.strokeStyle='#5A574F'; c.lineWidth=1; c.beginPath(); c.moveTo(x-r*.3,y+r*.1); c.lineTo(x+r*.05,y+r*.35); c.lineTo(x+r*.4,y+r*.2); c.stroke();
      return;
    }
    c.save(); c.shadowColor=lit?'#FFD27A':'#0008'; c.shadowBlur=lit?24:8; c.shadowOffsetY=lit?0:4;
    c.fillStyle='#E4572E'; c.beginPath(); c.arc(x,y,r,0,7); c.fill(); c.restore();
    c.fillStyle='#fff'; c.beginPath(); c.arc(x,y,r*.62,0,7); c.fill();
    c.fillStyle=lit?'#F2C14E':'#E4572E'; c.beginPath(); c.arc(x,y,r*.32,0,7); c.fill();
  });
  // windmills
  h.spinners.forEach(sp=>{
    const clock=scene.ball&&scene.ball.clock!==undefined?scene.ball.clock:(scene.clock||0);
    bladeSegs(sp,clock).forEach(([x1,y1,x2,y2])=>{
      c.save(); c.shadowColor='#0008'; c.shadowBlur=6; c.shadowOffsetY=3; c.lineCap='round';
      c.strokeStyle=nat?'#7A5230':'#F4F1E4'; c.lineWidth=8; c.beginPath(); c.moveTo(x1,y1); c.lineTo(x2,y2); c.stroke(); c.restore();
      c.strokeStyle=nat?'#A8784A':'#E4572E'; c.lineWidth=3; if(!nat) c.setLineDash([8,8]); c.beginPath(); c.moveTo(x1,y1); c.lineTo(x2,y2); c.stroke(); c.setLineDash([]);
    });
  });
  // gopher holes: a ring of dug-up dirt round a dark hole (and now and then, a gopher)
  (h.gophers||[]).forEach(([gx,gy],i)=>{
    c.fillStyle='#7A5230'; c.beginPath(); c.ellipse(gx,gy+1,GOPH_R+5,GOPH_R+3.5,0,0,7); c.fill();
    c.fillStyle='#A0703F'; for(let k=0;k<6;k++){ const a=k*1.05+i; c.beginPath(); c.arc(gx+Math.cos(a)*(GOPH_R+4),gy+Math.sin(a)*(GOPH_R+3),2,0,7); c.fill(); }
    c.fillStyle='#1B120B'; c.beginPath(); c.arc(gx,gy,GOPH_R,0,7); c.fill();
    if(!reduceMotion && Math.sin(t/900+i*2.3)>0.93){ c.font='13px serif'; c.textAlign='center'; c.textBaseline='middle'; c.fillText('🐹',gx,gy-3); }
  });
  // tee mat
  const [tx,ty]=h.tee;
  if(nat){ c.fillStyle='#8AD86A'; c.fillRect(tx-22,ty-13,44,26); [-14,14].forEach(dx=>{ c.fillStyle='#2A5DB0'; c.beginPath(); c.arc(tx+dx,ty-9,3,0,7); c.fill(); c.fillStyle='#ffffff99'; c.beginPath(); c.arc(tx+dx-1,ty-10,1,0,7); c.fill(); }); }
  else { c.fillStyle='#2E7D46'; c.beginPath(); c.roundRect(tx-16,ty-10,32,20,5); c.fill(); }
  // cup + flag
  const [cx,cy]=h.cup;
  const cupR=h.cupR||CUP_R; c.fillStyle='#0B1A12'; c.beginPath(); c.arc(cx,cy,cupR,0,7); c.fill();
  c.strokeStyle='#ffffff55'; c.lineWidth=1.5; c.beginPath(); c.arc(cx,cy,cupR,Math.PI*1.1,Math.PI*1.9); c.stroke();
  if(!scene.flagOut){
    c.strokeStyle='#EDEDED'; c.lineWidth=2; c.beginPath(); c.moveTo(cx,cy); c.lineTo(cx,cy-42); c.stroke();
    const wave=reduceMotion?0:Math.sin(t/300)*3;
    c.fillStyle=nat?'#F2D13B':'#E4572E'; c.beginPath(); c.moveTo(cx,cy-42); c.quadraticCurveTo(cx+14,cy-40+wave,cx+26,cy-35+wave); c.lineTo(cx,cy-28); c.fill();
  }
  // aim guide
  if(scene.aim){
    const {bx,by,dx,dy,p}=scene.aim, len=30+p*120;
    c.save(); c.setLineDash([2,8]); c.lineCap='round'; c.lineWidth=4;
    c.strokeStyle=`hsl(${50-p*50} 95% 60%)`; c.beginPath(); c.moveTo(bx,by); c.lineTo(bx+dx*len,by+dy*len); c.stroke(); c.restore();
    c.fillStyle=`hsl(${50-p*50} 95% 60%)`; c.save(); c.translate(bx+dx*len,by+dy*len); c.rotate(Math.atan2(dy,dx));
    c.beginPath(); c.moveTo(8,0); c.lineTo(-6,-7); c.lineTo(-6,7); c.fill(); c.restore();
  }
  // trail
  if(scene.trail) scene.trail.forEach((p,i)=>{ c.globalAlpha=i/scene.trail.length*.5; c.fillStyle='#fff'; c.beginPath(); c.arc(p.x,p.y,R*.6,0,7); c.fill(); });
  c.globalAlpha=1;
  (scene.fx||[]).forEach(f=>{ c.globalAlpha=Math.max(0,f.life); c.fillStyle=f.c; c.beginPath(); c.arc(f.x,f.y,f.s,0,7); c.fill(); });
  c.globalAlpha=1;
  // ball
  if(scene.ball && !scene.ball.hidden){
    const {x}=scene.ball, air=scene.ball.air||0, lift=air>0?Math.sin(Math.PI*(1-air/CHIP_AIR))*28:0, y=scene.ball.y-lift, rr=R*(1+lift/50);
    c.fillStyle=lift?'#0004':'#0006'; c.beginPath(); c.ellipse(x+2+lift*.3,scene.ball.y+3,R,R*.8,0,0,7); c.fill();   // in the air, the shadow stays on the grass
    const g=c.createRadialGradient(x-2,y-2,1,x,y,rr); g.addColorStop(0,'#fff'); g.addColorStop(1,'#D9DDE3');
    c.fillStyle=g; c.beginPath(); c.arc(x,y,rr,0,7); c.fill();
  }
}


export { LW, LH, COURSE, setCourse, HOLES, N_HOLES, rng, inPoly, inRect, segDist, buildHole, reachable, holeFor, R, CUP_R, MAX_STROKES, tick, q20, q100, ATTACKS, holeWithAttack, holeWithTwists, twistsFor, CHIP_AIR, drawHole, setGolfTheme, COS, SIN };
