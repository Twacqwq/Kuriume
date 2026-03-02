use serde::{Deserialize, Serialize};

/// 番剧基本信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimeInfo {
    /// 数据源内部 ID
    pub id: String,
    /// 番剧标题
    pub title: String,
    /// 封面图 URL
    pub cover: Option<String>,
    /// 评分（0-10）
    pub score: Option<f64>,
    /// 首播年份
    pub year: Option<u16>,
    /// 总集数
    pub episodes: Option<u32>,
    /// 分类标签
    pub genres: Vec<String>,
    /// 简介
    pub description: Option<String>,
}

/// 搜索请求参数
#[derive(Debug, Clone, Default)]
pub struct SearchQuery {
    /// 搜索关键词
    pub keyword: String,
    /// 分页偏移
    pub offset: u32,
    /// 每页数量
    pub limit: u32,
}

/// 分页结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PagedResult<T> {
    /// 数据列表
    pub data: Vec<T>,
    /// 总数
    pub total: u32,
}
