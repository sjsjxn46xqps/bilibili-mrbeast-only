# 发布到 GitHub

发布目录：`D:\ds\github-publish\bilibili-mrbeast-only`

这个目录包含完整扩展源码、README、许可证和预览图，**不包含** B 站视频文件、账号 Cookie、API key 或下载的 DSH 插件。

## 方案 A：GitHub CLI（推荐）

```powershell
gh auth login

cd D:\ds\github-publish\bilibili-mrbeast-only

# 如果本机还没有 Git 身份，先执行一次（换成你自己的名字/邮箱）
git config --global user.name "你的名字"
git config --global user.email "you@example.com"

git init
git add .
git commit -m "Initial release: Bilibili MrBeast Only v1.4.1"
git branch -M main

gh repo create bilibili-mrbeast-only --public --source=. --remote=origin --push
```

如果名字被占用：

```powershell
gh repo create my-bilibili-mrbeast-only --public --source=. --remote=origin --push
```

## 方案 B：网页建空仓库后推送

1. 打开 <https://github.com/new>。
2. 仓库名填 `bilibili-mrbeast-only`。
3. 不要勾选自动生成 README、.gitignore 或 license。
4. 创建后：

```powershell
cd D:\ds\github-publish\bilibili-mrbeast-only

git init
git add .
git commit -m "Initial release: Bilibili MrBeast Only v1.4.1"
git branch -M main
git remote add origin https://github.com/<你的用户名>/bilibili-mrbeast-only.git
git push -u origin main
```

## 打 Release

先生成扩展 zip：

```powershell
Compress-Archive -Path .\* -DestinationPath ..\bilibili-mrbeast-only-v1.4.1.zip -Force
```

然后：

```powershell
git tag v1.4.1
git push origin v1.4.1
```

GitHub 页面 → **Releases → Draft a new release**：

- Tag：`v1.4.1`
- Title：`Bilibili MrBeast Only v1.4.1`
- 附件：`bilibili-mrbeast-only-v1.4.1.zip`
- 说明：复制 README 的功能和安装部分

> 注意：`Compress-Archive` 会把当前目录内容打包。确认压缩包里 `manifest.json` 位于根目录，而不是多套一层文件夹。

## 发布前检查

```powershell
git status
Get-ChildItem -Recurse -Force | Where-Object { $_.Name -eq '_metadata' }
Select-String -Path .\* -Recurse -Pattern 'cookie|api[_-]?key|secret|token' -ErrorAction SilentlyContinue
```

如果误提交了敏感信息，先吊销对应凭据，再清理 Git 历史。

## 仓库设置建议

- Description：`把 B 站首页和搜索变成野兽先生 MrBeast 专属内容墙的 Edge/Chromium 扩展。`
- Topics：`bilibili`, `mrbeast`, `edge-extension`, `chrome-extension`, `manifest-v3`
- 开启 Issues
- README 中保留“非官方扩展”声明
- 不要上传 B 站视频、封面大图或账号数据
