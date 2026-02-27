export interface Anime {
  id: number;
  title: string;
  cover: string;
  year: number;
  rating: number;
  genres: string[];
  episodes: number;
  description: string;
}

const pic = (id: number) => `https://picsum.photos/seed/anime${id}/400/560`;
const bannerPic = (id: number) =>
  `https://picsum.photos/seed/banner${id}/1920/800`;

export const heroAnime: Anime & { banner: string } = {
  id: 0,
  title: "进击的巨人 最终季",
  cover: pic(0),
  banner: bannerPic(0),
  year: 2023,
  rating: 9.8,
  genres: ["动作", "奇幻", "剧情"],
  episodes: 16,
  description:
    "艾伦与调查兵团的最终决战。当真相揭露、自由的代价浮出水面，人类与巨人的命运将迎来终局。",
};

export const trendingAnime: Anime[] = [
  {
    id: 1,
    title: "咒术回战",
    cover: pic(1),
    year: 2024,
    rating: 9.2,
    genres: ["动作", "奇幻"],
    episodes: 24,
    description: "虎杖悠仁吞下了诅咒之王两面宿傩的手指，从此踏入咒术师的世界。",
  },
  {
    id: 2,
    title: "鬼灭之刃 柱训练篇",
    cover: pic(2),
    year: 2024,
    rating: 9.5,
    genres: ["动作", "历史"],
    episodes: 8,
    description: "为了迎接与鬼舞辻无惨的最终决战，炭治郎等人开始接受柱们的严酷训练。",
  },
  {
    id: 3,
    title: "间谍过家家",
    cover: pic(3),
    year: 2023,
    rating: 8.9,
    genres: ["喜剧", "动作"],
    episodes: 25,
    description: "间谍黄昏为了执行任务组建了假家庭，殊不知妻子是杀手，女儿是超能力者。",
  },
  {
    id: 4,
    title: "我的英雄学院",
    cover: pic(4),
    year: 2024,
    rating: 8.7,
    genres: ["动作", "校园"],
    episodes: 25,
    description: "无个性少年绿谷出久继承了最强英雄的力量，在雄英高中追逐成为最伟大英雄的梦想。",
  },
  {
    id: 5,
    title: "链锯人",
    cover: pic(5),
    year: 2023,
    rating: 9.1,
    genres: ["动作", "恐怖"],
    episodes: 12,
    description: "电次为了还债与链锯恶魔合体，加入公安对魔特异课，开始了疯狂的恶魔猎杀之旅。",
  },
  {
    id: 6,
    title: "蓝色监狱",
    cover: pic(6),
    year: 2024,
    rating: 8.8,
    genres: ["运动", "竞技"],
    episodes: 24,
    description: "日本足球协会发起蓝色监狱计划，300名前锋在极限淘汰赛中争夺最强射手之位。",
  },
];

export const newReleases: Anime[] = [
  {
    id: 7,
    title: "葬送的芙莉莲",
    cover: pic(7),
    year: 2024,
    rating: 9.6,
    genres: ["奇幻", "冒险"],
    episodes: 28,
    description: "勇者一行击败魔王后，精灵魔法使芙莉莲踏上了理解人类情感的漫长旅途。",
  },
  {
    id: 8,
    title: "药屋少女的呢喃",
    cover: pic(8),
    year: 2024,
    rating: 9.3,
    genres: ["推理", "历史"],
    episodes: 24,
    description: "药师猫猫被卖入后宫为侍女，凭借药学知识解开一个个宫廷谜案。",
  },
  {
    id: 9,
    title: "迷宫饭",
    cover: pic(9),
    year: 2024,
    rating: 9.0,
    genres: ["奇幻", "美食"],
    episodes: 24,
    description: "为了救回被红龙吞噬的妹妹，莱欧斯一行决定在迷宫中就地取材烹饪魔物维持体力。",
  },
  {
    id: 10,
    title: "排球少年!! 垃圾场的决战",
    cover: pic(10),
    year: 2024,
    rating: 9.4,
    genres: ["运动", "热血"],
    episodes: 1,
    description: "乌野高中与音驹高中终于在全国大赛上相遇，一场宿命之战即将开打。",
  },
  {
    id: 11,
    title: "物语系列 OFF & MONSTER",
    cover: pic(11),
    year: 2024,
    rating: 8.6,
    genres: ["奇幻", "悬疑"],
    episodes: 12,
    description: "阿良良木历的怪异故事再度展开，新的怪异与旧的因缘交织在一起。",
  },
  {
    id: 12,
    title: "擅长捉弄的高木同学",
    cover: pic(12),
    year: 2024,
    rating: 8.5,
    genres: ["恋爱", "日常"],
    episodes: 1,
    description: "高木同学与西片的甜蜜日常终于迎来了剧场版的完美结局。",
  },
];

export const classicAnime: Anime[] = [
  {
    id: 13,
    title: "新世纪福音战士",
    cover: pic(13),
    year: 1995,
    rating: 9.7,
    genres: ["科幻", "机战"],
    episodes: 26,
    description: "少年碇真嗣被父亲召唤至NERV，驾驶EVA初号机与袭来的使徒战斗。",
  },
  {
    id: 14,
    title: "钢之炼金术师 FA",
    cover: pic(14),
    year: 2009,
    rating: 9.8,
    genres: ["奇幻", "冒险"],
    episodes: 64,
    description: "爱德华与阿尔冯斯兄弟为了找回失去的身体，踏上了寻找贤者之石的旅途。",
  },
  {
    id: 15,
    title: "命运石之门",
    cover: pic(15),
    year: 2011,
    rating: 9.6,
    genres: ["科幻", "悬疑"],
    episodes: 25,
    description: "冈部伦太郎意外发明了能发送短信到过去的装置，从此陷入时间线的漩涡。",
  },
  {
    id: 16,
    title: "CLANNAD After Story",
    cover: pic(16),
    year: 2008,
    rating: 9.7,
    genres: ["恋爱", "剧情"],
    episodes: 24,
    description: "冈崎朋也与古河渚的故事延续到成人世界，面对家庭与人生的种种考验。",
  },
  {
    id: 17,
    title: "银魂",
    cover: pic(17),
    year: 2006,
    rating: 9.5,
    genres: ["喜剧", "动作"],
    episodes: 367,
    description: "在被外星人占领的江户时代，银时与伙伴们经营万事屋，过着搞笑又热血的日常。",
  },
  {
    id: 18,
    title: "攻壳机动队 SAC",
    cover: pic(18),
    year: 2002,
    rating: 9.4,
    genres: ["科幻", "犯罪"],
    episodes: 52,
    description: "公安九课在网络化的近未来社会中，追踪电子犯罪与恐怖主义威胁。",
  },
];

export const genres = [
  "全部",
  "动作",
  "奇幻",
  "科幻",
  "恋爱",
  "喜剧",
  "运动",
  "推理",
  "日常",
  "历史",
  "恐怖",
] as const;
