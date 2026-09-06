(function(){
  'use strict';
  const labels={ok:'成功',complete:'已导出',scheduled:'未到采集日期',pending:'待采集',running:'采集中',error:'失败',retry:'等待重试',waiting_login:'待登录',offline:'调度器离线',stale:'数据未更新',unknown:'暂无结果'};
  const attention=r=>['error','retry','waiting_login','offline','stale','unknown'].includes(r.status)||r.publication_status==='error'||r.alert_active;
  const pending=r=>['scheduled','pending','waiting_login','retry','running'].includes(r.status);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=v=>{if(!v)return '暂无记录';const d=new Date(v);return isNaN(d)?'暂无记录':d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};
  let data=null,busy=false,failed=false;
  const $=id=>document.getElementById(id);
  function render(){
    if(!data)return;
    const stale=failed||data.stale||Date.now()-Date.parse(data.generated_at)>180000;
    $('connection').className=stale?'warning':'';
    $('connection').textContent=stale?'状态同步已中断或过期，下方为最后收到的记录，请勿视为实时状态。':'Starfish 状态已连接 · 更新于 '+date(data.generated_at)+' · 每30秒刷新';
    const rows=data.collectors||[];
    $('summary').innerHTML=[['采集与检查任务',rows.length],['需要关注',rows.filter(attention).length],['月度待处理',rows.filter(r=>r.month&&pending(r)).length],['已成功 / 已导出',rows.filter(r=>['ok','complete'].includes(r.status)).length]].map(([k,v])=>`<div>${k}<strong>${v}</strong></div>`).join('');
    const filtered=rows.filter(r=>(!$('group').value||r.group===$('group').value)&&(!$('month').value||r.month===$('month').value)&&(!$('status').value||($('status').value==='attention'?attention(r):$('status').value==='pending'?pending(r):['ok','complete'].includes(r.status))));
    $('collectors').innerHTML=filtered.map(r=>{
      const destination=r.destination_url&&/^\/[a-z0-9/-]*$/.test(r.destination_url)?`<a href="/jun-pages${escape(r.destination_url)}${r.month?'?month='+encodeURIComponent(r.month):''}">${escape(r.destination)}</a>`:escape(r.destination);
      return `<article class="collector-card"><header><div><span class="collector-group">${escape(r.group)} · ${escape(r.source)}${r.month?' · '+escape(r.month)+'账期':''}</span><h2>${escape(r.name)}</h2></div><span class="collector-badge ${escape(r.status)}">${escape(labels[r.status]||'未知')}</span></header><dl><dt>数据去向</dt><dd>${destination}</dd><dt>采集计划</dt><dd>${escape(r.schedule)}</dd>${r.planned_at?`<dt>计划日期</dt><dd>${date(r.planned_at)}</dd>`:''}<dt>最近执行</dt><dd>${date(r.last_attempt_at)}</dd><dt>最近成功</dt><dd>${date(r.last_success_at)}</dd><dt>下次执行</dt><dd>${r.next_run_at?date(r.next_run_at):r.status==='complete'?'本期已完成':r.status==='running'?'当前正在执行':'按队列状态继续'}</dd>${r.publication_status?`<dt>中台上传</dt><dd>${escape(labels[r.publication_status]||'暂无结果')} · ${date(r.publication_at)}</dd>`:''}</dl>${r.detail||r.alert_active?`<p class="collector-detail">${escape(r.detail)}${r.alert_active?(r.detail?' · ':'')+'有未恢复的通知事项':''}</p>`:''}</article>`;
    }).join('')||'<div class="collector-empty">没有符合筛选条件的任务。</div>';
  }
  async function refresh(){if(busy)return;busy=true;$('refresh').disabled=true;try{
    const response=await fetch('/api/admin/collectors',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(response.status===403?'仅管理员可查看采集状态':'暂时无法读取采集状态');
    data=await response.json();failed=false;const selected=$('month').value;
    $('month').innerHTML='<option value="">全部月份</option>'+[...new Set(data.collectors.map(r=>r.month).filter(Boolean))].sort().reverse().map(m=>`<option>${escape(m)}</option>`).join('');$('month').value=selected;render();
  }catch(e){failed=true;if(data)render();else{$('connection').className='warning';$('connection').textContent=e.message;}}finally{busy=false;$('refresh').disabled=false;}}
  ['group','month','status'].forEach(id=>$(id).addEventListener('change',render));$('refresh').addEventListener('click',refresh);
  Promise.resolve(window.JUN_AUTH_READY).then(context=>{if(!context)return;refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);}).catch(()=>{});
})();
