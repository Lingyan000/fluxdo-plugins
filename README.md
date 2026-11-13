# FluxDO 元宇宙市场

这个仓库维护 FluxDO 原生插件市场的目录。插件作者在自己的 GitHub 仓库开发，通过 Releases 分发 `.fluxplugin` 文件，并向本仓库提交收录或版本更新。

默认源地址为 `https://raw.githubusercontent.com/Lingyan000/fluxdo-plugins/main/index.json`。在 FluxDO 的「元宇宙 → 市场 → 市场源」中也可以添加采用相同格式的自定义目录。

## 收录流程

1. 在作者仓库发布插件 Release，上传 `.fluxplugin` 附件。
2. 新建 `entries/<插件ID>.json`，填写介绍、分类、截图、仓库、版本、SDK 版本、下载地址与 SHA-256。
3. 使用 Node.js 24 运行 `node tools/catalog.mjs` 生成索引。
4. 提交条目和索引的 Pull Request，校验通过并合并后进入默认市场。
5. 发布新版时修改同一条目中的版本、下载地址、摘要与更新说明。

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

仓库内的 `plugins/quick-notes` 可作为本地数据与原生交互的起点，`plugins/ld-store` 提供商城接入示例。当前包使用 schema 9 和 apiVersion 2，需要支持 API 2 的新版 FluxDO。士多的服务协议由插件处理，公共 Connect、凭证存储和 LDC 收银台由应用提供。

```sh
node tools/package.mjs plugins/quick-notes dist/quick-notes.fluxplugin
```

打包会输出 SHA-256，供市场条目使用。插件界面与清单还需通过 FluxDO 安装器校验。
