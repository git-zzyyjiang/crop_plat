# 巴尔喀什湖流域农业时空智能平台

基于 Vue 3、OpenLayers、Cesium 和 Pinia 构建的流域农业时空信息系统，包含：首页、时空数据、农业地块、作物结构和水资源消耗五个模块。

## 环境要求

- Node.js 16 或更高版本
- npm
- 可选：GeoServer 和水资源计算服务

## 本地运行

```bash
npm install
npm run serve
```

默认访问地址为 `http://localhost:8000/`。

## 生产构建

```bash
npm run build
```

构建结果生成在 `dist` 目录中。

## 服务配置

开发和生产环境的服务地址分别位于 `.env.development`、`.env.production`。新环境可参考 `.env.example` 调整以下变量：

```dotenv
VUE_APP_GEOSERVER_URL=http://localhost:8080
VUE_APP_CROP_WATER_API_BASE=http://localhost:5000
```

GeoServer 图层及样式发布说明位于 `geoserver/README.md`。
