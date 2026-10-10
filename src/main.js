import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import {stores} from './stores/index'
import '../public/css/index.css'
import 'ol/ol.css'
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
const app =  createApp(App)
app.use(stores)
app.use(router)
app.use(ElementPlus)
app.mount('#app')
