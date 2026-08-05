window.JUN_CONFIG = {
  supabaseUrl: 'https://bksugnavdfplkedzmxbw.supabase.co',
  supabasePublishableKey: 'sb_publishable_2Hgccd_4At_BA1LvHX9LMQ_M8Tsv6vO',
  pagesBasePath: '/jun-pages',
  edgeFunctionName: 'zhongtai-api',
  edgeFunctionBaseUrl: window.location.hostname === 'zhongtai.jundesign.studio'
    ? `${window.location.origin}/_supabase/functions/v1/zhongtai-api`
    : 'https://bksugnavdfplkedzmxbw.supabase.co/functions/v1/zhongtai-api'
};
