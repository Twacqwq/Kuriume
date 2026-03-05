export interface Anime {
  id: number
  title: string
  cover: string
  score: number
  year: number
  episodes: number
  genre: string[]
  description: string
}

/** Hero carousel item */
export interface HeroItem {
  anime: Anime
  heroCover: string
}

/** A show the user has partially watched */
export interface ContinueWatchingItem {
  anime: Anime
  episode: number
  progress: number // 0-100
  lastWatched: string // ISO date
}

const HERO_COVERS = [
  'https://lain.bgm.tv/pic/cover/l/c2/0a/12_24O6L.jpg',
  'http://lain.bgm.tv/pic/cover/l/7c/f1/443106_b4QP3.jpg',
  'http://lain.bgm.tv/pic/cover/l/0c/f3/458985_wIzkk.jpg',
]

export const heroAnime: Anime = {
  id: 0,
  title: '葬送的芙莉莲',
  cover: HERO_COVERS[0] as string,
  score: 9.4,
  year: 2024,
  episodes: 28,
  genre: ['奇幻', '冒险', '治愈'],
  description:
    '勇者一行击败魔王后，精灵魔法使芙莉莲开始了新的旅程。在漫长岁月中回顾曾经的伙伴，她逐渐学会理解人类的情感，踏上了一段寻找"了解人类"的旅途。',
}

export const heroItems: HeroItem[] = [
  {
    anime: {
      id: 100,
      title: '咒术回战',
      cover: 'http://lain.bgm.tv/pic/cover/l/0c/f3/458985_wIzkk.jpg',
      score: 9.1,
      year: 2024,
      episodes: 47,
      genre: ['动作', '奇幻'],
      description: '隐藏着强大诅咒力量的少年，被卷入咒术师与诅咒之间的殊死战斗。涩谷事变后的故事将走向何方？',
    },
    heroCover: 'http://lain.bgm.tv/pic/cover/l/0c/f3/458985_wIzkk.jpg',
  },
  {
    anime: heroAnime,
    heroCover: HERO_COVERS[0] as string,
  },
  {
    anime: {
      id: 101,
      title: '药屋少女的呢喃',
      cover: 'https://lain.bgm.tv/pic/cover/l/c2/0a/12_24O6L.jpg',
      score: 9.0,
      year: 2025,
      episodes: 24,
      genre: ['悬疑', '日常'],
      description: '后宫药屋中的少女猫猫，凭借毒物知识卷入宫廷谜案。第二季全新篇章，更多宫廷秘辛等你揭开。',
    },
    heroCover: 'https://lain.bgm.tv/pic/cover/l/c2/0a/12_24O6L.jpg',
  },
  {
    anime: {
      id: 102,
      title: '鬼灭之刃',
      cover: 'http://lain.bgm.tv/pic/cover/l/7c/f1/443106_b4QP3.jpg',
      score: 9.3,
      year: 2025,
      episodes: 44,
      genre: ['动作', '奇幻'],
      description: '少年踏上了成为最强剑士的道路，与同伴一起斩杀恶鬼，保护所爱之人。无限城决战即将到来。',
    },
    heroCover: 'http://lain.bgm.tv/pic/cover/l/7c/f1/443106_b4QP3.jpg',
  },
]

/* ── Anime grid mock data ── */

const BANGUMI_COVERS = [
  'https://lain.bgm.tv/pic/cover/l/c2/0a/12_24O6L.jpg',
  'http://lain.bgm.tv/pic/cover/l/7c/f1/443106_b4QP3.jpg',
  'http://lain.bgm.tv/pic/cover/l/0c/f3/458985_wIzkk.jpg',
]

const ANIME_POOL: Anime[] = [
  { id: 200, title: '进击的巨人', cover: BANGUMI_COVERS[0]!, score: 9.5, year: 2023, episodes: 87, genre: ['动作', '奇幻'], description: '人类与巨人的最终决战。' },
  { id: 201, title: '间谍过家家', cover: BANGUMI_COVERS[1]!, score: 8.8, year: 2024, episodes: 25, genre: ['喜剧', '日常'], description: '间谍、杀手、超能力者组成的假面家庭。' },
  { id: 202, title: '链锯人', cover: BANGUMI_COVERS[2]!, score: 8.9, year: 2023, episodes: 12, genre: ['动作', '恐怖'], description: '少年与链锯恶魔融合，成为公安猎魔人。' },
  { id: 203, title: '我推的孩子', cover: BANGUMI_COVERS[0]!, score: 9.0, year: 2024, episodes: 23, genre: ['悬疑', '剧情'], description: '转生到偶像母亲身边的双胞胎，揭开演艺圈的阴暗面。' },
  { id: 204, title: '无职转生', cover: BANGUMI_COVERS[1]!, score: 9.1, year: 2024, episodes: 24, genre: ['奇幻', '冒险'], description: '废柴中年转生异世界，开启认真人生。' },
  { id: 205, title: '排球少年', cover: BANGUMI_COVERS[2]!, score: 9.3, year: 2024, episodes: 85, genre: ['运动', '热血'], description: '小个子的排球梦想，飞翔吧。' },
  { id: 206, title: '辉夜大小姐想让我告白', cover: BANGUMI_COVERS[0]!, score: 9.0, year: 2022, episodes: 37, genre: ['恋爱', '喜剧'], description: '天才们的恋爱头脑战。' },
  { id: 207, title: '86 -不存在的战区-', cover: BANGUMI_COVERS[1]!, score: 8.7, year: 2021, episodes: 23, genre: ['科幻', '战争'], description: '被国家抛弃的少年兵们的战斗与尊严。' },
  { id: 208, title: '迷宫饭', cover: BANGUMI_COVERS[2]!, score: 8.9, year: 2024, episodes: 24, genre: ['奇幻', '美食'], description: '在迷宫深处用魔物做美食。' },
  { id: 209, title: '孤独摇滚', cover: BANGUMI_COVERS[0]!, score: 9.2, year: 2022, episodes: 12, genre: ['音乐', '日常'], description: '社恐少女的乐队之路。' },
  { id: 210, title: '石纪元', cover: BANGUMI_COVERS[1]!, score: 8.6, year: 2023, episodes: 48, genre: ['科幻', '冒险'], description: '石化世界中用科学重建文明。' },
  { id: 211, title: '欢迎来到实力至上主义教室', cover: BANGUMI_COVERS[2]!, score: 8.5, year: 2024, episodes: 38, genre: ['校园', '心理'], description: '表面平静的精英学校暗流涌动。' },
  { id: 212, title: '天国大魔境', cover: BANGUMI_COVERS[0]!, score: 8.8, year: 2023, episodes: 13, genre: ['科幻', '冒险'], description: '末日废墟中少年少女寻找天国。' },
  { id: 213, title: '奔跑吧梅洛斯', cover: BANGUMI_COVERS[1]!, score: 8.4, year: 2024, episodes: 12, genre: ['剧情', '文学'], description: '以太宰治作品为灵感的群像剧。' },
  { id: 214, title: '物语系列', cover: BANGUMI_COVERS[2]!, score: 9.4, year: 2025, episodes: 100, genre: ['奇幻', '对话'], description: '怪异与少女们的物语。' },
  { id: 215, title: '夏日重现', cover: BANGUMI_COVERS[0]!, score: 8.9, year: 2022, episodes: 25, genre: ['悬疑', '科幻'], description: '小岛上的时间循环与影之谜。' },
  { id: 216, title: '别当欧尼酱了', cover: BANGUMI_COVERS[1]!, score: 7.8, year: 2023, episodes: 12, genre: ['喜剧', '日常'], description: '突然变成妹妹的日常搞笑生活。' },
  { id: 217, title: '机动战士高达：水星的魔女', cover: BANGUMI_COVERS[2]!, score: 8.6, year: 2023, episodes: 24, genre: ['科幻', '战斗'], description: '学园舞台上的高达决斗与阴谋。' },
  { id: 218, title: '地狱乐', cover: BANGUMI_COVERS[0]!, score: 8.3, year: 2023, episodes: 13, genre: ['动作', '奇幻'], description: '忍者死刑犯踏入极乐净土的生存之旅。' },
  { id: 219, title: '总之就是非常可爱', cover: BANGUMI_COVERS[1]!, score: 8.2, year: 2023, episodes: 24, genre: ['恋爱', '喜剧'], description: '闪婚之后的甜蜜新婚生活。' },
]

/**
 * Simulates a paginated API call.
 * Each page returns `pageSize` items from the pool (cycles if needed).
 * Stops after `maxPages` pages.
 */
export function createMockFetchPage(pageSize = 20, maxPages = 10) {
  return async (page: number): Promise<{ items: Anime[]; hasMore: boolean }> => {
    // Simulate network delay
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 300))

    const pool = ANIME_POOL
    const items: Anime[] = []
    for (let i = 0; i < pageSize; i++) {
      const src = pool[(page * pageSize + i) % pool.length]!
      items.push({
        ...src,
        // Give each item a unique id across pages
        id: src.id + page * 1000 + i,
      })
    }

    return {
      items,
      hasMore: page < maxPages - 1,
    }
  }
}