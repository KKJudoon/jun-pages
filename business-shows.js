(function(root){
'use strict';
const labels={pending:'待审核',approved:'已通过 · 自动记录',rejected:'已退回',withdrawn:'已撤回'};
const money=n=>Number(n??0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function actions(c,data){
 if(c.status!=='pending')return [];
 if(c.owner_id===data.user_id)return ['withdraw'];
 return data.can_approve?(c.payroll_locked?['reject']:['approve','reject']):[];
}
const totals=claims=>({approved:claims.filter(c=>c.status==='approved').reduce((s,c)=>s+Math.round(Number(c.amount)*100),0)/100,pending:claims.filter(c=>c.status==='pending').length});
root.JUN_SHOWS={actions,totals,esc};if(typeof module!=='undefined')module.exports=root.JUN_SHOWS;if(typeof document==='undefined')return;
const errors={show_forbidden:'没有这项操作权限',show_employee:'账号尚未关联员工，请联系管理员',show_month:'请选择有效月份',show_request:'请求无效，请刷新',show_request_conflict:'这次申报已提交，请刷新核对记录',show_amount:'金额须大于 0，最多两位小数且不超过 99999999.99',show_note:'请填写备注，最多 2000 字',show_payroll_locked:'该月份工资已发放，请选择其他月份',show_not_found:'记录不存在，请刷新',show_self_review:'不能审核本人申报',show_version:'记录已更新，请刷新后重试',show_closed:'该申报已处理，请刷新',show_reason:'请填写退回原因，最多 2000 字',show_action:'操作无效',show_request_failed:'服务暂时异常，请稍后重试'};
const $=s=>document.querySelector(s),names={approve:'通过',reject:'退回',withdraw:'撤回'};
const currentMonth=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
let month=new URLSearchParams(location.search).get('month')||currentMonth(),data,sequence=0;
if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))month=currentMonth();
async function api(values){
 const response=await fetch('/api/business/shows'+(values?'':'?month='+encodeURIComponent(month)),values?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)}:{});
 const payload=await response.json();if(!response.ok)throw new Error(errors[payload.error]||'请求失败，请稍后重试');return payload;
}
function message(text){$('#show-message')?.remove();const el=document.createElement('div');el.id='show-message';el.className='alert alert-danger';el.setAttribute('role','alert');el.textContent=text;$('#module-content').before(el);}
function render(){
 const sum=totals(data.claims);
 $('#module-toolbar').innerHTML=`<div class="show-toolbar"><label>归属月份<input id="show-month" type="month" class="form-control" value="${esc(month)}" required></label>${data.can_submit?'<button type="button" class="btn btn-primary" data-new-show>＋ 申报走秀活动</button>':''}<button type="button" class="btn btn-outline-secondary" data-refresh-show>刷新</button></div>`;
 $('#module-content').innerHTML=`<div class="show-summary"><span>已通过金额 <strong>¥${money(sum.approved)}</strong></span><span>待审核 <strong>${sum.pending}</strong> 笔</span></div><p class="text-secondary">审批通过后自动记录到当月“走秀合作”工资项，无需定稿。待审核、退回和撤回不计入申报工资。${data.can_approve?'当月已有手填走秀金额时，改用已通过申报合计，不重复相加。':''}</p><div class="show-records">${data.claims.map(c=>`<article class="card show-record"><div class="card-body"><header><strong>¥${money(c.amount)}</strong><span class="badge ${c.status==='approved'?'bg-green-lt':c.status==='pending'?'bg-yellow-lt':'bg-secondary-lt'}">${labels[c.status]||esc(c.status)}</span></header><p class="show-note">${esc(c.note)}</p><div class="text-secondary">${esc(c.owner_name)} · ${esc(c.month)}<br>申报时间 ${esc(new Date(c.created_at).toLocaleString('zh-CN'))}</div>${c.reason?`<p class="show-note mt-2">处理备注：${esc(c.reason)}</p>`:''}${c.payroll_locked?'<p class="text-secondary mt-2">该月份工资已发放</p>':''}<footer>${actions(c,data).map(a=>`<button type="button" class="btn btn-sm ${a==='approve'?'btn-success':'btn-outline-secondary'}" data-show-action="${a}" data-id="${esc(c.id)}">${names[a]}</button>`).join('')}</footer></div></article>`).join('')||'<div class="card card-body text-secondary">本月暂无走秀活动申报。</div>'}</div>`;
}
async function load(){const seq=++sequence;const result=await api();if(seq!==sequence)return;data=result;render();}
function dialog(title,body){const d=document.createElement('dialog');d.className='show-dialog';d.innerHTML=`<header><strong>${title}</strong><button type="button" class="btn btn-icon" data-close-show aria-label="关闭">×</button></header><form>${body}<p class="text-danger" role="alert"></p><footer><button type="submit" class="btn btn-primary">${title}</button></footer></form>`;document.body.append(d);d.querySelector('[data-close-show]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());d.showModal();return d;}
function submitForm(d,makeValues){
 let inflight=false,done=false;
 d.addEventListener('cancel',e=>{if(inflight)e.preventDefault();});
 d.querySelector('form').onsubmit=async e=>{
 e.preventDefault();if(inflight||done)return;inflight=true;
 const b=e.target.querySelector('[type=submit]'),close=d.querySelector('[data-close-show]');b.disabled=close.disabled=true;
 try{await api(makeValues(new FormData(e.target)));done=true;d.close();try{await load();}catch(err){message('操作已成功，但列表刷新失败，请点击刷新核对。');}}
 catch(err){d.querySelector('[role=alert]').textContent=err.message;}
 finally{inflight=false;b.disabled=close.disabled=done;}
 };
}
function newShow(){
 const selectedMonth=month,requestId=crypto.randomUUID();
 const d=dialog('提交申报',`<p>归属月份：<strong>${esc(selectedMonth)}</strong></p><label>金额（元）<input name="amount" type="number" class="form-control" inputmode="decimal" min="0.01" max="99999999.99" step="0.01" required></label><label>备注<textarea name="note" class="form-control" rows="4" maxlength="2000" placeholder="例如：活动名称、合作内容" required></textarea></label><p class="text-secondary">审批通过后自动计入当月走秀合作工资。</p>`);
 submitForm(d,f=>{const values={month:selectedMonth,amount:String(f.get('amount')),note:String(f.get('note')).trim()};return {action:'submit',values:{...values,id:requestId}};});
}
function review(action,id){const c=data.claims.find(x=>x.id===id);if(!c||!actions(c,data).includes(action))return;
 const d=dialog(names[action]+'申报',`<p>${esc(c.owner_name)} · ${esc(c.month)} · <strong>¥${money(c.amount)}</strong></p><p class="show-note">${esc(c.note)}</p>${action==='approve'?'<p>通过后自动计入当月走秀合作工资。</p>':''}${action==='reject'?'<label>退回原因<textarea name="reason" class="form-control" rows="3" maxlength="2000" required></textarea></label>':''}`);
 submitForm(d,f=>({action,values:{id:c.id,version:c.version,reason:String(f.get('reason')||'').trim()}}));
}
document.addEventListener('change',e=>{if(e.target.id==='show-month'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)){month=e.target.value;const u=new URL(location);u.searchParams.set('month',month);history.replaceState(null,'',u);load().catch(e=>message(e.message));}});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-new-show'))newShow();if(b.hasAttribute('data-refresh-show'))load().catch(e=>message(e.message));if(b.dataset.showAction)review(b.dataset.showAction,b.dataset.id);});
Promise.resolve(window.JUN_AUTH_READY).then(load).catch(e=>message(e.message));
})(typeof window!=='undefined'?window:globalThis);
