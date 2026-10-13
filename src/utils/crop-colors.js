// USDA NASS Cropland Data Layer 作物色。轮作地块采用其第二季作物色。
export const CROP_COLORS_BY_CODE = Object.freeze({
  1: "#A87000", // 冬小麦
  2: "#D9B56C", // 春小麦
  3: "#FF2626", // 棉花
  4: "#FFD400", // 玉米
  5: "#00A9E6", // 水稻
  8: "#FFD400", // 冬小麦—玉米轮作
  9: "#00A9E6", // 冬小麦—水稻轮作
});

export function getCropColor(code, fallback = "#00A9E6") {
  return CROP_COLORS_BY_CODE[Number(code)] || fallback;
}
