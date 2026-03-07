import { createFileRoute } from "@tanstack/react-router";
import { HeroBanner, type BannerItem } from "@/components/hero-banner";
import { AnimeGrid } from "@/components/anime-grid";
import { invoke } from "@tauri-apps/api/core";
import type { AnimeInfo, PagedResult } from "@/lib/types";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

const mockItems: BannerItem[] = [
  {
    id: 1,
    title: "葬送的芙莉莲",
    cover: "https://lain.bgm.tv/pic/cover/l/13/c5/400602_ZI8Y9.jpg",
    score: 9.4,
    year: 2023,
    episodes: 28,
    genre: ["奇幻", "冒险"],
    description:
      "勇者一行击败魔王后，精灵魔法使芙莉莲开始了新的旅程。在漫长岁月中回顾曾经的伙伴，她逐渐学会理解人类的情感。",
  },
  {
    id: 2,
    title: "咒术回战",
    cover: "https://lain.bgm.tv/pic/cover/l/60/fe/294993_JrrzK.jpg",
    score: 9.1,
    year: 2020,
    episodes: 24,
    genre: ["动作", "奇幻"],
    description:
      "隐藏着强大诅咒力量的少年虎杖悠仁，被卷入咒术师与诅咒之间的殊死战斗。",
  },
  {
    id: 3,
    title: "进击的巨人",
    cover: "https://lain.bgm.tv/pic/cover/l/d2/ea/229612_vntMZ.jpg",
    score: 9.2,
    year: 2013,
    episodes: 25,
    genre: ["动作", "悬疑"],
    description:
      "人类栖息在三重高墙之内，直到超大型巨人出现，打破了百年的和平。少年艾伦发誓要驱逐所有巨人。",
  },
  {
    id: 4,
    title: "鬼灭之刃",
    cover: "https://lain.bgm.tv/pic/cover/l/9d/d1/245665_5an54.jpg",
    score: 9.0,
    year: 2019,
    episodes: 26,
    genre: ["动作", "奇幻"],
    description:
      "少年炭治郎踏上了成为最强剑士的道路，与同伴一起斩杀恶鬼，保护所爱之人。",
  },
  {
    id: 5,
    title: "CLANNAD",
    cover: "https://lain.bgm.tv/pic/cover/l/28/38/51_z0Ly8.jpg",
    score: 9.3,
    year: 2007,
    episodes: 23,
    genre: ["校园", "恋爱"],
    description:
      "冈崎朋也在樱花飞舞的坡道上邂逅少女古河渚，从此他浑浑噩噩的生活发生了改变。",
  },
];


const PAGE_SIZE = 50;

async function fetchAnimeList(offset: number): Promise<PagedResult<AnimeInfo>> {
  return invoke<PagedResult<AnimeInfo>>("get_list", {
    provider: "Bangumi",
    query: {
      limit: PAGE_SIZE,
      offset,
      soft: "Rank",
      type: 2,
      year: 2026,
    },
  });
}

function IndexComponent() {
  return (
    <div>
      <HeroBanner items={mockItems} />
      {/* Content area — overlaps banner fade zone */}
      <AnimeGrid
        title="全部番剧"
        queryKey={["anime-list", "Bangumi"]}
        queryFn={fetchAnimeList}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}