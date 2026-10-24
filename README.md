# NEON SERPENT / 3D

一个纯前端、零构建的 3D 霓虹贪吃蛇。场景、蛇、食物与粒子全部由 Three.js 实时渲染，音效由 Web Audio 实时合成，不依赖任何外部图片、字体或 CDN。

![NEON SERPENT 3D](screenshots/hero.png)

## 运行

双击 **start.cmd**。脚本会启动一个本地静态服务器，并自动打开：

    http://127.0.0.1:4173

也可以用：

    npm start

或：

    node serve.mjs

> 不要直接双击 index.html。页面使用 ES Module，必须通过 HTTP 打开；直接打开文件时页面会提示通过 start.cmd 启动。

环境要求：支持 WebGL2 的现代浏览器（Chrome / Edge / Firefox / Safari 新版），以及 Node.js（仅用于本地静态服务器）。游戏本身不需要联网。

## 玩法

- **WASD / 方向键**：转向
- **空格**：开始 / 暂停 / 继续
- **R**：重开
- **M**：声音
- **Esc / P**：暂停
- 手机：滑动屏幕，或使用右下角的方向键

规则很简单：吃掉橙色能量球，身体变长、速度变快。撞到边界或咬到自己就结束。

连续快速进食会累积 **COMBO**，最高 ×5；单颗能量球最高可得 50 分。每吃 3 颗会提升一级速度。

三种节奏：

| 难度 | 初始节奏 | 特点 |
| --- | --- | --- |
| 轻松 | 196 ms / 格 | 适合先熟悉 3D 棋盘 |
| 经典 | 154 ms / 格 | 默认速度 |
| 极速 | 116 ms / 格 | 反应测试 |

最高分保存在浏览器的 localStorage 中。

## 技术说明

- **Three.js r186**，vendored 在 vendor/ 下，离线可玩。
- 场景包含透视相机、软阴影、自定义网格着色器、程序化发光贴图、叠加混合粒子、合成音效。
- 游戏逻辑位于 js/engine.js，不依赖 DOM，可单独测试。
- 无构建步骤，无 npm runtime 依赖。

## 文件结构

    index.html            页面与界面结构
    css/style.css         全部界面样式
    js/engine.js          纯游戏逻辑
    js/visuals.js         Snake / Food / Particles 三维视图
    js/game.js            场景、循环、输入与 UI 状态机
    js/audio.js           Web Audio 合成音效
    vendor/               Three.js（MIT）
    tests/                Node 单元测试
    serve.mjs             本地静态服务器
    start.cmd             Windows 一键启动

## 测试

    npm test

覆盖了移动、吃食物、COMBO 过期、速度提升、撞墙、自撞、尾随格、暂停、食物生成与难度切换。

## 许可

游戏代码为项目代码。Three.js 以 MIT 许可分发，许可证见 vendor/THREE-LICENSE.txt。