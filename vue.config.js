const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  devServer: {
    port: 8000, // 指定端口
  },
  transpileDependencies: true,
  lintOnSave: false
})
