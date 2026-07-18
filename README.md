# 香港咖啡地图 · HTML5 / PWA

这是基于 36 家香港咖啡店数据制作的第一版可运行应用。

## 直接预览

在本文件夹启动一个本地 Web 服务器：

```bash
python3 -m http.server 8000
```

然后在浏览器打开：`http://localhost:8000`

也可以直接双击 `index.html` 预览主要功能；但 PWA 安装与离线缓存需要通过 HTTPS 或 localhost 访问。

## 当前功能

- 36 家咖啡店地图大头针
- 店名、地址和地区搜索
- 港岛 / 九龙 / 离岛及具体地区筛选
- 地图 / 列表 / 优先收藏视图
- Google Maps 与 Apple Maps 跳转
- “想去 / 优先去 / 去过”状态
- 手动添加新店铺
- 使用当前地图中心快速填入坐标
- 浏览器本地保存
- JSON 备份导入导出
- CSV 导出
- PWA 主屏幕安装

## 发布

将整个文件夹上传至 GitHub Pages、Netlify、Cloudflare Pages 或任意静态网站空间即可。无需 Mapbox Token。

## 数据说明

第一版新增店铺保存在浏览器 localStorage。换设备不会自动同步；后续可接 Google Sheets、Supabase 或 Firebase。
