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

新插件使用 schema 9、API 2，通过 permissions 声明通用凭证、Connect 和支付能力。当前校验也接受 schema 8、API 1 的通用插件包，客户端负责执行完整权限和组件校验。


schema 10 插件可声明 `requiredFeatures: ["confirmationDialog", "virtualGrid"]`。条目必须包含与包清单相同的能力集合；校验工具检查两者一致。新客户端按能力判断兼容性，旧客户端在安装时通过 schema 拒绝不支持的包。没有能力声明的历史插件保持兼容。
