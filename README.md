# FluxDO 元宇宙市场

这个仓库维护 FluxDO 原生插件市场的目录。插件作者在自己的 GitHub 仓库开发，通过 Releases 分发 `.fluxplugin` 文件，并向本仓库提交收录或版本更新。

默认源地址为 `https://raw.githubusercontent.com/Lingyan000/fluxdo-plugins/main/index.json`。在 FluxDO 的「元宇宙 → 市场 → 市场源」中也可以添加采用相同格式的自定义目录。

## 收录流程

1. 在作者仓库发布插件 Release，上传 `.fluxplugin` 附件。
2. 新建 `entries/<插件ID>.json`，填写介绍、分类、截图、仓库、版本、SDK 版本、下载地址与 SHA-256。
3. 使用 Node.js 24 运行 `node tools/catalog.mjs` 生成索引。
4. 提交条目和索引的 Pull Request，校验通过并合并后进入默认市场。
5. 发布新版时更新对应渠道的版本、下载地址、摘要与更新说明。正式版使用 `entries/<插件ID>.json`，测试版使用 `entries/<插件ID>.preview.json`；更新测试版时保留现有正式版条目。

条目格式见 [市场格式](catalog-format.md)。脚本只校验文件与元数据，插件通过 FluxDO 安装器完成权限和界面协议校验。

## 本地检查

```sh
node --test tools/catalog.test.mjs
node tools/catalog.mjs --check
node tools/catalog.mjs --check --verify-packages
```

最后一个命令下载公开 Release 附件，核对大小、SHA-256、插件 ID、版本和资源结构。索引中的版本代表本市场收录的版本。

## 插件开发

在 FluxDO「元宇宙 → 开发中心」中查看交互示例及当前 SDK 参考。插件包使用 UTF-8 JSON，包含 `manifest` 和 `files`。业务逻辑与界面分别放在 JavaScript 和 rfw 文件中。

应用源码及打包工具位于 [FluxDO 仓库](https://github.com/Lingyan000/fluxdo)。

仓库内的 `plugins/quick-notes` 可作为本地数据与原生交互的起点，`plugins/ld-store` 提供商城接入示例。包内清单声明 schema、apiVersion 和必需的宿主能力，缺少能力时应用会要求升级。士多的服务协议由插件处理，公共 Connect、凭证存储和 LDC 收银台由应用提供。

```sh
node tools/package.mjs plugins/quick-notes dist/quick-notes.fluxplugin
```

打包会输出 SHA-256，供市场条目使用。插件界面与清单还需通过 FluxDO 安装器校验。

## 维护语言资源

士多与动态订阅的业务源文件位于各插件 `src/`，英文译文在 `locales/en.json`。执行 `npm ci --ignore-scripts`、`npm run localize` 后生成四种语言的文案目录及根目录 JS/RFW，打包只包含清单指向的生成文件。请勿直接编辑生成文件。CI 使用 `node tools/localize.mjs --check` 验证源码、语言资源、清单与产物同步。

中文产品文案在构建时标记，插件显示时依照 `host.environment().locale` 选择简体、台湾繁体、香港繁体或英文。服务返回的标题、用户名、正文和用户输入保持原文；语言变化只重绘已有状态，不重复请求业务接口。清单中的市场名称和导航标签仍由作者提供固定名称。

动态订阅按名单和来源分批读取，每页落盘，并与前台共享请求预算。系统任务受操作系统调度限制；最近记录有容量上限，历史通过服务端游标分页，继续阅读时分段显示。旧名单可在应用的迁移入口复制，再粘贴到插件的批量导入页；插件不直接访问应用旧数据。

士多的补货提醒、评论回复和投票、举报记录、文字补充与证据附件均使用原生组件。私密证据通过受控附件 API 上传、预览；插件不会取得本地文件路径，也不会将服务凭证注入网页。举报处理和订单售后分别使用各自服务流程。已有求购洽谈支持原生消息列表、历史分页、发送、已读与关联订单；发布求购和卖家经营仍由网站提供。

## 作者签名与发布

仓库内插件使用 `publisher-key.json` 对应的作者密钥签名。公开公钥用于核对作者，首次安装或从无签名版本升级仍需用户审阅；签名不能代替市场来源和权限审查。后续相同作者、未扩权的版本可按宿主更新策略自动安装。

手动运行「签署并发布插件」工作流，选择 `plugins` 下的目录和发布渠道。工作流校验源码与本地化产物后，从仓库 Secret `PLUGIN_SIGNING_KEY` 读取密钥、签名、生成摘要并创建新 Release。已有版本拒绝覆盖。密钥轮换使用 CLI 的 `--previous-key` 生成连续性证明，不能直接换一把密钥覆盖旧包。

发布后更新 `entries` 中的版本、摘要、能力要求及更新说明，再运行 `node tools/catalog.mjs` 生成索引。目录中的 preview 渠道必须对应 GitHub 的预发布 Release。`public-services.yml` 定时匿名读取士多分类、商品、详情和评论，只记录协议是否仍符合约定；不登录或发送业务写请求。
