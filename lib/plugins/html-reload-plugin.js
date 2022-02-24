const fs = require('fs');

/**
 * @desc 修改 html 的引入
*/
class HtmlReloadPlugins {
  apply(compiler) {
    // SyncWaterfallHook可以传递值,这里的res由上一个 hooks 的返回值传递下来
    compiler.hooks.afteremit.tap("HtmlReloadPlugins", function (ranNum) {
      let content = fs.readFileSync("./public/index.html", "utf8");
      // content = content.replace("bundle.js", `bundle.${ranNum}.js`); // ranNum 没传下来，先去掉这段逻辑
      fs.writeFileSync("./dist/index.html", content);
    });
  }
}

module.exports = HtmlReloadPlugins;