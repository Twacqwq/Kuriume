import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  AnimeDetail,
  type AnimeDetailData,
} from "@/components/anime-detail";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import type { AnimeInfo } from "@/lib/types";

function toAnimeDetailData(info: AnimeInfo): AnimeDetailData {
  return {
    id: Number(info.id),
    title: info.title_cn || info.title,
    titleOriginal: info.title_cn ? info.title : undefined,
    cover: info.cover ?? "",
    score: info.score ?? 0,
    ratingCount: 0,
    year: info.year ?? 0,
    season: "",
    status: "已完结",
    totalEpisodes: info.total_episodes,
    currentEpisodes: info.total_episodes,
    genre: info.genres,
    studio: "",
    director: "",
    description: info.description ?? "",
    episodes: [],
    characters: [],
    related: [],
  };
}

export const Route = createFileRoute("/anime/$id")({
  loader: async ({ params }) => {
    if (queryClient.getQueryData(["anime-detail", params.id])) return;

    await queryClient.prefetchQuery({
      queryKey: ["anime-detail", params.id],
      queryFn: () =>
        invoke<AnimeInfo>("get_detail", {
          provider: "Bangumi",
          id: params.id,
        }),
    });
  },
  component: AnimeDetailPage,
});

const MOCK_DETAIL: AnimeDetailData = {
  id: 1,
  title: "葬送的芙莉莲",
  titleOriginal: "葬送のフリーレン",
  cover: "https://lain.bgm.tv/pic/cover/l/13/c5/400602_ZI8Y9.jpg",
  score: 9.4,
  ratingCount: 12850,
  year: 2023,
  season: "秋季",
  status: "已完结",
  totalEpisodes: 28,
  currentEpisodes: 28,
  genre: ["奇幻", "冒险", "治愈", "剧情"],
  studio: "MADHOUSE",
  director: "斋藤圭一郎",
  description:
    "勇者一行击败魔王后，精灵魔法使芙莉莲开始了新的旅程。在漫长岁月中回顾曾经的伙伴，她逐渐学会理解人类的情感。这是一段关于「了解人类」的冒险物语。通过与弟子费伦、战士修塔尔克的旅行，千年精灵芙莉莲终于开始理解那些转瞬即逝却无比珍贵的人类情感。",
  episodes: Array.from({ length: 28 }, (_, i) => ({
    id: i + 1,
    number: i + 1,
    title: [
      "冒险的结束", "去往魔法都市", "杀人魔法", "灵魂的灯火",
      "死者的幻影", "新年快乐", "像勇者一样", "冒险的开始",
      "断头台的贤者", "沉潜于黑暗中的修道士", "北方勇者", "那时的选择",
      "同族", "不一般的随行护卫", "厄运真的来了", "长寿种族的老师",
      "去往第一级魔法使试验的旅途", "在第一级魔法使考试中", "入学",
      "必要的准备", "魔法的使用方法", "暗号", "迷宫攻略",
      "完美的复制体", "一级魔法使试验的终结", "默契", "人类的时代", "享受旅途",
    ][i] ?? `第 ${i + 1} 话`,
    cover: "https://lain.bgm.tv/pic/cover/l/13/c5/400602_ZI8Y9.jpg",
    duration: `${22 + (i % 3)}:${String(30 + (i % 30)).padStart(2, "0")}`,
    progress: i < 5 ? 100 : i === 5 ? 42 : undefined,
  })),
  characters: [
    {
      id: 1,
      name: "芙莉莲",
      role: "主角",
      avatar: "https://lain.bgm.tv/pic/crt/l/0d/0d/107862_crt_FKm8I.jpg",
      cv: "种崎敦美",
    },
    {
      id: 2,
      name: "费伦",
      role: "主角",
      avatar: "https://lain.bgm.tv/pic/crt/l/c2/b5/107863_crt_1Ap5p.jpg",
      cv: "市之�的加那",
    },
    {
      id: 3,
      name: "修塔尔克",
      role: "主角",
      avatar: "https://lain.bgm.tv/pic/crt/l/c0/56/107864_crt_Zua6z.jpg",
      cv: "小林千晃",
    },
    {
      id: 4,
      name: "欣梅尔",
      role: "主要角色",
      avatar: "https://lain.bgm.tv/pic/crt/l/6f/cc/107865_crt_eKp2G.jpg",
      cv: "�的木毅",
    },
    {
      id: 5,
      name: "海塔",
      role: "主要角色",
      avatar: "https://lain.bgm.tv/pic/crt/l/0d/0d/107862_crt_FKm8I.jpg",
      cv: "东山奈央",
    },
    {
      id: 6,
      name: "艾泽",
      role: "主要角色",
      avatar: "https://lain.bgm.tv/pic/crt/l/c2/b5/107863_crt_1Ap5p.jpg",
      cv: "上田丽奈",
    },
    {
      id: 7,
      name: "赞泽",
      role: "配角",
      avatar: "https://lain.bgm.tv/pic/crt/l/c0/56/107864_crt_Zua6z.jpg",
      cv: "梶裕贵",
    },
    {
      id: 8,
      name: "丹肯",
      role: "配角",
      avatar: "https://lain.bgm.tv/pic/crt/l/6f/cc/107865_crt_eKp2G.jpg",
      cv: "森川智之",
    },
  ],
  related: [
    {
      id: 201,
      title: "迷宫饭",
      cover: "https://lain.bgm.tv/pic/cover/l/13/c5/400602_ZI8Y9.jpg",
      score: 8.9,
      year: 2024,
      relation: "类似推荐",
    },
    {
      id: 202,
      title: "药屋少女的呢喃",
      cover: "https://lain.bgm.tv/pic/cover/l/60/fe/294993_JrrzK.jpg",
      score: 9.0,
      year: 2024,
      relation: "类似推荐",
    },
    {
      id: 203,
      title: "狼与香辛料",
      cover: "https://lain.bgm.tv/pic/cover/l/d2/ea/229612_vntMZ.jpg",
      score: 8.7,
      year: 2024,
      relation: "类似推荐",
    },
    {
      id: 204,
      title: "魔女之旅",
      cover: "https://lain.bgm.tv/pic/cover/l/9d/d1/245665_5an54.jpg",
      score: 8.2,
      year: 2020,
      relation: "类似推荐",
    },
    {
      id: 205,
      title: "紫罗兰永恒花园",
      cover: "https://lain.bgm.tv/pic/cover/l/28/38/51_z0Ly8.jpg",
      score: 9.1,
      year: 2018,
      relation: "类似推荐",
    },
    {
      id: 206,
      title: "来自深渊",
      cover: "https://lain.bgm.tv/pic/cover/l/13/c5/400602_ZI8Y9.jpg",
      score: 8.8,
      year: 2017,
      relation: "类似推荐",
    },
  ],
};

function AnimeDetailPage() {
  const router = useRouter();
  const { id } = Route.useParams();

  const { data } = useQuery({
    queryKey: ["anime-detail", id],
    queryFn: () =>
      invoke<AnimeInfo>("get_detail", {
        provider: "Bangumi",
        id,
      }),
    initialData: () => queryClient.getQueryData<AnimeInfo>(["anime-detail", id]),
  });

  if (!data) return null;

  return (
    <AnimeDetail
      data={toAnimeDetailData(data)}
      onBack={() => router.history.back()}
    />
  );
}