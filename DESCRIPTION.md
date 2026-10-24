# GitHub 仓库描述 / Release 文案

## 仓库名

`bilibili-mrbeast-only`

## About 描述（短，直接粘贴）

```text
把哔哩哔哩首页和搜索变成野兽先生 MrBeast 专属内容墙的 Edge/Chromium 扩展：官方全量、搬运分类、二创分级开关。项目由 AI 辅助制作，可能存在瑕疵。
```

英文备选：

```text
An Edge/Chromium extension that turns Bilibili's homepage and search into a MrBeast-only wall: official uploads, repost filters, and optional AI/commentary content.
```

## Topics

```text
bilibili
mrbeast
edge-extension
chrome-extension
manifest-v3
content-filter
video-filter
```

## 一句话简介（README 顶部用）

> 只看野兽先生：B 站首页和搜索的 MrBeast 专属内容墙。

## GitHub CLI 设置

如果仓库已经创建：

```powershell
gh repo edit `
  --description "把哔哩哔哩首页和搜索变成野兽先生 MrBeast 专属内容墙的 Edge/Chromium 扩展：官方全量、搬运分类、二创分级开关。项目由 AI 辅助制作，可能存在瑕疵。" `
  --add-topic bilibili `
  --add-topic mrbeast `
  --add-topic edge-extension `
  --add-topic chrome-extension `
  --add-topic manifest-v3 `
  --add-topic content-filter `
  --add-topic video-filter
```

创建仓库时直接带描述：

```powershell
gh repo create bilibili-mrbeast-only `
  --public `
  --description "把哔哩哔哩首页和搜索变成野兽先生 MrBeast 专属内容墙的 Edge/Chromium 扩展：官方全量、搬运分类、二创分级开关。项目由 AI 辅助制作，可能存在瑕疵。" `
  --source . `
  --remote origin `
  --push
```

## Release 标题

```text
Bilibili MrBeast Only v1.4.1
```

## Release 说明（直接粘贴）

```markdown
## B站只看野兽先生 v1.4.1

把哔哩哔哩首页和搜索变成 MrBeast（野兽先生）专属内容墙的 Edge / Chromium 扩展。

### 功能

- 首页隐藏原有推荐流，只显示野兽先生相关内容
- 官方区通过 B 站空间接口读取全量公开投稿
- 内容漏斗：全部 / 官方 / 搬运 · 翻译 / 搬运 · 未翻译
- “全部包含二创”：AI、解说、模仿、低播放等进入“全部”底部
- “全量关键词”：所有含“野兽先生/MrBeast”且 ≥500 播放的非官方视频排底部
- 搜索栏自动限定为“野兽先生 + 关键词”，搜索页置顶官方账号卡
- 修复首页/搜索页鼠标滚轮滚动
- 1920 / 1440 / 1024 / 768 / 390 宽度适配

### 安装

1. 下载 `bilibili-mrbeast-only-v1.4.1.zip` 并解压
2. 打开 `edge://extensions/`
3. 开启“开发人员模式”
4. “加载解压缩的扩展”，选择解压目录
5. 打开或刷新 https://www.bilibili.com/

> 非官方扩展，与哔哩哔哩、MrBeast 均无隶属关系。
> 本项目由 AI 辅助制作，可能存在瑕疵。
> 扩展不包含任何 B 站视频文件、账号 Cookie 或 API Key。
```

## 社交预览图

使用 `docs/preview-home.png`，在 GitHub 仓库 **Settings → Social preview** 上传。
