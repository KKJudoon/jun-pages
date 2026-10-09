(function(){
  'use strict';
  const labels={ok:'成功',complete:'全链路完成',import_pending:'待导入中台',scheduled:'未到采集日期',pending:'待采集',running:'采集中',error:'失败',retry:'等待重试',waiting_login:'待登录 / 验证',deferred:'等待浏览器',offline:'调度器离线',stale:'数据未更新',unknown:'暂无结果',missed:'未按期完成',timeout:'执行超时',manual_only:'仅人工导入',control:'运行规则'};
  const successLabels={collection:'最后成功采集',check:'最后检查通过',publication:'最后成功发布',ingestion:'最后成功入账',control:'运行控制'};
  const channelLabels={manual_import:'手动导入',automatic_collection:'自动采集',agentmail:'邮件导入',sf_portal_download:'顺丰平台导入',existing:'已有中台数据'};
  const attention=r=>['error','retry','waiting_login','offline','stale','unknown','import_pending','missed','timeout'].includes(r.status)||['error','stale','unknown'].includes(r.publication_status)||r.alert_active;
  const pending=r=>['scheduled','pending','waiting_login','retry','running'].includes(r.status);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=(v,pastOnly=false)=>{if(!v)return '暂无可核验时间';const d=new Date(v);return isNaN(d)?'时间无效，待核验':pastOnly&&d.getTime()>Date.now()+60000?'时间异常，待核验':d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});};
  let data=null,busy=false,failed=false;
  const $=id=>document.getElementById(id);
  function render(){
    if(!data)return;
    const age=Date.now()-Date.parse(data.generated_at);
    const stale=failed||data.stale||!Number.isFinite(age)||age>180000||age< -60000;
    const publicationIssue=r=>['ok','complete'].includes(r.status)&&['error','stale','unknown'].includes(r.publication_status);
    const badge=r=>`<span class="collector-badge ${escape(stale&&!['manual_only','control'].includes(r.status)?'unknown':publicationIssue(r)?r.publication_status:r.status)}">${escape(stale&&!['manual_only','control'].includes(r.status)?'状态过期':publicationIssue(r)?r.publication_status==='error'?'上传失败':r.publication_status==='stale'?'上传未更新':'上传未核验':labels[r.status]||'未知')}</span>`;
    $('connection').className=stale?'warning':'';
    $('connection').textContent=stale?'状态同步已中断或过期，下方为最后收到的记录，请勿视为实时状态。':'Starfish 状态已连接 · 更新于 '+date(data.generated_at)+' · 每30秒刷新';
    const rows=data.collectors||[];
    const notices=data.notifications||{},policy=notices.policy||{};
    const technical=Number(policy.technical_failure_confirmation_seconds);
    $('notification-policy').textContent=policy.exceptions==='email'&&policy.feishu_enabled===false?
      '日常正常结果留本页'+(policy.monthly_completion==='email_once_per_month'?' · 月度核验完成后每月一封邮件':'')+(technical>0?' · 技术采集 / 发布故障持续'+Math.ceil(technical/60)+'分钟后邮件告警':'')+' · 登录 / 验证及时邮件提醒并附远控链接'+(policy.collector_recovery==='email_after_verified_success'?' · 核验恢复后邮件通知一次':'')+' · 同一故障去重，飞书已关闭'+(notices.pending_notifications?' · '+notices.pending_notifications+'项异常邮件待发送':''):
      '尚未同步到新的提醒规则；请以最新状态为准。';
    const rules=data.retry_rules||{};
    $('collection-rules').textContent='出现验证码立即暂停全部千牛采集；暂停期间每60秒只读检查，通过后自动恢复。远控5分钟无人工操作断开。'+(rules.qianniu_seconds?' 千牛定时任务技术失败'+Math.ceil(rules.qianniu_seconds/60)+'分钟后重试。':'')+(rules.monthly_seconds?' 月度账房、推广失败'+Math.ceil(rules.monthly_seconds/60)+'分钟后重试，已完成来源不重复采。':'')+' 顺丰邮箱每月只查一次，企微仅保留人工导入。';
    $('schedule-catalog').innerHTML=(data.schedule_catalog||[]).map(r=>`<tr><th scope="row">${escape(r.name)}</th><td>${escape(r.schedule)}</td><td>${r.status==='control'||r.status==='manual_only'?'<span class="collector-muted">不自动采集</span>':`<span class="collector-time-label">${escape(successLabels[r.last_success_kind]||'最近成功记录')}${r.success_month?' · '+escape(r.success_month)+'账期':''}</span><time>${date(r.last_success_at,true)}</time>`}</td><td>${badge(r)}</td></tr>`).join('')||'<tr><td colspan="4">完整时表尚未同步，请勿据此判断采集频率。</td></tr>';
    $('active-issues').innerHTML=(notices.active_issues||[]).map(r=>`<article class="collector-issue"><strong>${escape(r.name)} · ${escape(r.problem)}</strong><p>${escape(r.detail)}</p><small>首次发现：${date(r.started_at)}</small></article>`).join('')||'<p class="collector-muted">'+(stale?'状态已过期，暂不能确认是否有异常。':!notices.active_issues?'异常记录尚未同步。':'当前没有已确认的活动故障。')+'</p>';
    const delivery={email:'异常邮件已发送',email_pending:'异常邮件待发送',dashboard:'仅页面记录',feishu:'历史飞书记录（已停用）'};
    $('notification-events').innerHTML=(notices.recent_events||[]).map(r=>`<article class="collector-event"><header><strong>${escape(r.title)}</strong><small>${date(r.created_at)} · ${escape(delivery[r.channel]||'页面记录')}</small></header><p>${escape(r.detail)}</p></article>`).join('')||'<p class="collector-muted">暂无运行记录。</p>';
    $('summary').innerHTML=[['采集与检查任务',rows.length],['需要关注',stale?rows.length:rows.filter(attention).length],['月度待处理',rows.filter(r=>r.month&&pending(r)).length],['已核验成功 / 完成',stale?'待核验':rows.filter(r=>['ok','complete'].includes(r.status)&&!publicationIssue(r)).length]].map(([k,v])=>`<div>${k}<strong>${v}</strong></div>`).join('');
    const filtered=rows.filter(r=>(!$('group').value||r.group===$('group').value)&&(!$('month').value||r.month===$('month').value)&&(!$('status').value||($('status').value==='attention'?attention(r):$('status').value==='pending'?pending(r):['ok','complete'].includes(r.status))));
    $('collectors').innerHTML=filtered.map(r=>{
      const destination=r.destination_url&&/^\/[a-z0-9/-]*$/.test(r.destination_url)?`<a href="/jun-pages${escape(r.destination_url)}${r.month?'?month='+encodeURIComponent(r.month):''}">${escape(r.destination)}</a>`:escape(r.destination);
      const parts=r.id==='qianniu-orders'?`<dt>已完成订单轮次</dt><dd>${date(r.finished_success_at,true)}</dd><dt>订单详情补采</dt><dd>${date(r.detail_success_at,true)}</dd>`:r.id==='qianniu-refunds'?`<dt>售后详情补采</dt><dd>${date(r.detail_success_at,true)}</dd>`:'';
      return `<article class="collector-card"><header><div><span class="collector-group">${escape(r.group)} · ${escape(r.source)}${r.month?' · '+escape(r.month)+'账期':''}</span><h2>${escape(r.name)}</h2></div>${badge(r)}</header><dl><dt>数据去向</dt><dd>${destination}</dd><dt>采集计划</dt><dd>${escape(r.schedule)}</dd>${r.planned_at?`<dt>计划日期</dt><dd>${date(r.planned_at)}</dd>`:''}<dt>最近执行记录</dt><dd>${date(r.last_attempt_at,true)}</dd><dt>${escape(successLabels[r.last_success_kind]||'最近成功记录')}</dt><dd>${date(r.last_success_at,true)}</dd>${parts}${r.month?`<dt>原件采集</dt><dd>${escape(r.collection_status==='complete'?'已完成':labels[r.collection_status]||'待采集')} · ${date(r.collection_success_at,true)}</dd><dt>中台入账</dt><dd>${escape(r.import_status==='complete'?'已回读'+(r.ingest_channel?' · '+(channelLabels[r.ingest_channel]||r.ingest_channel):''):'待完成')}</dd>`:''}<dt>下次计划</dt><dd>${r.next_run_at?date(r.next_run_at):r.status==='complete'?'本期已完成':r.status==='running'?'当前正在执行':'按队列状态继续'}</dd>${r.publication_status?`<dt>最后成功上传</dt><dd>${escape(labels[r.publication_status]||'暂无结果')} · ${date(r.publication_at,true)}</dd>`:''}</dl>${r.detail||r.alert_active?`<p class="collector-detail">${escape(r.detail)}${r.alert_active?(r.detail?' · ':'')+'有未恢复的通知事项':''}</p>`:''}</article>`;
    }).join('')||'<div class="collector-empty">没有符合筛选条件的任务。</div>';
  }
  async function refresh(){if(busy)return;busy=true;$('refresh').disabled=true;try{
    const response=await fetch('/api/admin/collectors',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(response.status===403?'仅管理员可查看采集状态':'暂时无法读取采集状态');
    data=await response.json();failed=false;const selected=$('month').value;
    $('month').innerHTML='<option value="">全部月份</option>'+[...new Set(data.collectors.map(r=>r.month).filter(Boolean))].sort().reverse().map(m=>`<option>${escape(m)}</option>`).join('');$('month').value=selected;render();
  }catch(e){failed=true;if(data)render();else{$('connection').className='warning';$('connection').textContent=e.message;}}finally{busy=false;$('refresh').disabled=false;}}
  ['group','month','status'].forEach(id=>$(id).addEventListener('change',render));$('refresh').addEventListener('click',refresh);
  Promise.resolve(window.JUN_AUTH_READY).then(context=>{if(!context)return;refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);}).catch(()=>{});
})();
