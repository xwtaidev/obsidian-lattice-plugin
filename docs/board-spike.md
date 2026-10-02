# Lattice 看板 spike（Bases 路线）

## 这个 spike 要回答什么

一句话：**Bases 能不能承载 wolai 式的看板，还是必须自己写数据层。**

结论：**能**。代价是 `minAppVersion` 一路抬到了 **1.10.2**（`createFileForView` 的门槛）；有一处必须绕开的坑，见下面的发现清单第 1 条。

## 实现

| 文件 | 职责 |
| --- | --- |
| `src/bases/register.ts` | 注册 Bases 视图，声明三个视图配置项（Group by / Show property names / Show note description） |
| `src/bases/lattice-bases-view.ts` | 视图本体：列头、卡片、两种拖拽、列菜单、新增列、描述的异步回填 |
| `src/bases/grouping.ts` | 分组、列顺序/移除/新增/重排、写回规则，纯函数、无 DOM 无副作用，可直接单测 |
| `src/bases/description.ts` | 从笔记正文里取出卡片要显示的那一段，纯函数，可单测 |
| `src/bases/value-colors.ts` | 一个值一种颜色，颜色取自 Obsidian 自己的八色 |
| `src/ui/confirm-modal.ts` | 二次确认弹窗（Obsidian 公开 API 里没有 confirm） |
| `src/ui/text-prompt-modal.ts` | 问一行文字的输入弹窗（同上，公开 API 里没有 prompt）；可选现成答案胶囊也在这里 |

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
| `latticeAddedColumns` | 手动新增的列，空着也在 |

三个刻意的选择：

- **用户没动过列之前，这三个 key 一个都不写。** 列完全由数据推导，于是不存在「顺序列表与数据不同步」
  这种状态。顺序列表只在用户真正移动过列之后才存在，值没被它提到的列一律排在后面。
- **删除列 = 从本视图移除，不写任何笔记。** 确认弹窗里把这一点说明了，也说明了怎么恢复。
  顺序列表**刻意不改**，所以将来把列加回来时，它回到用户原先摆的位置，而不是末尾。
- **「有没有这一列」和「这一列排在哪」是两个列表。** 顺序列表只描述排列，不制造列 ——
  否则一份曾经画过、后来取值消失的列会被永远留在板上。列的存在由 `latticeAddedColumns` 说了算。

`columnKey(value)` 是列的身份：`null`（无值列）存成空字符串。真实的空字符串值会和它撞身份 ——
可以接受，因为两者对用户本来就是同一列。

**无值列的名字来自界面语言，不由数据决定。** 它代表「没有值」，没有哪篇笔记会拼出这个词，所以
`deriveColumns` 拿不到它 —— 由调用方通过 `ColumnNaming` 传进来：中文界面是 `未分组`，其余是
`Ungrouped`（核心自己的分组标题对同一列说的是 `None`）。另一半是**什么算「没有值」**：
`BasesEntry.getValue` 对缺失的属性返回的不是 `null` 而是一个 `NullValue` 对象，`toString()` 就是字符串
`"null"` —— 直接采信那段文本，这些笔记就会得到一个名为 `null` 的列（详见「发现清单」第 20 条）。
这个判定同样由调用方以 `MissingValue` 传进来（`grouping.ts` 因此保持零 App 依赖，可以在 node 里跑）。
两个参数都留了「没有 App 可问」时的默认值（`No value` / 纯 `null` 判定），**只有看板视图显式传**。

「+」按钮走 `BasesView.createFileForView(name?, fmProcessor?)`，弹出的是 **Obsidian 自己的新建笔记菜单**，
文件夹与模板都继承仓库设置 —— 插件里因此不需要再放一份 folder/template 配置。

## 新增列

列本来是「数据的影子」：没有笔记带这个值，就没有这一列。可看板是要往里放东西的地方 ——
**空的「Blocked」正是它存在的理由**，而一个还没有笔记带过的取值，根本没有地方放下第一张卡片。
所以最后一列之后有一个 **Add column**：

| 点什么 | 发生什么 |
| --- | --- |
| Add column（按钮） | 直接弹出「输一个名字」的弹窗，名字就是分组属性的取值，该列插在最右 |
| 弹窗里的 `Restore "X"` | 把之前删掉的列加回来（只在它还找得到名字时出现） |

- **按一下就是弹窗，中间没有菜单。** 早先这一下先弹菜单（`Add column…` / `Restore "X"`），
  但菜单里通常只有一项 —— 按钮按下就是想加一列，先问一次「你想干什么」只是把问题推后。
  现在「恢复」作为现成答案排在**弹窗里面**：一次点击的路径只有一条，而删除仍然撤销得了。

- **名字就是值。** 列头显示的就是这个名字，拖进去的卡片 frontmatter 就写这个值，
  「+」新建的卡片也预填它 —— 和任何别的列没有区别。写进 `latticeAddedColumns` 之后，
  即使一张卡片都没有，它也留在板上。
- **只有能写的属性才有这个按钮。** `file.name` 和 `formula.*` 是派生值，建出来的列永远填不上，
  所以那两种分组下不显示按钮（和卡片拖不进去是同一件事）。
- **删除与新增是对称的。** 新增要把该值从 `latticeRemovedColumns` 里划掉，否则刚加就被过滤掉；
  删除**不动** `latticeAddedColumns`，理由和不动顺序列表一样 —— 加回来的列该回到原来的位置。
  两个列表同时有一个值时，**删除赢**（后发生的意愿）。
- **删除是能撤销的，而且不用去改文件。** 「…→ Delete column」之后，Add column 弹窗里会出现
  一枚 `Restore "X"` 胶囊，按下去整个弹窗就以那个名字作答。在这之前恢复列的唯一办法是手动编辑
  `.base` 文件 —— 确认弹窗当时就是这么教用户的。
  只列**还找得到名字**的列：笔记全都不带这个值、又不是手动加的列，就没有名字可报。
- **`Restore` 是「一整个答案」，不是把名字填进输入框。** 填进去还得再按一次 `Add column`（按钮
  上写的还是「加一列」），等于把动作叫错名。所以点它直接关闭弹窗并作答。
- **名字重复不会静默失败**：输入的取值已经在板上时，弹一条 Notice 说明，
  而不是关掉弹窗、什么也没发生。
- 名字空着时确定按钮是灰的；回车提交，Esc / 点外面取消。

`restorableColumns()` 和 `buildColumns()` 都是 `grouping.ts` 里的纯函数，规则在 `grouping.test.ts` 里钉住。

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
- **胶囊 = 标签的整套配方，不只是间距。** 一个标签的 `font-size` 是 `--tag-size`（`0.875em`，
  所以同一个标签在卡片行里是 10.5px、在列头里是 11.4px —— **它是相对所在位置**的）、
  `line-height: 1`、字重继承、padding 用 `--tag-padding-*`、圆角 `--tag-radius`。
  只借 padding 与圆角的话，胶囊会用自己的 12px 字号和 500 字重画出来，得到一枚**比旁边的标签
  大一整号**的胶囊（实测高 21.59px vs 15.75px，字号 12 vs 10.5）。所以这一条 CSS 里
  两件事一起改：`.lattice-label`（= 列名）和 `.is-chip`（= 卡片上的值）共用同一套配方。
- **日期是值，不是输入框。** `DateValue.renderTo` 画的是一个 `<input type="date/datetime-local">`，
  而 Obsidian 只在它自己的值容器上（`bases-cards-line`，带 `bases-rendered-value` 类）把输入框
  的边框、底色、最小高度去掉。Lattice 早先把值渲染进一个裸的 span，于是卡片上出现了一个带边框的
  输入框。现在这一格也戴上 `bases-rendered-value`，日期就是一行普通数字（实测：同一个 input
  27px 高带边框 → 17px、无边框、透明底，整行高度和一行纯文字相同）。
  **但字号还得自己说。** 表单控件不继承所在位置的字号 —— 它留着 Obsidian 给「正在输入的字段」
  定的那一档（本机 13px），而卡片行的值是 12px（`--font-ui-smaller`）。于是同一张卡上，日期是
  唯一比别的值大一号的，也是唯一会被裁掉尾巴的那个。一行 `.lattice-card-row-value input
  { font-size: inherit }` 就够（实测 13px → **12px**，input 高 17px → 16px，整行仍是 18px）。
  字体族与字重不用管：量下来 input 与旁边的值本来就用同一套字体栈、同为 400。

离屏对照：`/tmp/lattice-preview/gen.py` 把看板的真实 DOM 复刻成静态页，挂上仓库里真正的
`styles.css`，只桩掉 Obsidian 的主题变量（值是从 `obsidian.asar` 里抽出来的真值），再用无头
Chrome 出图并量尺寸。上表那几个数字就是这么来的，不是估的。

**后来发现只桩主题变量是不够的**，量弹窗、按钮、日期这类要过 Obsidian 自己组件样式的东西时，
得把 asar 里的 `app.css` 整个挂上（见「已验证」一节）—— 少了它，量出来的按钮高度是假的。

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
12. **最右端的 Add column**：**按一下就应该直接弹出输入弹窗**（中间没有菜单）。输一个还没有笔记用过
    的值（比如 `Blocked`）。板上应该多出一列、里面一张卡也没有，按钮和列名在同一条线上；
    再打开 `.base` 确认 `latticeAddedColumns` 写了进去。
13. **往新列里放东西**：拖一张卡片进去，那篇笔记的 frontmatter 应该拿到这个值；再点该列的 **+**
    新建一张，确认新建的笔记也预填了它。**然后把卡片拖出去** —— 这一列应该还在（手动加的列不会
    因为空了就消失），而普通列在最后一张卡片离开后会跟着消失。
14. **撤销删除**：再点 Add column，弹窗里应该有一枚 `Restore "…"` 胶囊（就是上一步删掉的列），
    点它弹窗应当**立刻关闭**（不用再按 Add column）。列回来，并且回到它原来的位置，而不是末尾。
15. **试着「放大」抽屉**：把右侧边栏里那个 tab 拖到主区域，看它是否变成主区域的标签页。
    若拖不动，说明这条路依赖的原生行为不成立，「放大」就只能靠 Cmd/Ctrl + 点卡片。
16. **看颜色**：列头应该是一枚带颜色的标签，卡片上的属性值也是，同一个值在两处颜色相同；
    `No value` 列应该是**没有颜色**的。再切换一次明暗主题，确认两边都读得清。
    **同一行里的胶囊要和标签（tags）一模一样大** —— 高、字号、内边距、圆角、字重都相同，
    和 `等级` 这类纯文字的值对齐在同一条基线上。
17. **看日期**：`创建时间` 这类属性应该是**一行普通数字**（`2026/10/01 22:00`），
    **不是一个带边框的输入框**，也不比别的行高，**字号和同一行里别的值一样大**。
    若又出现了边框，检查那一格有没有 `bases-rendered-value` 类；若字比别的值大一号，
    说明表单控件的默认字号又漏出来了。
18. **看描述**：卡片标题下面应该是这篇笔记的**第一句正文**。找一篇正文很长的笔记，确认它
    **停在两行**、第二行末尾有省略号；再找一篇正文只有标题、没有正文的，确认卡片上**没有**
    空着的一行。在视图配置里把 **Show note description** 关掉，描述应该整体消失。
19. **看「Add column」的位置**：它的文字应该和第一列的列名**在同一条线上**（不是高半行）。
20. **看属性白名单**：打开视图配置里的 **Group by** 下拉，里面应该**只有自定义属性、公式，加上
    创建时间 / 修改时间** —— 路径、扩展名、文件夹、大小、反向链接这些内置 file 属性不该出现。
    再打开工具栏那个**属性菜单**：内置文件属性应该已经从列表里**消失**（只剩自定义属性、公式、
    创建时间 / 修改时间）。在菜单的搜索框里输入文字后，列表会被核心按搜索词重建 —— 这时我们
    不插手（搜索本身已经把列表筛短了）。随便勾一个内置文件属性（比如「文件大小」），卡片上也不会
    因此多出一行。注意 `.base` 里 `order` 已经写成 `note.tags` / `file.ctime` / `file.mtime`，
    所以卡片上是这三行。
21. **看属性菜单的键盘**：核心的选中是**按索引**走的（`moveDown` = `selectedItem + 1`，不看元素
    可不可见），所以被我们藏掉的项仍然占着位置 —— 用 ↑/↓ 翻的时候高亮会有几跳「看不见」。
    鼠标点击不受影响；在搜索框里输入后再用 ↑/↓ 也不受影响（那时列表里没有被藏的项）。
22. **看无值列**：新建一张卡片，**不要**给它选分组属性（或者直接把一张卡的属性删掉）。它应该落进
    最右边那一列，列头写着 **`未分组`**（中文界面；英文界面是 `Ungrouped`），而不是 `null` ——
    而且它**不是**一枚胶囊（没有值的列不该有颜色）。把这张卡往别的列拖，属性会被写上；
    往这一列拖，属性会被**删掉**。卡片上那一格没值的属性行应该显示 `—`。
23. **看工具栏**：看板视图的工具栏上，**排序**和**筛选**两个按钮应该不见了（它们对看板没有意义，
    等板子自己支持了再放回来）；**视图**、结果计数、**属性**、**新建**都还在，位置和以前**完全一样**
    （不留空洞）。把同一个 `.base` 切到**表格**视图，这两个按钮应该**回来** —— 规则只挂在看板上。
24. **看「添加视图」**：在**看板**里点工具栏的视图按钮，菜单底下那一项（`+ 添加视图`）点下去。
    应该**直接多出一个看板视图**（叫 `Board`、`Board 2`……），并且**当前视图已经切到它** ——
    不会出现核心那个「配置视图」页，更不会多出一个**表格**视图。反复点几次，名字应该往后数。
    注意这只在看板的工具栏里成立：把同一个 `.base` 切到**表格**视图再点，加出来的仍是表格视图
    （那是核心自己的行为，我们没有接管）。

```bash
npm test        # 纯函数断言（node:test + esbuild，无第三方框架）：描述提取 + 列的分组规则 + 属性白名单 + 视图命名
```

## 已验证 / 未验证

静态验证（全部通过）：

- `npm run build` —— 类型检查 + 打包通过，说明所有 API 签名都对得上
- `npm run lint` —— 0 error
- `npm run check:manifest` —— 全绿
- `npm test` —— **90 条**断言全过（`description.test.ts` 30 条 + `grouping.test.ts` 48 条 +
  `board-properties.test.ts` 3 条 + `property-menu.test.ts` 4 条 + `view-menu.test.ts` 5 条）。运行器是
  `scripts/test.mjs`：把 `src/**/*.test.ts` 用 esbuild 打成 ESM 丢进临时目录，再 `node --test` 跑；
  不引第三方框架。`grouping.test.ts` 收的是原先躺在 `/tmp` 的那批一次性断言（分组、移除、显式顺序、
  `moveColumn` 的边界、`reorderByDrop` 的全部 32 种落点）加上新增列的新用例 —— **`/tmp` 那份已经搬空**。
- 列顺序不随卡片变动的结论，是先写脚本跑出来才改的代码（`/tmp/lattice-drag-proof.ts`）：
  确认 `Backlog→Done` 会让列顺序从 `[Backlog, Doing]` 变成 `[Done, Doing, Backlog]`。
- 卡片密度与标签颜色用离屏渲染量过（`/tmp/lattice-preview/`）：真实 `styles.css` + 复刻的 DOM +
  `obsidian.asar` 里抽出的主题变量，无头 Chrome 出图并读回 `getBoundingClientRect`。深浅两个主题
  各出一张图。上表那四个数字来自这次测量。
- 描述的两行截断与列宽同一次量过（`/tmp/lattice-desc/`）：4 张卡分别「无正文 / 一行 / 中文长文 /
  英文长文 / 长 URL」，读回的元素高度是 18px 与 **36px**（= 1 × 与 2 × 行高），出图确认第二行末尾
  有省略号、长 URL 不再撑宽列。
- **Add column 的位置量过一次，但那次工装是错的 —— 已改正。** 见下面「一次假通过」。
- **Add column 弹窗的胶囊量过**（`/tmp/lattice-prompt/`）：这次把 `obsidian.asar` 里真正的
  `app.css` 也接了进来（不只是主题变量），DOM 也按 `TextPromptModal` 的建法**逐个节点生成**
  （不是写 HTML —— 标签之间换行产生的空白文本节点会进 flex 布局，第一版就是这么量出偏差的）。
  读回：胶囊 **23.5px** 高、半径 26px（≥ 高度一半 ⇒ 是胶囊）、字号 13px = `--font-ui-small`
  （和列名那枚 23.4px 的胶囊同度量），明显矮于弹窗自己的 30px 按钮；长列名在胶囊内部换行，
  宽 349px 仍留在 526px 的内容区里。**10 条断言**在深浅两个主题下全过。
  顺带量到一条一直存在的事实：**Obsidian 的全局 `button` 规则把每个按钮钉在
  `height: var(--input-height)`（本机 30px）**，所以按钮上的纵向 padding 是无效的 —— 胶囊要矮下来
  只能显式 `height: auto`。
- **一次假通过。** `/tmp/lattice-add/` 那次只桩了主题变量、没挂 `app.css`，于是 Obsidian 的
  `button { height: var(--input-height) }` 不在场，「Add column」被撑成 41.4px 高，它的文字**恰好**
  和列名同线 —— 5 条断言全绿。这次把整张卡（列头 + 卡片 + 四种值）搬进 `/tmp/lattice-chip/`
  并挂上真的 `app.css` 之后，同一个位置量出的是：按钮 **30px**（Obsidian 钉的高度）、文字被居中，
  于是比列名**高 5.7px**。修法 `.lattice-add-column { height: auto }`，现在两者盒子相同
  （`top: 32 / height: 19.5`，两个主题都是）。**教训：量「Obsidian 会怎么画」时，只桩变量不够。**
- **从属性菜单里去掉内置 file 属性 —— 第一次没生效，原因是「同一个类挂在两个元素上」。** 菜单是核心
  `bases` 画的：项是 `.bases-toolbar-menu-item`、file 类型的项被 `toggleClass("mod-implicit", "file"===u)`
  标出来、名字节点是 `.bases-toolbar-menu-item-name`，文本来自 `config.getDisplayName`（所以不写死
  任何中文）。但 `bases-toolbar-properties-menu` 这个类，`HY.addClass` **同时加给了工具栏按钮和菜单
  本体**：

  ```js
  e.prototype.addClass = function (e) {
    this.button.addContainerClass(e);   // <div class="bases-toolbar-item bases-toolbar-properties-menu">
    this.menu.menuEl.addClass(e);       // <div class="menu bases-toolbar-menu bases-toolbar-properties-menu">
  };
  ```

  而菜单本体是 `setOpen` 时 `body.appendChild(menuEl)` 追加进去的 ⇒ 它在文档顺序上排在**按钮之后**。
  第一版用 `document.querySelector('.bases-toolbar-properties-menu')`，取到的**永远是工具栏按钮**；
  按钮子树里一个菜单项都没有，于是「两个时间都不在列表里」那道保险被触发，整个菜单原样不动 ——
  看起来就像补丁根本没跑。现在改成**从菜单项自己往上 `closest('.menu')` 分组**，不再关心哪个元素
  带类（顺带把菜单身份判断完全交给保险：同时列出创建时间与修改时间的那张列表，就是属性菜单）。
  样式侧的账也核过：核心 `.bases-toolbar-menu-item` 只有 `display: flex`（特异度 0,1,0），我们的
  `.bases-toolbar-menu-item.lattice-hidden-property`（0,2,0）压得住，整份 `app.css` 里没有会压回它的
  `!important`。**排序菜单不会误伤** —— 它自建 DOM，用的是 `base-toolbar-sort-item` /
  `bases-sort-property`，`bases-toolbar-menu-item` 与 `mod-implicit` 出现 0 次。
- **工具栏上那两个按钮的隐藏量过**（`/tmp/lattice-toolbar/`）：真 `app.css` + 真 `styles.css`，
  按核心的建法复刻**两个**容器 —— 一个 `.bases-view.lattice-board`（看板），一个普通 `.bases-view`
  （对照组：同样宽、同样六个按钮，它就是「没被动过的工具栏长什么样」）。**18 条断言**在深浅两个主题
  下全过：规则确实加载、只挂着 `:has(~ .bases-view.lattice-board)`、两个按钮 `display: none` 且盒高为
  0、**在原位放探针（`elementFromPoint`）什么都点不到**、对照容器同一位置能点到按钮的文字节点（证明
  探针本身有效）、余下四个按钮仍在、看板工具栏可见项 **4** / 对照 **6**、留下来的按钮与对照容器
  **横向位置与尺寸逐个相同**、工具栏高度不变。把规则裁掉的那一版（`before.html`）**恰好失败 7 条** ——
  说明这些断言真的在测东西，不是在自证。
- **胶囊与标签同尺寸、日期不再是输入框，在 `/tmp/lattice-chip/` 里一起量过**：一张完整的卡片
  （列头 + 标题 + 描述 + 四行值：纯文本 `priority` / 数字 `等级` / `tags` / `创建时间`），
  真的 `app.css` + 真的 `styles.css`，深浅各一张图。改动前后：

  | | 之前 | 之后 |
  | --- | --- | --- |
  | 胶囊 `High` 高 | 21.59px | **15.75px** |
  | 标签 `task` 高 | 15.75px | 15.75px |
  | 胶囊字号 / 字重 | 12px / 500 | **10.5px / 400**（与标签逐项相同） |
  | 列名胶囊高 | 23.4px | 19.5px |
  | 日期那一行 | 27px、带 1px 边框的输入框 | **18px、无边框透明底**（与一行纯文字同高） |
  | 日期字号 | 13px（表单控件那一档） | **12px**，与同一行的其它值逐项相同 |

  **12 条断言**（胶囊与标签同高 / 各自在自己行里落位一致 / 字号 / padding / 圆角 / 字重相同、
  日期无边框无输入框底色、日期行与文字行同高、日期与同一行的值同字号且不是 13px、
  Add column 文字与列名同线）在两个主题下全过。

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
- **Add column 那条路只做过静态检查。** 按钮按下即弹窗（这一版把中间的菜单去掉了）、输入框的初始
  焦点、回车提交、空名字时确定键是灰的、弹窗里的 `Restore "…"` 胶囊按下去即以该名字作答 ——
  这些只有类型检查、lint 和离屏渲染保证，没在真机上点过。
- **属性菜单那层补丁，真实 DOM 我这边看不到。** 容器归属（类加在按钮 + 菜单两个元素上、菜单被
  `appendChild` 到 `body`）、`mod-implicit` 标记、项名节点，全部是从 `obsidian.asar` 抽出来的
  `app.js` 里逐行读出来的，静态推理成立，但没有在真机上肉眼确认过。要拿到真证据只有两条路：
  **① 让插件把菜单结构写进一个文件再回读**（需要点一次菜单）；**② 拿一个复制出来的测试库，
  用 `--remote-debugging-port` 起第二个 Obsidian 实例，走 CDP 读活 DOM**（不用碰用户正在用的那份）。
- **`setIcon` 出来的 svg 是否带 `--icon-size` 以外的尺寸干扰。** 离屏是照着手写的 svg 量的
  （14px 正确），真机上 `setIcon` 产物的 class 组合一致，理论上一样。
- **工具栏「兄弟关系」也是从源码读出来的**，同样没在真机上看过：`.bases-header` 与 `.bases-view`
  同属一个父元素、前者在前，是从 `app.js` 的构造顺序读出来的（离屏工装按这个结构复刻，量出来的
  是这套结构的自洽性，不是真机 DOM）。**失效方向是安全的** —— 哪天核心把 `.bases-view` 挪进一层
  包装，`:has(~ …)` 不再匹配，两个按钮就重新出现，不会误伤别处。
- **「添加视图」的接管同样没在真机上验过。** 菜单名（`.menu.bases-toolbar-views-menu`）、
  `has-active-menu` 落在工具栏上、行结构（`info-icon > svg.lucide-plus`）、搜索框是整个列表的
  重绘开关 —— 四条全部是从 `obsidian.asar` 抽出的 `app.js` 里逐行读的
  （`HY.prototype.addClass`、`zY.prototype.setOpen`、`r$.prototype.renderSuggestion`），
  静态推理成立，但没有在真机 DOM 上确认过。**失效方向是安全的**：四步里任何一步对不上就**整个
  放行**，回到核心原来的行为（加一个表格视图），不会留下半成品 —— 「切视图」那一步不自己实现，
  也是同一个理由。验证只需点一次 `+ 添加视图`。
- **`latticeAddedColumns` 是否真的落盘。** 走的是和 `latticeColumnOrder` 同一个 `config.set`，
  而后者已经在测试 vault 里被证实；这条只要点一次 Add column 再看 `.base` 就能确认。
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
    `--tag-padding-y: 0.25em`、`--tag-color` / `--tag-background` 及其 hover 版本）。重配色只需覆写
    `--tag-color` / `--tag-background`，Obsidian 自己的胶囊规则会把其余部分处理好。
    **但尺寸要靠整套配方，不能只借 padding**：`a.tag` 还写了 `font-size: var(--tag-size)`
    （= `--font-smaller` = `0.875em`，**相对所在位置**：卡片行里 10.5px、列头里 11.4px）、
    `line-height: 1`、`font-weight: var(--tag-weight)`（= inherit）、`border: 0`。
    只借 padding 与圆角，胶囊会用自己的 12px / 500 字重画出来，比旁边的标签**大一整号**
    （实测 21.59px vs 15.75px），这正是用户一眼看出来的那个差异。
14. **`Value.renderTo` 期望的宿主是 Obsidian 自己的值容器。** asar 里看得很清楚：
    `bases-rendered-value` 这个类**不是** `renderTo` 加的，而是视图建 `bases-cards-line` 时
    `el.addClass("bases-rendered-value")` 加的；它带来 `--input-border-width: 0`，以及
    `.bases-rendered-value input { background: transparent; padding: 0 }` 和
    `input[disabled=true] { min-height: 0 }`。**日期值渲染出来是一个 `<input type="datetime-local">`**
    —— 少了这个类，卡片上就是一只带边框的输入框（实测 27px 高、1px 边框、不透明底色）。
    把同一格也戴上这个类，它就是一行数字（17px、无边框、透明底），整行高度与纯文字行相同。
15. **Obsidian 的全局 `button` 规则钉死高度**：`button { height: var(--input-height) }`
    （本机 30px），**按钮上的纵向 padding 无效**，连空按钮也是 30px。想让按钮矮下来只能
    `height: auto`。这条还顺手暴露了一次错误的量测（见「一次假通过」）。
16. **`flex: 0 0 240px` 不等于「宽度就是 240px」。** 量描述的时候撞上的：一条没有空格的 URL 把
    整列撑到 **740px**。原因是 flex item 的 `min-width: auto` 会取**内容的最小尺寸**，而它盖过
    flex-basis —— 内容比 240px 宽，列就跟着宽。一行 `min-width: 0` 就够（`.lattice-column`）。
    相邻的一个坑：`overflow-wrap: break-word` **不算进**最小尺寸，`anywhere` 才算，
    所以那种长 token 要用后者。属性值之所以一直没事，是因为 `.lattice-card-row-value` 有
    `overflow: hidden`（非 visible 的溢出会把自动最小尺寸直接归零）。
17. **描述只能自己去读正文。** Bases 的属性来源只有 `note` / `formula` / `file` 三种，**没有正文**；
    `BasesEntry` 只有 `file` 和 `getValue()`。所以这个功能绕不开 `vault.cachedRead`，也绕不开异步
    回填（`render()` 是同步的）。
18. **列名是一枚胶囊，所以「Add column」要对齐的是胶囊里的文字，不是胶囊的盒子。** 第一版只把
    按钮的 padding 设成和列一样，量出来文字比列名**高 3.7px** —— 因为列名那枚胶囊自己还带
    `--tag-padding-y` 的上下内边距。做法是让按钮里的文字也戴上胶囊的纵向度量：
    `padding-block: var(--tag-padding-y)` + `line-height: 1`（和胶囊一样的行盒），量出来两者的
    盒子 top / height 完全相同。只借纵向，横向间距仍是按钮自己的。
19. **工具栏那个「属性」菜单不归插件管，插件能画的线在别处。** 那个菜单（搜索框「查找或创建…」、
    底部「添加公式」「全部隐藏」）由核心 Bases 渲染 —— i18n 键都在 `bases.*` 命名空间
    （`placeholderSearchProperty` / `actionAddFormula` / `actionHideAll`），按钮类名
    `.bases-property-visibility-button`。它列的是**全库可用属性的全集**：笔记里出现过的自定义属性、
    公式，加上内置的 file 属性（反向链接、文件名、创建时间、嵌入、扩展名、文件夹、完整文件名、链接、
    修改时间、名称、路径、大小、文件标签）。**没有任何 API 能裁剪这个列表** —— `BasesView.allProperties`
    只读，`registerBasesView` 只收声明式的 `options`；它勾选的结果就是 `config.getOrder()`。
    插件唯一能画的线是 **`BasesPropertyOption.filter`**（`@since 1.10.0`，官方注释写得很直白：
    *only properties which pass the filter will be included for selection in the property dropdown*），
    而它**只作用于视图自己的属性选择器**（我们的 `Group by`），碰不到核心菜单。
    所以 Lattice 把白名单抽成 `src/bases/board-properties.ts` 的 `isBoardProperty()`
    （`note.*` ∪ `formula.*` ∪ `file.ctime` / `file.mtime`），**两处共用**：`Group by` 的 `filter`，
    以及渲染卡片时对 `getOrder()` 的二次过滤。核心菜单里照旧列着路径和大小，但**勾了也不会出现在
    看板上**。用户后来明确要求「下拉框里不要看见」，于是又加了一层 DOM 补丁
    （`src/bases/property-menu.ts`，见「已验证 / 未验证」里那条，含它第一次没生效的原因）。
20. **`getValue()` 对「没有值」返回的是 `NullValue`，不是 `null`。** 这是本项目踩过的第二个「读错 API」
    的坑，表现是看板上出现一个名叫 `null` 的列：卡片没填分组属性时，笔记会落进一个标题写着 `null`、
    还带着胶囊配色的列。链条是 `entry.getValue(propertyId).toString()` —— `NullValue` 的
    `toString()` 就是字符串 `"null"`，被当成一个真实的取值。官方的判定方式在核心 `app.js` 里写得很
    清楚：分组时 `getValue(...) || NullValue.value`（**`NullValue` 是单例，文档要求用
    `NullValue.value` 而不是 new**），而「这一组有没有值」是 `hasKey() = !!key && !equals(key,
    NullValue.value)`；`BasesEntryGroup.hasKey()` 也是同一句。核心自己渲染空分组标题时用的是
    `Bases.labelGroupKeyNone()`，英文文案是 `None`。
    另外两条副产物：**`value === null` 这个判定在实践中几乎从不成立**（查询解析不出属性 id 时才可能
    是 JS 的 `null`），所以卡片行上那格 `—`（`.is-empty`）在修好之前一直是死代码 ——
    `getValue` 返回 `NullValue` 时走的是 `renderTo`，而它什么都不画。
    还有：**核心的语言包是「按行对齐的平铺文本」**（`obsidian.asar` 的 `i18n/*.txt`，英文即键、
    没有 en.txt），所以想查某个键的中文，得先知道它在键列表里的行号再取同行的 zh 文本；
    本轮没走通这条路，最后用 `getLanguage()` 自己判断语言。
21. **工具栏的排序 / 筛选按钮藏掉了，做法是 CSS 而不是 JS 补丁。** 这两个按钮对看板没有意义（排的是
    表格的问题，看板用列来回答），用户要求先收起来、等板子自己支持了再说。关键事实是**工具栏不在
    视图容器里面，而是它的兄弟节点** —— 核心的构造顺序是：

    ```js
    var a = (o.viewHeaderEl = i.createDiv({cls:"bases-header"})).createDiv({cls:"bases-toolbar"});
    o.sortMenu   = new ZX(t, a);   // r.addClass("bases-toolbar-sort-menu")
    o.filterMenu = new TX(o, a);   // r.addClass("bases-toolbar-filter-menu")
    o.viewContainerEl = i.createDiv("bases-view");
    this.view = factory(this, this.viewContainerEl);   // ← 视图拿到的 containerEl 就是它
    ```

    所以后代选择器够不到按钮，得让选择器**横着走**。视图拿到的那个容器就是 `.bases-view`，而
    `render()` 里 `root = this.containerEl` 又给它加了 `.lattice-board` ⇒ 一条 `:has()` 正好：

    ```css
    .bases-header:has(~ .bases-view.lattice-board) .bases-toolbar-item.bases-toolbar-sort-menu,
    .bases-header:has(~ .bases-view.lattice-board) .bases-toolbar-item.bases-toolbar-filter-menu
    ```

    **为什么要限定在看板上**：排序和筛选是**每一个** Bases 视图的按钮，一条不分视图的规则会把表格
    视图的按钮一起拿走（而筛选还是 `.base` 级的 `filters:`，表格正在用）。限定之后别的视图照旧。

    两个类名都是核心给的、不是猜的：类名的落点是 `VY` 建的
    `this.containerEl = e.createDiv("bases-toolbar-item")`（`.text-icon-button` 是它的孩子），而核心
    自己在打印模式下就是这么藏排序按钮的 —— `.print .bases-toolbar .bases-toolbar-item.bases-toolbar-sort-menu
    { display: none }`。特异度也够：核心 `.bases-toolbar .bases-toolbar-item { display: flex }` 是 (0,2,0)，
    我们这条是 (0,5,0)。

    一条差点把结论写反的账：**删掉两个按钮并不会把右边的按钮拉过来。** 结果计数项带
    `margin-inline-end: auto`，那是核心自己的留白，它把后面的按钮组顶到最右 —— 所以改动前后
    `Properties` / `New item` 的位置**一像素不差**，变大的只是中间那段空白。
22. **「添加视图」加出来的永远是表格视图 —— 那是核心写死的，不是配置。** 核心 `addView` 的结尾是

    ```js
    var i = new wY(e, "table", n);        // ← "table" 是字面量
    this.controller.show(new a$(this.controller, i, true));
    ```

    那个 `wY` 就是 `BasesViewConfig`，构造签名 `(query, type, name)`。`"table"` 没有任何 API
    能碰：`registerBasesView` 说的是「我们的视图是什么」，不是「添加按钮造什么」，而
    `QueryController` 的类体是空的。**插件能做的只有把那一行接管下来**，用核心自己的类建视图
    （`views[0].constructor`）、push 进同一个 `query.views`、走同一个 `query.save()` ——
    除了那一个词，一行都没另写。

    三件从核心源码里挖出来、让这件事成立的事实：

    - **菜单的名字打在菜单本身上。** `HY.prototype.addClass` 是
      `this.button.addContainerClass(e); this.menu.menuEl.addClass(e)`，而 `menuEl` 由
      `createDiv("menu bases-toolbar-menu")` 建出来 ⇒ `.menu.bases-toolbar-views-menu` 精确命中
      菜单。**这道限定是必须的**：属性菜单里也有一行「添加…」，和「添加视图」行由同一段代码
      建出来，只看图标分不出来 —— 没有它，用户点「添加公式」就会多出一个看板视图。
    - **菜单能找回它属于哪个视图。** 菜单被 `appendChild` 到 `body`，DOM 上断了线；但
      `setOpen` 里有一句 `c.toggleClass("has-active-menu", e)`（`c = this.parentEl`，也就是
      `.bases-toolbar`），而工具栏和视图容器是**同一父元素下的兄弟**（见上一条）⇒
      `.bases-toolbar.has-active-menu` → 父 → 父 → `:scope > .bases-view[data-view-type="lattice"]`。
      **不这么找就可能把视图写进另一个 `.base`**，所以宁可找不到就放行，也不用「屏幕上随便一个
      看板」兜底。
    - **`BasesViewConfig` 公开、它里面的 `query` 不公开，但 `query` 是跑不掉的**：`config.set()`
      的文档说它把值存到这个视图上，实现是 `this.data[..] = value; this.query.save()` ⇒
      `config.query` 一定在。反过来，**视图是唯一能把 config 交出来的东西**（`remember()` 每次
      `render()` 登记一次，因为核心是在工厂返回之后才赋值 `config` 的），这也解释了菜单开在表格
      视图上时为什么不接管 —— 那时没有任何 config 可读。

    **「切到新视图」那一步不自己写。** `selectView` 同样没有公开入口，但视图列表点一下就会调它
    —— 所以清空搜索框（它的 `input` 事件就是列表重绘）、等一帧、点新行。切视图、工具栏文字、
    写盘全部由核心完成。**建视图用核心的类，切视图用核心的点击，自己一行都不抄。**

## 下一步（按 wolai 差异点排序）

1. **列的手动管理** —— 顺序、移除、**新增／预置空列**都已做（见「列的管理」「新增列」）。
   还差 wolai 里「把列隐藏起来但又留着」那种纯隐藏语义 —— 现在只有「从本板移除」。
   另外普通列在最后一张卡片离开时会消失，手动加的列不会；若这两种要统一（列一旦出现就留下），
   得先决定「数据不再产生某列」时该不该自动把它转成手动列。
2. **子分组泳道** —— Bases 完全没有这个概念，也是差异化里最硬的一张牌。
3. **列底虚线的「+ 新增」** —— 列头那个 **+** 已经做了（走 `createFileForView` 并预填分组值，
   `minAppVersion` 也因此停在 1.10.2）。还差 wolai 那种「每列底部一条虚线 +」的入口，是同一套东西的第二个位置。
4. **列头颜色映射** —— 已做：列头与卡片上同一个值共用同一个颜色（见「卡片的样子与标签的颜色」）。
   还差 wolai 的「跟随单选标签色」那一层：现在颜色由值文本哈希决定，而不是读用户在属性选项里
   配的颜色。等 Bases 的属性选项能带颜色，或者我们自己加一份配色设置时再接。
5. **拖拽补完** —— 列之间已经能拖（手柄起拖 + 竖线落点）。还差**列内排序**：卡片在列里的先后，
   以及排序结果的持久化（frontmatter 属性）。
