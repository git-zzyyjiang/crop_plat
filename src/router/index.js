import {createRouter, createWebHashHistory} from 'vue-router'
import useMapStore from "@/stores/map";
import {stores} from "@/stores";
const store = useMapStore(stores)
const router =  createRouter({
    history: createWebHashHistory(),
    routes:[
        { // 地块分类
            name:'landCover',
            path:'/',
            redirect: {name:'home'}, // 默认进首页
            // component:()=>import('../components/land-cover.vue')
        },
        { // 首页
            name:'home',
            path:'/home',
            component:()=>import('../components/home-view.vue')
        },
        // {
        //     name:'landCover',
        //     path:'/landCover',
        //     component:()=>import('../components/land-cover.vue')
        // },

        { // 时序
            name: 'timeSeriesData',
            path: '/timeSeriesData',
            component: ()=> import ('../components/imagery-view.vue')
        },

        { // 作物
            name:'cropClassification',
            path:'/cropClassification',
            component:()=>import ('../components/crop-classification.vue')
        },

        { // 农田
            name:'agriParcel',
            path:'/agriParcel',
            component:()=>import('../components/land-mass.vue')
        },

        { // 地形图
            name:'topographicMap',
            path:'/topographicMap',
            component:()=>import('../components/topographic-map.vue')
        },
         // 水量
        {
            name:'cropWaterRequirement',
            path:'/cropWaterRequirement',
            component:()=>import('../components/crop-water-requirement.vue')
        }
    ]
})


// 全局前置路由守卫————初始化的时候被调用、每次路由切换之前被调用
router.beforeEach((to,from,next)=>{
    if(to.name==='landCover'){
        store.clickItem=0
    }else if(to.name==='timeSeriesData'){
        store.clickItem=1
    }else if(to.name==='agriParcel'){
        store.clickItem=2
    }else if(to.name==='cropClassification'){
        store.clickItem=3
    }else if(to.name==='topographicMap'){
        store.clickItem=4
    }else if(to.name==='cropWaterRequirement'){
        store.clickItem=5
    }
    next()
})
// const VueRouterPush = VueRouter.prototype.push
// VueRouter.prototype.push = function push (to) {
//     return VueRouterPush.call(this, to).catch(err => err)
// }
export default router
