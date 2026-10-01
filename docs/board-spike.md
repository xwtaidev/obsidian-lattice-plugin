# Lattice 看板 spike（Bases 路线）

## 这个 spike 要回答什么

一句话：**Bases 能不能承载 wolai 式的看板，还是必须自己写数据层。**

结论：**能**。代价是 `minAppVersion` 一路抬到了 **1.10.2**（`createFileForView` 的门槛）；有一处必须绕开的坑，见下面的发现清单第 1 条。

## 实现

| 文件 | 职责 |
| --- | --- |
| `src/bases/register.ts` | 注册 Bases 视图，声明两个视图配置项（Group by / Show property names） |
| `src/bases/lattice-bases-view.ts` | 视图本体：列头、卡片、两种拖拽、列菜单 |
| `src/bases/grouping.ts` | 分组、列顺序/移除/重排、写回规则，纯函数、无 DOM 无副作用，可直接单测 |
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

## 怎么试

```bash
npm run build
npm run deploy -- <vault-path>
```

然后在 Obsidian 里：

1. 把 `examples/lattice-board.base` 拷进 vault 任意目录，打开它。视图类型已经写成 `lattice-board`。
2. 若显示的不是看板，用视图右上角切换到 **Lattice board**。
3. 打开视图配置菜单，在 **Group by** 里选一个属性（比如 `status`）。列会按该属性的值分出来。
4. 把一张卡片拖到另一列，然后去看那个笔记的 frontmatter —— 分组属性的值应该已经改了。
   **同时确认其他列没有挪位。**（这是本轮修的 bug：列顺序原本会被卡片拖拽重排。）
5. 拖到 **No value** 列会删掉该属性。
6. **拖列头最左的手柄**左右移动：目标位置应该出现一条强调色竖线，松手后列落到那一侧。
   再拖列里的一张卡片，确认只动了卡片、没动列。
7. 列头的 **…** 菜单里试 Move left / right / start / end，看列的左右位置是否真的变了，再打开 `.base` 文件确认 `latticeColumnOrder` 被写了进去。
8. 列头的 **+** 新建一张卡片，确认新建的笔记 frontmatter 里已经带上本列的分组值。
9. 列头的 **… → Delete column**，确认弹窗讲清了「不修改任何文件」，确认后该列消失。

仓库里没有测试运行器，这个 spike 靠真机验证。

## 已验证 / 未验证

静态验证（全部通过）：

- `npm run build` —— 类型检查 + 打包通过，说明所有 API 签名都对得上
- `npm run lint` —— 0 error
- `npm run check:manifest` —— 全绿
- `grouping.ts` 的纯函数跑过一组一次性断言（**115 项**：分组、移除、显式顺序、`moveColumn` 的边界、
  `reorderByDrop` 的全部 32 种落点 + 8 个手算用例、`columnKey` / `writablePropertyKey`）。
  项目还没有测试运行器，断言脚本写在 repo 外的 `/tmp`，没有进库。
- 列顺序不随卡片变动的结论，是先写脚本跑出来才改的代码（`/tmp/lattice-drag-proof.ts`）：
  确认 `Backlog→Done` 会让列顺序从 `[Backlog, Doing]` 变成 `[Done, Doing, Backlog]`。

**未验证，需要真机确认**（我这边跑不了 Obsidian）：

- `containerEl` 的生命周期。`onDataUpdated` 每次都整个重建 DOM，如果 Bases 在编辑过程中触发更新，正在输入的内容可能被吞掉。
- `Value.renderTo` 在窄卡片里的观感（长值会不会撑破）
- 拖拽手感。我用的是 HTML5 原生 drag & drop，Obsidian 自己有拖拽体系，两者在 `obsidian.md` 里的表现要实测。
- **拖列时 `setDragImage(columnEl, ...)` 是否被正常快照。** 用它是为了让拖拽影像跟着整列而不是
  那个 16px 的图标走。若 Electron 下影像不对，退路是让整个列头当拖拽起点。
- **`dragover` 期间 `dataTransfer.types` 是否稳定带着自定义类型。** 两种拖拽的路由全靠它 ——
  拖拽进行中数据不可读，只有类型可读。若不稳，退路是记在视图实例上。
- **`config.set` 是否真的持久化。** 它现在承担了列顺序与移除状态。要确认两点：`.base` 文件里确实
  出现了 `latticeColumnOrder`，且重开视图后顺序还在。文档只说「Store configuration data for the
  view」，没承诺写盘时机。
- **列头按钮的点击会不会穿透到列本身。** 用了 `stopPropagation`，未实测。

## 发现清单

1. **`groupBy` 会和核心 Bases 撞 key。** 官方 Bases 语法里，view 级本来就有 `groupBy`、`order`、`filters`、`summaries`、`limit`，文档明确要求插件视图不要占用核心已用的键。所以 Lattice 的配置键统一加了前缀：`latticeGroupBy`、`latticeShowPropertyNames`。**不要**改回裸名。
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

## 下一步（按 wolai 差异点排序）

1. **列的手动管理** —— 顺序与移除已做（见上）。还差 **新增／预置空列**：把一个还不存在的值插进
   列列表（从 `latticeRemovedColumns` 里去掉、再插进 `latticeColumnOrder`），以及列头配色。
2. **子分组泳道** —— Bases 完全没有这个概念，也是差异化里最硬的一张牌。
3. **列底「+ 新增」并预填分组值** —— `createFileForView(baseFileName, frontmatterProcessor)` 正好是这个用途；它是 `@since 1.10.2`，届时 `minAppVersion` 要再抬一次。
4. **列头颜色映射** —— 跟随单选标签色。
5. **拖拽补完** —— 列之间已经能拖（手柄起拖 + 竖线落点）。还差**列内排序**：卡片在列里的先后，
   以及排序结果的持久化（frontmatter 属性）。
