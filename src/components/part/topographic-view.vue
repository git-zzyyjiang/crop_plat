<template>
  <div id="landType">
    <div class="landUse_p1">
      <span class="span">TOPOGRAPHIC MAP / 地形图</span>
      <span class="span" style="color: rgb(75, 112, 125)">CLICK TO TOGGLE VISIBILITY</span>
    </div>
    <div class="landUse_p2" id="landUse_p2">
      
      <!-- <div id="legend-container" class="legend-container" ref="topoContent">
        <div
          class="legend-item clicked"
          v-for="item in topoInfo"
          v-bind:key="item.index"
          @click="clickItem(item.index)"
        >
        
          
          <div class="topo-icon-wrapper">
            <div class="topo-icon" :data-type="item.description">
              {{ getIconEmoji(item.description) }}
            </div>
          </div>
          <span style="font-size: 20px; padding: 8px">{{ item.name }}</span>
          
        </div>
      </div> -->

    </div>
  </div>
</template>

<script setup>
import { ref, getCurrentInstance } from "vue";
import useMapStore from "@/stores/map";
import { storeToRefs } from "pinia";

// 获取当前实例用于操作 DOM
let pageInstance = getCurrentInstance();

// 获取 map store
let store = useMapStore();

// 初始化：移除相关图层并获取地形图数据
import { onMounted } from 'vue'

// 初始化：移除相关图层并获取地形图数据（在挂载后执行，避免在 setup 期间操作尚未初始化的 map）
onMounted(()=>{
  // store.removeTopoLayers();
  // store.getTopoInfo();
})

// 从 store 获取地形图信息
const { topoInfo } = storeToRefs(store);

// 记录当前选中的要素索引
let clickedItem = ref(-1);

// 根据地理要素类型获取对应的图标 emoji
const getIconEmoji = (description) => {
  const iconMap = {
    'mountain_range': '⛰️',  // 山脉
    'river': '🌊',           // 河流
    'lake': '💧',            // 湖泊
    'farmland': '🌾'         // 农田
  };
  return iconMap[description] || '📍';
};

// 处理地形图要素的点击事件
const clickItem = (index) => {
  if (clickedItem.value === index) {
    // 如果点击的是已选中的要素，取消选中状态，显示所有要素
    for (let i = 0; i < topoInfo.value.length; i++) {
      pageInstance.refs.topoContent.children[i].classList.add("clicked");
    }
    clickedItem.value = -1;
    // 加载所有地形图层
    store.loadTopo(topoInfo.value);
    // 清空 store 中的当前地形要素（3D 显示默认底图）
    store.setCurrentTopo('');
  } else {
    // 取消所有要素的选中状态
    for (let i = 0; i < topoInfo.value.length; i++) {
      pageInstance.refs.topoContent.children[i].classList.remove("clicked");
    }
    // 选中点击的要素
    pageInstance.refs.topoContent.children[index].classList.add("clicked");
    clickedItem.value = index;
    // 加载单个地形图层
    store.loadTopo([topoInfo.value[index]]);
    // 将选中的地形要素写入 store，供 3D 组件切换底图使用
    store.setCurrentTopo(topoInfo.value[index].description);
  }
};

// 当取消选中时，确保 store 中的 currentTopo 也被清空（显示全部）
const clearSelection = () => {
  if (clickedItem.value === -1) {
    store.setCurrentTopo('');
  }
};
</script>

<style scoped>
/* 地理要素图标容器 */
.topo-icon-wrapper {
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 5px;
  flex-shrink: 0;
}

/* 地理要素图标样式 */
.topo-icon {
  font-size: 32px;
  transition: opacity 0.3s ease, transform 0.3s ease;
  cursor: pointer;
}

/* 新增 */

.legend-container {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
}
/* .legend-item {
  display: flex;
  align-items: center;
  white-space: nowrap;
  cursor: pointer;
} */


.legend-item.clicked .topo-icon {
  opacity: 1; /* 选中状态下图标完全显示 */
  transform: scale(1.1); /* 选中时略微放大 */
}

.legend-item:not(.clicked) .topo-icon {
  opacity: 0.4; /* 未选中的图标变淡 */
  transform: scale(0.9); /* 未选中时略微缩小 */
}

/* 选中时的特效 */
.legend-item:active .topo-icon {
  transform: scale(1.05);
}
</style>
