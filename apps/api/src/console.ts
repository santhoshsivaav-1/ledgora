/**
 * A small page for trying accounts without the web app (the real screens arrive in Phase 3). It only runs outside
 * production and talks to the same endpoints as everything else: nothing here is a shortcut.
 */
export const consoleHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Ledgora account console</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#111827;--mute:#6b7280;--line:#e5e7eb;--brand:#1d4ed8;--ok:#047857;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#e5e7eb;--mute:#9ca3af;--line:#2a2f3a;--brand:#60a5fa;--ok:#34d399;--bad:#f87171}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:center;justify-content:space-between;background:var(--card)}
header b{font-size:16px}main{max-width:1100px;margin:0 auto;padding:16px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}h2{margin:0 0 8px;font-size:14px}
label{display:block;color:var(--mute);font-size:12px;margin-top:8px}input,select{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit}
button{margin-top:10px;margin-right:6px;padding:7px 12px;border:0;border-radius:6px;background:var(--brand);color:#fff;cursor:pointer}button.alt{background:transparent;color:var(--brand);border:1px solid var(--brand)}
pre{background:var(--bg);padding:8px;border-radius:6px;overflow:auto;max-height:220px;font-size:12px;white-space:pre-wrap;word-break:break-word}
.row{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px dashed var(--line)}.pill{font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--mute)}
.ok{color:var(--ok)}.bad{color:var(--bad)}.mute{color:var(--mute)}.wide{grid-column:1/-1}
</style></head><body>
<header><b>Ledgora account console <span class="pill">development only</span></b><span><span id="who" class="mute">not signed in</span> <button id="logout" onclick="logout()" style="display:none;margin:0 0 0 10px">Log out</button></span></header>
<main>
<section><h2>1. Sign up / sign in (e-mail)</h2>
<label>Name</label><input id="name" value="Asha Sharma"><label>E-mail</label><input id="email" value="asha@example.com"><label>Password</label><input id="pw" type="password" value="correct-horse-9">
<button onclick="signUp()">Sign up</button><button class="alt" onclick="signIn()">Sign in</button><button class="alt" onclick="signOut()">Sign out</button>
<pre id="out1" class="mute">Sign-up sends a verification e-mail: open it in panel 8, click the link, then sign in.</pre></section>

<section><h2>2. Phone OTP</h2>
<label>Phone (international)</label><input id="phone" value="+919876543210">
<button onclick="sendOtp()">Send code</button><label>Code (appears in panel 8)</label><input id="code" placeholder="6 digits"><button class="alt" onclick="verifyOtp()">Verify and sign in</button>
<pre id="out2" class="mute">A new number creates an account on verification.</pre></section>

<section><h2>3. Who am I</h2><button class="alt" onclick="me()">Refresh</button><div id="me" class="mute">sign in first</div></section>

<section><h2>4. Two-factor (TOTP + 10 backup codes)</h2>
<label>Password</label><input id="pw2" type="password" value="correct-horse-9"><button onclick="enable2fa()">Enable</button><button class="alt" onclick="disable2fa()">Disable</button>
<label>6-digit code from your authenticator</label><input id="totp"><button class="alt" onclick="verifyTotp()">Confirm</button><pre id="out4" class="mute"></pre></section>

<section><h2>5. Team</h2><div id="members" class="mute">sign in first</div>
<label>Invite by e-mail or phone</label><input id="invTo" placeholder="name@example.com or +91..."><select id="invRole"></select>
<button onclick="invite()">Send invitation</button><button class="alt" onclick="team()">Refresh</button><pre id="out5" class="mute"></pre></section>

<section><h2>6. Devices</h2><div id="sessions" class="mute">sign in first</div>
<button class="alt" onclick="sessions()">Refresh</button><button onclick="revokeAll()">Log out everywhere else</button></section>

<section><h2>7. Audit trail</h2><div id="audit" class="mute">sign in first</div><button class="alt" onclick="audit()">Refresh</button></section>

<section class="wide"><h2>8. Dev outbox (mail and SMS the API "sent")</h2><button class="alt" onclick="outbox()">Refresh</button><div id="outbox" class="mute"></div></section>
</main>
<script>
const $=id=>document.getElementById(id);
async function api(method,path,body){const r=await fetch(path,{method,credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{status:r.status,body:j}}
const show=(el,r)=>{$(el).className=r.status<300?'ok':'bad';$(el).textContent=r.status+' '+JSON.stringify(r.body,null,1)};
async function signUp(){const r=await api('POST','/v1/auth/sign-up/email',{name:$('name').value,email:$('email').value,password:$('pw').value});show('out1',r);outbox();me()}
async function signIn(){const r=await api('POST','/v1/auth/sign-in/email',{email:$('email').value,password:$('pw').value});show('out1',r);refresh()}
async function signOut(){await logout()}
async function logout(){await api('POST','/v1/auth/sign-out',{});location.href=location.pathname}
async function sendOtp(){show('out2',await api('POST','/v1/auth/phone-number/send-otp',{phoneNumber:$('phone').value}));outbox()}
async function verifyOtp(){show('out2',await api('POST','/v1/auth/phone-number/verify',{phoneNumber:$('phone').value,code:$('code').value}));refresh()}
async function enable2fa(){const r=await api('POST','/v1/auth/two-factor/enable',{password:$('pw2').value});show('out4',r)}
async function verifyTotp(){show('out4',await api('POST','/v1/auth/two-factor/verify-totp',{code:$('totp').value}));me()}
async function disable2fa(){show('out4',await api('POST','/v1/auth/two-factor/disable',{password:$('pw2').value}));me()}
async function me(){const r=await api('GET','/v1/me');if(r.status!==200){$('me').textContent=r.status===401?'not signed in':JSON.stringify(r.body);$('who').textContent='not signed in';$('logout').style.display='none';return}
 const m=r.body;$('logout').style.display='inline-block';$('who').textContent=(m.user.email||m.user.phoneNumber)+' · '+m.organization.name+' · '+m.role;
 $('me').innerHTML='<div class="row"><span>Organization</span><b>'+m.organization.name+'</b></div><div class="row"><span>Role</span><b>'+m.role+'</b></div><div class="row"><span>Plan</span><b>'+(m.subscription?m.subscription.status+' until '+(m.subscription.trialEndsAt||'').slice(0,10):'-')+'</b></div><div class="row"><span>2FA</span><b>'+(m.user.twoFactorEnabled?'on':'off')+'</b></div><div class="row"><span>Businesses</span><b>'+(m.businessIds?m.businessIds.length+' allowed':'all')+'</b></div><div class="row"><span>Can</span><span class="mute" style="max-width:60%;text-align:right">'+m.permissions.join(', ')+'</span></div>'+m.organizations.map(o=>'<div class="row"><span>'+o.name+' <span class="pill">'+o.role+'</span></span><button class="alt" onclick="switchOrg(\\''+o.id+'\\')">Use</button></div>').join('')}
async function switchOrg(id){await api('POST','/v1/me/organization',{organizationId:id});refresh()}
async function team(){const [m,i]=await Promise.all([api('GET','/v1/members'),api('GET','/v1/invitations')]);if(m.status!==200){$('members').textContent=m.status+' '+(m.body.error?m.body.error.message:'');return}
 $('members').innerHTML=m.body.data.map(x=>'<div class="row"><span>'+x.name+' <span class="mute">'+(x.email||x.phoneNumber||'')+'</span></span><span><select onchange="setRole(\\''+x.id+'\\',this.value)">'+roles.map(r=>'<option '+(r===x.role?'selected':'')+'>'+r+'</option>').join('')+'</select><button class="alt" onclick="rm(\\''+x.id+'\\')">Remove</button></span></div>').join('')+(i.body.data||[]).map(x=>'<div class="row"><span>Invited '+(x.email||x.phone)+' <span class="pill">'+x.role+'</span></span><button class="alt" onclick="revoke(\\''+x.id+'\\')">Withdraw</button></div>').join('')}
const roles=['owner','admin','accountant','salesman','biller','stock_keeper','viewer'];$('invRole').innerHTML=roles.filter(r=>r!=='owner').map(r=>'<option>'+r+'</option>').join('');
async function invite(){const v=$('invTo').value.trim();const b={role:$('invRole').value,...(v.startsWith('+')?{phone:v}:{email:v})};show('out5',await api('POST','/v1/invitations',b));team();outbox()}
async function setRole(id,role){show('out5',await api('PATCH','/v1/members/'+id,{role}));team()}
async function rm(id){show('out5',await api('DELETE','/v1/members/'+id));team()}
async function revoke(id){await api('DELETE','/v1/invitations/'+id);team()}
async function sessions(){const r=await api('GET','/v1/sessions');if(r.status!==200){$('sessions').textContent='sign in first';return}$('sessions').innerHTML=r.body.data.map(s=>'<div class="row"><span>'+s.device+(s.current?' <span class="pill ok">this device</span>':'')+'<br><span class="mute">'+s.createdAt.slice(0,16).replace('T',' ')+' · '+(s.ipAddress||'')+'</span></span>'+(s.current?'':'<button class="alt" onclick="killSession(\\''+s.id+'\\')">Log out</button>')+'</div>').join('')}
async function killSession(id){await api('DELETE','/v1/sessions/'+id);sessions()}
async function revokeAll(){show('out5',await api('POST','/v1/sessions/revoke-all',{}));sessions()}
async function audit(){const r=await api('GET','/v1/audit?limit=15');if(r.status!==200){$('audit').textContent=r.status+' '+(r.body.error?r.body.error.message:'');return}$('audit').innerHTML=r.body.data.map(a=>'<div class="row"><span>'+a.action+' <span class="mute">'+a.entityType+'</span></span><span class="mute">'+a.at.slice(11,19)+(a.ip?' · '+a.ip:'')+'</span></div>').join('')||'nothing yet'}
async function outbox(){const r=await api('GET','/v1/dev/outbox');$('outbox').innerHTML=r.body.data.slice(0,8).map(o=>'<div class="row"><span><b>'+(o.kind==='sms'?'SMS':'Mail')+'</b> to '+o.to+(o.subject?' · '+o.subject:'')+'<br><span class="mute">'+(o.text||'').replace(/(https?:\\/\\/\\S+)/g,'<a href="$1" target="_blank">$1</a>').replace(/\\n/g,'<br>')+'</span></span><span class="mute">'+o.at.slice(11,19)+'</span></div>').join('')||'empty'}
function refresh(){me();team();sessions();audit();outbox()}
const inv=new URLSearchParams(location.search).get('invitation');
if(inv){api('POST','/v1/invitations/'+inv+'/accept').then(r=>{alert(r.status<300?'Invitation accepted':'Could not accept: '+JSON.stringify(r.body));refresh()})}
refresh();
</script></body></html>`;
