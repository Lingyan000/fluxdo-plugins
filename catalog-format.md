# 市场条目格式

每个条目保存为 `entries/<id>.json`，示例占位地址和摘要需替换为实际发布内容。

```json
{
  "id": "org.example.notes",
  "name": "笔记",
  "version": "1.0.0",
  "apiVersion": 2,
  "author": "Example",
  "summary": "查看和整理笔记",
  "description": "支持搜索、分页和笔记详情。",
  "repository": "https://github.com/example/notes",
  "packageUrl": "https://github.com/example/notes/releases/download/v1.0.0/notes.fluxplugin",
  "sha256": "发布附件的64位小写SHA256摘要",
  "icon": "bookmark",
  "categories": ["效率"],
  "screenshots": [],
  "changelog": "首次发布"
}
```

`id` 与包内清单一致，发布后保持稳定。`version` 遵循 SemVer，`apiVersion` 表示所需宿主 SDK。下载地址指向对应作者仓库的固定 Release 附件。`screenshots` 最多八个 HTTPS 图片地址。

仓库按条目生成 schemaVersion 为 1 的 `index.json`。客户端从同一来源检查更新，跨来源的同 ID 插件由用户明确选择。

## 正式版与测试版

同一插件的两个渠道独立维护：正式版为 `entries/<id>.json`，测试版为 `entries/<id>.preview.json`，分别声明 `channel: "stable"` 和 `channel: "preview"`。发布测试版只更新测试条目，保留最近已发布的正式版；不能把正式条目改名后替换成测试版本。条目的渠道必须与对应 GitHub Release 的 `prerelease` 标记一致。

客户端默认展示正式条目，接收测试版本后从两个渠道选择较新的版本；已安装较新测试版时，关闭测试渠道不会自动降级。只有测试版的插件在默认渠道中不展示，不能为了展示而将未确认的测试版改成正式版。

CI 会阻止移除仍在发布的正式条目。需要撤回时，在该条目上设置 `withdrawn: true` 并写明 `reason`；撤回后才允许清理条目。已安装的插件不会因此被远程删除。

新插件使用 schema 9、API 2，通过 permissions 声明通用凭证、Connect 和支付能力。当前校验也接受 schema 8、API 1 的通用插件包，客户端负责执行完整权限和组件校验。


schema 10 插件可声明 `requiredFeatures: ["confirmationDialog", "virtualGrid"]`。条目必须包含与包清单相同的能力集合；校验工具检查两者一致。新客户端按能力判断兼容性，旧客户端在安装时通过 schema 拒绝不支持的包。没有能力声明的历史插件保持兼容。
