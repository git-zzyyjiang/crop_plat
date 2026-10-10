# 巴尔喀什湖及周边区域 Web 展示数据说明

整理日期：2026-10-06。当前目录：`C:\Users\19083\Desktop\10.4\10.6`。

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
- 原 NASA POWER/MERRA-2 的逐月展示文件被替换为同一来源 **ERA5、0.25°×0.25°** 的年度气温、降水文件，不再提供逐月展示图层。相较原来的 0.625°×0.5° 网格，新网格面积约为原来的 1/5。

## 文件与内容

|文件|说明|
|---|---|
|`01_basemap/rivers_major.geojson`|HydroRIVERS 主要河流，4,633 条河段，ORD_STRA ≥5；可展示更多入湖河流和主要支流。完整保留相交河段，来源没有河流名称。|
|`01_basemap/rivers_named.geojson`|原 Natural Earth 16 个有名称的概览河流要素，供辅助名称标注。|
|`01_basemap/lakes.geojson`|18 个湖泊面，包括巴尔喀什湖及附近湖泊。|
|`01_basemap/mountain_ranges.geojson`|7 个山系/高地标注范围，筛选 Range/mtn、Plateau、Foothills 类型；包含哈萨克丘陵。它们是制图标注范围，不能视为严格地貌边界。|
|`02_boundaries/countries.geojson`|258 个全球国家/制图区域面。|
|`02_boundaries/country_borders.geojson`|515 个全球国家陆地界线要素；海岸线应从国家面边缘展示，不在陆地国界线中。|
|`02_boundaries/provinces.geojson`|1,799 个州/省级行政区面，亚洲及周边宽范围。|
|`02_boundaries/province_borders.geojson`|3,860 个州/省级界线要素，亚洲及周边宽范围。|
|以上矢量的同名 Shapefile|`.shp/.shx/.dbf/.prj/.cpg` 必须一起使用；UTF-8。`.fields.json` 记录属性字段对应关系。GeoJSON 和 Shapefile 内容已核对。|
|`03_terrain/elevation_m.tif`|高程，米；4000×2000 像元，0.005°网格，约 360—557 米；来源为 Mapzen Terrain Tiles z8，不是逐年数据。|
|`03_terrain/slope_deg.tif`|坡度，度；由高程求梯度，经纬方向距离转换为米并按纬度修正。网格会平滑陡坡，适用于区域展示。|
|`04_imagery/services.json`|S1/S2 × 三年，共 6 个在线影像图层，包含查询、TileJSON、XYZ 地址、最新景日期及测试结果。|
|`04_imagery/S1_YYYY_*`|Sentinel-1 RTC：VV，线性 gamma0，灰度 0—0.3。|
|`04_imagery/S2_YYYY_*`|Sentinel-2 L2A：B04/B03/B02 真彩色，0—3000 拉伸，整景云量 <20%。|
|`04_imagery/*sample*.png`|在线服务测试瓦片，仅用于验证，不是全范围影像数据。|
|`04_imagery/frontend_examples.js`|Leaflet、MapLibre 的影像和年度气象接入示例。|
|`05_weather/YYYY/temperature_YYYY.tif`|年度或年内截至日期的 2 米气温平均值，°C。|
|`05_weather/YYYY/precipitation_YYYY.tif`|年度或年内截至日期的累计降水量，mm；包括液态和固态降水的水当量。|
|`05_weather/YYYY/*.geojson`|每层 3,321 个完整网格面；属性含 year、value、units、period_start、period_end、days、temporal_complete，可用于填色与点击查询。|
|地形、气象同名 `.json`|网格、范围、数值极值、单位、色标、统计日期，以及网页预览图的投影和正确叠加边界。|
|地形、气象同名 `.png`|EPSG:4326 网格的配色参考图。|
|`*_web3857.png`|重投影后的 EPSG:3857 网页展示图，最长边不超过 2048 像素；使用同名 JSON 中的 `web_preview_bounds_wgs84` 叠加。用于显示，数值查询使用 TIFF/GeoJSON。|
|`metadata/layers.json`|统一图层清单，含年份、图层地址、统计范围和完整性标识。|
|`metadata/validation.json`|文件、几何、Shapefile 一致性、GeoTIFF 网格及有效值检查。|
|`metadata/imagery_validation.json`|六个影像服务在西部、中部、东部共 18 个样本瓦片的检查结果。|
|`metadata/weather_api_validation.json`|从公开 ERA5 查询接口独立核对三个格点的日统计结果。|
|`metadata/file_manifest.json`|文件路径、字节大小、SHA-256；清单自身不参与校验。|
|`sources/`|使用到的 Natural Earth 原始 ZIP、165 张 Terrarium 高程源瓦片、ERA5 区域日值 NPZ 和请求来源记录、气象补值原始响应及卫星最新景的 STAC 记录。它们用于追溯和重建，前端不需要加载。|

## 年度气象统计与完整性

|年份|统计日期（UTC）|天数|气温|降水|完整性|
|---|---|---:|---|---|---|
|2024|01-01—12-31|366|年平均气温|年累计降水|完整全年|
|2025|01-01—12-31|365|年平均气温|年累计降水|完整全年|
|2026|01-01—09-30|273|截至 09-30 的平均气温|截至 09-30 的累计降水|未完成全年|

气温先对每个 UTC 日的 24 个小时取平均，再对所有有效日取平均；降水先累计 UTC 时间戳 00—23 时的小时降水，再累计所有有效日。完整年度与部分年度的统计天数写入每层元数据。**2026 年没有补预测、没有按比例外推成年总量，也没有用气候多年平均代替实际年际数据。** 前端可显示“2026（截至9月30日）”；2026 年累计降水不能直接作为完整全年总量与前两年比较。

数据直接读取 Open-Meteo AWS 公开存储的 ERA5 原生 0.25°网格，保留原格点，未进行高程降尺度或空间插值。数值栅格约为 18—28 公里分辨率，不能把图层放大后的显示像素视为更高的科学分辨率。气象预览图的重投影插值只用于显示。

源存储 `chunk_986.om` 在 2026-09-25 存在缺值；该日通过 **同一 ERA5 模型**的 Open-Meteo 历史接口、最近格点、`elevation=nan`、UTC 日统计补齐全部 3,321 个格点。没有采用邻日或邻格插值。API 气温返回值按 0.1°C 舍入，降水按 0.01 mm 舍入；补值原始响应与方法见 `sources/ERA5_20260925_api_gap_fill.json`、`metadata/weather_gap_fill.json`。

已检索更高分辨率来源：[TerraClimate v1.1](https://www.climatologylab.org/terraclimate.html) 约 4 公里，公开目录当前更新到 2025 年，未提供 2026；[Open-Meteo 的 ERA5-Land](https://open-meteo.com/en/docs/historical-weather-api) 气温为 0.1°，但该分发途径的降水继承 ERA5 0.25°。本次采用两变量、三个年份一致的 ERA5 来源和原生网格。后续如采用 TerraClimate，需要明确更换来源，不能把不同来源的年度差异全部解读为气候变化。

## Web 接入

GeoJSON 可由静态服务器直接提供。气象只按 `year` 切换；不要再查找旧的 `YYYYMM` 文件。

所有 8 个数值 TIFF 均为单波段 Cloud Optimized GeoTIFF（COG），含 NoData=-9999、压缩和概览。可通过 TiTiler/GeoServer 等服务发布动态瓦片；静态服务若支持字节范围请求，也可供支持 COG 的客户端读取。气温单位为 °C，降水单位为 mm，高程为 m，坡度为度。

高程、坡度和气象各有 `*_web3857.png`，适合在 Web Mercator 地图上快速显示。必须读取对应 JSON 的实际预览边界，不要强行使用参考框作为图片边界。原 `.png` 均匀分布在经纬度网格中，不能直接当成已经重投影的 Web Mercator 图片。

三年气象采用同一组色标，便于视觉比较。超出色标端点的数值使用端点颜色显示，真实极值仍完整保留在 TIFF 和 GeoJSON 中；具体色标见每层 JSON。

S1/S2 读取 `services.json` 中各年份的 `xyz_url` 或 `tilejson_url`。XYZ 地址是 `{z}/{x}/{y}`。S2 的 RGB 波段采用重复参数 `assets=B04&assets=B03&assets=B02`。当前访问无需 API Key；服务与网络可用性取决于提供方。查询与注册响应已保留，可向 `/api/data/v1/mosaic/register` 直接提交保存的 search JSON 重建服务。

卫星图层是**全年日期筛选的多时相动态拼接**，按最新景优先取得第一个有效像素，不是年平均、年中位数或单日整幅影像。完整年份查询范围为 1—12 月，可能混合季节、雪盖、云和接缝；S2 整景云量筛选不能保证每个像素无云。2026 的最新景日期因传感器与区域而异，详见服务配置。六个服务均已通过湖区测试，以及参考范围西、中、东部的样本测试；测试不等于逐像元验证全部覆盖。**本目录提供在线卫星影像配置，未下载全范围 S1/S2 原始整景或年度栅格。**

概览河流名称、湖泊、山系和行政界线采用 Natural Earth 1:1000 万制图数据；文件名中的 10m 是比例尺，不是 10 米空间分辨率。行政界线是静态制图版本，不是 2024—2026 的逐年官方界线；大幅放大时需要更精细数据。

## 来源、署名与追溯

- [Natural Earth](https://www.naturalearthdata.com/downloads/)：公共领域；原始 ZIP 保留在 sources。国家面中一个无效几何采用 make_valid 修复；空几何记录跳过，详细数量见元数据。
- [Mapzen Terrain Tiles / AWS](https://registry.opendata.aws/terrain-tiles/)：原始 RGB 瓦片按 `h=R×256+G+B/256−32768` 解码。网页保留[底层高程来源署名](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)。
- [Copernicus Sentinel / Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/catalog)：保留 Copernicus Sentinel 和 Microsoft Planetary Computer 来源署名；[服务接口文档](https://planetarycomputer.microsoft.com/api/data/v1/docs)。
- [Copernicus ERA5 / Open-Meteo AWS Open Data](https://github.com/open-meteo/open-data)：CC BY 4.0，保留 Copernicus Climate Change Service / ECMWF、ERA5、Open-Meteo 署名；[历史接口与模型说明](https://open-meteo.com/en/docs/historical-weather-api)。

旧版全目录已在替换前另行备份。当前展示目录中不保留旧月度气象、旧影像配置、详细河网或山峰点，避免被前端误加载。重建与验证记录均与本版数据同步，不沿用旧版范围和检查结论。

## 河流补充与密度控制（2026-10-06）

原 Natural Earth 概览河流在流域内过于稀疏，默认主要河流图层已更新为 [HydroRIVERS v1.0](https://www.hydrosheds.org/products/hydrorivers) 亚洲数据的筛选结果。参考框内完整原始河网共 68,627 条河段，按 **Strahler 等级 ORD_STRA ≥5** 保留 4,633 条，减少约 93.25%。这些是河段数量，不是独立命名河流数量。数据来自原有备份的官方原始亚洲 ZIP，无需重复下载；当前展示目录没有恢复全部密集河网。

该筛选保留较大的河流与主要支流，排除 1—4 级的小支流和源头溪流。Strahler 等级是河网拓扑等级，不是河宽或实时流量；不能据此判断河流全年有水。跨参考框边界的选中河段完整保留，坐标未简化，属性保留 HYRIV_ID、NEXT_DOWN、MAIN_RIV、UPLAND_SKM、DIS_AV_CMS、ORD_STRA 等。元数据见 `metadata/rivers.json`，密度对比见 `metadata/river_density_comparison.png`。

网页加载 `01_basemap/rivers_major.geojson` 即可展示新增的主要河流；原 `rivers.geojson` 保留用于兼容旧引用，内容仍是16个概览河流。建议 5、6、7、8 级线宽分别约 1.0、1.4、1.8、2.2 像素，并随缩放调整；很小的概览比例尺可进一步筛选 ORD_STRA ≥6，放大后显示全部 5 级及以上。

HydroRIVERS 本身没有名称字段；如需名称标注，另加载 `01_basemap/rivers_named.geojson`。该名称层仍是稀疏概览数据，不为所有新河段提供名称，本次未给河段猜配名称。Shapefile 与 GeoJSON 均已同步更新。

网页保留 HydroRIVERS / HydroSHEDS 来源，并按[官方产品许可](https://www.hydrosheds.org/products/hydrorivers)使用。引用：Lehner & Grill (2013), Hydrological Processes 27(15):2171–2186，[doi:10.1002/hyp.9740](https://doi.org/10.1002/hyp.9740)。
