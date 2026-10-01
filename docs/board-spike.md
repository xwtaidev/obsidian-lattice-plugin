# Lattice 看板 spike（Bases 路线）

## 这个 spike 要回答什么

一句话：**Bases 能不能承载 wolai 式的看板，还是必须自己写数据层。**

结论：**能**。代价是 `minAppVersion` 一路抬到了 **1.10.2**（`createFileForView` 的门槛）；有一处必须绕开的坑，见下面的发现清单第 1 条。

## 实现

| 文件 | 职责 |
| --- | --- |
| `src/bases/register.ts` | 注册 Bases 视图，声明三个视图配置项（Group by / Show property names / Show note description） |
| `src/bases/lattice-bases-view.ts` | 视图本体：列头、卡片、两种拖拽、列菜单、描述的异步回填 |
| `src/bases/grouping.ts` | 分组、列顺序/移除/重排、写回规则，纯函数、无 DOM 无副作用，可直接单测 |
| `src/bases/description.ts` | 从笔记正文里取出卡片要显示的那一段，纯函数，可单测 |
| `src/bases/value-colors.ts` | 一个值一种颜色，颜色取自 Obsidian 自己的八色 |
| `src/ui/confirm-modal.ts` | 二次确认弹窗（Obsidian 公开 API 里没有 confirm） |

几个刻意的选择：

- **自己分组，不用 `data.groupedData`。** 因为 `QueryController` 的类体是空的，视图读不到 Bases 原生的 `groupBy` 配置，也就没法把「列顺序／预置空列／隐藏列」接上去。既然终归要自己分组，不如一开始就自己来。
- **卡片字段来自 `config.getOrder()`。** 也就是用 Bases 原生的 properties 菜单管显隐和顺序，这块 UI 不用自己写。
- **卡片值用 `value.renderTo(el, this.app.renderContext)`。** 链接、标签、日期都走 Obsidian 自己的渲染，观感与别处一致。
- **列头显示分组值，卡片上跳过该字段。** 同一列里每张卡片重复同一个值只是噪音。
- **`file.*` 和 `formula.*` 的列不给 drop target。** 它们是派生值不是存储值，拖上去什么也改不了，那就不该看起来能拖。

## 列的管理

列不是数据结构的一部分，它只是「分组字段某个取值的呈现」。所以列的显隐与顺序存成**视图配置** ——
和它所作用的那份数据放在一起，也就是 `.base` 文件里的那个 view 条目，而不是插件自己的 `data.json`：

| key | 含义 |
| --- | --- |
| `latticeColumnOrder` | 显式的从左到右顺序，存 `columnKey` 列表 |
| `latticeRemovedColumns` | 从这个看板移除的列 |

两个刻意的选择：

- **用户没动过列之前，这两个 key 一个都不写。** 列完全由数据推导，于是不存在「顺序列表与数据不同步」
  这种状态。顺序列表只在用户真正移动过列之后才存在，值没被它提到的列一律排在后面。
- **删除列 = 从本视图移除，不写任何笔记。** 确认弹窗里把这一点说明了，也说明了怎么恢复。
  顺序列表**刻意不改**，所以将来把列加回来时，它回到用户原先摆的位置，而不是末尾。

`columnKey(value)` 是列的身份：`null`（无值列）存成空字符串。真实的空字符串值会和它撞身份 ——
可以接受，因为两者对用户本来就是同一列。

「+」按钮走 `BasesView.createFileForView(name?, fmProcessor?)`，弹出的是 **Obsidian 自己的新建笔记菜单**，
文件夹与模板都继承仓库设置 —— 插件里因此不需要再放一份 folder/template 配置。

## 两种拖拽

看板上两样东西能拖，它们共用同一块区域，所以**不能靠位置区分**，只能靠载荷类型：

| 拖什么 | 从哪里拖起 | 载荷类型 | 放下后 |
| --- | --- | --- | --- |
| 卡片 | 卡片任意处 | `application/x-lattice-card` | 写回分组属性所在的 frontmatter |
| 列 | 列头最左的手柄 | `application/x-lattice-column` | 把该列插到目标列左/右半边 |

- **列只能从手柄拖起。** 卡片是 `draggable`，列本身不是 —— 手柄是列唯一的拖拽入口，
  于是「起点落在哪」不再有歧义，不必靠猜。
- **两种拖拽各有自己的落点反馈。** 拖卡片时整个目标列亮起（`.is-card-drop-target`）；
  拖列时在列与列之间画一条竖线（`.is-drop-before` / `.is-drop-after`），表达的是「插到哪一侧」。
  反馈刻意长得不一样，因为这是两件事。
- **整个看板只有一组 drag 监听**（挂在 `.lattice-board-columns` 上），没有按列各自接一套。
  目标列从事件里查，落点反馈永远只有一个元素携带 —— 这也是 `dragleave` 的噪音不会让整块板
  抖闪的原因。
- **`text/plain` 一律不设。** 卡片拖进笔记里不该粘出一个路径，Obsidian 自己的拖拽体系也不该
  把这些当成文件拖拽接过去。
- 只接**自己写的类型**。外部拖拽（Finder 的文件、别的面板）没有 `preventDefault`，看板就不接。

拖列的落点由 `reorderByDrop(keys, from, hovered, after)` 算。它看着像没必要的算术，其实不是：
`moveColumn` 是「先删后插」，所以凡是从删除前的数组取来的下标，向右拖时统统差一位。
A 拖到 C 的右半边必须得到 `[B, C, A, D]`，算错了要等某次列落错一格才会被发现。

## 列顺序为什么不再随卡片变动

列的顺序原本是**推导**出来的：按「该取值在数据里第一次出现的顺序」。这带来一个不好发现的
后果 —— **拖一张卡片就会重排列**：

```
拖之前   a(Backlog) b(Doing) c(Backlog)   →  列 [Backlog, Doing]
把 a 拖到 Done   a(Done) b(Doing) c(Backlog)  →  列 [Done, Doing, Backlog]
```

Backlog 不再是第一个出现的值，于是整块板重排，新列还插到了最前面。看起来就像「拖卡片的时候
列也跟着动了」。这不是两种拖拽打架 —— 当时压根没有列拖拽。

现在的规则是：

- **看板记住自己上一次画出来的列顺序**（视图实例上的 `drawnOrder`），在用户没有显式设过顺序时
  就按它重画。上例于是得到 `[Backlog, Doing, Done]`：Backlog 留在原地，新列追加在末尾。
- **显式顺序仍然优先**：`.base` 里的 `latticeColumnOrder` 一旦存在就压过它。
- **两者都不写盘。** `drawnOrder` 只在内存里，所以「打开看板」不会偷偷改 `.base`；
  真正要固定的布局，用移动列的动作把它写进文件 —— 拖列和「…」菜单都会把**当前排布**整体
  物化成顺序列表。

## 卡片打开：右侧抽屉

点卡片**不**在主区域打开笔记。看板是读它的地方，而主区域里打开一篇笔记，替换掉的正是你看的这块板
—— 一张卡把整个看板顶掉了。笔记改开在**右侧边栏**（Obsidian 自己的抽屉）里：

| 操作 | 结果 |
| --- | --- |
| 点卡片 | 笔记开在右侧边栏，边栏自动展开 |
| Cmd/Ctrl + 点卡片 | 主区域新标签页，全页打开 |
| 点卡片里的链接 / 标签 | 交给那个链接本身，不会额外打开卡片所属的笔记 |

- **只复用一个 leaf。** 连续点卡片是替换抽屉内容，不是越开越多。这也是为什么必须**记住自己的
  leaf**，而不是向工作区要「右侧栏当前活跃的那个」—— 后者会把用户自己放在那儿的反链面板顶掉。
- **记住的 leaf 可能是死的**（用户把它关了，或它随工作区重载消失）。引用一旦失效就丢弃，下次回落
  到边栏自己的 leaf。存活判断走 `workspace.iterateAllLeaves`；`WorkspaceItem` 没有公开的 `id`，
  所以 `getLeafById` 这条路取不到 id（它需要一个我们拿不到的字符串）。
- **卡片里点链接的守卫**：卡片上的值是真实链接（标签、内链、日期），`value.renderTo` 渲染出来的
  它们自己会响应点击。若不拦，点一个标签会既触发标签搜索、又冒泡上来打开这篇笔记。
- **打开模式保持用户偏好**，没有强行切到阅读视图：`openFile` 不带 `openState`。
- **「放大」交给 Obsidian 原生行为**：把边栏里的 tab 拖到主区域，它就变成主区域的标签页。
  这条依赖原生拖拽，**未验证**（见下）。确定可用的是 Cmd/Ctrl + 点卡片那条路径 —— 它由我们控制。

## 卡片的样子与标签的颜色

卡片从「标题 + 一行行灰字」改成了「标题 + 属性块」，属性块与标题的间距比属性之间的大，卡片内外
的间距也都放大了：

| 量 | 之前 | 之后 |
| --- | --- | --- |
| 卡片高度（标题 + 一个属性） | 56px | 75px |
| 卡片之间 | 4px | 8px |
| 列头与第一张卡片 | 8px | 12px |
| 卡片内边距 | 8px | 12px |

**值带颜色。** 看板是一墙短字符串，而同一个字符串每次出现都表示同一件事（`High`、一个标签、
一个列名）。给每个值一个固定的颜色，看板就从「逐张读」变成「扫一眼」：没有颜色时，想找两张写着
`High` 的卡，眼睛得走完每一张。

- **颜色取自 Obsidian 自己的八个颜色**（`--color-red-rgb` 等），所以浅色和深色主题都自动成立，
  不必各自调一遍；这八个也正是用户在 callout、错误提示里一直看到的那八个。
- **同一个值，同一个颜色，处处一致**：列头和卡片上的同一串文字走同一个分配。
- **分配到颜色的规则**（`src/bases/value-colors.ts`）：FNV-1a 哈希取模进 8 个桶；撞了就往后
  探一个空位 —— 这就是 `High` 和 `Low` 不会同色的原因。分配表**每次渲染重建**，因为值的集合变了，
  让已经离场的值继续占着颜色没有意义。
- **谁会被上色**：`renderTo` 之后若拿到的是纯文本，就把这一格做成胶囊；若拿到的是标签（`.tag`），
  就让每个标签各拿自己的颜色、整行改为换行；其余（链接、日期）**原样不动** —— 它们已经是链接色了。
- **列头是一枚标签，但「No value」不是。** `No value` 和 `All notes` 命名的是「没有值」这件事，
  给它们上色等于宣称一个它们并不具备的含义。
- 胶囊的 padding 与圆角直接读 Obsidian 的 `--tag-padding-*` / `--tag-radius`，所以「真的是标签」
  和「长得像标签」两种值出来是同一个尺寸。

离屏对照：`/tmp/lattice-preview/gen.py` 把看板的真实 DOM 复刻成静态页，挂上仓库里真正的
`styles.css`，只桩掉 Obsidian 的主题变量（值是从 `obsidian.asar` 里抽出来的真值），再用无头
Chrome 出图并量尺寸。上表那几个数字就是这么来的，不是估的。

## 卡片上的描述

卡片在标题下面显示笔记的**正文第一段**，**最多两行，超出打点**。

Bases 给不出正文。它能给的属性只有三种来源 —— `note.*`（frontmatter）、`file.*`（文件元数据）、
`formula.*`（.base 里算出来的），**没有一种是笔记正文**。所以要像 wolai 那样在卡片上带一句摘要，
只能自己去读 markdown：

- **取哪一段**：跳过 frontmatter、标题、代码块（连内容一起）、表格行、HTML / `%%` 注释、
  callout 的 `> [!note]` 头；从第一行**散文**开始，到空行或下一个结构行为止。
- **剥掉行内语法**：加粗 / 斜体 / `~~删除线~~` / `==高亮==` / 行内代码 / `[文字](url)` /
  `[[目标|别名]]`（取别名）/ `![[嵌入]]`（整段去掉）。**剥不掉的语法就原样留着** —— 一条读起来
  有点怪的描述，也好过一张空白卡片。
- **段内换行按一个空格连接**，因为 Markdown 渲染器就是这么处理段内换行的：摘要读起来和笔记一样。
- **纯函数**：`src/bases/description.ts`，输入 markdown 输出一段文本或 `null`。看板本身没法在
  测试里跑，这段可以 —— 见 `description.test.ts`。

**两行是 CSS 裁的**，不是数出来的：`-webkit-line-clamp: 2` + `overflow: hidden`，超出的部分被
裁掉并由浏览器补上省略号。实测（离屏，240px 列宽）：

| 描述 | 描述元素高度 | 卡片高度 |
| --- | --- | --- |
| 没有正文可摘要 | —— （不渲染这一行） | 71.5px |
| 一行 | 18px（1 × 行高） | 97.1px |
| 长到溢出 | **36px（2 × 行高）** | 115.1px |

**异步回填，而不是先占位。** 读正文是异步的（`vault.cachedRead`），而 `render()` 是同步的。
描述元素是**文本到了以后才插进去**的 —— 不能先插一个空 div 等着，因为 flex 的 `gap` 对零高元素
照收，卡片会为「什么都没说」白变高 4px。迟到的回答靠一个**渲染世代号**判断自己是不是过期了
（重绘已经把它要写进去的那个元素换掉了）。

**读了就记住**，按 `path` 存，用 `mtime` + `size` 校验，所以改完笔记会自动重读；**「读了没内容」
也记住**，否则每次重绘都要为一无所获再读一遍盘。

**顺带修掉一个列宽 bug。** 量测时发现一条长 URL（没有空格可断）会把整列从 240px 撑到 **740px**：
`flex: 0 0 240px` 挡不住它，因为 flex item 的自动最小尺寸是**内容**的，会盖过 flex-basis。
两处修：`.lattice-column` 补 `min-width: 0`（列宽就是 240px，到此为止），描述用
`overflow-wrap: anywhere`（`break-word` 不算进最小尺寸，`anywhere` 算）。

视图配置里有 **Show note description**（`latticeShowDescription`，默认开）—— 一个全是「标题 +
一句话」的 vault 可以关掉它。

## 怎么试

```bash
npm run build
npm run deploy -- <vault-path>
```

然后在 Obsidian 里：

1. 把 `examples/lattice-board.base` 拷进 vault 任意目录，打开它。视图类型已经写成 `lattice-board`。
2. 若显示的不是看板，用视图右上角切换到 **Lattice board**。
3. 打开视图配置菜单，在 **Group by** 里选一个属性（比如 `status`）。列会按该属性的值分出来。
4. **点一张卡片**：笔记应该出现在**右侧边栏**，边栏自动展开，而主区域的看板**原封不动**。
   再点另一张卡片，确认是**替换**抽屉里的内容，而不是又堆一个面板。
5. **Cmd/Ctrl + 点卡片**：这次应该是主区域里的新标签页。
6. 把一张卡片拖到另一列，然后去看那个笔记的 frontmatter —— 分组属性的值应该已经改了。
   **同时确认其他列没有挪位。**（这是上一轮修的 bug：列顺序原本会被卡片拖拽重排。）
7. 拖到 **No value** 列会删掉该属性。
8. **拖列头最左的手柄**左右移动：目标位置应该出现一条强调色竖线，松手后列落到那一侧。
   再拖列里的一张卡片，确认只动了卡片、没动列。
9. 列头的 **…** 菜单里试 Move left / right / start / end，看列的左右位置是否真的变了，再打开 `.base` 文件确认 `latticeColumnOrder` 被写了进去。
10. 列头的 **+** 新建一张卡片，确认新建的笔记 frontmatter 里已经带上本列的分组值。
11. 列头的 **… → Delete column**，确认弹窗讲清了「不修改任何文件」，确认后该列消失。
12. **试着「放大」抽屉**：把右侧边栏里那个 tab 拖到主区域，看它是否变成主区域的标签页。
    若拖不动，说明这条路依赖的原生行为不成立，「放大」就只能靠 Cmd/Ctrl + 点卡片。
13. **看颜色**：列头应该是一枚带颜色的标签，卡片上的属性值也是，同一个值在两处颜色相同；
    `No value` 列应该是**没有颜色**的。再切换一次明暗主题，确认两边都读得清。
14. **看描述**：卡片标题下面应该是这篇笔记的**第一句正文**。找一篇正文很长的笔记，确认它
    **停在两行**、第二行末尾有省略号；再找一篇正文只有标题、没有正文的，确认卡片上**没有**
    空着的一行。在视图配置里把 **Show note description** 关掉，描述应该整体消失。

```bash
npm test        # 描述提取的纯函数断言（node:test + esbuild，无第三方框架）
```

## 已验证 / 未验证

静态验证（全部通过）：

- `npm run build` —— 类型检查 + 打包通过，说明所有 API 签名都对得上
- `npm run lint` —— 0 error
- `npm run check:manifest` —— 全绿
- `npm test` —— `description.test.ts` 的 **30 条**断言全过。运行器是 `scripts/test.mjs`：把
  `src/**/*.test.ts` 用 esbuild 打成 ESM 丢进临时目录，再 `node --test` 跑；不引第三方框架。
- `grouping.ts` 的纯函数跑过一组一次性断言（**115 项**：分组、移除、显式顺序、`moveColumn` 的边界、
  `reorderByDrop` 的全部 32 种落点 + 8 个手算用例、`columnKey` / `writablePropertyKey`）。
  那批断言写在 repo 外的 `/tmp`，**还没搬进新运行器**。
- 列顺序不随卡片变动的结论，是先写脚本跑出来才改的代码（`/tmp/lattice-drag-proof.ts`）：
  确认 `Backlog→Done` 会让列顺序从 `[Backlog, Doing]` 变成 `[Done, Doing, Backlog]`。
- 卡片密度与标签颜色用离屏渲染量过（`/tmp/lattice-preview/`）：真实 `styles.css` + 复刻的 DOM +
  `obsidian.asar` 里抽出的主题变量，无头 Chrome 出图并读回 `getBoundingClientRect`。深浅两个主题
  各出一张图。上表那四个数字来自这次测量。
- 描述的两行截断与列宽同一次量过（`/tmp/lattice-desc/`）：4 张卡分别「无正文 / 一行 / 中文长文 /
  英文长文 / 长 URL」，读回的元素高度是 18px 与 **36px**（= 1 × 与 2 × 行高），出图确认第二行末尾
  有省略号、长 URL 不再撑宽列。

**未验证，需要真机确认**（我这边跑不了 Obsidian）：

- `containerEl` 的生命周期。`onDataUpdated` 每次都整个重建 DOM，如果 Bases 在编辑过程中触发更新，正在输入的内容可能被吞掉。
- `Value.renderTo` 在窄卡片里的观感（长值会不会撑破）
- 拖拽手感。我用的是 HTML5 原生 drag & drop，Obsidian 自己有拖拽体系，两者在 `obsidian.md` 里的表现要实测。
- **拖列时 `setDragImage(columnEl, ...)` 是否被正常快照。** 用它是为了让拖拽影像跟着整列而不是
  那个 16px 的图标走。若 Electron 下影像不对，退路是让整个列头当拖拽起点。
- **`dragover` 期间 `dataTransfer.types` 是否稳定带着自定义类型。** 两种拖拽的路由全靠它 ——
  拖拽进行中数据不可读，只有类型可读。若不稳，退路是记在视图实例上。
- **`config.set` 是否真的持久化 —— 已证实（2026-10-02）。** 测试 vault 里的 `lattice-board.base`
  已经出现了 `latticeColumnOrder: [Backlog, Doing, Done, Blocked]`，而这个 key 从没被手写进去过。
  顺带看到 Obsidian 会把 `.base` 重新序列化（自己加回去 `type: table/cards/list` 那几个视图，
  并把 `note.priority` 规范成 `priority`）—— 所以别拿「文件里长什么样」当代码写入了什么的证据，
  要看 key 在不在。剩下待确认的是**重开视图后顺序是否还在**。
- **列头按钮的点击会不会穿透到列本身。** 用了 `stopPropagation`，未实测。
- **抽屉是不是真的只占一个 leaf。** 连点几张卡片应始终是同一个面板；用户手动关掉抽屉后再点卡片，
  应该正常回落（`iterateAllLeaves` 判存活），而不是对着一个已销毁的 leaf 白开一次。
- **`revealLeaf` 会不会把主区域的焦点抢走。** 它会把那个 leaf 置为 active。若结果是看板失焦、
  键盘操作被打断，退路是改成只对 `workspace.rightSplit` 调 `expand()`。
- **把侧栏 tab 拖到主区域是否可行**（「放大」依赖这条原生行为）。若不成立，需要另找放大入口 ——
  比如把抽屉换成 Lattice 自己注册的视图，好让抽屉里能放一个放大按钮。
- **描述会不会因为「读正文」而变慢。** 一面 50 张卡片的看板首次渲染会并发发起 50 次
  `vault.cachedRead`。缓存让它只在首次和改动后发生，但**首次进入一个大看板的手感要实测** ——
  不行的话退路是排队读（一次读几张）。另外 `file.stat` 的 `mtime` / `size` 是否真的会在
  `processFrontMatter` 之后立刻更新，也要确认：不更新的话，改完笔记描述会旧到下次重开视图。
- **两行截断在真机字体下的观感。** 量测用的是桩出来的 `--font-ui-smaller: 12px` 与
  `--line-height-normal: 1.5`；真机若主题改了这些值，两行的高度会跟着变，需要确认卡片不至于
  变得太高。

## 发现清单

1. **`groupBy` 会和核心 Bases 撞 key。** 官方 Bases 语法里，view 级本来就有 `groupBy`、`order`、`filters`、`summaries`、`limit`，文档明确要求插件视图不要占用核心已用的键。所以 Lattice 的配置键统一加了前缀：`latticeGroupBy`、`latticeShowPropertyNames`、`latticeShowDescription`。**不要**改回裸名。
2. **`App.renderContext` 是渲染 Value 的入口**（`@since 1.10.0`）。原以为 `RenderContext` 类体空、没有公开构造途径，实际 Obsidian 在 `App` 上放了一个现成的，直接传就行。
3. **`QueryController` 类体为空。** 视图拿不到查询控制权：读不到也改不了 Bases 的 `groupBy` / `filters` / `sort` 原始配置。这是「必须自己分组」的根本原因。
4. **`BasesView.data` 会被整体替换**，其中 `BasesEntry` 也会被重建，官方注释明确说视图不得持有引用。做乐观更新时要留意。
5. **多值属性的分组还没有解。** `tags: [a, b]` 经 `toString()` 会变成一个字符串 `a, b`，于是整张卡片只落进一个列，而不是同时出现在 `a` 和 `b` 两列。这需要一个明确的取舍。
6. **`BasesView.type` 用 getter 而不是类字段。** 类字段要等 `super()` 返回后才赋值，而 Obsidian 可能在那之前读 `type`。
7. **`minAppVersion` 一路抬到 1.10.2。** 不是选择而是硬约束：先是整个 Bases API `@since 1.10.0`（lint 的 `no-unsupported-api` 在 Bases 代码上报了 **25 处**，`eslint-disable` 压不住，真机也会崩），后来列头的 `+` 要用 `createFileForView`，那是 `@since 1.10.2`。
8. **列顺序是数据推导的，所以拖卡片会重排列**（见上面那节）。根因是「按取值第一次出现的顺序」，
   而拖拽改的正是那个取值。修法是记住上次绘制顺序，而不是改成按名字排序 —— 后者稳定但会
   丢掉 Bases 排序的语义。
9. **`instanceof HTMLElement` 会被 `obsidianmd/prefer-instanceof` 拦下。** 要改用节点自带的
   `el.instanceOf(HTMLElement)`：它跨窗口安全（弹出窗口里的节点也认），`instanceof` 不认。
10. **列不能只靠 `dataset.value` 找回身份**（本轮差点写错）：无值列的 key 是空字符串，
    所以「`getData` 返回空串」既可能是「没有数据」也可能是「拖的是无值列」。
    调用点先用 `dataTransfer.types` 确认类型存在，再读数据，就不会把后者误判成前者。
11. **`WorkspaceItem` 没有公开的 `id` 属性**，所以 `Workspace.getLeafById(id)` 这个 API 实际用不上
    —— 它需要一个我们拿不到的字符串。想在侧栏里稳定复用**自己那一片**面板（而不是顶掉用户的），
    只能自己记住 `WorkspaceLeaf` 引用，再用 `workspace.iterateAllLeaves`（`@since 0.9.7`）确认它还活着。
12. **胶囊要做在值的那一格上，不能做在它里面的 inline 子元素上。** `.lattice-card-row-value` 带
    `overflow: hidden` 做文本截断，而 inline 元素的 padding 是画在**自己的行盒之外**的 —— 挂在内层
    会被外面直接裁掉一截。所以纯文本值是把这一格本身变成胶囊；标签值本来就各是一个 border-box，
    才可以直接上色。
13. **Obsidian 的 `--tag-*` 是一组公开可读的变量**（`--tag-radius: 2em`、`--tag-padding-x: 0.65em`、
    `--tag-padding-y: 0.25em`、`--tag-color` / `--tag-background` 及其 hover 版本）。胶囊直接借这几
    个度量，才能让「真的是标签」和「长得像标签」的两类值尺寸一致；重配色也只需覆写 `--tag-color` /
    `--tag-background`，Obsidian 自己的胶囊规则会把其余部分处理好。
14. **`flex: 0 0 240px` 不等于「宽度就是 240px」。** 量描述的时候撞上的：一条没有空格的 URL 把
    整列撑到 **740px**。原因是 flex item 的 `min-width: auto` 会取**内容的最小尺寸**，而它盖过
    flex-basis —— 内容比 240px 宽，列就跟着宽。一行 `min-width: 0` 就够（`.lattice-column`）。
    相邻的一个坑：`overflow-wrap: break-word` **不算进**最小尺寸，`anywhere` 才算，
    所以那种长 token 要用后者。属性值之所以一直没事，是因为 `.lattice-card-row-value` 有
    `overflow: hidden`（非 visible 的溢出会把自动最小尺寸直接归零）。
15. **描述只能自己去读正文。** Bases 的属性来源只有 `note` / `formula` / `file` 三种，**没有正文**；
    `BasesEntry` 只有 `file` 和 `getValue()`。所以这个功能绕不开 `vault.cachedRead`，也绕不开异步
    回填（`render()` 是同步的）。

## 下一步（按 wolai 差异点排序）

1. **列的手动管理** —— 顺序与移除已做（见上）。还差 **新增／预置空列**：把一个还不存在的值插进
   列列表（从 `latticeRemovedColumns` 里去掉、再插进 `latticeColumnOrder`）。
2. **子分组泳道** —— Bases 完全没有这个概念，也是差异化里最硬的一张牌。
3. **列底虚线的「+ 新增」** —— 列头那个 **+** 已经做了（走 `createFileForView` 并预填分组值，
   `minAppVersion` 也因此停在 1.10.2）。还差 wolai 那种「每列底部一条虚线 +」的入口，是同一套东西的第二个位置。
4. **列头颜色映射** —— 已做：列头与卡片上同一个值共用同一个颜色（见「卡片的样子与标签的颜色」）。
   还差 wolai 的「跟随单选标签色」那一层：现在颜色由值文本哈希决定，而不是读用户在属性选项里
   配的颜色。等 Bases 的属性选项能带颜色，或者我们自己加一份配色设置时再接。
5. **拖拽补完** —— 列之间已经能拖（手柄起拖 + 竖线落点）。还差**列内排序**：卡片在列里的先后，
   以及排序结果的持久化（frontmatter 属性）。
