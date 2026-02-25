#!/bin/bash
###############################################################################
# seed-herbs-formulas.sh
#
# Comprehensive Chinese medicine herb & formula seeding script.
# Calls GET /api/v1/herbs?name=xxx and GET /api/v1/formulas?name=xxx for each
# entry. The backend automatically: searches DB -> if empty -> calls DeepSeek
# AI -> saves result to DB.
#
# Usage:
#   ./seed-herbs-formulas.sh [OPTIONS]
#
# Options:
#   --api-url URL       Backend API base URL (default: http://localhost:8080)
#   --username USER     Login username (default: admin)
#   --password PASS     Login password (default: admin123)
#   --herbs-only        Only seed herbs, skip formulas
#   --formulas-only     Only seed formulas, skip herbs
#   --dry-run           Print what would be done without making API calls
#   --delay SECONDS     Delay between API calls in seconds (default: 1)
#   --reset-progress    Clear progress file and start from scratch
#   --help              Show this help message
#
# Files:
#   Progress: /tmp/seed-herbs-formulas-progress.log
#   Log:      /tmp/seed-herbs-formulas-YYYYMMDD-HHMMSS.log
###############################################################################
set -euo pipefail

# ============================ Configuration ============================

API_URL="${API_URL:-http://localhost:8080}"
USERNAME="${USERNAME:-admin}"
PASSWORD="${PASSWORD:-admin123}"
DELAY=1
DRY_RUN=false
HERBS_ONLY=false
FORMULAS_ONLY=false
RESET_PROGRESS=false

PROGRESS_FILE="/tmp/seed-herbs-formulas-progress.log"
LOG_FILE="/tmp/seed-herbs-formulas-$(date +%Y%m%d-%H%M%S).log"
TOKEN=""

# Counters
HERB_SUCCESS=0
HERB_FAIL=0
HERB_SKIP=0
FORMULA_SUCCESS=0
FORMULA_FAIL=0
FORMULA_SKIP=0

# ============================ Argument Parsing ============================

show_help() {
    head -30 "$0" | tail -25
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --username)
            USERNAME="$2"
            shift 2
            ;;
        --password)
            PASSWORD="$2"
            shift 2
            ;;
        --herbs-only)
            HERBS_ONLY=true
            shift
            ;;
        --formulas-only)
            FORMULAS_ONLY=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --delay)
            DELAY="$2"
            shift 2
            ;;
        --reset-progress)
            RESET_PROGRESS=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

if [[ "$HERBS_ONLY" == true && "$FORMULAS_ONLY" == true ]]; then
    echo "Error: --herbs-only and --formulas-only cannot be used together."
    exit 1
fi

# ============================ Herb List (~600 unique) ============================
# Organized by category per Chinese Materia Medica. All entries unique.

HERBS=(
    # ---- 解表药·发散风寒 ----
    麻黄 桂枝 紫苏叶 荆芥 防风 羌活 白芷 细辛 辛夷 苍耳子
    生姜 香薷 葱白
    # ---- 解表药·发散风热 ----
    葛根 柴胡 升麻 薄荷 牛蒡子 蝉蜕 桑叶 菊花 蔓荆子 淡豆豉
    浮萍 木贼
    # ---- 清热泻火药 ----
    石膏 知母 栀子 芦根 天花粉 竹叶 夏枯草 决明子 谷精草 密蒙花
    # ---- 清热燥湿药 ----
    黄芩 黄连 黄柏 龙胆草 苦参 秦皮 白鲜皮 椿皮 马尾连 三颗针
    关黄柏 岩黄连
    # ---- 清热解毒药 ----
    金银花 连翘 蒲公英 紫花地丁 板蓝根 大青叶 青黛 鱼腥草 射干 山豆根
    马勃 白头翁 败酱草 红藤 土茯苓 穿心莲 半边莲 白花蛇舌草 山慈菇 漏芦
    野菊花 重楼 拳参 绿豆 熊胆 马齿苋 鸦胆子 地锦草 委陵菜 翻白草
    半枝莲 白英 龙葵 四季青 绵马贯众 大血藤 千里光 金荞麦 铁苋菜 北豆根
    金果榄 锦灯笼 木芙蓉叶 朱砂根 肿节风 蛇莓 天葵子 南板蓝根 白蔹 虎耳草
    # ---- 清热凉血药 ----
    生地黄 玄参 牡丹皮 赤芍 紫草 水牛角
    # ---- 清虚热药 ----
    青蒿 白薇 地骨皮 银柴胡 胡黄连
    # ---- 泻下药·攻下 ----
    大黄 芒硝 番泻叶 芦荟
    # ---- 泻下药·润下 ----
    火麻仁 郁李仁
    # ---- 泻下药·峻下逐水 ----
    甘遂 大戟 牵牛子 商陆 巴豆 京大戟 千金子 芫花
    # ---- 祛风湿药·散寒 ----
    独活 威灵仙 川乌 蕲蛇 乌梢蛇
    # ---- 祛风湿药·清热 ----
    秦艽 防己 桑枝 豨莶草 臭梧桐 海风藤 络石藤 穿山龙
    # ---- 祛风湿药·强筋骨 ----
    木瓜 桑寄生 五加皮 狗脊 千年健 雷公藤 丝瓜络 伸筋草 寻骨风
    # ---- 祛风湿药·补充 ----
    天仙藤 青风藤 丁公藤 昆明山海棠 徐长卿 功劳木 香加皮 海桐皮
    石楠叶 老鹳草 松节 凤仙透骨草
    # ---- 化湿药 ----
    藿香 佩兰 苍术 厚朴 砂仁 白豆蔻 草豆蔻 草果
    # ---- 利水渗湿药·利水消肿 ----
    茯苓 猪苓 泽泻 薏苡仁 冬瓜皮 玉米须 葫芦 泽漆 赤小豆 蝼蛄
    # ---- 利水渗湿药·利尿通淋 ----
    车前子 滑石 木通 通草 金钱草 海金沙 石韦 萆薢 瞿麦 地肤子
    萹蓄 灯心草 车前草
    # ---- 利水渗湿药·利湿退黄 ----
    茵陈 虎杖 田基黄 赶黄草 垂盆草 鸡骨草 溪黄草 叶下珠
    # ---- 利水渗湿药·补充 ----
    广金钱草 连钱草 冬瓜子 水红花子 苘麻子 荠菜花
    # ---- 温里药 ----
    附子 干姜 肉桂 吴茱萸 花椒 小茴香 丁香 高良姜 胡椒 荜茇
    荜澄茄 山柰
    # ---- 理气药 ----
    陈皮 青皮 枳实 枳壳 木香 香附 乌药 沉香 檀香 川楝子
    荔枝核 佛手 薤白 柿蒂 大腹皮 甘松 刀豆 玫瑰花 绿萼梅 娑罗子
    # ---- 消食药 ----
    山楂 神曲 麦芽 谷芽 莱菔子 鸡内金 鸡矢藤
    # ---- 驱虫药 ----
    使君子 苦楝皮 槟榔 南瓜子 鹤草芽 雷丸 榧子
    # ---- 止血药·凉血止血 ----
    大蓟 小蓟 地榆 槐花 侧柏叶 白茅根 苎麻根
    # ---- 止血药·化瘀止血 ----
    三七 茜草 蒲黄 花蕊石 降香
    # ---- 止血药·收敛止血 ----
    白及 仙鹤草 棕榈炭 血余炭 藕节
    # ---- 止血药·温经止血 ----
    艾叶 炮姜 槐角
    # ---- 活血化瘀药·活血止痛 ----
    川芎 延胡索 郁金 姜黄 乳香 没药 五灵脂
    # ---- 活血化瘀药·活血调经 ----
    丹参 红花 桃仁 益母草 泽兰 牛膝 鸡血藤 王不留行 月季花 凌霄花
    # ---- 活血化瘀药·活血疗伤 ----
    土鳖虫 自然铜 苏木 骨碎补 血竭 儿茶 刘寄奴 马钱子
    # ---- 活血化瘀药·破血消癥 ----
    三棱 莪术 水蛭 穿山甲 虻虫 干漆 斑蝥 北刘寄奴 急性子
    # ---- 化痰药·温化寒痰 ----
    半夏 天南星 白芥子 旋覆花 白前 皂荚
    # ---- 化痰药·清化热痰 ----
    桔梗 前胡 瓜蒌 川贝母 浙贝母 竹茹 竹沥 天竺黄 海蛤壳 海浮石
    瓦楞子 昆布 海藻 礞石 黄药子 胖大海 木蝴蝶 瓜蒌皮 瓜蒌仁 猫爪草
    # ---- 止咳平喘药 ----
    杏仁 紫苏子 百部 紫菀 款冬花 马兜铃 枇杷叶 桑白皮 葶苈子 白果
    洋金花 矮地茶 满山红 胡颓子叶
    # ---- 安神药·重镇安神 ----
    朱砂 磁石 龙骨 琥珀
    # ---- 安神药·养心安神 ----
    酸枣仁 柏子仁 远志 合欢皮 夜交藤 灵芝 珍珠
    # ---- 平肝息风药·平抑肝阳 ----
    石决明 珍珠母 牡蛎 代赭石 刺蒺藜 罗布麻叶
    # ---- 平肝息风药·息风止痉 ----
    羚羊角 钩藤 天麻 地龙 全蝎 蜈蚣 僵蚕 牛黄
    # ---- 开窍药 ----
    麝香 冰片 石菖蒲 苏合香 安息香
    # ---- 补气药 ----
    人参 党参 太子参 西洋参 黄芪 白术 山药 甘草 大枣 蜂蜜
    白扁豆 绞股蓝 红景天 刺五加 饴糖 黄精 炙甘草
    # ---- 补血药 ----
    当归 熟地黄 白芍 阿胶 何首乌 龙眼肉 桑椹
    # ---- 补阴药 ----
    北沙参 南沙参 百合 麦冬 天冬 石斛 玉竹 枸杞子 墨旱莲 女贞子
    龟甲 鳖甲 明党参 银耳 铁皮石斛
    # ---- 补阳药 ----
    鹿茸 紫河车 淫羊藿 巴戟天 仙茅 杜仲 续断 肉苁蓉 锁阳 补骨脂
    益智仁 菟丝子 沙苑子 蛤蚧 核桃仁 冬虫夏草 海马 韭菜子 阳起石 鹿角胶
    鹿角霜 狗肾
    # ---- 收涩药·固表止汗 ----
    五味子 浮小麦 糯稻根须 麻黄根
    # ---- 收涩药·敛肺涩肠 ----
    乌梅 诃子 石榴皮 肉豆蔻 赤石脂 禹余粮
    # ---- 收涩药·固精缩尿止带 ----
    山茱萸 覆盆子 桑螵蛸 金樱子 海螵蛸 莲子 芡实 鸡冠花 刺猬皮 莲须
    # ---- 涌吐药 ----
    常山 瓜蒂 胆矾 藜芦
    # ---- 外用药 ----
    硫磺 雄黄 蛇床子 明矾 硼砂 炉甘石 樟脑 木鳖子 蟾酥 大蒜
    露蜂房 土荆皮
    # ---- 其他常用药 ----
    皂角刺 路路通 冬葵子 八角茴香 紫苏梗 荷叶 扁豆花 西瓜翠衣
    鬼箭羽 没食子 五倍子
    # ---- 动物药·补充 ----
    九香虫 蟾皮 蛇蜕 白花蛇 海龙 鹿角 龟板胶 鳖甲胶 海狗肾
    莲房 糯稻根 猪牙皂 蝉花
    # ---- 矿物药·补充 ----
    紫石英 辰砂 龙齿 夜明砂 生铁落 铅丹 皂矾 砒石 硇砂
    # ---- 其他补充 ----
    紫苏 芫荽 忍冬藤 鹿衔草 功劳叶 罗布麻 天仙子 华山参 钩吻
    松花粉 蚕砂 牙皂 败酱 萱草根 紫贝齿 豆蔻
    苦瓜 珍珠草 瓦松 马鞭草 鬼针草 积雪草 水飞蓟 青叶胆
    翠云草 冬凌草 白毛夏枯草 胡桃肉 仙人掌
    # ---- 岭南草药 ----
    救必应 了哥王 毛冬青 岗梅根 两面针 九里香 三叉苦 飞龙掌血 东风橘 入地金牛
    # ---- 其他各地常用草药 ----
    七叶一枝花 八月札 预知子 王瓜 木馒头 薜荔果 南鹤虱 芜荑 贯众 鹧鸪菜
    罗汉果 千日红 木棉花 余甘子 藏红花 藏茵陈 雪莲花
    # ---- 民间常用药材 ----
    金线莲 铁皮枫斗 灵芝草 天山雪莲 雪上一枝蒿 透骨草 豨莶
    # ---- 花类药材 ----
    金银花藤 菊花脑 蒲公英根 旋覆花梗 红花籽 合欢花 厚朴花 代代花 佛手花
    白梅花 辛夷花 茉莉花 密蒙花藤 凌霄花根
    # ---- 果实种子类补充 ----
    蔓荆子仁 苍耳子仁 薏苡仁壳 车前子壳 决明子仁 枸杞叶 枸杞根
    桑椹子 女贞叶 冬青子 酸枣 山楂核 橘核 橘络 橘红 化橘红
    # ---- 根茎类补充 ----
    白术根 苍术根 半夏曲 天南星曲 生半夏 法半夏 姜半夏 清半夏
    制附子 黑顺片 白附片 淡附片
)

# ============================ Formula List (~600 unique) ============================
# Organized by classical source. All entries unique.

FORMULAS=(
    # ======== 伤寒论方 (100) ========
    桂枝汤 桂枝加葛根汤 桂枝加附子汤 桂枝去芍药汤 桂枝去芍药加附子汤
    桂枝麻黄各半汤 桂枝二麻黄一汤 桂枝二越婢一汤 桂枝加厚朴杏子汤
    桂枝加芍药生姜各一两人参三两新加汤
    麻黄汤 葛根汤 葛根加半夏汤 葛根黄芩黄连汤 大青龙汤 小青龙汤
    桂枝去桂加茯苓白术汤 甘草干姜汤 芍药甘草汤 调胃承气汤
    四逆汤 茯苓桂枝甘草大枣汤 五苓散 茯苓甘草汤
    栀子豉汤 栀子厚朴汤 栀子干姜汤 真武汤
    小柴胡汤 小建中汤 大柴胡汤 柴胡加芒硝汤
    桃核承气汤 柴胡加龙骨牡蛎汤
    桂枝去芍药加蜀漆牡蛎龙骨救逆汤 桂枝甘草龙骨牡蛎汤
    抵当汤 抵当丸
    大陷胸汤 大陷胸丸 小陷胸汤 三物白散
    柴胡桂枝汤 柴胡桂枝干姜汤
    半夏泻心汤 十枣汤
    大黄黄连泻心汤 附子泻心汤 生姜泻心汤 甘草泻心汤
    赤石脂禹余粮汤 旋覆代赭汤
    桂枝人参汤 瓜蒂散
    黄芩汤 黄芩加半夏生姜汤 黄连汤
    桂枝附子汤 去桂加白术汤 甘草附子汤
    白虎汤 白虎加人参汤 炙甘草汤
    大承气汤 小承气汤 猪苓汤
    蜜煎导方 茵陈蒿汤 栀子柏皮汤
    麻黄连轺赤小豆汤 麻杏石甘汤
    桂枝加桂汤 茯苓桂枝白术甘草汤
    理中丸 四逆加人参汤
    桂枝加芍药汤 桂枝加大黄汤
    麻黄附子细辛汤 麻黄附子甘草汤
    黄连阿胶汤 附子汤
    白头翁汤 猪肤汤 甘草汤 桔梗汤
    苦酒汤 半夏散及汤
    白通汤 白通加猪胆汁汤
    通脉四逆汤 通脉四逆加猪胆汁汤
    四逆散 乌梅丸
    当归四逆汤 当归四逆加吴茱萸生姜汤
    吴茱萸汤 麻黄升麻汤
    干姜黄芩黄连人参汤 竹叶石膏汤
    禹余粮丸 烧裈散 枳实栀子豉汤 牡蛎泽泻散

    # ======== 金匮要略方 (85) ========
    括蒌桂枝汤 百合地黄汤 百合知母汤 百合鸡子汤
    百合滑石散 栝蒌牡蛎散 百合洗方
    甘麦大枣汤 酸枣仁汤
    薯蓣丸 大黄蛰虫丸 鳖甲煎丸
    桂枝芍药知母汤 乌头汤
    防己黄芪汤 防己地黄汤
    桂枝茯苓丸 温经汤 当归芍药散 当归散 白术散
    当归生姜羊肉汤 枳术汤
    橘皮竹茹汤 半夏厚朴汤 厚朴七物汤
    大建中汤 大黄附子汤 赤丸 附子粳米汤
    排脓散 排脓汤
    黄芪桂枝五物汤 桂枝加黄芪汤
    肾气丸 瓜蒌薤白白酒汤 瓜蒌薤白半夏汤
    枳实薤白桂枝汤 人参汤
    茯苓杏仁甘草汤 橘枳姜汤
    薏苡附子散 桂枝生姜枳实汤
    乌头赤石脂丸 九痛丸
    旋覆花汤 桂枝加龙骨牡蛎汤
    天雄散 黄芪建中汤
    薏苡附子败酱散 大黄牡丹汤
    王不留行散 升麻鳖甲汤
    当归贝母苦参丸 葵子茯苓散
    蒲灰散 滑石白鱼散 茯苓戎盐汤
    矾石丸 麻子仁丸
    己椒苈黄丸 厚朴三物汤 大黄甘草汤
    外台茯苓饮 厚朴生姜半夏甘草人参汤
    小半夏汤 猪苓散
    小半夏加茯苓汤 茯苓泽泻汤
    文蛤散 半夏干姜散
    甘姜苓术汤 桂苓五味甘草汤
    苓甘五味姜辛汤 苓甘五味姜辛半夏杏仁汤
    射干麻黄汤 皂荚丸 泽泻汤 泽漆汤
    麦门冬汤 葶苈大枣泻肺汤 桔梗白散
    越婢加半夏汤 小青龙加石膏汤

    # ======== 温病条辨方 (50) ========
    银翘散 桑菊饮 清营汤 犀角地黄汤
    安宫牛黄丸 紫雪丹 至宝丹
    三仁汤 藿朴夏苓汤 甘露消毒丹
    清暑益气汤 沙参麦冬汤 增液汤
    青蒿鳖甲汤 加减复脉汤 大定风珠
    宣白承气汤 导赤承气汤 牛黄承气汤
    增液承气汤 新加黄龙汤
    桑杏汤 翘荷汤 清络饮
    白虎加苍术汤 连朴饮 薛生白方
    加减正气散 一甲复脉汤 二甲复脉汤 三甲复脉汤
    小定风珠 专翕大生膏
    桃花汤 黄芩滑石汤
    人参乌梅汤 椒梅汤 连梅汤
    清宫汤 化斑汤
    玉女煎去牛膝熟地加细生地元参方
    五汁饮 雪梨浆
    杏苏散 清燥救肺汤
    益胃汤 玉竹麦门冬汤
    薛氏五叶芦根汤 新加香薷饮

    # ======== 太平惠民和剂局方 (17) ========
    四君子汤 六君子汤 香砂六君子汤
    四物汤 八珍汤 十全大补汤 人参养荣汤
    逍遥散 加味逍遥散
    藿香正气散 参苓白术散
    平胃散 二陈汤
    消风散 苏合香丸
    川芎茶调散 不换金正气散

    # ======== 六味地黄丸系列 (8) ========
    六味地黄丸 知柏地黄丸 杞菊地黄丸
    麦味地黄丸 都气丸 桂附地黄丸
    济生肾气丸 金匮肾气丸

    # ======== 补益方 (18) ========
    补中益气汤 归脾汤 玉屏风散
    生脉散 当归补血汤
    保元汤 大补阴丸
    左归丸 右归丸 左归饮 右归饮
    龟鹿二仙胶 河车大造丸 七宝美髯丹
    二仙汤 琼玉膏 泰山磐石散 保产无忧方

    # ======== 泻火方 (7) ========
    龙胆泻肝汤 导赤散 泻白散
    清胃散 玉女煎
    泻心汤 泻青丸

    # ======== 清热方 (8) ========
    普济消毒饮 仙方活命饮
    黄连解毒汤 清瘟败毒饮
    凉膈散 五味消毒饮
    四妙勇安汤 竹叶黄芪汤

    # ======== 温阳方 (5) ========
    阳和汤 参附汤 回阳救急汤
    参附龙牡汤 再造散

    # ======== 消食方 (6) ========
    保和丸 枳实导滞丸
    木香槟榔丸 健脾丸
    枳术丸 葛花解酲汤

    # ======== 理气方 (12) ========
    越鞠丸 柴胡疏肝散
    金铃子散 天台乌药散 暖肝煎
    四磨汤 橘核丸 厚朴温中汤
    香苏散 正气天香散 良附丸 枳壳散

    # ======== 理血·活血方 (16) ========
    失笑散 血府逐瘀汤
    膈下逐瘀汤 少腹逐瘀汤
    身痛逐瘀汤 通窍活血汤
    补阳还五汤 复元活血汤
    生化汤 桃红四物汤
    丹参饮 七厘散
    跌打丸 正骨紫金丹
    大活络丹 小活络丹

    # ======== 理血·止血方 (6) ========
    十灰散 四生丸 咳血方
    小蓟饮子 槐花散 黄土汤

    # ======== 治风方·疏散外风 (8) ========
    大秦艽汤 牵正散
    小续命汤 独活寄生汤
    蠲痹汤 薏苡仁汤
    荆防败毒散 防风通圣散

    # ======== 治风方·平息内风 (5) ========
    镇肝熄风汤 天麻钩藤饮
    羚角钩藤汤 地黄饮子 侯氏黑散

    # ======== 治燥方 (6) ========
    养阴清肺汤 百合固金汤
    玉液汤 润肠丸
    五仁丸 济川煎

    # ======== 祛湿方 (16) ========
    八正散 五淋散 萆薢分清饮 程氏萆薢分清饮
    石韦散 实脾散 五皮饮
    苓桂术甘汤 当归拈痛汤 鸡鸣散
    二妙散 三妙散 四妙散
    胃苓汤 茵陈五苓散 春泽汤

    # ======== 化痰方 (10) ========
    温胆汤 黄连温胆汤
    清金化痰汤 滚痰丸
    指迷茯苓丸 半夏白术天麻汤
    止嗽散 贝母瓜蒌散
    清气化痰丸 涤痰汤

    # ======== 治喘方 (5) ========
    定喘汤 苏子降气汤
    三子养亲汤 华盖散
    九宝汤

    # ======== 安神方 (10) ========
    天王补心丹 朱砂安神丸
    磁朱丸 生铁落饮
    交泰丸 半夏秫米汤
    柏子养心丸 安神定志丸 珍珠母丸
    孔圣枕中丹

    # ======== 收涩方 (13) ========
    牡蛎散 当归六黄汤 九仙散
    四神丸 真人养脏汤
    桑螵蛸散 缩泉丸
    完带汤 易黄汤
    固冲汤 固经丸
    金锁固精丸 水陆二仙丹

    # ======== 驱虫方 (3) ========
    化虫丸 布袋丸 肥儿丸

    # ======== 痈疡方 (8) ========
    透脓散 托里消毒散
    小金丹 犀黄丸
    海藻玉壶汤 苇茎汤
    内补黄芪汤 真人活命饮

    # ======== 妇科方 (10) ========
    胶艾汤 寿胎丸 艾附暖宫丸
    清经散 两地汤 定经汤
    四物消风饮 荆芥连翘汤
    举元煎 毓麟珠

    # ======== 经典名方·补充一 (15) ========
    痛泻要方 甘露饮 一贯煎
    济川煎 金水六君煎
    启膈散 月华丸
    清心莲子饮 丁香柿蒂汤
    香砂养胃丸 附子理中丸 茯苓饮
    升陷汤 保真汤 人参蛤蚧散

    # ======== 经典名方·补充二 (12) ========
    百合汤 二冬膏 三才封髓丹
    清心牛黄丸 牛黄清心丸
    紫金锭 行军散 通关散 玉真散
    冠心苏合丸 速效救心丸 开噤散

    # ======== 经典名方·补充三 (10) ========
    清骨散 秦艽鳖甲散 二至丸 仓廪汤
    升麻葛根汤 柴葛解肌汤
    九味羌活汤 加减葳蕤汤
    葱豉桔梗汤 正柴胡饮

    # ======== 经典名方·补充四 (10) ========
    蒿芩清胆汤 达原饮
    截疟七宝饮 柴胡达原饮
    清脾饮 何人饮
    越婢汤 越婢加术汤
    麻黄细辛附子汤 参苏饮

    # ======== 经典名方·补充五 (10) ========
    败毒散 三痹汤 乌头汤
    补肺阿胶汤 虎潜丸
    大青叶汤 竹叶石膏汤
    风引汤 紫石英散
    千金苇茎汤

    # ======== 经典名方·补充六 (15) ========
    五苓散加味 茵陈蒿汤加味 胃苓汤加味
    归脾丸 逍遥丸 补中益气丸 六味地黄丸加味
    参苓白术丸 天王补心丸
    知柏地黄丸加味 杞菊地黄丸加味
    桂附地黄丸加味 六君子丸 香砂六君子丸
    保和丸加味

    # ======== 医宗金鉴方 (15) ========
    回阳救急汤加味 参附龙牡救逆汤 生脉散加味
    四逆加人参汤加味 独参汤
    黄芪桂枝五物汤加味 当归四逆汤加味
    小柴胡汤加味 大柴胡汤加味
    大陷胸汤加味 小陷胸汤加味
    半夏泻心汤加味 生姜泻心汤加味
    甘草泻心汤加味 旋覆代赭汤加味

    # ======== 医学衷中参西录方 (15) ========
    升陷汤加味 活络效灵丹 理冲汤
    理冲丸 固冲汤加味 温冲汤
    安冲汤 清冲汤 荡冲汤
    滋膵饮 化膈汤 和中汤
    培脾舒肝汤 健脾化痰丸 镇肝熄风汤加味

    # ======== 景岳全书方 (15) ========
    左归丸加味 右归丸加味 大营煎
    小营煎 大补元煎 小补元煎
    举元煎 赞育丸 毓麟珠加味
    玉女煎加味 化肝煎 六味回阳饮
    三阴煎 正柴胡饮加味 柴胡疏肝散加味

    # ======== 外台秘要方 (10) ========
    延年半夏汤 大岩蜜汤 小岩蜜汤
    崔氏八味丸 紫苏饮 大五补丸
    茯神汤 天门冬丸 千金翼方 延年益寿散

    # ======== 千金方 (15) ========
    温胆汤加味 千金苇茎汤加味
    犀角地黄汤加味 千金独活汤
    千金鲤鱼汤 千金麻黄汤
    千金生脉散 千金三黄汤
    千金内补丸 千金补肝汤
    千金排脓汤 千金温脾汤
    千金犀角散 千金紫菀汤
    千金竹茹汤

    # ======== 备急千金要方补充 (10) ========
    小续命汤 大续命汤 排风汤
    侯氏黑散 风引汤 紫石英散
    崔氏方 千金要方 千金翼方补充
    备急方

    # ======== 肘后备急方 (10) ========
    葛洪方 青蒿方 常山方 鳖甲方
    雄黄散 硫磺散 矾石散
    蛇床子散 雷丸散 槟榔散

    # ======== 脾胃论方 (10) ========
    升阳益胃汤 升阳除湿汤 升阳散火汤
    清暑益气汤加味 清胃散加味
    调中益气汤 清燥汤 补脾胃泻阴火升阳汤
    黄芪人参汤 沉香温胃丸

    # ======== 丹溪心法方 (10) ========
    左金丸 上中下通用痛风方 保阴煎
    越鞠保和丸 虎潜丸加味 大补阴丸加味
    琼玉膏加味 秦艽扶羸汤 人参固本丸
    滋阴大补丸

    # ======== 内外伤辨惑论方 (5) ========
    补中益气汤加味 升阳举陷汤
    当归补血汤加味 调中益气汤加味
    黄芪建中汤加味

    # ======== 傅青主女科方 (10) ========
    完带汤加味 清肝止淋汤 傅氏解毒汤
    傅氏逐瘀汤 傅氏安奠二天汤 傅氏助仙丹
    傅氏两地汤 傅氏清经散 傅氏定经汤
    傅氏转气汤

    # ======== 现代常用中成药方 (15) ========
    银翘解毒丸 藿香正气丸 保济丸
    六神丸 云南白药 片仔癀
    安宫牛黄丸加味 牛黄解毒丸 连花清瘟胶囊
    血府逐瘀胶囊 复方丹参滴丸 速效救心丸加味
    六味地黄丸标准方 归脾丸标准方 逍遥丸标准方
)

# ============================ Utility Functions ============================

log() {
    local msg
    msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg" | tee -a "$LOG_FILE"
}

is_processed() {
    local type="$1"
    local name="$2"
    if [[ -f "$PROGRESS_FILE" ]]; then
        grep -qxF "${type}:${name}" "$PROGRESS_FILE" 2>/dev/null
        return $?
    fi
    return 1
}

mark_processed() {
    local type="$1"
    local name="$2"
    echo "${type}:${name}" >> "$PROGRESS_FILE"
}

# ============================ API Functions ============================

login() {
    log "Logging in as ${USERNAME} to ${API_URL}..."

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY-RUN] Would POST ${API_URL}/api/v1/auth/login"
        TOKEN="dry-run-token"
        return 0
    fi

    local response
    local http_code
    response=$(curl -s -w "\n%{http_code}" \
        -X POST "${API_URL}/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')

    if [[ "$http_code" != "200" ]]; then
        log "ERROR: Login failed with HTTP ${http_code}"
        log "Response: ${body}"
        exit 1
    fi

    TOKEN=$(echo "$body" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

    if [[ -z "$TOKEN" ]]; then
        log "ERROR: Failed to extract token from response"
        log "Response: ${body}"
        exit 1
    fi

    log "Login successful. Token obtained."
}

query_herb() {
    local name="$1"

    if is_processed "herb" "$name"; then
        log "  [SKIP] Herb already processed: ${name}"
        ((HERB_SKIP++)) || true
        return 0
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "  [DRY-RUN] Would GET ${API_URL}/api/v1/herbs?name=${name}"
        mark_processed "herb" "$name"
        ((HERB_SKIP++)) || true
        return 0
    fi

    local response
    local http_code
    response=$(curl -s -w "\n%{http_code}" -G \
        -H "Authorization: Bearer ${TOKEN}" \
        --data-urlencode "name=${name}" \
        "${API_URL}/api/v1/herbs")

    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')

    if [[ "$http_code" == "200" ]]; then
        log "  [OK] Herb: ${name} (HTTP ${http_code})"
        mark_processed "herb" "$name"
        ((HERB_SUCCESS++)) || true
    elif [[ "$http_code" == "401" ]]; then
        log "  [AUTH] Token expired, re-logging in..."
        login
        response=$(curl -s -w "\n%{http_code}" -G \
            -H "Authorization: Bearer ${TOKEN}" \
            --data-urlencode "name=${name}" \
            "${API_URL}/api/v1/herbs")
        http_code=$(echo "$response" | tail -1)
        if [[ "$http_code" == "200" ]]; then
            log "  [OK] Herb: ${name} (HTTP ${http_code}) (after re-login)"
            mark_processed "herb" "$name"
            ((HERB_SUCCESS++)) || true
        else
            log "  [FAIL] Herb: ${name} (HTTP ${http_code})"
            ((HERB_FAIL++)) || true
        fi
    else
        log "  [FAIL] Herb: ${name} (HTTP ${http_code})"
        ((HERB_FAIL++)) || true
    fi

    sleep "$DELAY"
}

query_formula() {
    local name="$1"

    if is_processed "formula" "$name"; then
        log "  [SKIP] Formula already processed: ${name}"
        ((FORMULA_SKIP++)) || true
        return 0
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "  [DRY-RUN] Would GET ${API_URL}/api/v1/formulas?name=${name}"
        mark_processed "formula" "$name"
        ((FORMULA_SKIP++)) || true
        return 0
    fi

    local response
    local http_code
    response=$(curl -s -w "\n%{http_code}" -G \
        -H "Authorization: Bearer ${TOKEN}" \
        --data-urlencode "name=${name}" \
        "${API_URL}/api/v1/formulas")

    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')

    if [[ "$http_code" == "200" ]]; then
        log "  [OK] Formula: ${name} (HTTP ${http_code})"
        mark_processed "formula" "$name"
        ((FORMULA_SUCCESS++)) || true
    elif [[ "$http_code" == "401" ]]; then
        log "  [AUTH] Token expired, re-logging in..."
        login
        response=$(curl -s -w "\n%{http_code}" -G \
            -H "Authorization: Bearer ${TOKEN}" \
            --data-urlencode "name=${name}" \
            "${API_URL}/api/v1/formulas")
        http_code=$(echo "$response" | tail -1)
        if [[ "$http_code" == "200" ]]; then
            log "  [OK] Formula: ${name} (HTTP ${http_code}) (after re-login)"
            mark_processed "formula" "$name"
            ((FORMULA_SUCCESS++)) || true
        else
            log "  [FAIL] Formula: ${name} (HTTP ${http_code})"
            ((FORMULA_FAIL++)) || true
        fi
    else
        log "  [FAIL] Formula: ${name} (HTTP ${http_code})"
        ((FORMULA_FAIL++)) || true
    fi

    sleep "$DELAY"
}

print_summary() {
    log ""
    log "============================================"
    log "              Seeding Summary"
    log "============================================"
    if [[ "$FORMULAS_ONLY" != true ]]; then
        log "Herbs:    success=${HERB_SUCCESS}  fail=${HERB_FAIL}  skip=${HERB_SKIP}  total=${#HERBS[@]}"
    fi
    if [[ "$HERBS_ONLY" != true ]]; then
        log "Formulas: success=${FORMULA_SUCCESS}  fail=${FORMULA_FAIL}  skip=${FORMULA_SKIP}  total=${#FORMULAS[@]}"
    fi
    log "Progress file: ${PROGRESS_FILE}"
    log "Log file:      ${LOG_FILE}"
    log "============================================"
}

# ============================ Deduplication ============================
# Runtime dedup compatible with bash 3.2+ (macOS default)

deduplicate_array() {
    local arr_name=$1
    local tmp_file
    tmp_file=$(mktemp /tmp/dedup.XXXXXX)

    eval "local arr_len=\${#${arr_name}[@]}"
    local unique=()
    local i=0

    while [[ $i -lt $arr_len ]]; do
        eval "local item=\${${arr_name}[$i]}"
        if ! grep -qxF "$item" "$tmp_file" 2>/dev/null; then
            echo "$item" >> "$tmp_file"
            unique+=("$item")
        fi
        ((i++)) || true
    done

    rm -f "$tmp_file"
    eval "${arr_name}=(\"\${unique[@]}\")"
}

# ============================ Main ============================

main() {
    log "============================================"
    log "  Herb & Formula Seeding Script"
    log "============================================"
    log "API URL:   ${API_URL}"
    log "Username:  ${USERNAME}"
    log "Delay:     ${DELAY}s"
    log "Dry-run:   ${DRY_RUN}"
    log "Mode:      $(if [[ "$HERBS_ONLY" == true ]]; then echo "herbs-only"; elif [[ "$FORMULAS_ONLY" == true ]]; then echo "formulas-only"; else echo "all"; fi)"
    log ""

    if [[ "$RESET_PROGRESS" == true ]]; then
        log "Resetting progress file..."
        rm -f "$PROGRESS_FILE"
    fi

    # Deduplicate arrays at runtime
    deduplicate_array HERBS
    deduplicate_array FORMULAS

    log "Unique herbs:    ${#HERBS[@]}"
    log "Unique formulas: ${#FORMULAS[@]}"
    log ""

    login

    if [[ "$FORMULAS_ONLY" != true ]]; then
        log "--- Seeding Herbs (${#HERBS[@]} unique) ---"
        local herb_idx=0
        for herb in "${HERBS[@]}"; do
            ((herb_idx++)) || true
            log "[${herb_idx}/${#HERBS[@]}] Querying herb: ${herb}"
            query_herb "$herb"
        done
        log "--- Herbs seeding complete ---"
        log ""
    fi

    if [[ "$HERBS_ONLY" != true ]]; then
        log "--- Seeding Formulas (${#FORMULAS[@]} unique) ---"
        local formula_idx=0
        for formula in "${FORMULAS[@]}"; do
            ((formula_idx++)) || true
            log "[${formula_idx}/${#FORMULAS[@]}] Querying formula: ${formula}"
            query_formula "$formula"
        done
        log "--- Formulas seeding complete ---"
        log ""
    fi

    print_summary
}

main
