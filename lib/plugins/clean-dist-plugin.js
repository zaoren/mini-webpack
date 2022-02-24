const fs = require('fs');
const path = require('path');

/**
 * @desc 编译前， 清除上次打包在 dist 目录下的文件
*/
class CleanDistPlugins {
  delFileFolderByName(url) {
    var files = [];
    /**
     * 判断给定的路径是否存在
     */
    if (fs.existsSync(url)) {
      /**
       * 返回文件和子目录的数组
       */
      files = fs.readdirSync(url);
      files.forEach(function (file, index) {
        var curPath = path.join(url, file);
        /**
         * fs.statSync同步读取文件夹文件，如果是文件夹，在重复触发函数
         */
        if (fs.statSync(curPath).isDirectory()) {
          // recurse
          this.delFileFolderByName(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      /**
       * 清除文件夹
       */
      // fs.rmdirSync(url);
    } else {
      console.log("给定的路径不存在，请给出正确的路径");
    }
  }

  apply(compiler) {
    // 将自身方法订阅到hook以备使用
    //假设它的运行期在编译完成之后
    const self = this;
    compiler.hooks.beforeCompile.tap(
      "CleanDistPlugins",
      function (compilation) {
        self.delFileFolderByName("./dist/");
      }
    );
  }
}

module.exports = CleanDistPlugins;
