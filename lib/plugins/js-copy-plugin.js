const fs = require("fs");
const path = require("path");
/**
 * @desc 编译后，重命名文件
 */
class JsCopyPlugins {
  delFileByName(url) {
    const curPath = path.join(url);
    fs.unlinkSync(curPath);
  }

  apply(compiler) {
    const self = this;
    console.log('self', self);
    compiler.hooks.afterPlugins.tap("JsCopyPlugins", function (compilation) {
      // const ranNum = parseInt(Math.random() * 100000000);
      fs.copyFile(
        "./dist/bundle.js",
        `./dist/bundle.${ranNum}.js`,
        function (err) {
          if (err) console.log("获取文件失败");
          self.delFileByName("./dist/bundle.js");
        }
      );
      // console.log("重新生成js成功，文件指纹：", ranNum);
      // return ranNum;
    });
  }
}

module.exports = JsCopyPlugins;
