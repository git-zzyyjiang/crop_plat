import { computed, onBeforeUnmount, ref } from 'vue'

/**
 * 让浮层窗口可以通过把手拖动。
 * 没拖过时用 CSS 里的默认位置，拖过一次之后就固定成像素定位，
 * 并做边界限制，不会被拖出屏幕。
 */
export function usePanelDrag() {
  const panel = ref(null)
  const pos = ref(null)
  const panelStyle = computed(() => pos.value
    ? {
        left: pos.value.left + 'px',
        top: pos.value.top + 'px',
        // right/bottom 要清掉：留着会和 left/top 一起把元素拉伸到两边
        right: 'auto',
        bottom: 'auto',
        transform: 'none'
      }
    : null
  )

  let grabOffset = { x: 0, y: 0 }

  const onPointerMove = evt => {
    const el = panel.value
    if (!el || !pos.value) return
    const maxLeft = Math.max(window.innerWidth - el.offsetWidth - 4, 4)
    const maxTop = Math.max(window.innerHeight - el.offsetHeight - 4, 4)
    pos.value = {
      left: Math.min(Math.max(evt.clientX - grabOffset.x, 4), maxLeft),
      top: Math.min(Math.max(evt.clientY - grabOffset.y, 4), maxTop)
    }
  }

  const endDrag = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', endDrag)
  }

  const startDrag = evt => {
    const el = panel.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    grabOffset = { x: evt.clientX - rect.left, y: evt.clientY - rect.top }
    pos.value = { left: rect.left, top: rect.top }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    evt.preventDefault()
  }

  onBeforeUnmount(endDrag)

  return { panel, panelStyle, startDrag }
}
