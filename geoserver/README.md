# 把 cut 数据发布到 GeoServer

目标：把 `cut/24|25|26` 三份 Shapefile 发布成三个图层，供前端按年份切换。

| 年份 | Shapefile | 发布后的图层名 |
| --- | --- | --- |
| 2024 | `cut/24/2024_nzw_merged.shp` | `agri-agent:bh_crop_class_2024` |
| 2025 | `cut/25/2025_nzw_merged.shp` | `agri-agent:bh_crop_class_2025` |
| 2026 | `cut/26/2026_nzw_merged.shp` | `agri-agent:bh_crop_class_2026` |

样式名固定为 `agri-agent:crop-style-10`，文件是同目录的 `crop-style-10.sld`。
前端图例的颜色必须和它一致，改颜色要两边一起改（前端在 `src/utils/crop-types.js`）。

字段：`Max_value` = 作物编码（1–10），`FID_1` = 地块编号。

## 方式一：一键脚本（推荐）

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\geoserver\publish-cut.ps1 -Password "你的GeoServer管理员密码"
```

脚本会：打包每年的 5 个文件 → 上传成数据存储 `cut_2024/2025/2026` → 发布图层 → 上传样式 → 把样式设为三个图层的默认样式。可以重复执行。

如果 cut 文件夹不在桌面，加 `-CutRoot "D:\你的路径"`。

## 方式二：GeoServer 管理界面

1. 打开 <http://10.98.59.222:8080/geoserver/web/>，用管理员账号登录。
2. 左边「数据 → 工作区」，确认有 `agri-agent`；没有就新建一个，命名空间填 `agri-agent`。
3. 「数据 → 存储 → 添加新的存储」，选 **Shapefile - ESRI(tm) Shapefiles (\*.shp)**：
   - 工作区：`agri-agent`
   - 数据源名称：`cut_2024`
   - 连接参数里的「文件位置」有两种填法：
     - 文件已经拷到服务器上：填服务器上的完整路径，例如 `file:data/cut/24/2024_nzw_merged.shp`
     - 文件还在本机：用「浏览」上传一个 zip（把同名的 `.shp/.shx/.dbf/.prj/.cpg` 五个文件一起压缩）
   - 字符集：`UTF-8`
   - 保存。
4. 保存后会自动进入发布页：
   - 名称：`bh_crop_class_2024`（其余保持默认）
   - 坐标参考系：声明 SRS 选 `EPSG:4326`，点「计算」让它从数据里读边界框
   - 保存
5. 对 `25`、`26` 重复第 3、4 步，数据源名 `cut_2025` / `cut_2026`，图层名 `bh_crop_class_2025` / `bh_crop_class_2026`。
6. 「数据 → 样式 → 添加新的样式」：
   - 工作区：`agri-agent`
   - 名称：`crop-style-10`
   - 格式：`SLD`
   - 把 `crop-style-10.sld` 的内容粘进编辑器（或点「浏览」上传这个文件）
   - 点「验证」确认没有报错，再保存。
7. 回到三个图层，逐个设置默认样式：
   「图层 → bh_crop_class_2024 → 发布 → WMS Settings → Default Style」选 `agri-agent:crop-style-10`，保存。另外两个同样处理。

## 验证

图层清单里能看到三个新图层：

```
http://10.98.59.222:8080/geoserver/agri-agent/wms?service=WMS&version=1.1.1&request=GetCapabilities
```

渲染一张图（把 `bbox` 换成流域范围即可看到彩色地块）：

```
http://10.98.59.222:8080/geoserver/agri-agent/wms?service=WMS&version=1.1.1&request=GetMap&layers=agri-agent:bh_crop_class_2024&styles=agri-agent:crop-style-10&bbox=72.8,43.3,81.8,47.7&width=768&height=512&srs=EPSG:4326&format=image/png
```

点选识别的属性（应返回 `Max_value` 和 `FID_1`）：

```
http://10.98.59.222:8080/geoserver/agri-agent/wms?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=agri-agent:bh_crop_class_2024&query_layers=agri-agent:bh_crop_class_2024&bbox=72.8,43.3,81.8,47.7&width=768&height=512&srs=EPSG:4326&info_format=application/json&x=380&y=250
```

如果浏览器打开上面这些链接报跨域错误，说明服务器没开 CORS；现在旧图层能用，通常说明已经配好了，不用额外处理。

## 换了数据之后要做什么

换新一批地块数据时，除了重新发布图层，还要重新生成前端用的统计文件：

```powershell
node scripts\cut-stats.cjs "C:\Users\27814\Desktop\cut"
```

脚本读三年的 `.shp` / `.dbf`，算出每年每类的地块数与面积、逐年主导作物、跨年稳定性，
写到 `public/static/cutCropStats.json`。「作物统计信息」面板读的就是这个文件，
不重新生成的话面板上的数字还是上一版的。

注意：脚本按**行号**把三年当成同一条地块做跨年比较（当前这套数据的三个 `.shp`
SHA256 完全一致，只有属性不同）。如果新数据三年边界不一致，先确认这一点，
否则时间序列和种植稳定性会算错。

另外，「作物时间序列」的轮作类型和「种植分析」的稳定性 / 多样性用的是分析方给的
另一份数据（`1009/parcel_temporal_analysis`），换了它就要重跑：

```powershell
node scripts\temporal-analysis.cjs "C:\Users\27814\Desktop\1009"
```

生成 `public/static/parcelTemporalStats.json`：轮作序列的种类与占比、相对基准年
2024 改变 0 / 1 / 2 次的地块数、三年出现过的作物种类分布。种植稳定性的口径就是
这份数据里的 `CHG_BASE`（相对基准年改变的年数），不是相邻两年的变化次数，
两种算法结果不一样，改代码时别混用。

同一份数据还要发布成地图图层（作物时间序列 / 种植分析两个页签的地图数据）：

```powershell
powershell -ExecutionPolicy Bypass -File .\geoserver\publish-rotation.ps1
```

发布 `agri-agent:bh_crop_rotation`，并挂两套样式：

| 样式 | 用在哪 | 依据字段 |
| --- | --- | --- |
| `crop-rotation-10` | 作物时间序列 | `SEQUENCE`，只画地块数前十种，其余透明 |
| `crop-stability-3` | 种植分析 | `CHG_BASE`，分 0 / 1 / 2 三级 |

前端不依赖图层的默认样式，而是在 WMS 请求里按页签指定 `STYLES`，点图例时再加
`CQL_FILTER` 只看某一类。

「种植多样性」用的是 10km 网格那份数据（`网格/grid_2024_10km_crop_diversity`）：

```powershell
node scripts\grid-diversity.cjs "C:\Users\27814\Desktop\网格"
```

生成 `public/static/gridDiversityStats.json`：每格的作物种类数、Shannon / Simpson、
地块密度、优势作物占比，外加每个格网反算成经纬度的包围盒。这份数据是 Albers
等积投影（Balkhash_Albers_WGS84，单位米），前端用经纬度，所以脚本里做了投影反算，
框选时按包围盒挑出落在选区里的格网再求平均。
