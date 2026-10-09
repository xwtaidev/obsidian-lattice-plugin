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
| `src/bases/search-scope.ts` | 让搜索连卡片标题一起搜（核心的搜索范围写死在视图的 order 上） |
| `src/bases/drawer-action.ts` | 侧栏预览右上角那个「放大」按钮的图标与文案（侧栏 header 是隐藏的，按钮只能自己画） |
| `src/bases/value-colors.ts` | 一个值一种颜色，颜色取自 Obsidian 自己的八色 |
| `src/board-file.ts` | 把看板那个 `.base` 从文件树里藏掉（核心没有「藏一个文件」的 API），以及「看板文件」这个设置的载体 |
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

四个刻意的选择：

- **用户没动过列之前，这三个 key 一个都不写。** 列完全由数据推导，于是不存在「顺序列表与数据不同步」
  这种状态。顺序列表只在用户真正移动过列之后才存在，值没被它提到的列一律排在后面。
- **删除列 = 从本视图移除，不写任何笔记。** 确认弹窗里把这一点说明了，也说明了怎么恢复。
  顺序列表**刻意不改**，所以将来把列加回来时，它回到用户原先摆的位置，而不是末尾。
- **「有没有这一列」和「这一列排在哪」是两个列表。** 顺序列表只描述排列，不制造列 ——
  否则一份曾经画过、后来取值消失的列会被永远留在板上。列的存在由 `latticeAddedColumns` 说了算。
- **无值列不参与排序：它永远画在最后一列**（`Add column` 按钮左边），**拖不动**。它不是哪个取值 ——
  没人往笔记里打过，所以它在用户排的那串值里没有位置可站：早先它落在「第一张无值笔记出现的地方」，
  于是一篇笔记改个值就能让它换地方，夹在值列中间还会被读成一个值。规则在 `withNoValueLast`
  （`grouping.ts`，排在 `applyOrder` 之后）：顺序列表**说了也不算**——**老 `.base` 里就写着空 key**，
  而且真实拖动确实会把它写进去（见发现 10），所以这条规则必须压得过它。顺序列表里**不再会有它**：
  `applyColumnOrder` 落地前把空 key 过滤掉，`.base` 里只剩用户摆过的那几列。

`columnKey(value)` 是列的身份：`null`（无值列）存成空字符串。真实的空字符串值会和它撞身份 ——
可以接受，因为两者对用户本来就是同一列。

**无值列的名字来自界面语言，不由数据决定。** 它代表「没有值」，没有哪篇笔记会拼出这个词，所以
`deriveColumns` 拿不到它 —— 由调用方通过 `ColumnNaming` 传进来：中文界面是 `未分组`，其余是
`Ungrouped`（核心自己的分组标题对同一列说的是 `None`）。另一半是**什么算「没有值」**：
`BasesEntry.getValue` 对缺失的属性返回的不是 `null` 而是一个 `NullValue` 对象，`toString()` 就是字符串
`"null"` —— 直接采信那段文本，这些笔记就会得到一个名为 `null` 的列（详见「发现清单」第 20 条）。
这个判定同样由调用方以 `MissingValue` 传进来（`grouping.ts` 因此保持零 App 依赖，可以在 node 里跑）。
两个参数都留了「没有 App 可问」时的默认值（`No value` / 纯 `null` 判定），**只有看板视图显式传**。

### 卡片从哪来

每一列有**两个**入口，都在同一列上，做的是同一件事：走 `BasesView.createFileForView(name?,
fmProcessor?)`，弹出的是 **Obsidian 自己的新建笔记菜单**，文件夹与模板都继承仓库设置 —— 插件里因此
不需要再放一份 folder/template 配置。

| 入口 | 在哪 | 为什么也在那儿 |
| --- | --- | --- |
| 列头的 `+` | 列名那一行的最右，与 `…` 并列 | 它是「对这一列做点什么」的第二个动作 |
| 列底的 `+` 条 | 最后一张卡片下面，整列宽 | 列一长，列头就滚出屏幕了；而这条在列表末尾，也正是新卡片会落到的地方 |

- **两处按的是同一条规则，所以一起在、一起不在**（`cardTargetKey(groupBy)`）：派生属性（`file.name`
  / `formula.x`）没有 frontmatter 可写，板子没设 `latticeGroupBy` 时也一列都不该有 —— 理由是同一个
  「这张笔记建出来也不知道该算哪一列」。**无值列照样有两个**：它建出的笔记不写值，于是正好落进它自己。
- **列底那条挂在 `.lattice-column-cards` 外面**，是 `.lattice-column` 的第三个孩子：竖着排在卡片列表
  之后，却不是列表的一员。拖卡片的落点槽只在列表里量卡片的中点，「第几个位置」不能混进一个非卡片的兄弟。
- **它是一条，不是一张卡片大小的框**：整列宽、`--icon-s` 的 `+` 居中、平时淡、悬停才亮。做成虚线或
  填充的卡片形状会被读成「一张等着被填的空卡」。卡片与它之间是列自己的 `gap`（12px）。
- 和 `Add column` 一样需要 **`height: auto`**：Obsidian 的全局 `button` 规则把每个按钮钉在
  `height: var(--input-height)`（本机 30px），不覆盖就是列底一条 30px 的独立灰板 —— 真机量到的是
  **34px**（8+8 padding + 18px 图标），六列一致。

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
| 列 | 列头最左的手柄 | `application/x-lattice-column` | 把该列插到目标列左/右半边（**无值列没有手柄**） |

- **列只能从手柄拖起。** 卡片是 `draggable`，列本身不是 —— 手柄是列唯一的拖拽入口，
  于是「起点落在哪」不再有歧义，不必靠猜。
- **无值列根本没有手柄。** 它画在最后是规则而不是位置（见「列的管理」），所以列头最左那个位置放的
  是一枚**图钉**（`is-pinned` + `pin` 图标）——抓不起来的把手比没有把手更糟；而且图标占的是同一个
  `--icon-s` 盒子，于是它的列头和别的列对齐（真机量过两边 `titleLeft` 都是 29px）。列菜单里
  **四个移动项也一并去掉**，只留 `Delete column`：留着四个点了没反应的菜单项比不给更糟。
- **拖别的列落在它右半边时，竖线画在它左边。** 它后面没有位置可插（`dropSide`：命中 `is-pinned`
  就一律当左半边），反馈不该许诺一个落不到的地方。
- **两种拖拽各有自己的落点反馈。** 拖卡片时目标列亮起（`.is-card-drop-target`），并在**它的列表里**
  开一个落点槽（`.lattice-card-slot`：虚线框 + 被拖卡片自己的标题，高度按那张卡量）；拖列时在列与
  列之间画一条竖线（`.is-drop-before` / `.is-drop-after`），表达的是「插到哪一侧」。
  反馈刻意长得不一样，因为这是两件事。落点槽见下面「卡片落在哪」。
- **整个看板只有一组 drag 监听**（挂在 `.lattice-board-columns` 上），没有按列各自接一套。
  目标列从事件里查，落点反馈永远只有一个元素携带 —— 这也是 `dragleave` 的噪音不会让整块板
  抖闪的原因。
- **`text/plain` 一律不设。** 卡片拖进笔记里不该粘出一个路径，Obsidian 自己的拖拽体系也不该
  把这些当成文件拖拽接过去。
- 只接**自己写的类型**。外部拖拽（Finder 的文件、别的面板）没有 `preventDefault`，看板就不接。
- **放不下的列不给任何反馈。** 两种情形：拖回原来那一列（`dropCard` 自己就会早退，见 `payload.column ===
  target`），以及整块板子的 `latticeGroupBy` 是**派生属性**（`file.name` / `formula.x`，没有 frontmatter
  可写）。这两种情况下 `dragover` **不调 `preventDefault`**、不亮列、不开槽 —— 光标自己会说「放不下」，
  插件一个字都不用写。**这是 2026-10-08 改的**：之前任何一列都会亮起来，包括点了什么都不会发生的那种。

拖列的落点由 `reorderByDrop(keys, from, hovered, after)` 算。它看着像没必要的算术，其实不是：
`moveColumn` 是「先删后插」，所以凡是从删除前的数组取来的下标，向右拖时统统差一位。
A 拖到 C 的右半边必须得到 `[B, C, A, D]`，算错了要等某次列落错一格才会被发现。

### 卡片落在哪

拖卡片时的落点槽有**两层**意义，只有一层是真的：

- **哪一列** —— 真的。放下就写回该列的值。
- **列里的第几个位置** —— **只是画出来的**。槽的上下位置由 `cardDropIndex(midpoints, clientY)` 决定
  （`midpoints` 是列里每张卡的垂直中点，「指针还没过中点的那张卡」之前就是落点，全过了就落到最后），
  但**列内顺序不归这个槽管**：卡片在列里的先后由「谁给这列排过序」决定 —— `.base` 里设了 `sort` 就听它的，
  否则按创建时间（见「卡片在列里怎么排」），而 `moveCard` 只写那一个 frontmatter 值。**实测过**：把卡片
  拖到 Doing 的第 2 个位置松手，它落在 Doing 的第 3 张（见「已验证」里的真机量测）。

⇒ 所以别把它当「插入到这儿」看。要让落点真正决定顺序，得先有**列内手动排序**（见「下一步」第 5 条）：
存一份每列自己的卡片顺序，并且和「哪些卡不在那份名单里」和解。在那之前，槽的位置是**提示**，列才是承诺。

槽本身有四处细节：
- **列表里只有卡片。** 列底那条新增的 `+`（见「卡片从哪来」）是 `.lattice-column-cards` 的**兄弟**，
  不在列表里，量 `midpoints` 时自然不会数到它 —— 这就是它必须挂在外面的原因。
- **元素是搬的、不是重建的。** `dragover` 每个像素都发一次，重建会让它每次都重新排版；而且它自己占
  位置（这正是「给卡片腾出地方」的意思），所以量 `midpoints` 时**要跳过槽自己**，否则「哪里该放槽」
  这个问题的答案里就混进了槽自己的高度。
- **两张卡之间的中点线是「粘」的**，不是抖的：槽插进列表后把下面的卡推下去，指针却还在原来的位置，
  于是判定结果不变（实测：y=300 插到第 1 个位，再移到 y=700，槽落到第 2 个位而不是第 3 个 —— 因为
  第 3 张卡的中点被槽推到了指针下方）。
- **从别的看板拖过来的卡片**这条路也走得通：本视图没见过它的 `dragstart`，所以没有标题也没有尺寸
  （槽只占 `min-height: var(--size-4-10)`，没有标题行），但它照样亮列、照样接。两个看板并排开着的时候
  这是常态。

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

## 卡片在列里怎么排

一列的卡片顺序有**两个来源**，谁在场听谁的：

| 情形 | 顺序 | 谁定的 |
| --- | --- | --- |
| `.base` 里写了 `sort` | 你设的那条排序 | 核心 —— 数据交到视图手上时已经排好了 |
| 没有 `sort` | **按笔记的创建时间，老的在上** | 看板自己（`orderByCreation`） |

第二条是 2026-10-09 加的，起因是一件看着像 bug 的平常事：**点列底那个 `+` 建出来的卡没有落在末尾**。
根因是「没有排序」并不等于「没有顺序」—— 核心对没有 `sort` 的视图交出来的顺序是**文件名**（中文按拼音，
于是 `未命名` 排在 `写一个很长的标题` 前面，因为 `wei < xie`），新卡落在哪全看它叫什么名字。

**创建时间**是唯一能让「加一张卡片」读作「追加」的规则：卡片本来就是一张张堆上去的。它还有个顺带的
好处 —— 老卡片之间的相对顺序不动，只有比它们新的才往后走。

三处细节：

- **判据是 `config.getSort()`**（`BasesSortConfig[]`，没设排序时是空数组），**不是** `config.get('sort')`：
  `get` 只认识 `BasesViewRegistration.options` 里注册过的键，对它一律返回 `null`。`config` 上确实挂着一个
  同名的 `sort` 字段，但那是实现细节，不该站上去 —— 见发现 31。
- **创建时间读 `entry.file.stat.ctime`**，不是 `entry.file.ctime`：`TFile` 上只有 `stat`。而且它是**秒级**
  的 —— 批量导入、连点几次 `+`，全都会落在同一秒里。
- **同一秒的卡片保持核心给的原顺序**，不另找判据去拆：拆出来的位置没有任何东西能解释。实现上就是对
  一个副本做一次 `sort`（稳定排序），而不是造一个把三种情形都排完的全序 key。

**这条规则只覆盖「没有排序」的板子。** 你自己在 `.base` 里写了 `sort`，看板一个字都不插手 —— 那是你
已经回答过这个问题了。

## 卡片打开：右侧抽屉

点卡片**不**在主区域打开笔记。看板是读它的地方，而主区域里打开一篇笔记，替换掉的正是你看的这块板
—— 一张卡把整个看板顶掉了。笔记改开在**右侧边栏**（Obsidian 自己的抽屉）里：

| 操作 | 结果 |
| --- | --- |
| 点卡片 | 笔记开在右侧边栏，边栏自动展开 |
| 点侧栏右上角的放大按钮 | 主区域新标签页打开同一篇（已经开着就直接切过去）。抽屉这一篇随之收掉，边栏若空则折起来 |
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
- **侧栏里的「放大」按钮是自己画的，因为侧栏的 header 整个是隐藏的。** 真机量到侧栏 leaf 的
  `.view-header` 是 `display: none`（`getClientRects()` 为 0）—— Obsidian 在侧栏里不画标题条，于是
  view 自己的那三个按钮（书签、阅读模式、更多）**也一起看不见**。`ItemView.addAction` 写的正是
  `.view-actions`，所以它在侧栏里等于写进一个看不见的地方。**这里翻过一次车**：自动化断言查了
  「按钮在 DOM 里、回调能触发」就以为成了，**没量可见性**。现在按钮走 `containerEl.createEl`，
  靠 `.lattice-with-new-tab`（容器转 `relative`）+ `.lattice-new-tab`（绝对定位在右上角）画出来，
  并复用 Obsidian 自己的 `clickable-icon` 类保持观感一致。图标 `maximize-2`，标签按语言
  （`在新标签页中打开` / `在新分頁中開啟` / `Open in a new tab`）。
- **它只加在右栏**（`leaf.getRoot() === workspace.rightSplit`）：按钮的意思是「出抽屉」，被拖进主区域的
  tab 已经在外面了。
- **按「已经开着就切过去」处理**：先在主区域找显示同一篇的 leaf，找到就 `revealLeaf`，否则才
  `openLinkText(..., 'tab')`。不这么做，按两次就留下两个同名标签页。
- **放大之后抽屉自己让位**：笔记既然有了自己的页面，抽屉再留着就是同一篇显示两遍，还白占一列屏幕。
  所以 `openInMainArea` 走完就把那片 leaf `detach()` 掉 —— 边栏空了就自己折回去（这正是「出抽屉」的
  形状）。**只 detach 自己那一片**，判据是 `leaf.getRoot() === workspace.rightSplit`；用户自己放在侧栏的
  反链面板是用户的，侧栏里还站着别人时也不替它折。注意这是**插件主动做**，不是等 Obsidian 碰巧收 ——
  上次用户看到的就是「碰巧会收」，行为不确定也不可解释。
- **按钮问的是抽屉现在显示哪一篇**（`leaf.view.file`），不是点卡片时记下的那篇 —— 在预览里跟着链接
  翻过几页之后，它仍然指「现在这一篇」，这时正是一个全页更值的时候。
- **按钮的生命周期跟着抽屉**：leaf 复用，view 也复用，所以每次开预览前先摘掉上一个按钮（连同容器上的
  类），否则点一圈卡片会在侧栏角落堆一排。leaf 被关掉时按钮随 DOM 消失，引用失效后再摘一次是无害的。

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

## 看板文件、卡片文件夹、入口

三件事其实是同一件事的三个面：**看板就是一个 `.base` 文件，卡片就是一批普通笔记。**

| 面 | 落在哪 | 谁决定 |
| --- | --- | --- |
| 看板本身 | 一个 `.base` 文件（默认 `lattice-board.base`） | 插件设置 **Board file** |
| 从哪进 | 左侧 ribbon 的 Lattice 图标（以及命令 `lattice-board:open-board`） | 插件 `main.ts` 的 `openBoard()` |
| 卡片放哪 | 一个普通文件夹（`lattice-cards`） | `.base` 顶层的 `newItemFolder` |

**一个刚装好插件的库，连这个文件都还没有 —— 所以第一次加载时插件自己写一份（2026-10-08 加）。**
这是「入口只有一个」留下的洞：门只有图标那一扇，门后的文件却要用户自己造 —— `examples/lattice-board.base`
只活在仓库里，而 release 只带 `main.js` / `manifest.json` / `styles.css`。`src/board-seed.ts` 补上这一步：
设置指的那个路径没有文件，就写一份空白看板；**已经有了就一个字节都不动**；路径里带目录
（`boards/work.base`）就把缺的目录逐级建出来；写不出来（只读库）时返回 false，点图标那句
「no file at …」照旧兜底。写成功了会说一声（Notice）—— 文件是自己冒出来的，而**看板被改名搬走之后
这个也会再触发一次**（设置里存的是旧路径），一句话比让用户猜好。

**这份空白看板必须带 `latticeGroupBy`，否则板子只能看不能配。** 不带的板子只有一列 `All notes`，
而两个能造列的按钮都会被收起来（`renderAddColumn` 在 `groupBy === null` 时直接 return，列头那个 `+`
同理），`Group by` 的入口又只在被藏掉的视图菜单里（见发现 28）。所以种子写的是
`latticeGroupBy: note.status`、不筛选 —— 开箱就有可写的列、能拖卡片写回 frontmatter，字段名随用户
在文件里改。

**入口只有一个，所以那个文件不该待在文件树里。** 文件树是「找文件」的地方，而 `.base` 不是要打开的文档，
是应用自己的一块屏 —— 它出现在树里只会让人以为那是该点的东西。所以插件把它的那一行藏掉
（`src/board-file.ts`）。三条路都不通才走到这一步：核心没有「藏一个文件」的 API；「排除文件」管不到文件树
（见发现 25）；`<style>` 元素被社区规范禁掉（`obsidianmd/no-forbidden-elements`，lint 直接报错）。
剩下能用的做法是**观察文件树 + 给那一行打一个类**，类写在 `styles.css` 里 —— 也就是 `property-menu.ts`
那套。**失效方向是安全的**：类名或选择器哪天对不上，文件自己回到树里，`+` 和拖拽都不受影响。

**新卡片落在哪个目录，是 `.base` 的键，不是插件的代码。** `createFileForView` 把活交给核心的
`newItemMenu.open()`，它按这个顺序挑目录：

```
newItemFolder → newItemTemplate 所在的目录 → 由 query/view 推出来的目录 → Obsidian「新笔记默认位置」
```

**所有列共用这一个目录**，未分组列也一样 —— 先在文件夹里建出笔记，再写分组属性的值（见发现 26）。
这是核心自己的能力，插件一行都不用写；自己接管反而会丢掉核心的新建卡片小弹窗和模板。

**一个还没做的取舍：文件夹不存在时不说一句话。** 真机量过（见发现 26）：指向一个不存在的目录，
`+` 就是「什么都不发生」，没有 Notice 也没有报错。修它需要在按 `+` 那一刻知道**当前看板是哪个
`.base`**，好把它的 `newItemFolder` 读出来先建目录 —— 而 `QueryController` 的类体是空的、视图也拿不到
自己的文件（发现 1 的同一条限制），所以现在没有干净的地方去做这件事。要做的话，得先解决「视图怎么知道
自己是哪个 `.base`」。

### 图标

入口只有一个图标，所以它得同时说清两件事：**这是一块板**，而且**它是个能打开的东西**。
`LATTICE_ICON = 'kanban-square'`（`constants.ts`）—— 圆角外框里三根高低不等的竖条。竖条是看板本身，
外框把它从「一个记号」变成「一块面板」，也就和半个插件生态都在用的四等分方块区分开了。这个常量同时喂
ribbon 按钮和 Bases 视图类型的注册，两处是一个图标。

**`layout-*` 那一族已经被核心占住了。** 真机读运行中实例的 ribbon 类名可以直接看到：「新建白板」戴的是
`lucide-layout-dashboard`、「新建数据库」戴的是 `lucide-layout-list`。原来的 `layout-grid` 既是那个
烂大街的形状，又紧挨着核心自己的词汇 —— 换到 kanban 这一族，落点干净。姊妹插件的「打开周看板」用的是
`calendar-days`，两者也不打架。

两个关于图标名的坑（细节见发现 27）：

- **名字是 Obsidian 打包的那版 Lucide，跨版本会变。** 同一个图标在现在的 Lucide 里叫 `square-kanban`，
  在 Obsidian 1.12.4 里叫 `kanban-square`。改名之前先对着 `getIconIds()` 查。
- **名字不认识不报错。** `setIcon` 是「清掉旧的、取新的，取到 null 就结束」—— 拼错一个字母，按钮变成
  空白，没有异常也没有日志。所以它只能靠量 DOM 来验。

验证方式是**比对指纹**：复制库 + 独立 profile + CDP 量运行中的 ribbon 按钮，拿到
`class="svg-icon lucide-kanban-square"`、`1 个 rect（18×18 rx=2）+ 3 条 path（M8 7v7 / M12 7v4 / M16 7v9）`、
`getClientRects()=1`、盒子 18×18 —— 与从 `app.js` 里抽出来的图标数据逐字一致。被换掉的 `layout-grid` 是
**4 个 rect、0 条 path**，所以这组数字是能区分开的，不是「有东西画出来就算过」。

## 怎么试

```bash
npm run build
npm run deploy -- <vault-path>
```

然后在 Obsidian 里：

1. 库根目录应该有 `lattice-board.base` —— 插件加载时自己写的（`src/board-seed.ts`），打开它就是看板。
   要试**带筛选**的那份，先建一个文件夹 `lattice-cards`（新卡片落在那儿，见发现 26），把
   `examples/lattice-board.base` 拷进 vault 任意目录，再在设置里把 **Board file** 指过去。两种文件里的
   视图类型都已经写成 `lattice-board`。
2. 若显示的不是看板，用视图右上角切换到 **Lattice board**。
3. 列由 `latticeGroupBy` 决定。`Group by` 就在视图配置页里，而那个入口目前是藏起来的（见发现 21、28）
   ⇒ **换分组属性现在只能改文件里的 `latticeGroupBy`**。
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
23. **看工具栏**：看板视图的工具栏上，**排序**、**筛选**、**视图**三个按钮都不见了 —— 前两个对看板没有
    意义，视图那个是连入口一起先收起来（见步骤 24）；**结果计数、属性、新建**都还在。右边那组按钮的
    位置**一像素不变**（结果计数的 `auto` 边距顶着）；**左边不一样**：视图按钮原本就在最左，它消失后
    结果计数会左移一格、贴到工具栏左端。把同一个 `.base` 切到**表格**视图（临时在 `.base` 里加一个
    `type: table` 的视图），这三个按钮应该**回来** —— 规则只挂在看板上。
24. **看「添加视图」（要先把入口放回来）**：视图按钮已经藏了，所以这一步得先删掉 `styles.css` 末尾那条
    `:has()` 规则里的 `bases-toolbar-views-menu` 一行再 `npm run deploy`，然后才谈得上「点视图按钮」。
    在**看板**里点工具栏的视图按钮，菜单底下那一项（`+ 添加视图`）点下去。
    应该**直接多出一个看板视图**（叫 `Board`、`Board 2`……），并且**当前视图已经切到它** ——
    不会出现核心那个「配置视图」页，更不会多出一个**表格**视图。反复点几次，名字应该往后数。
    注意这只在看板的工具栏里成立：把同一个 `.base` 切到**表格**视图再点，加出来的仍是表格视图
    （那是核心自己的行为，我们没有接管）。
25. **搜一张卡片的标题**：点工具栏的搜索按钮（放大镜），在出现的输入框里输入**卡片标题里的一个词**
    （比如「拖拽」）。应该**只剩那几张卡片**，输入框右边写着「显示 N」。清空后全部回来。
    再输一个**字段值**（比如 `High`）应该照样搜得到 —— 加标题是往上加，不是替换。
    输一个谁都词都没有的字符串，应该是 0 张、看板空、旁边写「显示 0」。
26. **点卡片，再点侧栏右上角的放大按钮**：点一张卡片，笔记开在右侧边栏。**侧栏内容区的右上角**应该有
    一个圆角小按钮，图标是斜着向外的两个箭头（`maximize-2`），悬停写着「在新标签页中打开」。点它 ——
    主区域应该开出一个**同名的新标签页**，显示同一篇笔记，**抽屉跟着收起**（那一篇不再在侧栏显示第二遍；
    侧栏里只剩它自己那一片，所以边栏折回去了）。
    连点两次**不应该**开出两个同名标签页（第二次直接切到已经开着的那个）。
    再点另一张卡片：侧栏换笔记，右上角**仍然只有一个**放大按钮（不是两个、三个），点它开的是**新的那篇**。
    把侧栏里的预览跟着链接翻到另一篇，再点按钮：开的应该是**当前显示的那篇**。
    用户自己在侧栏开的别的面板（反链等）**不该**被顺手关掉 —— 收的只是 Lattice 自己那一片。
27. **点左侧 ribbon 的 Lattice 图标**：应该直接打开看板 —— 已经开着就切过去，**不会**开出第二个标签页；
    关掉再点，才新开一个。**同时看文件树**：里面**不该**有 `lattice-board.base` 这一行（文件夹和笔记照常
    显示）。再造一个别的文件，确认新出现的那一行**没有**被误藏 —— 藏的是那一个路径，不是一类文件。
28. **看新卡片落在哪**：在**任意一列**的列头点 `+`。新笔记应该在 `lattice-cards/` 里；有值的列还会把值
    写进 frontmatter（未分组列不写）。**先确认 `lattice-cards` 这个文件夹真的存在** —— 指向一个不存在的
    文件夹时，`+` 是「什么都不发生」，没有提示、没有报错（见发现 26）。
29. **看拖卡片的落点槽**：按住一张卡片往别的列拖（别松手）—— 目标列亮起，列里出现一个虚线框，写的是
    那张卡片的标题，高度也是那张卡的高度，下面的卡片跟着让出位置；上下移动，虚线框跟着挪。拖回它
    原来那一列，列不亮、槽也不开（松手什么都不会发生）。**松手之后卡片在列里的位置未必是槽那个位置**，
    原因见「卡片落在哪」。
30. **看无值列是不是钉在最后**：把看板滚到最右 —— `未分组` 应该**永远是最后一列**，紧挨着 `Add column`
    按钮。它列头最左是一枚**图钉**（不是别的列那种 `⠿` 握把）：抓不起来，光标也不是抓手，它的 `⋯`
    菜单里只有 `Delete column`（四个移动项全没了）。把别的列拖到它**右半边**，竖线会画在它**左边**，
    松手后那一列落在它前面，而它还在最后；**顺手看 `.base`** —— `latticeColumnOrder` 里不会出现空 key。
    想试「规则压过文件」这条：自己在 `.base` 的 `latticeColumnOrder` 里手写一行 `- ""` 放到最前，
    重新加载后它照样画在最后（真机就是这么验的）。
31. **看列底那个 `+`**：每一列的**最后一张卡片下面**都有一条整列宽、`+` 居中的横条（卡片与它之间
    12px）。点它 —— 和点列头 `+` 一样建出一张卡片，落在**这一列**（有值的列写值，`未分组` 不写）。
    空列也一样：`Backlog` 一张卡都没有时，横条紧跟在列头下面。**把卡片直接拖到这条横条上松手**，
    卡片也应该落进这一列（这条在列里、但在卡片列表外面，是特意验的）。
    两个不该有的情形：把 `.base` 的 `latticeGroupBy` 临时换成 `file.name` 再重新加载 —— **每列都没有**
    这条，列头的 `+` 也没有；把 `latticeGroupBy` 整行删掉，板子只剩 `All notes`，同样两个都没有。
    `未分组` 是例外中的例外：它**有**这两个按钮，但建出的卡片不带值。
32. **看卡片排在列里的哪儿**：先点几次列底的 `+` —— 建出来的卡片都落在该列**末尾**（这就是 2026-10-09
    加的规则，见「卡片在列里怎么排」）。再打开 `.base`，在 view 条目里加一段

    ```yaml
    sort:
      - property: file.name
        direction: DESC
    ```

    卡片顺序立刻整列跟着倒过来（刚建的那张回到中间）——**插件一个字都没插手**。把这段删掉，新卡又
    回到末尾。同一秒建的卡片保持原顺序这条，看老卡片更快：`复刻看板的列宽表现 → 特殊字符 & 括号 (#42)
    的标题 → 写一个很长的标题…` 三张是同一秒的，顺序一直是文件名的顺序，没被创建时间动过。

```bash
npm test        # 纯函数断言（node:test + esbuild，无第三方框架）：描述提取 + 列的分组规则 + 属性白名单 + 视图命名 + 搜索范围 + 放大按钮的文案
```

## 已验证 / 未验证

静态验证（全部通过）：

- `npm run build` —— 类型检查 + 打包通过，说明所有 API 签名都对得上
- `npm run lint` —— 0 error
- `npm run check:manifest` —— 全绿
- `npm test` —— **121 条**断言全过（`description.test.ts` 30 条 + `grouping.test.ts` 64 条 +
  `board-properties.test.ts` 3 条 + `property-menu.test.ts` 4 条 + `view-menu.test.ts` 5 条 +
  `search-scope.test.ts` 4 条 + `drawer-action.test.ts` 3 条 + `board-seed.test.ts` 8 条）。运行器是
  `scripts/test.mjs`：把 `src/**/*.test.ts` 用 esbuild 打成 ESM 丢进临时目录，再 `node --test` 跑；
  不引第三方框架。`grouping.test.ts` 收的是原先躺在 `/tmp` 的那批一次性断言（分组、移除、显式顺序、
  `moveColumn` 的边界、`reorderByDrop` 的全部 32 种落点、`cardDropIndex` 的边界、无值列钉在最后
  —— 包括「老顺序里的空 key 压不过它」和「删掉了就不许它自己回来」、卡片按创建时间排的六条）
  加上新增列的新用例 —— **`/tmp` 那份已经搬空**。
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

**真机取证：复制库 + 第二个实例 + CDP（2026-10-03 走通）。**

复制一份测试库出来，用一个**独立的 `--user-data-dir`**（里面只写一份指向那个副本的 `obsidian.json`）
起第二个 Obsidian，加 `--remote-debugging-port`，再用 CDP 读活的 DOM 和活的对象。Node 22 自带全局
`WebSocket`，**不需要** playwright / puppeteer。三个环境上的坑：沙箱里必须带
`--no-sandbox --disable-gpu --disable-gpu-sandbox --disable-software-rasterizer`（否则 GPU 进程起不来，
主进程直接 `FATAL: GPU process isn't usable`）；`curl` 要 `--noproxy '*'`（agent shell 里挂着
`HTTP_PROXY`，对 127.0.0.1 也生效）；**插件热重载不够** —— disable/enable 之后核心手里拿的仍是旧插件
建的那个视图实例，`main.js` 换了也不生效，**要重启实例**（`pkill -f "user-data-dir=<临时目录>"`）。
**还有一条 2026-10-08 撞上的：Obsidian 1.14.4 下，干净的 `--user-data-dir` 里社区插件一律不加载** ——
`app.plugins.manifests` 认得出 `lattice-board`、`community-plugins.json` 也写着它，但
`app.plugins.plugins` 是空的、ribbon 上只有核心按钮。卡在 `PluginManager.isEnabled()` 上，它的实现是

```js
function () { return 'true' === localStorage.getItem('enable-plugin-' + this.app.appId) }
```

也就是**每个库一份、存在 localStorage 里的那个「启用社区插件」总开关**，而全新的 user-data-dir 里没有它
（`--user-data-dir` 就是 localStorage 的落脚处）。修法是进去写一句再重载：

```js
localStorage.setItem('enable-plugin-' + app.appId, 'true')   // appId 是每个库一个的随机串
```

写完 `curl -X PUT http://127.0.0.1:<port>/json/reload`，回来 `app.plugins.plugins` 里就有东西了。**
症状之所以难认，是因为它长得像「插件坏了」**：没有报错、没有 Notice，`enablePlugin()` 也返回 true，
只是 `loadPlugin` 第一行 `if (!this.isEnabled()) return` 就退了。

从此以后，「核心 DOM 长什么样」不再只能从 `app.js` 里推。已经拿到的（全部是读活物，不是读 bundle）：

- **工具栏 7 个按钮的类名**，全部落在 `div.bases-toolbar-item` 上：`bases-toolbar-views-menu`、
  `bases-toolbar-results-menu` + `bases-toolbar-result-count`、`bases-toolbar-sort-menu`、
  `bases-toolbar-filter-menu`、`bases-toolbar-properties-menu`、`bases-toolbar-search`、
  `bases-toolbar-new-item-menu`。
- **`.bases-view` 带 `data-view-type` 与 `data-view-name`**（看板是 `lattice-board` / `Board`），
  而 `render()` 贴上的 `.lattice-board` 就在同一个元素上。
- **工具栏与 `.bases-view` 确实是兄弟** —— `:has(~ .bases-view.lattice-board)` 真的命中了：排序 /
  筛选 / 视图三个按钮读出来都是 `getComputedStyle().display === 'none'`。
- **`config.getOrder()` 交出的是规范化过的 id**：`.base` 里手写 `等级` / `priority`，读出来是
  `note.等级` / `note.priority`；而 `data.properties` 里**只有** order 里的那几个。
- **`controller` 的内部形貌**：自有字段 `query` / `results`（Map，全量）/ `view` / `viewName` /
  `searchQuery` / `initialScan` / `ctx` / `queue`；`getSearchQuery` / `updateSearchQuery` /
  `applySearchQuery` / `notifyView` 都在**原型**上。`controller.view.config` 就是核心交给视图的那一份。
- **核心把结果按 `file.name` 排序**（本机 locale 下是拼音序），不是按 path —— 拿
  `localeCompare(path)` 排是对不上的。
- **搜索框的 `input` 事件就是那条路**：派一个 `new Event('input')` 与手打等价，打开 → 输入 → 重算
  整条链都能走通（发现 23 就是这么量的）。
- **侧栏 leaf 的 `.view-header` 是 `display: none`**（`getClientRects()` 为 0，盒子 0×0），主区域的
  则是正常显示的。这是「放大按钮为什么看不见」的答案：`ItemView.addAction` 写的正是那个 header 里的
  `.view-actions`，写进去等于写进视野之外 —— 核心自己的书签 / 阅读模式按钮也在那儿，一样看不见。
  侧栏 leaf 的 `.workspace-leaf-content` 读出来是 `position: relative`，所以往它里面放绝对定位的元素
  是安全的；代码仍自己加一个类来定这个位，免得哪天核心改了那个值。
- **量「有没有画出来」不能只查 DOM。** 上面那条之所以是坑，是因为断言查的是
  `querySelector(...) !== null` 与「回调能被触发」，两样都通过，而按钮是 `display: none` 的父元素里的
  一个 0×0 元素。**判据是 `getClientRects().length`，再加一次 `document.elementFromPoint(中心)` 看
  返回的是不是它自己**（前者证明有盒子，后者证明没有东西压在上面）。
- 一条**没走通**的：对 `display: none` 的视图按钮调 `.click()` **打不开菜单**。~~所以「菜单内部」那几样
  （属性菜单的 `mod-implicit` 标记、视图菜单的行结构）到现在仍然没有真机证据。~~ **2026-10-08 更正：
  合成 `MouseEvent` 打不开任何菜单**（后加的列菜单也一样：DOM 一动不动、没有异常、`defaultPrevented`
  也看不出来），**要读菜单必须发可信事件** —— 见下面那条。所以「菜单内部」的取证不是不可能，只是
  之前用错了工具。
- **可信输入这条路走通了：读列菜单的条目（2026-10-08 新增）。** 合成事件进不了 Obsidian 的菜单，
  但 CDP 的 `Input.dispatchMouseEvent`（`mousePressed` + `mouseReleased`，中间隔 ~80ms）走的是浏览器
  输入管线，事件 `isTrusted === true`，菜单**真的会开**。步骤里的两个坑：**菜单容器是 `<menu>`**
  （不是 `.menu` 之类），而且**开完没多久就从 document 上摘掉了**（等 700ms 再查，`document` 里一个
  不剩）——所以取证姿势是**先留住节点引用再读**：patch `Node.prototype.appendChild` +
  `Element.prototype.append` + `Element.prototype.insertAdjacentElement`，凡是 class 带 `menu` 的节点
  都塞进一个数组，点完再从数组里读 `textContent`（引用还在，摘下去也读得到）。量到的菜单：

  | 列 | 菜单项 |
  | --- | --- |
  | 无值列（`未分组`） | 只有 `Delete column`（`menu-item tappable is-warning`） |
  | 普通列（`Doing`，当时在第 0 位） | `Move left`（`is-disabled`）、`Move right`、`Move to start`（`is-disabled`）、`Move to end`、`Delete column` |

  顺带证实了「列头按钮的点击不穿透」：可信点击的落点就是那个 `clickable-icon lattice-column-action`，
  菜单开在它旁边，列本身没有任何反应。
- **无值列钉死在最后 —— 真机量过（2026-10-08 新增）。** 夹具本身就是**敌意**的：副本的 `.base` 里
  `latticeColumnOrder` 第一条正是 `- ""`（上一次拖动留下的，改代码之前写的），而且数据顺序把它排在
  中间。加载后量到的是：

  | 量什么 | 结果 |
  | --- | --- |
  | 列序（`board.children`） | `Backlog, Doing, Done, Arcive, Review, (未分组), ADD-COLUMN` —— 空 key 在顺序里排第一，画出来仍在最后，`Add column` 紧跟在它右边 |
  | 无值列列头 | `lattice-column-grip is-pinned`、`draggable = false`、图标 `svg-icon lucide-pin`、`aria-label = The "未分组" column is always last` |
  | 普通列列头 | `lattice-column-grip`、`draggable = true`、`lucide-grip-vertical`（**对照组**） |
  | 列头对齐 | 无值列与普通列的标题左缘都是 **29px**（图钉与握把占同一个图标盒） |
  | 对无值列派 `dragstart` | `dataTransfer.types` **空数组** —— 它压根没有载荷，不是「拖了没反应」 |
  | 拖 `Backlog` 落在无值列**右半边** | `defaultPrevented = true`、竖线是 `(未分组):before`（画在它左边） |
  | 松手后 | `Doing, Done, Arcive, Review, Backlog, (未分组), ADD-COLUMN` —— 被拖的列进了它前面，它仍在最后，`Add column` 仍紧跟其后 |
  | 落盘后的 `latticeColumnOrder` | `Doing, Done, Arcive, Review, Backlog` —— **原来的 `- ""` 被清掉了**（`applyColumnOrder` 过滤空 key），文件里不再有空 key |
- **列底那个 `+` —— 真机量过（2026-10-08 新增）。** 六列（`Backlog / Doing / Done / Arcive / Review /
  未分组`）在 `latticeGroupBy: note.status` 下：

  | 量什么 | 结果 |
  | --- | --- |
  | 每列有没有 | 六列**全有**，而且都是 `.lattice-column` 的**最后一个孩子**（`header, cards, add`） |
  | 它在不在卡片列表里 | **不在**（`cards > .lattice-card-add` 查不到它） |
  | 尺寸 | 高 **34px** —— `height: auto` 生效，没被全局 `--input-height`（30px）钉住；宽 **222** = 列宽 240 − 2×8 padding − 2×1 border |
  | `+` 的位置 | `svg-icon lucide-plus`，水平居中（图标中心与按钮中心差 < 1px） |
  | 与最后一张卡的距离 | **12px**，就是列自己的 `gap` |
  | `aria-label` | `New note in Backlog` … `New note in 未分组` |
  | 点 `Review` 那条 | 出现 `lattice-cards/未命名.md`，frontmatter `status: Review`；看板仍渲染（笔记开在**新标签页**，没顶掉看板） |
  | 点列头 `+`（`Arcive`，**对照组**） | `status: Arcive` —— 两个入口结果一致 |
  | 点 `未分组` 那条 | 新笔记**没有 `status` 键** ⇒ 落进 `未分组` 自己 |
  | 把卡片**直接拖到 `Doing` 的横条上**松手 | 文件 `status` 从 `Backlog` 变 `Doing`，列计数 1 → 10，松手后槽 0 个、亮列 0 个、六列横条仍在。**读的时候要轮询**：落盘是磁盘往返，等 1 秒就读到旧值（第一次读文件就是这么误判的） |
  | 对照：`latticeGroupBy: file.name` | 30 列，**0 条**横条、**0 个**列头 `+` |
  | 对照：删掉 `latticeGroupBy` 整行 | 5 列（最后一个仍是 `All notes`），**0 条**横条，`Add column` 也不在 |
  | 拖卡片时的落点槽 | `slot.parentElement` 是 `.lattice-column-cards`（**不是** `.lattice-column`），槽仍开在列表里、横条仍是最后一个孩子 |
- **卡片按创建时间排 —— 真机验证过（2026-10-09 新增）。** 复制库、`latticeGroupBy: note.status`、六列、
  `.base` 里**没有** `sort`：

  | 量什么 | 结果 |
  | --- | --- |
  | 核心交过来的数据顺序 | `… 未分组的一张卡, 未命名, 未命名 1, 未命名 2, 无等级无优先级的 Backlog 卡, 写一个很长的标题…` —— **文件名拼音序**，从头到尾没变过 |
  | 画出来的 `Backlog` | `复刻看板的列宽表现, 特殊字符 & 括号 (#42) 的标题, 写一个很长的标题…, 未命名, 未命名 1` —— 两张新卡到了末尾 |
  | 画出来的 `Done` | `超长单词的溢出, 卡片描述的两行打点, 看板的空列应该保留吗, 已完成-日期属性的渲染, Done 里的复选框卡, 未命名 2` |
  | 老卡片的相对顺序 | **没动**：同一秒的那三张仍是 `复刻 → 特殊字符 → 写一个很长`（秒级时间戳分不出它们，稳定排序保留了原顺序） |
  | 点 `Doing` 列底的 `+` | 建出 `lattice-cards/未命名 3.md`（`status: Doing`），落在 Doing 的**第 9 张 = 末尾**（8 → 9） |
  | 对照：`.base` 加 `sort: [file.name DESC]` | `config.getSort()` = `[{file.name, DESC}]`；数据顺序整列倒过来，`未命名 3` **落回第 8 位** —— 插件完全让位 |
  | 对照：把这段 `sort` 删掉 | `getSort()` = `[]`，`Doing` 的 `未命名 3`、`Backlog` 的 `未命名 1` 都回到末尾 |
  | 反例（改之前的路子） | `config.get('sort')` 对**手写**的 `sort` 也返回 `null` —— 拿它当判据会让插件压掉用户的排序，所以用的是 `getSort()`（见发现 31） |
- **文件树那一行的形貌（2026-10-03 新增）**：`data-path` 在 `.nav-file-title` 上，`.nav-file` 自己没有；
  打了类的 `.nav-file` 读出 `getClientRects().length === 0`、`display: none`。树重建（`vault.create`）
  之后标记仍在，且新文件那行是 `display: block` —— 只藏了那一个路径。
- **点 ribbon 图标开看板（2026-10-03 新增）**：已经开着时按 → 标签页数不变（`bases` leaf 仍是 1）；
  关掉再按 → 新开一个，主区域、`data-view-type="lattice-board"`、4 列、高度 682；再按 → 仍然只有 1 个。
  插件的设置读出来是 `{boardFile: 'lattice-board.base'}`，命令只有 `lattice:open-board`
  （旧那个 `lattice:open-view` 已经不在），设置页只有一条 **Board file**。
- **新卡片落点（2026-10-03 新增）**：见发现 26，两列各自的 `+` 都落在 `lattice-cards/`。
- **空白看板是加载时自己写出来的 —— 两次真机走通（2026-10-08 新增）。** 做法：把测试库复制到 `/tmp`，
  在**副本**里删掉 `lattice-board.base`、把插件目录换成 `lattice-board`、删掉 `data.json`、把
  `community-plugins.json` 指向新 id，`npm run deploy` 进副本，再配一份只指该副本的 `obsidian.json` +
  独立 `--user-data-dir` + CDP 量：
  ① 加载后文件出现，内容与 `BLANK_BOARD` 逐字相同，并弹出「wrote a blank board at "…"」；
  ② 点 ribbon 图标 → `.bases-view` 从 0 变 1、`data-view-type="lattice-board"`、6 列
  （`未分组` 109 张 + 库里那 5 个 `status` 值）、`Add column` 在、**每列列头都有 `+`**；
  ③ 文件树那一行戴着 `lattice-hidden-file` 且 `getClientRects().length === 0`；
  ④ **对照组（已存在的文件不被覆写）**：往文件尾追加一行标记，再 `disablePlugin` / `enablePlugin` →
  标记还在、文件长度只多了那一行、`- type: lattice-board` 仍只出现 1 次；
  ⑤ **带目录的路径**：把 **Board file** 改成 `boards/work.base` 再重载 → `boards/` 目录与
  `boards/work.base` 都被建出来，内容同样是空白看板。
  两次都是「先删掉文件、看它自己回来」，所以①③不是「本来就在那儿」的误读。

- **拖卡片的落点槽 —— 真机量过（2026-10-08 新增）。** 走的是同一个工装，只把「怎么造一次拖拽」换掉了：
  **不用去合成原生鼠标事件，直接用 `DataTransfer` + 合成的 `DragEvent` 打真正的处理函数**——
  `new DataTransfer()`、`setData`、然后往元素上 `dispatchEvent(new DragEvent('dragover', {dataTransfer, clientX,
  clientY, bubbles, cancelable}))`。`types` / `getData` / `defaultPrevented` 都照常工作，所以整条
  `dragstart → dragover → drop → dragend` 能一条条打出来（`dragover` 的目标用 `document.elementFromPoint(x, y)`
  取，跟真的一模一样）。量到的（6 列、Doing 那列 6 张卡）：

  | 打的事件 | 结果 |
  | --- | --- |
  | `dragstart`（Backlog 第 1 张，高 175） | `types = ['application/x-lattice-card']`、源卡片戴 `is-dragging`、槽 0 个 |
  | `dragover` Doing y=300 | `defaultPrevented = true`、Doing 亮、槽在**第 1 个位**、标题 = 源卡片标题、高 **175** = 卡的高度；下面 5 张卡每张**下移 183** = 175 + 8（就是槽的占位） |
  | 再 `dragover` Doing y=700 | 槽落到**第 2 个位**（不是第 3），且**还是同一个 DOM 节点**（`slots[0] === 上一个`）：槽把第 3 张卡的中点推到了指针下方 |
  | `dragover` Backlog（它出来的那一列）y=300 | `defaultPrevented = false`、没有列亮、槽 0 个 |
  | `dragover` 回到 Doing | 槽回来，又是在第 1 个位 |
  | `dragover` y=4000（列底以下） | 槽在**第 7 个位** = 该列真实卡片数，即落到最末 |
  | `dragend`（没有 drop） | `is-dragging` 摘掉、槽 0 个、亮列 0 个 |
  | `dragover` 一个**没见过 `dragstart`** 的卡片载荷（模拟从另一块板子拖过来） | 照样亮列、照样开槽，槽**没有标题**、高 **40** = CSS 的 `min-height`（`--size-4-10`）、没有内联高度 |
  | 真 `drop` 到 Doing | 槽清掉、亮列清掉、文件里出现 `status: Doing`、Backlog 5→4 张、Doing 6→7 张、**只有 6 列**（没有多出一列） |
  | 列拖拽（手柄起拖，落到 Done 左半边）回归 | Done 戴 `is-drop-before`、**槽 0 个**、亮列 0 个、`dragend` 之后竖线 0 条 |

  两处**对照**：① 松开后卡片落在 Doing 的**第 3 张**，而槽画的是第 1、2 个位 —— 这就是「列内位置只是画出来的」
  的实测证据（见「卡片落在哪」）；② 把 `.base` 的 `latticeGroupBy` 临时改成 `file.name`（派生属性）再拖，
  **三列全都不亮、槽 0 个、`defaultPrevented` 全是 false**（改完立刻还原）。另外把某一列的
  `.lattice-column-cards` 临时清空（白箱模拟「手动加出来的空列」）：`defaultPrevented = true`、槽在**第 0 个位**、高
  175，之后把卡片放回去，收尾时全板槽 0、`is-dragging` 0、亮列 0。

**未验证，需要真机确认**：

- `containerEl` 的生命周期。`onDataUpdated` 每次都整个重建 DOM，如果 Bases 在编辑过程中触发更新，正在输入的内容可能被吞掉。
- `Value.renderTo` 在窄卡片里的观感（长值会不会撑破）
- 拖拽手感。我用的是 HTML5 原生 drag & drop，Obsidian 自己有拖拽体系，两者在 `obsidian.md` 里的表现要实测。
- **拖列时 `setDragImage(columnEl, ...)` 是否被正常快照。** 用它是为了让拖拽影像跟着整列而不是
  那个 16px 的图标走。若 Electron 下影像不对，退路是让整个列头当拖拽起点。
- **`dragover` 期间 `dataTransfer.types` 是否稳定带着自定义类型 —— 已经被真人拖动证实。** 两种拖拽的
  路由全靠它（拖拽进行中数据不可读，只有类型可读）。**真人拿鼠标拖一张卡片时目标列会亮起**，而亮列
  这一步就在 `types.includes(LATTICE_CARD_DRAG_TYPE)` 之后 —— 所以这一支在真实拖动下是通的
  （合成事件的量测只是把「亮得对不对」补齐，不能单独作数）。**顺带一提：拖拽进行中 `dropEffect` 读不出来**
  —— 合成事件里给它赋 `'none'` / `'move'`，读回来一律是 `'none'`。要看「这一列接不接」只能看
  `dragover` 有没有被 `preventDefault`（接 = `true`）。
- **`config.set` 是否真的持久化 —— 已证实（2026-10-02）。** 测试 vault 里的 `lattice-board.base`
  已经出现了 `latticeColumnOrder: [Backlog, Doing, Done, Blocked]`，而这个 key 从没被手写进去过。
  顺带看到 Obsidian 会把 `.base` 重新序列化（自己加回去 `type: table/cards/list` 那几个视图，
  并把 `note.priority` 规范成 `priority`）—— 所以别拿「文件里长什么样」当代码写入了什么的证据，
  要看 key 在不在。剩下待确认的是**重开视图后顺序是否还在**。
- **列头按钮的点击会不会穿透到列本身 —— 已证实不穿透（2026-10-08）。** 用可信点击（CDP
  `Input.dispatchMouseEvent`）落在 `⋯` 上：菜单在它旁边打开，列本身没有任何反应。无值列的 `⋯`
  现在只剩 `Delete column` 一项（见「两种拖拽」与发现 30）。
- **看板文件被改名或搬走之后，插件跟不上。** 设置里存的是**路径字符串**，不是文件引用：改名之后文件树
  那一行会自己回来（新的路径没人藏）。**2026-10-08 起这一条的后果变了**：旧路径已经没有文件，于是
  加载时插件会在旧路径上**再写一份空白看板**（并弹一条 Notice）—— 比原来那句「no file at …」好懂，
  但那块新板子是空壳，真正的板子（改名后那个）得自己在设置里指过去。要么在设置页里做个文件选择器，
  要么监听 `rename` 事件顺手改设置。另外**换一个看板**（设置指向别的 `.base`）也是同一个手动步骤，
  没做过。
- **藏文件这件事只覆盖主窗口。** `document.head` / `document.body` 拿的是主窗口那一份，弹出式窗口有自己的
  文件树，那里面这一行不会藏（`property-menu.ts` 同样只覆盖主窗口）。要覆盖得多留一份 `<style>` 或每窗口
  各观察一遍，现在没做。另外**插件加载时文件树折叠着、或文件树面板根本没开**这两种起手也没单独量过 ——
  观察器那一支已经证明能用（见「真机取证」），理论上同一条路。
- **空路径时的行为没在设置页上手动走过。** 把 Board file 清空 → 存回默认名 `lattice-board.base`
  （空框按「还在打字」处理）。这一段只有类型检查。
- **Add column 那条路只做过静态检查。** 按钮按下即弹窗（这一版把中间的菜单去掉了）、输入框的初始
  焦点、回车提交、空名字时确定键是灰的、弹窗里的 `Restore "…"` 胶囊按下去即以该名字作答 ——
  这些只有类型检查、lint 和离屏渲染保证，没在真机上点过。
- **属性菜单的内部结构仍然只有静态推理。** 工具栏那半边已经验证了（那个类确实同时落在按钮与菜单
  两个元素上，见上），但**菜单本体里**的东西 —— `mod-implicit` 标记、项名节点、`appendChild` 到
  `body` —— 还没有真机证据：要等菜单真被打开才有东西可看，而程序化点击打不开菜单（见上）。
  得真人点一次，或者让插件把菜单结构写进一个文件再回读。
- **`setIcon` 出来的 svg 是否带 `--icon-size` 以外的尺寸干扰。** 离屏是照着手写的 svg 量的
  （14px 正确），真机上 `setIcon` 产物的 class 组合一致，理论上一样。
- **`:has(~ …)` 哪天不再匹配，失效方向是安全的**（兄弟关系本身已经是真机事实了，见上）：核心一旦把
  `.bases-view` 挪进一层包装，规则不命中，那三个按钮就自己回来，不会误伤别处。
- **「添加视图」的接管同样没在真机上验过 —— 而且现在整条路被 CSS 挡着。** 视图按钮在看板上被藏了
  （见发现 21），接管的触发条件因此不可达，所以这一段代码目前处于「看着没人调用、也没有运行时影响」的
  状态。要验它得先取消隐藏。菜单名（`.menu.bases-toolbar-views-menu`）、
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
    **2026-10-08 把这条量实了（两处都反直觉，所以都记下来）**：① `setData(type, '')` **不会**把类型
    弄丢 —— 构造型 `DataTransfer` 读回来 `types = ['application/x-lattice-column']`、`getData` 是空串，
    所以**载荷为空不等于路由失效**，「空串 = 没有数据」这个假设才是错的；② 空串**能进出 `.base`**——
    真实拖动之后文件里写出的就是 `- ""`，重新加载后列的位置照旧，所以老文件里带空 key 是正常状态，
    不是损坏。**推论**：无值列钉死在最后这件事（发现 30）不能只在写入端拦，必须在读取端也压过它。
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
21. **工具栏的排序 / 筛选 / 视图三个按钮藏掉了，做法是 CSS 而不是 JS 补丁。** 排序和筛选对看板没有
    意义（排的是表格的问题，看板用列来回答），用户要求先收起来、等板子自己支持了再说；**视图菜单连
    入口一起先收起来**（用户：「这个功能暂时隐藏」）—— 虽然「添加视图」已被接管成只加看板，但既有
    `.base` 里通常还躺着几个核心早期建的**表格**视图，能切过去就等于掉出看板，而看板也还没打算回答
    「多视图」这件事。三条规则写在同一个选择器组里。关键事实是**工具栏不在视图容器里面，而是它的
    兄弟节点** —— 核心的构造顺序是：

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
    .bases-header:has(~ .bases-view.lattice-board) .bases-toolbar-item.bases-toolbar-filter-menu,
    .bases-header:has(~ .bases-view.lattice-board) .bases-toolbar-item.bases-toolbar-views-menu
    ```

    **为什么要限定在看板上**：这三个都是**每一个** Bases 视图的按钮，一条不分视图的规则会把表格视图
    的按钮一起拿走（而筛选还是 `.base` 级的 `filters:`，表格正在用）。限定之后别的视图照旧 ——
    `styles.css` 末尾那段注释里留着「放回来的时候把这一整块删掉」。

    三个类名都是核心给的、不是猜的：类名的落点是 `VY` 建的
    `this.containerEl = e.createDiv("bases-toolbar-item")`（`.text-icon-button` 是它的孩子）。视图菜单
    那个类是同一个落点：`HY.prototype.addClass = function(e){ this.button.addContainerClass(e);
    this.menu.menuEl.addClass(e) }`，视图菜单构造出来紧接着就 `o.addClass("bases-toolbar-views-menu")`
    —— 一个类名同时落在**按钮容器**和**菜单本体**两处，这正是 `view-menu.ts` 必须用 `.menu.bases-toolbar-views-menu`
    而不是 `.bases-toolbar-views-menu` 去认菜单的原因（按钮在文档顺序里在前）。
    核心自己在打印模式下就是这么藏排序按钮的 —— `.print .bases-toolbar .bases-toolbar-item.bases-toolbar-sort-menu
    { display: none }`。特异度也够：核心 `.bases-toolbar .bases-toolbar-item { display: flex }` 是 (0,2,0)，
    我们这条 (0,5,0) 覆盖它绰绰有余。

    一条差点把结论写反的账：**藏掉右边那两个按钮并不会把它们右边的按钮拉过来。** 结果计数项带
    `margin-inline-end: auto`，那是核心自己的留白，它把后面的按钮组顶到最右 —— 所以改动前后
    `属性` / `新建` 的位置**一像素不差**，变大的只是中间那段空白。**视图按钮不受这条保护**：它在
    结果计数**左边**，藏掉它等于把左边那一段整体往左推，结果计数会贴到工具栏左端。
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

    **但这条现在整条不可达**：发现 21 把视图按钮也藏了，菜单开不出来，接管就没有触发条件。
    `view-menu.ts` 因此处于「没有运行时影响」的状态。代码留着是有意的 —— 用户要隐藏的是入口，
    不是这件事的做法；入口放回来的那天，它就接着管用。
23. **看板搜不到卡片标题 —— 搜索范围被核心写死在 `getOrder()` 上。** 用户报「搜索无效」，真机一量：
    搜标题里的词（「拖拽」）→ 计数写「显示 0」、看板空；搜字段值（`High`）→ 正常 3 张。
    根因整个在核心的 `notifyView` 里 —— **搜索不是视图做的事**：

    ```js
    var p = this.applySearchQuery(h, u.getOrder());   // h = 全量 results，u = viewConfig
    ...
    o.data = new l$(i, u, d, p), o.onDataUpdated();   // 过滤完的结果直接推给视图
    ```

    范围就是 `viewConfig.getOrder()` —— 表格里是可见列，**看板里是卡片字段**。卡片标题
    （`file.name`）不是「字段」，于是永远不在范围里，搜任何标题都必然 0 条。核心没给范围留参数，
    `BasesView` 的原型链上也没有任何搜索相关的钩子（只有 `updateProperty` / `exportTable` 这些），
    所以这跟视图自己怎么写无关 —— 它拿到的数据已经被砍过了。

    **修法（`src/bases/search-scope.ts`）：把 `file.name` 加进范围。** `getOrder` 是原型方法，
    在**这一个 config 实例**上盖一个自有属性，就只影响这个视图：

    ```ts
    const order = config.getOrder.bind(config);
    config.getOrder = () => searchedProperties(order());   // [...order, 'file.name']
    ```

    为什么比「视图自己再过滤一遍」省得多：

    - **计数是诚实的。** 核心按**它自己过滤的结果**计数，输入框旁边「显示 N」与板上的卡片数永远一致；
      视图另过滤一遍就会变成「显示 0、板上 3 张」。
    - **卡片不会多出一个字段。** 看板渲染字段前先过 `isBoardProperty()`，`file.*` 被滤掉，标题变不成
      胶囊（真机复核：卡片上仍是 `等级 / priority / tags`）。
    - **不写盘。** `getOrder` 只被读，`.base` 里不会多出 `file.name`。
    - **别的视图不受影响。** `.base` 里每个视图有自己的 config 实例，表格照旧搜它的列。

    真机上的对照：对「拖拽」，`applySearchQuery(all, order)` = **0**，换成 `['file.name', ...order]`
    = **1**；改完之后搜「拖拽」板上 1 张、写「显示 1」，`High` 仍是 3、`task` 仍是 7、不存在的词 0、
    清空 7，卡片字段没变。

    **没做进去的**：卡片描述（正文首段）仍然搜不到 —— 它不是属性，`getValue` 拿不到；要搜正文得自己读
    文件内容再过滤，而过滤早在核心那边做完了（视图拿到的是过滤后的 `data`）。真要做，得绕过 `data`
    去读 `controller.results`（全量，见「真机取证」一节），那条路更脏，先不动。

24. **侧栏没有「扩大」这种按钮，而且不是「没画」而是「画在了看不见的地方」—— 侧栏的 header 整个是
    `display: none`。** 用户报「侧边栏没有扩大按钮」。第一版做法是 `ItemView.addAction('maximize-2', ...)`
    —— 那是公开 API，加出来的按钮也确实出现在 `.view-actions` 里、`aria-label` 对、回调点得动、
    **真机自动化全绿**。可人看不见它：真机一量，侧栏 leaf 的 `.view-header` 是
    `display: none`（`getClientRects()` 为 0），而 `addAction` 写的正是那个 header 里的
    `.view-actions`。核心自己的书签、阅读模式、更多三个按钮也一起在那儿藏着 —— 也就是说，侧栏里
    **从来没有过** view header 按钮。

    **教训是量法，不是结论**：那一轮断言查的是「元素在不在 DOM 里」「回调触发没触发」，两样都通过，
    而查的对象是一个 `display: none` 父元素下、0×0 的按钮。**判可见性要 `getClientRects().length`,
    再补一次 `document.elementFromPoint(按钮中心)` 看返回的是不是它自己**（前者证明有盒子，后者证明
    没有被压住）。同类的账之前记过一次（胶囊那次「只桩变量会假通过」）。

    现在的做法：按钮不进 header，走 `view.containerEl.createEl('button', ...)` 直接放在
    `.workspace-leaf-content` 里，绝对定位到右上角；容器加 `.lattice-with-new-tab` 把 `position` 定成
    `relative`（真机上它**本来就是** `relative`，但不靠这个巧合），按钮加 `.lattice-new-tab` 上背景/边框/
    阴影，并借核心的 `clickable-icon` 类保证观感与 header 按钮一致。实测：32×28，`elementFromPoint`
    返回的是按钮自己，`z-index` 取到 `--layer-cover`。

    另外两条行为上的选择：**只在右栏加**（`leaf.getRoot() === rightSplit`，被拖进主区域的 tab 已经在
    外面了）；**已经开着就切过去**（`openLinkText(..., 'tab')` 每按一次都会再开一个同名标签页，所以先
    在主区域找有没有显示同一篇的 leaf，有就 `revealLeaf`）。按钮问的也是 `leaf.view.file`
    （抽屉**现在**显示的那篇），不是点卡片时记下的那篇。
25. **「排除文件」藏不了文件树 —— 它是给搜索用的，不是给文件树用的。** 想让 `lattice-board.base`
    不出现在文件树里，第一反应是把它加进 Obsidian 的「排除文件」。回读 `app.js`：`userIgnoreFilters`
    只被这几个地方读 —— 搜索、快速切换、链接建议、图谱、反链、标签面板，**以及 Bases 自己那条查询**
    （`for (...) if (!metadataCache.isUserIgnored(path))`，也就是说排除掉的文件连看板都不会收）。文件树
    一次都没读它。所以排除只会让文件从搜索结果里消失，树里照旧。
    
    第二条想到的路是注入一个 `<style>` 元素把那一行写死 —— **社区插件规范禁止**（`obsidianmd` 的
    `no-forbidden-elements`，`npm run lint` 直接报 error，见下条）。而 CSS 规则本身也写不死：规则要的是
    路径，路径是用户的，只有那一行 DOM 自己知道。所以最后落到「观察文件树 + 打一个类」，规则写在
    `styles.css` 里 —— 和 `property-menu.ts` 同一个形状，也同一个失效方向。

    真机拿到的两件事：**`data-path` 挂在 `.nav-file-title`（内层）上，不在 `.nav-file`（tree-item）上**
    —— 藏的是外层那一行（内层藏了外层还占一条高度），所以选择器是
    `.nav-file:has(.nav-file-title[data-path="…"])`；以及**树重建之后标记跟着重建**（`vault.create`
    造一个新文件 → 树新增一行 → 观察器那一支真的跑到 → 那行仍是 `display: none`，而新文件那行
    `display: block`，即藏的是一个路径而不是一类文件）。
26. **新卡片的目录由 `.base` 的 `newItemFolder` 决定，而且缺目录时是「静默什么都不发生」。**
    `BasesView.createFileForView(baseFileName, frontmatterProcessor)` 自己什么都不建，转手
    `queryController.newItemMenu.open(e, t)`；目录按这个顺序挑：
    `newItemFolder` → `newItemTemplate` 所在目录 → `IY(app, query, viewConfig).folder` →
    `fileManager.getNewFileParent(...)`（也就是 Obsidian「新笔记默认位置」）。**全是核心的键，插件拦不到**，
    写进 `.base` 就生效，且对每一列都一样：先在目录里 `vault.create`，再 `processFrontMatter` 写值。

    真机（`lattice-cards/` 存在，看的板是 `note.status`）：未分组列的 `+` → `lattice-cards/未命名 2.md`，
    frontmatter 只有 `tags: [task]` + 空的自定义属性（**没有 `status`**），列计数 2→3；Backlog 列的 `+`
    → `lattice-cards/未命名 3.md`，带 `status: Backlog`，计数 4→5。**两列都落在文件夹里。**

    坑在**目录不存在**时。`vault.create` 是 `checkPath`（只校验名字合法）→ `adapter.exists` →
    `adapter.write`，而 `write` 里就是一句 `fsPromises.writeFile`，**不建父目录**；写失败又被
    `try/finally` 里的 `reconcileInternalFile` 吃掉，最后 `vault.create` 正常 resolve。所以把
    `lattice-cards` 改名走再点 `+`：**没有新文件、没有 Notice、没有异常** —— 一个按下去什么都不发生的按钮。
    插件那边 `await createFileForView(...)` 也收不到拒绝，捕不到。要么用户自己保证目录存在（`examples/`
    里已经写明），要么等「视图怎么知道自己是哪个 `.base`」有答案之后，在按 `+` 那一刻补建目录。
27. **图标名不认识是静默失效，而它只活在该版 Obsidian 打包的 Lucide 里。**
    `setIcon` 的真身是三行的 `Jm(e, t)`：拿 `e.firstChild` 比一下类名，不一样就 `removeChild`，再用
    `getIcon(t)` 取新的，**取到 null 就结束** —— 元素被清空了，且没有任何异常和日志。名字也不是稳定
    API：同一个图标在现在的 Lucide 叫 `square-kanban`，Obsidian 1.12.4 里叫 `kanban-square`。

    所以换图标只能「对着 `getIconIds()` 查 + 上真机量 DOM」，而真机的断言要**比指纹**：按钮戴
    `svg-icon lucide-<name>`，形状还能数。`kanban-square` = 1 rect + 3 path，被换掉的 `layout-grid` =
    4 rect + 0 path —— 后者让「画出来了」这种弱断言变得没用，必须写明预期形状。

    顺带量到核心自己怎么用这套图标：**「新建白板」= `layout-dashboard`、「新建数据库」= `layout-list`**，
    也就是说 `layout-*` 那一族和核心的词汇是重叠的。另有一条环境事实：**1.12.4 的渲染进程里只有
    `app` / `Notice` / `moment` 是全局**，`setIcon` / `getIcon` / `getIconIds` 都不是，
    `require('obsidian')` 在插件沙箱外也取不到模块 —— 真机取证只能走 DOM。

28. **`Group by` 只在被藏掉的视图菜单里 —— 藏入口顺手把「配置这块板子」也一起藏了（2026-10-08）。**
    核心给插件视图渲染配置项的那一页是 `a$`（标题 `labelConfigureView()`）：`Group by`、两个开关、
    属性顺序都在里面，而它**只有两个入口**，两个都在 `o$`（视图菜单）里 ——

    ```js
    // o$ 的构造：视图按钮自己
    o.button.buttonEl.addEventListener("contextmenu", e => { ... r.show(new a$(r, t, false)) });
    // o$.onOpen：菜单里每一行右侧那个 chevron-right
    this.show(new r$(this).onNext(e => this.show(new a$(this, e, false))));
    ```

    ⇒ 这一页的 DOM 全部挂在 `.bases-toolbar-views-menu` 这个按钮的子树上，而它正是发现 21 里被 CSS
    藏掉的那个按钮。**结论：看板上目前没有任何办法改 `Group by`，只能改 `.base` 文件。** 这也是
    `board-seed.ts` 的种子必须自带 `latticeGroupBy` 的直接原因（不带的板子连 `Add column` 都不发，
    见「看板文件、卡片文件夹、入口」）。**这一条只在发现 21 生效之后才成立** —— 视图入口放回来的那天，
    它跟着作废。

29. **落点槽的位置是「画出来」的，卡片最终落哪不归看板管（2026-10-08）。** 拖卡片时列里会开一个虚线槽
    （`.lattice-card-slot`，高度按被拖的那张卡量、写它自己的标题），位置由 `cardDropIndex(midpoints,
    clientY)` 算 —— 但**列内顺序来自 `.base` 的 sort，而 `moveCard` 只写那一个 frontmatter 值**。
    真机对照过：槽画在 Doing 的第 2 个位，松手后卡片落在第 3 张。所以槽只能读成「会进这一列」，
    不能读成「会插在这儿」；要让它名副其实，得先做列内手动排序（见「下一步」第 5 条）。

    同一个槽还有两条必须记住的：**量 `midpoints` 时要跳过槽自己**（它自己占位置，否则「槽该放哪」的
    答案里混进了槽自己的高度）；**拖回原来那一列、或板子的 `latticeGroupBy` 是派生属性时，整条反馈都不发**
    （不 `preventDefault`、不亮列、不开槽），光标自己会说放不下 —— 这一条是 2026-10-08 改的，
    改之前任何一列都会亮起来，包括点了什么都不会发生的那种。

30. **无值列的位置要「规则」，不要「数据的副作用」—— 而且规则得在读取端压过文件（2026-10-08）。**
    它原先的落点是 `deriveColumns` 的副产物：按取值第一次出现的顺序，于是「第一张无值笔记落在哪儿」
    就决定了它在哪，夹在值列中间。要把它钉到最后，有三处不能少：① **`withNoValueLast` 排在
    `applyOrder` 之后**（不是之前，否则顺序列表把它拖回中间）；② **不能只在 `config.set` 里过滤空 key**，
    因为**老 `.base` 里就写着 `- ""`**（真实拖动写进去的，见发现 10），过滤只保证「以后不再写」，
    读取端还得压过它 —— 真机上文件里 `- ""` 排第一、画出来仍在最后，就是这一条的证据；③ **它不是
    「拖了没反应」，而是「没有载荷」**：列头那枚图钉没有 `dragstart`，`dataTransfer.types` 是空数组，
    所以不必在 `dropColumn` 里为它写一条特殊分支（那条分支要靠「拖过来的是它」来判断，而它根本拖不过来）。
    剩下要单独想的是**别的东西落在它身上**：`dropSide` 一律当左半边，因为「插到它右边」这件事不存在，
    竖线得画在它左边（真机量过：指针在它右半边，竖线是 `(未分组):before`）。
31. **「没有排序」不等于「没有顺序」，而默认的那条顺序是文件名（2026-10-09）。** 核心对没有 `sort` 的
    视图交出的数据是按**文件名**排的（中文走拼音：`未(wei) < 写(xie)`），于是 `+` 建出来的 `未命名`
    会插到 `写一个很长的标题` 前面 —— 一个看起来像 bug 的正常行为。想接管这条顺序，判据只有
    **`BasesViewConfig.getSort()`**（`@since 1.10.0`，返回 `BasesSortConfig[]`，没有排序时是 `[]`，
    类型定义里还顺手写明「data from BasesQueryResult will be presorted」）。
    **`config.get('sort')` 对它返回 `null`**：`get` 只认识 `BasesViewRegistration.options` 里注册过的键 ——
    视图自己 `config.set` 进 `.base` 的那几个 `lattice*` 键读得到，核心的键一个都读不到（`get('order')`
    同样是 `null`，而 `.base` 里明明写着 `order:`）。`config` 对象上确实挂着一个 `sort` 字段（还有 `order`、
    `query`），是那份 `.base` 配置直接落到实例上的，**但没有文档**，不该用；`config.query` 甚至整棵
    解析树都挂着，还是循环引用。
    另外创建时间在 **`entry.file.stat.ctime`**（`TFile` 上是 `stat`，`file.ctime` 是 `undefined`），
    而且**只到秒**：同一秒建的卡片分不出先后，也就只能让它们保持原顺序（见「卡片在列里怎么排」）。

## 下一步（按 wolai 差异点排序）

1. **列的手动管理** —— 顺序、移除、**新增／预置空列**都已做（见「列的管理」「新增列」）。
   还差 wolai 里「把列隐藏起来但又留着」那种纯隐藏语义 —— 现在只有「从本板移除」。
   另外普通列在最后一张卡片离开时会消失，手动加的列不会；若这两种要统一（列一旦出现就留下），
   得先决定「数据不再产生某列」时该不该自动把它转成手动列。
2. **子分组泳道** —— Bases 完全没有这个概念，也是差异化里最硬的一张牌。
3. **列底的「+ 新增」** —— **已做（2026-10-08）**：列头那个 `+` 之外，每列最后一张卡片下面还有一条
   整列宽的 `+`（两处共用 `cardTargetKey(groupBy)`，一起在或一起不在；走 `createFileForView` 并预填
   分组值，落盘目录来自 `.base` 顶层的 `newItemFolder`，见发现 26；`minAppVersion` 也因此停在 1.10.2）。
   见「卡片从哪来」。**与 wolai 的一处差别是刻意的**：它是一条**实底**的横条，不是虚线框 ——
   虚线在这个看板上已经有主了（那是拖拽的落点槽），一条虚线框会被读成「一张等着被填的空卡」。
4. **列头颜色映射** —— 已做：列头与卡片上同一个值共用同一个颜色（见「卡片的样子与标签的颜色」）。
   还差 wolai 的「跟随单选标签色」那一层：现在颜色由值文本哈希决定，而不是读用户在属性选项里
   配的颜色。等 Bases 的属性选项能带颜色，或者我们自己加一份配色设置时再接。
5. **拖拽补完** —— 列之间已经能拖（手柄起拖 + 竖线落点），卡片拖到哪一列也有落点槽了（虚线框 + 标题，
   跟着指针走，见「卡片落在哪」）。还差**列内排序**：卡片在列里的先后，以及排序结果的持久化。**这是
   落点槽目前唯一还没兑现的承诺** —— 槽画在第 2 个位，卡片可能落在第 3 张。要兑现得做三件事：
   ① 一份每列自己的卡片顺序（存哪儿待定：`.base` 里按列名存一串路径，或者每张笔记上一个排序键）；
   ② 与「不在那份名单里的卡片」和解（新卡片、被别的工具改了状态的卡片）—— 名单外的按数据原顺序接在后面
   是最省事的答案；③ 加了顺序之后再想「排序属性改了怎么办」，因为 Bases 自己的 sort 和它必然打架。
   **③ 已经有了一半答案**：没有 `sort` 时看板自己用的是创建时间（见「卡片在列里怎么排」），所以「谁排的序」
   这条优先级链已经存在 —— 手动顺序要插进去的是这条链的**最上面**（手动 > `.base` 的 sort > 创建时间）。
