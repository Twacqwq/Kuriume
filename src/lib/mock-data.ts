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