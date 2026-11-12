# LD士多

LD士多的 FluxDO 原生插件，支持商品搜索与筛选、商品详情和评论、登录、报价、订单创建、LDC 收银台、订单查询与交付内容。

当前版本为 1.6.6，清单使用 schema 8，脚本 API 版本为 1，需要带有插件市场的新版 FluxDO。

## 安装

在 FluxDO 的「元宇宙 → 市场」搜索 LD士多，阅读权限后安装。也可从本仓库 Release 下载 `.fluxplugin`，在应用的添加服务入口选择文件。

## 权限与数据

商品和订单数据通过清单声明的士多接口读取。授权由当前 Linux DO 账号发起，凭证绑定当前账号。LDC 付款使用应用收银台，提交前由用户确认。

插件使用原生组件库，跟随应用主题。详情页面按界面实例保存状态，返回时保留筛选和分页。日志、占用空间与数据重置入口位于插件管理。

## 开发

`plugin.json` 声明能力，`main.js` 处理页面事件，`ui.rfwtxt` 声明界面。打包命令如下。

```sh
node tools/package.mjs plugins/ld-store dist/ld-store-1.6.6.fluxplugin
```

测试与宿主实现见 [FluxDO](https://github.com/Lingyan000/fluxdo)。
