# 校园版与雨课堂版接口差异

1.2.0的官方版仅改变请求域名，仍发送学校LMS课程列表和 `xtbz: cloud`。这不能证明官方登录后的课程接口兼容。此前正常学生观察中，官方域名复用学校列表曾返回 `count: 0`，而指定课堂的学习单元、待办与学习统计可以读取。

## 1.2.1适配

| 操作 | 校园版 | 雨课堂版 |
| --- | --- | --- |
| 连接入口 | `/pro/` | `/v2/web/index` |
| 学生课程列表 | `/mooc-api/v1/lms/user/user-courses/` | `/v2/api/web/courses/list?identity=2` |
| 请求头 | `xtbz: cloud` | `xtbz: ykt`、`Xt-Agent: web` |
| 返回结构 | `data.product_list` | `data.list`，每项包含班级及课程对象 |
| 线上SKU及学校上下文 | 学校LMS课程对象 | `/v2/api/web/classrooms/{classroom_id}?role=5`的`sku_id`或`free_sku_id`、学校和平台信息 |

官方版目录请求使用学校上下文0，以获取账号的原生课程列表。逐课请求使用实际学校与平台。待办和学习统计继续访问同一域名的学生接口；读取不到SKU的普通课堂显示未配置线上单元，避免请求SKU为0的地址。播放仍须课程待办同步成功，服务器明确返回完成后才标记完成。

## 依据与验证范围

官方公开前端脚本：

- `https://fe-static-yuketang.yuketang.cn/fe/static/web/1.2.346/js/pc.d9f8a19f.js`定义了`GET_CLASS_LIST`为`/v2/api/web/courses/list`，学生首页以`identity: 2`读取`data.list`，普通官方请求默认`xtbz: ykt`。学生课程卡片读取`course.university_id`和`course.platform`。
- `https://fe-static-yuketang.yuketang.cn/fe/static/web/1.2.346/js/96412.c48163e2.js`的学生课程页读取`/v2/api/web/classrooms/{id}?role=5`，以`sku_id || free_sku_id`定位线上学习单元。
- 历史正常学生观察确认官方域名可读取指定课程的待办和学习统计。原始捕获保留在本地调查目录，没有打包或提交个人数据。

这些脚本建立了接口选择和字段的静态依据。新适配通过模拟响应测试覆盖列表、详情、学校上下文、待办、播放入口、无线上SKU及登录失败。只读本机验证确认官方连接进入`/v2/web/index`，但可访问的旧调试会话在原生课程接口返回HTTP401；真实课程列表、任务状态与长期观看尚未通过有效账号实测。用户其他Chrome配置中的登录状态没有据此判定。

同步失败会保留已有缓存并显示HTTP状态或接口错误码；整批刷新失败时不允许开始旧缓存中的任务。不会将接口失败显示为“没有课程”。
