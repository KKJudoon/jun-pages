# JUN Pages

生意中台原版界面的公网入口：<https://kkjudoon.github.io/jun-pages/>

此仓库只保存经过白名单发布的浏览器端文件。完整源码、数据库迁移、m87 同步脚本
和项目文档保存在私有 `KKJudoon/JUN` 仓库；不要在这里直接修改或加入凭据。

这些页面从 m87 的原始 8091 模板生成。所有业务接口都先经过 Supabase Auth、角色权限和
新设备审批校验，再由 Supabase Edge Function 读取云端业务数据；Pages 不会实时回源 m87，
也不包含业务数据或服务端密钥。用户管理和安全审批仅在受保护的管理页面中完成。
Tabler 图标 CSS 和字体文件也随仓库发布，避免依赖外部 CDN。
