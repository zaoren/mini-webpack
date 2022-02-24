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