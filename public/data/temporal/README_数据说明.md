# 巴尔喀什湖及周边区域 Web 展示数据说明

整理日期：2026-10-10。当前目录：`public/data/temporal/`；非运行时原始及重复数据见项目根目录 `data-archive/temporal/`。

## 展示需求与范围

展示图层：河流、山脉、湖泊、国家边界、州/省界、高程、坡度；Sentinel-1、Sentinel-2、气温、降水按 **2024、2025、2026 年**选择。国家面和州/省面另行保留，供填色、定位及查询使用；河流名称另有辅助标注层。

参考框为 **68°—88°E、40°—50°N**，GeoJSON 坐标顺序为经度、纬度，数值栅格与矢量均使用 WGS84 / EPSG:4326。`metadata/display_extent.geojson` 是展示参考框，**不是精确流域边界**。

基础矢量从原始全球/亚洲数据重新筛选：只要要素与参考框相交，就保留完整要素，不沿矩形边缘切断河流、湖泊或山系。因此它们的实际外包范围可以超出参考框。数值地形栅格覆盖参考框；气象保留完整边缘网格，其实际范围为 67.875°—88.125°E、39.875°—50.125°N。

## 本次修改

- 删除山峰点与原完整密集河网。后续按展示需求，将默认主要河流 `rivers_major.*` 更新为 HydroRIVERS 5 级及以上主要河流；原有名称的概览河流保留为 `rivers_named.*`，用于辅助标注。
- 湖泊、河流、山系按扩大后的参考框重新提取，不使用旧的小范围裁剪结果。
- 国家面与国家陆地边界线保留全球范围。州/省面与界线按 25°—180°E、10°S—85°N 的宽范围筛选，覆盖亚洲及周边，并保留跨界完整要素。该框包含部分欧洲、非洲和大洋洲区域，不是严格亚洲大陆掩膜。
- 高程和坡度重新拼接，补齐扩大后的参考框；坡度计算使用框外一格的缓冲高程，随后去掉缓冲，减少计算边缘影响。
- S1/S2 改为每年独立的全年日期查询；2026 年查询截至 2026-10-05。更新在线拼接服务和网页接入配置。
- 气温现使用同一来源 **ERA5、0.25°×0.25°** 的逐日平均温度文件；降水仍为年度累计量。气温日期范围与原年度温度统计不同，详见下表。

## 文件与内容

|文件|说明|
|---|---|
|归档的 `01_basemap/rivers_major.geojson`|HydroRIVERS 主要河流源数据，4,633 条河段，ORD_STRA ≥5；当前显示用裁切结果另存为 `rivers_major_basin.geojson`。|
|归档的 `01_basemap/rivers_named.geojson`|原 Natural Earth 有名称概览河流；当前名称显示使用 `rivers_named_basin.geojson` 与 `hydro_labels.geojson`。|
|`01_basemap/lakes.geojson`|18 个湖泊面，包括巴尔喀什湖及附近湖泊。|
|`01_basemap/mountain_ranges.geojson`|7 个山系/高地标注范围，筛选 Range/mtn、Plateau、Foothills 类型；包含哈萨克丘陵。它们是制图标注范围，不能视为严格地貌边界。|
|归档的 `02_boundaries/countries.geojson`|258 个全球国家/制图区域面；当前页面只使用国家边界线与名称点。|
|`02_boundaries/country_borders.geojson`|515 个全球国家陆地界线要素；海岸线应从国家面边缘展示，不在陆地国界线中。|
|归档的 `02_boundaries/provinces.geojson`|1,799 个州/省级行政区面；当前页面只使用州界线与名称点。|
|`02_boundaries/province_borders.geojson`|3,860 个州/省级界线要素，亚洲及周边宽范围。|
|以上矢量的同名 Shapefile|整理前的 Shapefile/字段文件已移至项目根目录 `data-archive/temporal/`，`.shp/.shx/.dbf/.prj/.cpg` 须成套使用；UTF-8。|
|`03_terrain/elevation_m.tif`|高程，米；4000×2000 像元，0.005°网格，约 360—557 米；来源为 Mapzen Terrain Tiles z8，不是逐年数据。|
|`03_terrain/slope_deg.tif`|坡度，度；由高程求梯度，经纬方向距离转换为米并按纬度修正。网格会平滑陡坡，适用于区域展示。|
|`04_imagery/services.json`|S1/S2 × 三年，共 6 个在线影像图层，包含查询、TileJSON、XYZ 地址、最新景日期及测试结果。|
|`04_imagery/S1_YYYY_*`|Sentinel-1 RTC：VV，线性 gamma0，灰度 0—0.3。|
|`04_imagery/S2_YYYY_*`|Sentinel-2 L2A：B04/B03/B02 真彩色，0—3000 拉伸，整景云量 <20%。|
|`04_imagery/*sample*.png`、`frontend_examples.js`|人工验证样例和接入示例已移至 `data-archive/temporal/04_imagery/`；不是运行数据。|
|`05_weather/daily_temperature/temperature_daily_YYYY.f32`|ERA5 每日平均 2 米气温，°C；小端序 Float32，按 `[日, 纬度, 经度]` 顺序排列。|
|`05_weather/daily_temperature/temperature_daily_static.json`|每日气温文件清单、日期范围、41×81 网格坐标、大小和 SHA-256。|
|`05_weather/YYYY/precipitation_YYYY.tif`|年度或年内截至日期的累计降水量，mm；包括液态和固态降水的水当量。|
|`05_weather/YYYY/precipitation_YYYY.geojson`|每层 3,321 个完整网格面；可用于年度降水填色与点击查询。|
|已归档的 `05_weather/YYYY/temperature_*`|旧月均/年均温度图层及其栅格、网格和预览文件，保存在项目根目录 `data-archive/temporal/05_weather/YYYY/`。|
|地形、气象同名 `.json`|网格、范围、数值极值、单位、色标、统计日期，以及网页预览图的投影和正确叠加边界。|
|地形、气象同名 `.png`|EPSG:4326 网格的配色参考图。|
|`*_web3857.png`|重投影预览图已移至归档，不参与当前页面显示。|
|`metadata/layers.json`|统一图层清单，含年份、图层地址、统计范围和完整性标识。|
|`metadata/validation.json`|文件、几何、Shapefile 一致性、GeoTIFF 网格及有效值检查。|
|`metadata/imagery_validation.json`|六个影像服务在西部、中部、东部共 18 个样本瓦片的检查结果。|
|`metadata/weather_api_validation.json`|从公开 ERA5 查询接口独立核对三个格点的日统计结果。|
|`metadata/file_manifest.json`|文件路径、字节大小、SHA-256；清单自身不参与校验。|
|上游原始下载包|本工作区未找到原说明所称的 `sources/` 目录；归档保留的是现有派生数据与验证文件，不包含完整上游原始下载包。|

## 每日气温与年度降水完整性

|年份|每日气温范围（UTC）|天数|气温数据完整性|年度降水|
|---|---|---:|---|---|---|
|2024|01-01—12-31|366|完整全年|完整全年|
|2025|01-01—12-31|365|完整全年|完整全年|
|2026|01-01—10-04|277|截至 10-04，所有格点完整|累计截至 09-30，未完成全年|

每日气温变量为 `temperature_2m_mean`，是 UTC 日内小时值的日平均。每景包含 3,321 个格点，网格尺寸 41×81、分辨率 0.25°，经纬度中心分别为 68—88°E、40—50°N；边缘范围为 67.875—88.125°E、39.875—50.125°N。2026 年只发布所有格点都完整的日期，未用预报或时间/空间插值补齐。年度降水仍是年累计值，2026 年截至 09-30，不能与完整年份直接比较。

数据直接读取 Open-Meteo AWS 公开存储的 ERA5 原生 0.25°网格，保留原格点，未进行高程降尺度或空间插值。数值栅格约为 18—28 公里分辨率，不能把图层放大后的显示像素视为更高的科学分辨率。气象预览图的重投影插值只用于显示。

每日温度 `.f32` 与年度 `.npz` 原始分年文件的大小、SHA-256 均已校验；NPZ 及 Leaflet 演示接入文件保存在 `data-archive/temporal/05_weather/daily_temperature_source/`，网页只需下载对应年份的 `.f32`。来源与变量说明见 `temperature_daily_static.json`。

已检索更高分辨率来源：[TerraClimate v1.1](https://www.climatologylab.org/terraclimate.html) 约 4 公里，公开目录当前更新到 2025 年，未提供 2026；[Open-Meteo 的 ERA5-Land](https://open-meteo.com/en/docs/historical-weather-api) 气温为 0.1°，但该分发途径的降水继承 ERA5 0.25°。本次采用两变量、三个年份一致的 ERA5 来源和原生网格。后续如采用 TerraClimate，需要明确更换来源，不能把不同来源的年度差异全部解读为气候变化。

## Web 接入

高程、坡度和年度降水的地图显示通过 GeoServer WMS 远程获取流域裁切版：工作区地址为 `${VUE_APP_GEOSERVER_URL}/geoserver/temporal/wms`，图层分别是 `temporal:elevation_m_basin`、`temporal:slope_deg_basin` 和 `temporal:precipitation_2024_basin_smooth/2025_basin_smooth/2026_basin_smooth`。降水平滑重采样仅用于显示，会改变插值后的像元值；精确分析请使用原始年度降水数据。浏览器网页需要 GeoServer 允许前端来源跨域访问；当前服务已对开发地址返回允许跨域的响应。

气温通过静态 HTTP 读取 `05_weather/daily_temperature/temperature_daily_static.json` 与对应年份的 `.f32`；选中某一年时才下载该年文件并在内存缓存，日期滑动从缓存中取对应 3,321 个值。静态服务器应允许 `.f32` 普通文件访问（推荐 `application/octet-stream`）。年度降水 GeoJSON 仍在本地读取，仅用于快速的指针数值查询；显示栅格图像由 WMS 提供。高程/坡度 TIFF 保留本地，用于指针像元查询；高程 TIFF 也用于 3D 地形高程采样。WMS 未提供经验证的 WCS 数值读取配置，因此这些分析用途暂不切换。

当前保留的地形与降水 TIFF 为单波段 Cloud Optimized GeoTIFF（COG），含 NoData=-9999、压缩和概览。每日气温使用 `.f32` 原生网格，不依赖后端栅格服务。气温单位为 °C，降水单位为 mm，高程为 m，坡度为度。

旧版高程、坡度和气象的 `*_web3857.png` 预览已归档。高程、坡度及年度降水的显示由 GeoServer WMS 渲染；每日气温继续使用本地经纬网格数据配色。经纬度网格 PNG 不能当成已经重投影的 Web Mercator 图片。

每日气温采用 −40—40°C 色标，超出端点时使用端点颜色；降水沿用年度色标，数值与统计日期保留在 GeoJSON/TIFF 中。

S1/S2 读取 `services.json` 中各年份的 `xyz_url` 或 `tilejson_url`。XYZ 地址是 `{z}/{x}/{y}`。S2 的 RGB 波段采用重复参数 `assets=B04&assets=B03&assets=B02`。当前访问无需 API Key；服务与网络可用性取决于提供方。查询与注册响应已保留，可向 `/api/data/v1/mosaic/register` 直接提交保存的 search JSON 重建服务。

卫星图层是**全年日期筛选的多时相动态拼接**，按最新景优先取得第一个有效像素，不是年平均、年中位数或单日整幅影像。完整年份查询范围为 1—12 月，可能混合季节、雪盖、云和接缝；S2 整景云量筛选不能保证每个像素无云。2026 的最新景日期因传感器与区域而异，详见服务配置。六个服务均已通过湖区测试，以及参考范围西、中、东部的样本测试；测试不等于逐像元验证全部覆盖。**本目录提供在线卫星影像配置，未下载全范围 S1/S2 原始整景或年度栅格。**

概览河流名称、湖泊、山系和行政界线采用 Natural Earth 1:1000 万制图数据；文件名中的 10m 是比例尺，不是 10 米空间分辨率。行政界线是静态制图版本，不是 2024—2026 的逐年官方界线；大幅放大时需要更精细数据。

## 来源、署名与追溯

整理说明（2026-10-10）：当前应用直接使用的轻量文件保留在 `public/data/temporal/`。未被页面直接请求的派生副本、冗余格式和验证样例已移至项目根目录 `data-archive/temporal/`，对应清单见项目根目录 `DATA_CATALOG.md`。归档不随 `public/` 部署。归档中的 `metadata/file_manifest.json` 校验归档文件；整理前旧清单另存为 `metadata/file_manifest_pre_20261010.json`。此处 `metadata/file_manifest.json` 只列出当前公开目录实际存在的文件。旧月度/年度温度文件已归档，页面改用每日温度 `.f32`；逐月累计降水也已归档，当前页面显示年度累计降水。

本工作区没有找到原说明所称的 `sources/` 原始下载包目录，因此这次归档的是项目内现有的处理结果与中间/验证文件，不代表已备份所有上游原始下载包。需要从原始来源重新生成数据时，应按下文列出的官方来源重新获取相应源数据。

- [Natural Earth](https://www.naturalearthdata.com/downloads/)：公共领域；当前工作区未找到上游原始 ZIP。国家面中一个无效几何采用 make_valid 修复；空几何记录跳过，详细数量见元数据。
- [Mapzen Terrain Tiles / AWS](https://registry.opendata.aws/terrain-tiles/)：原始 RGB 瓦片按 `h=R×256+G+B/256−32768` 解码。网页保留[底层高程来源署名](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)。
- [Copernicus Sentinel / Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/catalog)：保留 Copernicus Sentinel 和 Microsoft Planetary Computer 来源署名；[服务接口文档](https://planetarycomputer.microsoft.com/api/data/v1/docs)。
- [Copernicus ERA5 / Open-Meteo AWS Open Data](https://github.com/open-meteo/open-data)：CC BY 4.0，保留 Copernicus Climate Change Service / ECMWF、ERA5、Open-Meteo 署名；[历史接口与模型说明](https://open-meteo.com/en/docs/historical-weather-api)。

当前展示目录不保留未使用的全范围中间河网、旧版月度降水或验证瓦片；已存在的可复用文件移至 `data-archive/`，避免被前端误加载。该归档不包含工作区里原本不存在的上游源包。

## 河流补充与密度控制（2026-10-06）

原 Natural Earth 概览河流在流域内过于稀疏，默认主要河流图层已更新为 [HydroRIVERS v1.0](https://www.hydrosheds.org/products/hydrorivers) 亚洲数据的筛选结果。参考框内完整原始河网共 68,627 条河段，按 **Strahler 等级 ORD_STRA ≥5** 保留 4,633 条，减少约 93.25%。这些是河段数量，不是独立命名河流数量。原始全范围数据文件保存在项目归档中；当前展示目录未保留全部密集河网。

该筛选保留较大的河流与主要支流，排除 1—4 级的小支流和源头溪流。Strahler 等级是河网拓扑等级，不是河宽或实时流量；不能据此判断河流全年有水。跨参考框边界的选中河段完整保留，坐标未简化，属性保留 HYRIV_ID、NEXT_DOWN、MAIN_RIV、UPLAND_SKM、DIS_AV_CMS、ORD_STRA 等。元数据见 `metadata/rivers.json`，密度对比见 `metadata/river_density_comparison.png`。

当前时空数据页加载 `01_basemap/rivers_major_basin.geojson` 显示流域内主要河段，并加载 `rivers_named_basin.geojson` 与 `hydro_labels.geojson` 辅助名称标注。原 `rivers_major.geojson`、`rivers_named.geojson` 保留为未按湖泊裁切的源数据，不是当前页面直接使用的显示文件。

HydroRIVERS 本身没有名称字段；名称标注使用稀疏的 Natural Earth 概览河流和人工校订的 `hydro_labels.geojson`，不为所有新河段猜配名称。相关现存 Shapefile/派生源文件在项目根目录的归档中。

网页保留 HydroRIVERS / HydroSHEDS 来源，并按[官方产品许可](https://www.hydrosheds.org/products/hydrorivers)使用。引用：Lehner & Grill (2013), Hydrological Processes 27(15):2171–2186，[doi:10.1002/hyp.9740](https://doi.org/10.1002/hyp.9740)。
