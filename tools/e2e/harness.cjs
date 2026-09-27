// Serves the real web/ folder with config pointed at local PostgREST, and signs a player in.
const path=require('path'), fs=require('fs'), http=require('http');
const WEB=path.resolve(__dirname,'../../web'), jwt=require('./jwt.cjs');
const DIR=process.env.E2E_DIR||'/var/tmp/gr-e2e', API_PORT=+(process.env.E2E_API_PORT||3399);
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
function fwd(route, url){
  const req=route.request(); const u=new URL(url);
  return new Promise(res=>{ const r=http.request({host:'localhost',port:API_PORT,path:u.pathname.replace('/rest/v1','')+u.search,method:req.method(),headers:{...req.headers(),host:'localhost:'+API_PORT}},resp=>{ let b=[]; resp.on('data',d=>b.push(d)); resp.on('end',()=>{ route.fulfill({status:resp.statusCode,headers:{...resp.headers,'access-control-allow-origin':'*'},body:Buffer.concat(b)}).then(res); }); });
    const body=req.postDataBuffer(); if(body) r.write(body); r.end(); });
}
// A tiny stand-in for Supabase Realtime: joins succeed, and broadcasts are relayed between
// every test page joined to the same topic (postgres changes aren't simulated).
const hub=new Set();
function fakeRealtime(ws){
  let arr=null; const me={topics:new Set(), ws};
  hub.add(me);
  const out=(m)=>ws.send(JSON.stringify(arr?[m.join_ref??null,m.ref??null,m.topic,m.event,m.payload]:m));
  ws.onMessage(raw=>{ let m;
    if(typeof raw!=='string'){ const u=Buffer.from(raw); if(u[0]!==3) return; let o=7; const take=(n)=>{ const t=u.subarray(o,o+n).toString(); o+=n; return t; };
      const jr=take(u[1]), rf=take(u[2]), topic=take(u[3]), ev=take(u[4]); take(u[5]); const body=u.subarray(o).toString();
      m={join_ref:jr||null,ref:rf||null,topic,event:'broadcast',payload:{type:'broadcast',event:ev,payload:u[6]===1?JSON.parse(body||'{}'):{}}}; arr=true; }
    else m=JSON.parse(raw); if(Array.isArray(m)){ arr=true; m={join_ref:m[0],ref:m[1],topic:m[2],event:m[3],payload:m[4]}; }
    if(m.event==='phx_join'){ me.topics.add(m.topic); const pc=(m.payload?.config?.postgres_changes||[]).map((c,i)=>({...c,id:i+1}));
      return out({topic:m.topic,event:'phx_reply',payload:{status:'ok',response:{postgres_changes:pc}},ref:m.ref,join_ref:m.join_ref}); }
    if(m.event==='phx_leave'){ me.topics.delete(m.topic); return out({topic:m.topic,event:'phx_reply',payload:{status:'ok',response:{}},ref:m.ref,join_ref:m.join_ref}); }
    if(m.event==='broadcast'){ hub.forEach(o=>{ if(o!==me && o.topics.has(m.topic)) try{ o.out({topic:m.topic,event:'broadcast',payload:m.payload,ref:null,join_ref:null}); }catch{} });
      if(m.ref) out({topic:m.topic,event:'phx_reply',payload:{status:'ok',response:{}},ref:m.ref,join_ref:m.join_ref}); return; }
    if(m.ref) out({topic:m.topic,event:'phx_reply',payload:{status:'ok',response:{}},ref:m.ref,join_ref:m.join_ref});
  });
  me.out=out; ws.onClose(()=>hub.delete(me));
}
module.exports=async function open(browser, userId, username, url, opts={}){
  const ctx=await browser.newContext({viewport:{width:400,height:900}, ignoreHTTPSErrors:true, reducedMotion: opts.fast?'reduce':'no-preference', ...(opts.mobile?{isMobile:true,hasTouch:true}:{})});
  const p=await ctx.newPage(); p.errs=[];
  p.on('pageerror',e=>p.errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error'&&!/fonts|ERR_|Failed to load|realtime|WebSocket/i.test(m.text())) p.errs.push(m.text()); });
  const token=jwt(userId);
  await p.routeWebSocket(/sb\.test\/realtime/, fakeRealtime);
  await p.route('**/*', async route=>{ const u=route.request().url();
    if(u.startsWith('http://sb.test/rest/v1')) return fwd(route,u);
    if(u.startsWith('http://sb.test/functions/')) return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"sent":0}'});
    if(u.startsWith('http://sb.test/auth/v1/user')) return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({id:userId,aud:'authenticated'})});
    if(u.startsWith('http://sb.test')) return route.abort();
    if(u.startsWith('http://app.test/')){ const rel=new URL(u).pathname.slice(1)||'index.html';
      if(rel==='config.js') return route.fulfill({contentType:'text/javascript',body:"export const SUPABASE_URL='http://sb.test'; export const SUPABASE_ANON_KEY='anon'; export const VAPID_PUBLIC_KEY='x'; export const USERNAME_DOMAIN='x.com';"});
      const f=path.join(WEB,rel); if(!fs.existsSync(f)) return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:types[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)}); }
    if(u.includes('supabase-js')) return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(DIR,'supabase.esm.js'))});
    if(u.includes('fonts.g')) return route.abort();
    return route.continue(); });
  await p.addInitScript(([t,uid])=>{ localStorage.setItem('sb-sb-auth-token', JSON.stringify({access_token:t,token_type:'bearer',expires_in:999999,expires_at:4102444800,refresh_token:'r',user:{id:uid,aud:'authenticated',role:'authenticated'}})); }, [token,userId]);
  await p.goto('http://app.test/'+url);
  return p;
};
