// lib/plugin/init-plugin 监听 entryInit 事件


/**
 * @desc 在编译前打印文案
*/
class InitPlugin {
  apply(compiler) {
      // 将的在执行期放到刚开始解析入口前
      compiler.hooks.entryInit.tap('Init', function(compilation) {
        console.log('Init - compilation', compilation);
          console.log(`开始编译，第一个插件成功运行，打印！`);
      })
  }
}

module.exports = InitPlugin