/* Shared page ownership and account-scoped month memory. */
(function (root) {
  'use strict';
  const areas = [
    {id:'operations',name:'运营',icon:'dashboard'}, {id:'erp',name:'ERP',icon:'clipboard-check'},
    {id:'production',name:'生产',icon:'building-factory-2'}, {id:'finance',name:'财务',icon:'report-money'},
    {id:'customer',name:'客服',icon:'messages'},
    {id:'business',name:'商务',icon:'briefcase'},
    {id:'system',name:'系统管理',icon:'settings'},
  ];
  const pages = [
    {path:'/',name:'运营总览',area:'operations',permission:'operations.overview.read',icon:'dashboard'},
    {path:'/sycm/',name:'生意参谋',area:'operations',permission:'operations.sycm.read',icon:'chart-bar'},
    {path:'/marketing-safety/',name:'营销安全',area:'operations',permission:'operations.marketing.read',icon:'shield-exclamation'},
    {path:'/business/shows/',name:'走秀活动申报',area:'business',permission:'business.show.read',icon:'briefcase'},
    {path:'/customer/wecom-sales/',name:'企业微信销售',area:'customer',permission:'customer.sales.read',icon:'messages'},
    {path:'/erp/',name:'订单审核',area:'erp',permission:'orders.read',icon:'clipboard-check'},
    {path:'/inventory/',name:'库存明细',area:'erp',permission:'inventory.read',icon:'building-warehouse'},
    {path:'/erp/shipments/',name:'发货情况',area:'erp',permission:'orders.read',icon:'truck-delivery',month:true},
    {path:'/production/',name:'生产记工',area:'production',permission:'production.read',icon:'building-factory-2',month:true},
    {path:'/production/manual/',name:'手工审批',area:'production',permission:'production.manual.read',icon:'writing-sign',month:true},
    {path:'/production/pattern/',name:'制版审批',area:'production',permission:'production.pattern.read',icon:'ruler-2',month:true},
    {path:'/finance/',name:'财务月报',area:'finance',permission:'finance.read',admin:true,icon:'report-money',month:true},
    {path:'/finance/sources/',name:'财务数据源',area:'finance',parent:'/finance/',permission:'finance.sources.read',admin:true,icon:'database',month:true},
    {path:'/finance/express-bills/',name:'快递费账单',area:'finance',parent:'/finance/',permission:'finance.sources.read',admin:true,icon:'truck-delivery',month:true},
    {path:'/finance/analysis/operating-expense/',name:'经营分析',area:'finance',parent:'/finance/',permission:'finance.read',admin:true,icon:'chart-bar',month:true},
    {path:'/finance/company-payroll/',name:'公司工资表',area:'finance',permission:'finance.read',admin:true,icon:'table',month:true},
    {path:'/finance/payroll/',name:'工资条',area:'finance',icon:'cash-banknote',month:true},
    {path:'/finance/employees/',name:'员工信息',area:'finance',permission:'finance.employees.manage',admin:true,icon:'users',month:true},
    {path:'/admin/collectors/',name:'采集器状态',area:'system',permission:'users.manage',admin:true,icon:'activity-heartbeat'},
    {path:'/admin/users/',name:'用户与安全',area:'system',permission:'users.manage',icon:'shield-lock'},
  ];
  const validMonth = value => typeof value === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
  const normalizePath = path => (path.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '') + '/';
  const pageFor = path => pages.find(page => page.path === normalizePath(path));
  const visiblePages = context => pages.filter(page => (!page.admin || context.profile?.role === 'admin') && (!page.permission || (context.permissions || []).includes(page.permission)));
  function chooseMonth(requested, saved, fallback, available) {
    const accepts = value => validMonth(value) && (!available || available.includes(value));
    return [requested,saved,fallback].find(accepts) || available?.find(validMonth) || '';
  }
  function createMonthMemory({page, saved={}, available=true, requested, send, clientId, status=()=>{}}) {
    let sequence = 0, latest = saved[page]?.month || '', persisted = latest, failure = false, sending = false;
    function remember(month, explicit=true) {
      if (!validMonth(month) || (!available && !explicit)) return Promise.resolve();
      if (month === latest && sending) return Promise.resolve();
      if (month === persisted && !failure && latest === month) return Promise.resolve();
      latest = month; sending = true; const current = ++sequence;
      return send({page_key:page,month,client_id:clientId,sequence:current}).then(() => {
        if (current === sequence) { sending=false; persisted=month; failure=false; status(null); }
      }).catch(() => { if (current === sequence) { sending=false; failure=true; status('月份未保存到账号，点击重试',()=>remember(latest)); } });
    }
    return {
      choose(fallback, months) { return chooseMonth(typeof requested==='function'?requested():requested,latest,fallback,months); },
      remember,
      get month() { return latest; },
    };
  }
  function renderNavigation(context, base, path) {
    const visible = visiblePages(context), current=pageFor(path), area=areas.find(item=>item.id===current?.area);
    const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const active = page => page.path===current?.path || page.path===current?.parent;
    const link = (page, kind, exact=false) => `<a href="${base}${page.path}" class="${kind}${(exact?page.path===current?.path:active(page))?' active':''}"${page.path===current?.path?' aria-current="page"':''}><span class="nav-link-icon"><i class="ti ti-${page.icon}" aria-hidden="true"></i></span><span class="nav-link-title">${esc(page.name)}</span></a>`;
    const sidebar=document.querySelector('#sidebar-menu .navbar-nav');
    if (sidebar) sidebar.innerHTML=areas.map(group=>{
      const modules=visible.filter(page=>page.area===group.id);
      return modules.length?`<li class="nav-section-label">${group.name}</li>${modules.map(page=>`<li class="nav-item${page.parent?' jun-nav-child':''}">${link(page,'nav-link')}</li>`).join('')}`:'';
    }).join('');
    const bottom=document.querySelector('.bottom-tab-bar .tab-items');
    if (bottom) bottom.innerHTML=areas.filter(group=>group.id!=='system').map(group=>{
      const first=visible.find(page=>page.area===group.id); if(!first)return '';
      return `<a href="${base}${first.path}" class="tab-item${group.id===current?.area?' active':''}"${group.id===current?.area?' aria-current="true"':''}><i class="ti ti-${group.icon}" aria-hidden="true"></i><span>${group.name}</span></a>`;
    }).join('');
    document.querySelector('#jun-module-navigation')?.remove();
    const header=document.querySelector('.page-wrapper .page-header');
    if (header && area) {
      const nav=document.createElement('div'); nav.id='jun-module-navigation';nav.className='container-xl jun-module-navigation';
      const modules=visible.filter(page=>page.area===area.id&&!page.parent);
      const children=visible.filter(page=>page.parent===(current.parent||current.path));
      const reportHome=visible.find(page=>page.path==='/finance/');
      nav.innerHTML=`<nav class="jun-module-tabs" aria-label="${area.name}模块">${modules.map(page=>link(page,'jun-module-link')).join('')}</nav>${children.length?`<nav class="jun-submodule-tabs" aria-label="财务月报子页面">${[reportHome?{...reportHome,name:'月报总览'}:null,...children].filter(Boolean).map(page=>link(page,'jun-module-link',true)).join('')}</nav>`:''}`;
      header.after(nav);
      const pretitle=header.querySelector('.page-pretitle');if(pretitle)pretitle.textContent='生意中台 · '+area.name;
    }
  }
  function init(context, edgeFetch) {
    const base=root.JUN_CONFIG.pagesBasePath||'/jun-pages';
    const relative=location.pathname.slice(base.length)||'/', current=pageFor(relative);
    renderNavigation(context,base,relative);
    const style=document.createElement('link');style.rel='stylesheet';style.href=base+'/workspace.css?v=20260906-1';document.head.append(style);
    const status=(message,retry)=>{
      let el=document.querySelector('#jun-month-memory-status');if(!message){el?.remove();return;}
      if(!el){el=document.createElement('button');el.id='jun-month-memory-status';el.className='jun-month-memory-status';el.type='button';el.setAttribute('role','status');document.body.append(el);}
      el.textContent=message;el.onclick=retry;
    };
    if(!current?.month)return;
    const memory=createMonthMemory({page:current.path,saved:context.page_state||{},available:context.page_state_available!==false,requested:()=>new URLSearchParams(location.search).get('month'),clientId:crypto.randomUUID(),status,
      send:async values=>{const response=await edgeFetch('/api/account/page-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(values),keepalive:true});if(!response.ok)throw new Error('month_save_failed');}
    });
    root.JUN_PAGE_STATE={
      resolveMonth:(fallback,available)=>memory.choose(fallback,available),
      rememberMonth:(month,explicit=true)=>memory.remember(month,explicit),
    };
    if(context.page_state_available===false)status('暂时无法读取上次月份，点击重新载入',()=>location.reload());
    // Only the main page selector is remembered, never dates inside an entry form.
    document.addEventListener('change',event=>{
      if(event.target.matches('#finance-month,#production-month,#manual-month'))memory.remember(event.target.value);
    },true);
  }
  root.JUN_WORKSPACE={areas,pages,pageFor,visiblePages,chooseMonth,createMonthMemory,renderNavigation,init};
  if(typeof module!=='undefined')module.exports=root.JUN_WORKSPACE;
})(typeof window==='undefined'?globalThis:window);
