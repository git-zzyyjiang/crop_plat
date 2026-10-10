# Agri Parcel 时间轴接入

范围为 2024-01-01 到浏览器当前日期。按天拖动，播放每 850 毫秒前进 1 天。当前静态数据保持原有红框，不显示历史数据待发布提示，不会伪造历史变化。

页面进入或点击 Refresh 时读取 agri-agent 工作区的 WMS GetCapabilities，支持以下两种数据方式。

## 日期快照（推荐）

发布 `agri-agent:bh_agri_parcel_20240101`、`agri-agent:bh_agri_parcel_20250101` 等图层。也支持 YYYY-MM-DD 和 YYYY_MM_DD 后缀。每一期包含当时全部地块，不是增量。前端显示所选日期之前最近一期；最早快照之前隐藏红框并提示无数据。图层须支持 EPSG:4326 和 red-polygon 样式。

## WMS 时间维度

保留 `agri-agent:bh_agri_parcel`，在 GeoServer 配置时间属性并启用 Time 维度，确保 GetCapabilities 发布 time Dimension/Extent。前端发送所选日期 UTC 全天的 TIME 区间。服务端数据应返回当天有效的全部地块（例如起止有效期），不能仅存当天新增记录。无数据日期应返回空图像，不应回落到最新数据。稀疏日期采用最近历史快照时推荐上一种方式。

两种方式同时存在时优先 Time 维度。完成发布后点击 Refresh 或重新进入页面即可识别，不需要再修改前端。红框数量与位置由真实图层内容决定；当前未添加数字统计卡。前端不会修改服务器配置。
