const CleanDistPlugins = require('./lib/plugins/clean-dist-plugin');
const HtmlReloadPlugins = require('./lib/plugins/html-reload-plugin');
const InitPlugin = require('./lib/plugins/init-plugin');
const JsCopyPlugins = require('./lib/plugins/js-copy-plugin');

const path = require("path");

module.exports = {
  entry: "./src/index.js",
  module: {
    rules: [
      {
        test: /\.less$/,
        use: [path.join(__dirname, "./lib/loader/less-loader.js")],
      },
    ],
  },
  plugins: [
    new CleanDistPlugins(),
    new HtmlReloadPlugins(),
    new InitPlugin(),
    // new JsCopyPlugins()
  ]
};
