// Globe.material 在现有地形绘制中叠加纹理；只更新 uniforms，不重建影像或地形瓦片。
// https://cesium.com/learn/cesiumjs/ref-doc/Globe.html#material
export function createParcelTerrainMaterial(C, emptyImage) {
  const material = new C.Material({
    fabric: {
      // 旧类型可能在开发热更新前缓存了 Canvas；更换类型同时隔离旧页面缓存。
      type: 'ParcelTerrainAnimationV2',
      uniforms: {
        // Fabric 会缓存/深拷贝默认值；DOM Canvas 只能在构造后设置，避免再次进入 3D 时克隆失败。
        parcelImage: C.Material.DefaultImageId,
        parcelBounds: new C.Cartesian4(0,0,1,1),
        roiBounds: new C.Cartesian4(0,0,1,1),
        previewBounds: new C.Cartesian4(0,0,1,1),
        parcelEnabled: 0, roiEnabled: 0, previewEnabled: 0
      },
      source: `
        vec2 parcelGeographic(czm_materialInput materialInput) {
          vec3 p = (czm_inverseView * vec4(-materialInput.positionToEyeEC, 1.0)).xyz;
          // Bowring：从实际地形位置求大地纬度，包含夸张高程，避免球面纬度偏移。
          float r = length(p.xy);
          float theta = atan(p.z * 6378137.0, r * 6356752.314245);
          float s = sin(theta), c = cos(theta);
          float latitude = atan(p.z + 42841.311513 * s*s*s, r - 42697.672707 * c*c*c);
          return vec2(atan(p.y, p.x), latitude);
        }
        vec2 parcelUv(vec2 geographic, vec4 bounds) {
          return (geographic - bounds.xy) / (bounds.zw - bounds.xy);
        }
        float parcelInside(vec2 uv) {
          return step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
        }
        float parcelBorder(vec2 uv) {
          vec2 edge = min(uv, 1.0-uv);
          vec2 width = max(fwidth(uv)*2.0, vec2(0.000001));
          return parcelInside(uv) * (1.0-step(width.x,edge.x)*step(width.y,edge.y));
        }
        czm_material czm_getMaterial(czm_materialInput materialInput) {
          czm_material material = czm_getDefaultMaterial(materialInput);
          vec2 geographic = parcelGeographic(materialInput);
          vec2 uv = parcelUv(geographic,parcelBounds);
          vec4 color = texture(parcelImage,clamp(uv,0.0,1.0));
          color.a *= parcelEnabled * parcelInside(uv);
          float border = roiEnabled * parcelBorder(parcelUv(geographic,roiBounds));
          vec2 previewUv = parcelUv(geographic,previewBounds);
          float previewAlpha = previewEnabled * max(parcelBorder(previewUv),parcelInside(previewUv)*0.06);
          float topAlpha = max(border,previewAlpha);
          float alpha = topAlpha + color.a*(1.0-topAlpha);
          material.diffuse = (vec3(1.0,0.0,0.0)*topAlpha + color.rgb*color.a*(1.0-topAlpha))/max(alpha,0.000001);
          material.alpha = alpha;
          return material;
        }
      `
    },
    translucent: true
  })
  material.uniforms.parcelImage = emptyImage
  return material
}

export function materialBounds(C, extent) {
  return new C.Cartesian4(...extent.map(value => C.Math.toRadians(value)))
}
