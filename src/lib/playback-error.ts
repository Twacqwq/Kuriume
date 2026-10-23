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
  // MEDIA_ERR_SRC_NOT_SUPPORTED ("Media error 4", "Format error"): the file
  // is in a format or codec this device cannot play (often H.265 or 10-bit).
  if (/media error 4|format error|src_not_supported|not supported/i.test(reason)) {
    return "当前设备不支持这个视频格式，请换个节点、线路或播放源。";
  }
  if (/decode|codec|解码|media error 3/i.test(reason)) return "当前视频无法解码，请切换版本或播放源。";
  if (/dns|network|http|connect|网络/i.test(reason)) return "暂时无法连接播放源，请检查网络后重试。";
  return "视频未能加载，请重试或切换播放源。";
}
