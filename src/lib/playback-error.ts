/** Keep provider diagnostics available without making them the main player UI. */
export function playbackErrorMessage(reason: string): string {
  if (/NEED_CAPTCHA|captcha|人机验证/i.test(reason)) {
    return "这个播放源暂时无法直连，请切换其他播放源。";
  }
  if (/too many requests|429|rate.limit/i.test(reason)) {
    return "播放源暂时限制了请求频率，请稍后重试。";
  }
  if (/timeout|timed out|超时/i.test(reason)) return "播放源响应超时，请重试或切换播放源。";
  if (/404|not found|no supported|没有可用|无可用/i.test(reason)) return "这一话暂时没有可用视频，请切换版本或播放源。";
  if (/403|401|expired|forbidden/i.test(reason)) return "播放地址已失效，重试可获取新地址。";
  if (/decode|codec|解码/i.test(reason)) return "当前视频无法解码，请切换版本或播放源。";
  if (/dns|network|http|connect|网络/i.test(reason)) return "暂时无法连接播放源，请检查网络后重试。";
  return "视频未能加载，请重试或切换播放源。";
}
