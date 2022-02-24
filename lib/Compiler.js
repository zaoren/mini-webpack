const path = require("path");
const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const babel = require("@babel/core");
const tapable = require('tapable');

/**
 * @desc webpack的核心类 Compiler
 * @author 枣仁,
 */

class Compiler {
  constructor(config) {
    this.compilation = {} // 存放编译信息
    this.config = config; // 配置信息
    this.modules = {};
    this.root = process.cwd(); // 当前项目的地址
    // ** step3: 确定入口，找出所有的入口文件,当前默认按照单入口处理
    this.entryPath = "./" + path.relative(this.root, config.entry);
    // Webpack 在构建的过程中会广播一些事件
    this.hooks = {
      entryInit: new tapable.SyncHook(),
      beforeCompile: new tapable.SyncHook(),
      afterCompile: new tapable.SyncHook(),
      afterPlugins: new tapable.SyncHook(),
      afteremit: new tapable.SyncWaterfallHook(['hash']),
    };
    this.depsGraph = {}; // 最终要收集的依赖图

    // 调用所有插件的 apply 方法
    const plugins = this.config.plugins;
    if (Array.isArray(plugins)) {
      plugins.forEach((item) => {
        // 每个均是实例，调用实例上的一个方法即可，传入当前Compiler实例
        item.apply(this);
      });
    }
  }

  /**
   * @desc 根据 Loader 解析各种静态文件
   */
  handleSourceByloader(modulePath) {
    let content = fs.readFileSync(modulePath, "utf-8");
    // 读取 rules 配置
    const rules = this.config.module.rules;
    for (let i = 0; i < rules.length; i++) {
      const { test, use } = rules[i];
      // 假设能和 test 匹配上
      if (test.test(modulePath)) {
        // 递归
        function changeLoader() {
          // 先拿最后一个
          let useLoaderLen = use.length - 1;
          console.log("use[useLoaderLen]", use[useLoaderLen]);
          let loader = require(use[useLoaderLen]);
          content = loader(content);
          useLoaderLen = useLoaderLen - 1;
          // 如果 use 有多个(使用多个loader处理)，递归处理
          if (useLoaderLen > 0) {
            changeLoader();
          }
        }
        changeLoader();
      }
    }
    return content;
  }

  /**
   * @desc 根据路径解析出该模块的 依赖和code
   */
  parseModuleInfo(modulePath) {
    const body = this.handleSourceByloader(modulePath);
    // 转化 ast 语法树
    // 代码字符串 -> 对象 -> 对象遍历解析
    const ast = parser.parse(body, {
      sourceType: "module", // 使用ESModule
    });

    // 收集依赖的对象
    const dependencies = {};

    // 遍历抽象语法树
    traverse(ast, {
      // visitor
      // 遇到 import 节点的时候
      ImportDeclaration({ node }) {
        // 收集依赖
        const dirname = path.dirname(modulePath); // 当前文件的路径
        const abspath = "./" + path.join(dirname, node.source.value); // 计算绝对路径
        dependencies[node.source.value] = abspath;
      },
    });

    // ES6 => ES5
    const { code } = babel.transformFromAst(ast, null, {
      presets: ["@babel/preset-env"],
    });

    const moduleInfo = {
      moduleName: modulePath, // 文件名
      dependencies, // 依赖那些文件
      sourceCode: code, // 源文件
    };

    return moduleInfo;
  }

  getDeps(depsModulesArray, { dependencies }) {
    Object.keys(dependencies).forEach((depsModuleName) => {
      const depsModuleInfo = this.parseModuleInfo(dependencies[depsModuleName]);
      depsModulesArray.push(depsModuleInfo);
      this.getDeps(depsModulesArray, depsModuleInfo);
    });
  }

  /**
   * @desc 构建模块，达到依赖关系图
   */
  buildMoudle() {
    // 分析入口模块
    const entryModuleInfo = this.parseModuleInfo(this.entryPath);
    // depsModulesArray 存放所有被依赖的模块
    const depsModulesArray = [entryModuleInfo];
    // 从入口模块开始 递归 收集所有的依赖
    this.getDeps(depsModulesArray, entryModuleInfo);
    // 遍历所有需要加载的模块，输出依赖图
    depsModulesArray.forEach((info) => {
      this.depsGraph[info.moduleName] = {
        dependencies: info.dependencies,
        sourceCode: info.sourceCode,
      };
    });
  }

  // **step4: 根据依赖图输出打包后的文件
  outputFile() {
    // console.log("this.depsGraph", this.depsGraph);
    const templateStr = `(function (graph) {
        function require(file) {
            function absRequire(relPath) {
                return require(graph[file].dependencies[relPath])
            }
            var exports = {};
            (function (require,exports,sourceCode) {
                eval(sourceCode)
            })(absRequire,exports,graph[file].sourceCode)
            return exports
        }
        require('${this.entryPath}')
    })(${JSON.stringify(this.depsGraph)})`;

    // 将打包好的文件写入到文件系统
    !fs.existsSync("./dist") && fs.mkdirSync("./dist");
    fs.writeFileSync("./dist/bundle.js", templateStr);
  }
  // 开始编译
  run() {
    this.hooks.entryInit.call(); //启动项目
    this.hooks.beforeCompile.call(); //编译前运行
    this.buildMoudle(this.entryPath);
    this.hooks.afterCompile.call(); //编译后运行
    this.outputFile();
    this.hooks.afterPlugins.call(); //执行完plugins后运行
    this.hooks.afteremit.call(); //结束后运行
  }
}

module.exports = Compiler;
