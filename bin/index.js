// 类似 webpack-cli 的作用解析命令行和配置文件中的参数
const path = require('path')
const Compiler = require('../lib/Compiler.js')

// ** step1: 初始化参数
const webpackConifg = require(path.resolve('webpack.config.js'))

console.log('webpack config', webpackConifg);

const webpackCompiler = new Compiler(webpackConifg);

// ** step2: 开始编译
webpackCompiler.run();