## 手写Webpack，明白打包原理

### Webpack的本质

简单点讲，Webpack本质上就是一个静态资源打包工具，将不同类型的资源打包成一个bundle文件。

### 原理分析

我们通过一个简单的例子，从宏观的角度上理解Webpack所做的事情。

假设我这里有两个文件`index.js`和`add.js`，我要将这两个模块打包成一个能在浏览器中直接运行的bundle.js，如何实现？

```js
// index.js
var add = require('add.js').default
console.log(add(1 , 2))
// add.js
exports.default = function(a,b) {return a + b}
```

假设在浏览器中直接执行这个程序肯定会有问题 最主要的问题是浏览器中没有exports对象与require方法所以一定会报错。我们需要通过模拟exports对象和require方法。

> 有同学会说，那为什么不直接用 import 和 export 语法呢？其实这两个语法Node并不能直接读取，也需要通过babel来转化成require 和 exports的形式，这个后面会讲到。

#### 1. 模拟exports对象

exports本质上是将当前的代码内容赋值给default属性，而用Nodejs打包的时候我们会使用fs.readfileSync()来读取js文件，得到的是一串字符串。如果需要将字符串运行，我们可以通过`eval`这个方法。

```js
const exports = {}
eval('exports.default = function(a,b) {return a + b}') // node文件读取后的代码字符串
exports.default(1,3) // 4
```

上面这段代码的运行结果可以将模块中的方法绑定在exports对象中。为了不污染全局，我们使用一个IIFE（立即执行函数）来封装一下。

```js
var exports = {}
(function (exports, code) {
	eval(code)
})(exports, 'exports.default = function(a,b){return a + b}')
```

#### 2. 模拟require函数

首先我们知道，当我们在 require一个文件比如`add.js`的时候，实际上就是在当前文件的作用域下执行add.js的代码，并且用一个变量去接收。

```js
function require(file) {
	var exports = {};
	(function (exports, code) {
		eval(code)
	})(exports, 'exports.default = function(a,b){return a + b}')
  return exports
}
var add = require('add.js').default
console.log(add(1 , 2))
```

#### 3. 将`add.js`和`index.js`打包

```js
(function (list) {
  function require(file) {
    var exports = {};
    (function (exports, code) {
      eval(code);
    })(exports, list[file]);
    return exports;
  }
  require("index.js");
})({
  "index.js": `
    var add = require('add.js').default
    console.log(add(1 , 2))
        `,
  "add.js": `exports.default = function(a,b){return a + b}`,
});
```

> 为了不影响其他模块，这里又用立即执行函数包了一下，这也是Webpack本身一个比较重要的思想

#### 4. 对比真正的Webpack打包结果

![](https://tva1.sinaimg.cn/large/e6c9d24ely1gzmositliej20yh0u0dhp.jpg)

#### 5. 确定简易编译模板

根据我们之前的分析，结合Webpack的打包结果，我们可以得出一个初步的编译模板，如下：

```js
// const  depsGraph = JSON.stringify(parseModules(file)); 
(function (graph) {
    function require(file) {
        function absRequire(relPath) {
            return require(graph[file].deps[relPath])
        }
        var exports = {};
        (function (require,exports,code) {
            eval(code)
        })(absRequire,exports,graph[file].code)
        return exports
    }
  // ！！！ 这里的 file 为入口文件
    require(file)
})(depsGraph)
```

这里有两个重点：1. file为入口文件的路径，从入口文件递归加载依赖模块 2. depsGraph 中存储了各个模块的key-code以及该模块依赖的模块，我们称之为**依赖图（Dependency Graph）**类似下面这样的结构：

```js
{
  "./src/index.js": {
    "deps": { "./add.js": "./src/add.js" },
    "code": "....."
  },
  "./src/add.js": {
    "deps": {},
    "code": "......"
  }
}
```

> 所以，接下来的工作重点就是依赖图的收集。

### 功能实现

![](https://tva1.sinaimg.cn/large/e6c9d24ely1gzmpp60elbj20u0160jtz.jpg)

对照Webpack构建流程图，我们将按步骤实现一下几个功能：

- **初始化参数**：从配置文件和命令行语句读取配置
- **开始编译**：初始化Compiler对象，加载所有配置了的插件，并执行Compiler的run方法开始编译
- **确定入口**：根据配置文件中的`entry`字段寻找入口
- **编译模块**：从入口出发，调用不同的`Loader`对模块进行解析，再找出模块的依赖，递归此过程。
- **完成模块编译**：根据入口和依赖关系确定好了依赖关系图（其中包括编译后的代码）
- **输出资源**：根据入口和模块之间的依赖关系，组装成一个个包含多个模块的Chunk（分包优化操作在这里做），这是可以改变输出结果的最后一步
- **输出完成**：在确定好输出内容后，根据配置确定输出的路径和文件名，把文件内容写入到计算机上的某个位置。

#### 0. 准备工作

运行`npm init -y`初始化项目,添加 Webpack 编译命令

```js
{
  "name": "mini-webpackV2",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "build": "node ./bin/index.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "devDependencies": {
    "marked": "^4.0.12"
  }
}
```

在 bin 文件下新建 `index.js`用来响应命令行

```js
const path = require('path')
```

新建 `webpacj.config.js`文件，声明 Webpack 运行时的配置

```js
module.exports = {
  entry: "./src/index.js",
  module: {
    rules: [],
  },
};
```

src文件下新建要打包的 `add.js` 和 `index.js` 文件

```js
// index.js
import add from './add.js';

console.log('add(2,4)', add(2,4));

// add.js
const add = (a, b) => {
  return a + b;
};

export default add;
```

#### 1. 初始化参数

在 `bin/index.js` 文件中，读取`webpack.config.js`和命令行的配置

```js
// 类似 webpack-cli 的作用解析命令行和配置文件中的参数
const path = require('path')

// ** step1: 初始化参数
const webpackConifg = require(path.resolve('webpack.config.js'))

console.log('webpack config', webpackConifg);
```

#### 2. 开始编译

开始编译之前，我们需要先简单定义一个 **Compiler** 对象，该对象初始化时加载所有`webpack.config.js`中定义的插件

在 `lib/Compiler.js`中定义 Compiler 类

```js
const path = require('path')
/**
 * webpack的核心类 Compiler
 */

class Compiler {
  constructor(config) {
    this.config = config;// 配置信息
   
    // 调用所有插件的 apply 方法
    const plugins = this.config.plugins;
    if (Array.isArray(plugins)) {
      plugins.forEach((item) => {
        // 每个均是实例，调用实例上的一个方法即可，传入当前Compiler实例
        item.apply(this);
      });
    }
  }
  
  run() {}
}
```

然后在 `bin/index.js`文件中实例化 Compiler 对象，并调用实例化后的 run 方法

```js
const webpackCompiler = new Compiler(config);

// ** step2: 开始编译
webpackCompiler.run();
```

#### 3. 确定入口

这一步比较简单，我们暂且只考虑**单入口**的情况，在 Compiler 类实例化的时候，读取`webpack.config.js`中的entry字段。

```js
const path = require('path')
class Compiler {
  constructor(config) {
   	...
    this.root = process.cwd(); // 当前项目的地址
         // ** step3: 确定入口，找出所有的入口文件,当前默认按照单入口处理
     this.entryPath = "./" + path.relative(this.root, config.entry);
  }
  ...
}
```

#### 4 编译模块

接下来，我们就是要从入口文件出发，分析出依赖关系图。首先我们写一个读取文件的方法，通过node 自带的fs模块读取文件内容，然后通过`@babel/parser`将我们的代码字符串转化成`AST`,转出来的结果如下：

```js
// 代码字符串 -> 对象 -> 对象遍历解析
    const ast = parser.parse(body, {
      sourceType: "module", // 使用ESModule
    });
```

![](https://tva1.sinaimg.cn/large/e6c9d24ely1gznltc9bxkj20r70lyq46.jpg)

然后我们遍历这个AST对象，收集依赖的对象

```js
// 遍历抽象语法树
    traverse(ast, {
      // visitor
      // 遇到 import 节点的时候
      ImportDeclaration({ node }) {
        // 收集依赖
        console.log("node", node);
        const dirname = path.dirname(modulePath); // 当前文件的路径
        const abspath = "./" + path.join(dirname, node.source.value); // 计算绝对路径
        dependencies[node.source.value] = abspath;
      },
    });
```

最后将源代码通过Babel转化成ES5版本

```js
// ES6 => ES5
const { code } = babel.transformFromAst(ast, null, {
  presets: ["@babel/preset-env"],
});
```

最终完整的解析函数如下：

```js
const path = require("path");
const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const babel = require("@babel/core");

/**
 * webpack的核心类 Compiler
 */

console.log("process.cwd()", process.cwd());

class Compiler {
  constructor(config) {
    this.config = config; // 配置信息
    this.modules = {};
    this.root = process.cwd(); // 当前项目的地址
    // ** step3: 确定入口，找出所有的入口文件,当前默认按照单入口处理
    this.entryPath = "./" + path.relative(this.root, config.entry);
    // Webpack 在构建的过程中会广播一些事件
    this.hooks = {};
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
   * @desc 根据路径解析出该模块的 依赖和code
   */
  parseModuleInfo(modulePath) {
    const body = fs.readFileSync(modulePath, "utf-8");
    console.log("body", body);
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
        console.log("node", node);
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

  // 构建模块，达到依赖关系图
  buildMoudle(entryPath) {
    // 分析入口模块
    const entryModuleInfo = this.parseModuleInfo(entryPath);
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

  // 开始编译
  run() {
    this.buildMoudle(this.entryPath);

  }
}

module.exports = Compiler;
```

#### 5 输出资源

编译模块之后，我们就拿到了依赖模块图`depsGraph`，使用我们之前确定的编译模板来编译依赖图，并且将编译后的内容输出到文件系统：

```js
outputFile() {
    console.log('this.depsGraph', this.depsGraph);
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
```

完整的`Compiler.js`如下：

```js
const path = require("path");
const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const babel = require("@babel/core");

/**
 * webpack的核心类 Compiler
 */

console.log("process.cwd()", process.cwd());

class Compiler {
  constructor(config) {
    this.config = config; // 配置信息
    this.modules = {};
    this.root = process.cwd(); // 当前项目的地址
    // ** step3: 确定入口，找出所有的入口文件,当前默认按照单入口处理
    this.entryPath = "./" + path.relative(this.root, config.entry);
    // Webpack 在构建的过程中会广播一些事件
    this.hooks = {};
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
   * @desc 根据路径解析出该模块的 依赖和code
   */
  parseModuleInfo(modulePath) {
    const body = fs.readFileSync(modulePath, "utf-8");
    console.log("body", body);
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
        console.log("node", node);
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

  // 构建模块，达到依赖关系图
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
    console.log('this.depsGraph', this.depsGraph);
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
    this.buildMoudle(this.entryPath);

    this.outputFile();
  }
}

module.exports = Compiler;
```

至此，我们的简易版`Webpack`就实现了，在终端运行命令`yarn build` or `npm run build`，就可以在`dist`目录下看到打包好的`bundle.js`文件了！

```js
(function (graph) {
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
        require('./src/index.js')
    })({"./src/index.js":{"dependencies":{"./add.js":"./src/add.js"},"sourceCode":"\"use strict\";\n\nvar _add = _interopRequireDefault(require(\"./add.js\"));\n\nfunction _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { \"default\": obj }; }\n\nconsole.log('add(2,4)', (0, _add[\"default\"])(2, 4));"},"./src/add.js":{"dependencies":{},"sourceCode":"\"use strict\";\n\nObject.defineProperty(exports, \"__esModule\", {\n  value: true\n});\nexports[\"default\"] = void 0;\n\nvar add = function add(a, b) {\n  return a + b;\n};\n\nvar _default = add;\nexports[\"default\"] = _default;"}})
```

新建`index.html`文件加载打包后的`bundle.js`文件查看下效果：

![](https://tva1.sinaimg.cn/large/e6c9d24ely1gzofxteipbj217e0lctb7.jpg)

### 进阶功能

#### 实现Webpack Loader机制

我们知道，Webpack本身只能处理js文件，对于其他的静态资源文件，只能通过Loader来加载，那Webpack是如何实现Loader机制的呢？

1. 在`webpack.config.js`中配置Loader

```js
// ...
module: {
        rules: [
         {
            test: /\.css$/,
            use: [path.join(__dirname, './lib/loader/style-loader.js')]
        }, 
         {
            test: /\.less$/,
            use: [path.join(__dirname, './lib/loader/less-loader.js')]
        }]
    },
```

2. 在`lib/loader`目录下新建`less-loader`（记得新增`less`依赖模块）

```js
const less = require('less')

function loader(source) {
    let css = ''
    less.render(source, function(err, output) {
        css = output.css
    })

    // css = css.replace(/\n/g, '\\n') // 这个地方感觉替换换行符的逻辑是为了兼容windows？
    let style = `
    let style = document.createElement('style')
    style.innerHTML = \n${JSON.stringify(css)}
    document.head.appendChild(style)
    `
    return style
}
module.exports = loader;
```

```js
// style-loader
function loader(source) {
    let style = `
    let style = document.createElement('style')
    style.innerHTML = \n${JSON.stringify(source)}
    document.head.appendChild(style)
    `
    return style
}
module.exports = loader;
```

3. 修改读取文件的逻辑，不仅仅只通过`fs`模块读取code。而是先判断`webpack.config.js`模块中的modules => rules中是否有对当前类型静态资源有特殊的处理，如果有，则递归调用对应的loader来处理得到结果。

```js
/**
  * @desc 根据 Loader 解析各种静态文件
   */
  handleSourceByloader(modulePath) {
    let content = fas.readFileSync(modulePath, "utf-8");
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
          console.log('use[useLoaderLen]', use[useLoaderLen]);
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
   //...
  }
```

4. 修改 dist/index.html 文件内容，添加一些文字。并且在入口文件中引入`index.less`

```js
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
</head>
<body>
  <span>hello World！Welcome</span>
  <script src="./bundle.js"></script>
</body>
</html>
```

```js
import './index.less'
import add from './add.js';

console.log('add(2,4)', add(2,4));
```

```less
body {
  text-align: center;
  font-size: 40px;
  color: red;
}

```

5. 运行打包命令，看看效果，可以看到less文件内容已经生效了！！

![](https://tva1.sinaimg.cn/large/e6c9d24ely1gzopu4x1a9j21ky0s00y1.jpg)

#### Webpack生命周期

为了拓展Webpack的构建能力，Webpack在构建的特定过程中会发布一些事件。插件监听到这些事件后，会调用Webpack的API改变构建结果。所以，模拟实现要做两个事情：1. 在构建的特定过程中发布事件  2. 在初始化时订阅事件

1. 初始化的时候，在`this.hooks`中设定一些特殊的生命周期

```js
//...
const tapable = require('tapable');

class Compiler {
  constructor(config) {
    // ...
    // Webpack 在构建的过程中会广播一些事件
    this.hooks = {
      entryInit: new tapable.SyncHook(),
      beforeCompile: new tapable.SyncHook(),
      afterCompile: new tapable.SyncHook(),
      afterPlugins: new tapable.SyncHook(),
      afteremit: new tapable.SyncWaterfallHook(),
    };
  }
}
```

2. 在编译过程中在适当的时机触发

```js
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
```

#### 实现Webpack Plugins机制

1. Compiler 初始化的时候，先读取`webpack.config.js`中的plugins配置，并且调用Plugins的`apply`方法，订阅特定的事件(这个之前的功能实现中已经写过了)。

```js
class Compiler {
  //...
  constructor(config) {
    // ...
    // 调用所有插件的 apply 方法
    const plugins = this.config.plugins;
    if (Array.isArray(plugins)) {
      plugins.forEach((item) => {
        // 每个均是实例，调用实例上的一个方法即可，传入当前Compiler实例
        item.apply(this);
      });
    }
  }
  //...
}
```

2. 在lib/plugins新增插件，监听特定的生命周期

新增 initPlugin:**在编译前打印文案**

```js
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
```

新增 CleanDistPlugins: **编译前， 清除上次打包在 dist 目录下的文件**

```js
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
```

新增JsCopyPlugins:**编译后，重命名文件**

```js
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
```

新增HtmlReloadPlugins: **修改 html 的引入**

```js
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
```

3. 在`webpack.config.js`中声明插件

```js
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
//    new JsCopyPlugins()
  ]
};
```

4. 我们在 public 目录下新建 `index.html`文件

```js
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
</head>
<body>
  <span>Hello World！Welcome</span>
  <script src="./bundle.js"></script>
</body>
</html>
```

重新运行 yarn build 命令，看到我们的插件已经成功运行了，改变了Webpack的构建结果！

### 项目源代码

[源码地址](https://github.com/zaoren/mini-webpack)

















