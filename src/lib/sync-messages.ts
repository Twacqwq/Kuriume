import { isSyncFailure, type SyncOutcome } from "@/lib/sync";

/** A short readable description of a finished sync, shared by the sync page and automatic runs. */
export function describeSyncOutcome(outcome: SyncOutcome, zh: boolean) {
  const parts: string[] = [];
  if (outcome.uploaded) parts.push(zh ? "已上传本机记录" : "uploaded local records");
  if (outcome.skipped_download) parts.push(zh ? "云端没有记录，未下载" : "nothing downloaded");
  if (outcome.written > 0) parts.push(zh ? `合并 ${outcome.written} 部作品` : `merged ${outcome.written} works`);
  if (outcome.note) parts.push(noteText(outcome.note, zh));
  if (parts.length === 0) parts.push(zh ? "同步完成" : "sync finished");
  return parts.join(zh ? "，" : ", ");
}

function noteText(note: string, zh: boolean) {
  switch (note) {
    case "no_etag":
      return zh ? "服务器没有提供 ETag，关闭应用时不会快速推送" : "the server sent no ETag, so closing will not fast-push";
    case "weak_etag":
      return zh ? "服务器只提供弱 ETag，已按完整流程同步" : "only a weak ETag was available; the full round-trip ran";
    case "auto_disabled":
      return zh ? "自动同步没有开启" : "automatic sync is off";
    case "recent":
      return zh ? "5 分钟内刚同步过，已跳过" : "already synced within 5 minutes";
    default:
      return note;
  }
}

/** Turn a rejected sync command into a readable message. */
export function describeSyncFailure(reason: unknown, zh: boolean, fallback: string) {
  if (!isSyncFailure(reason)) return messageFromReason(reason, fallback);
  const text = {
    config_missing: zh ? "还没有填写服务器地址" : "No sync server is configured yet.",
    need_password: zh ? "需要重新输入密码" : "Enter the password again.",
    not_https: zh ? "只支持以 https:// 开头的地址" : "Only HTTPS addresses are supported.",
    invalid_url: zh ? "服务器地址无效" : "The server address is not valid.",
    invalid_path: zh ? "远程路径必须以 / 开头，且不能包含 .. 或 //" : "The remote path must start with / and must not contain .. or //.",
    auth: zh ? "用户名或密码被拒绝（401）" : "The username or password was rejected (401).",
    forbidden: zh ? "服务器拒绝访问（403）" : "The server refused access (403).",
    not_found: zh ? "远程地址不存在（404）" : "The remote address does not exist (404).",
    mkcol_failed: zh ? "无法创建远程文件夹" : "The remote folder could not be created.",
    conflict: zh ? "云端文件在另一台设备上被改动过，请重试" : "The file changed on another device; retry.",
    too_large: zh ? "云端文件超过 32 MB" : "The remote file is larger than 32 MB.",
    corrupt: zh ? "云端文件不是 Kuriume 记录文件，未改动本机数据" : "The remote file is not a Kuriume records file; nothing changed.",
    schema_too_new: zh ? "云端文件来自更新版本的 Kuriume" : "The remote file comes from a newer Kuriume.",
    insufficient_storage: zh ? "服务器空间不足（507）" : "The server is out of space (507).",
    redirect: zh ? "服务器返回了重定向，请检查地址" : "The server returned a redirect; check the address.",
    tls: zh ? "TLS 证书校验失败" : "The TLS certificate was rejected.",
    timeout: zh ? "同步超时" : "The sync ran out of time.",
    busy: zh ? "已有同步在进行" : "A sync is already running.",
    keyring: zh ? "系统凭据管理器不可用" : "The system credential store is unavailable.",
    unsupported_platform: zh ? "这个平台暂不支持同步" : "Sync is not supported on this platform yet.",
    server: zh ? "服务器返回错误" : "The server returned an error.",
    network: zh ? "无法连接到服务器" : "The server could not be reached.",
    internal: zh ? "同步出现内部错误" : "The sync failed unexpectedly.",
  } as Record<string, string>;
  return text[reason.code] ?? (reason.message || fallback);
}

/** A plain error object or string, used when the failure is not a sync command result. */
export function messageFromReason(reason: unknown, fallback: string) {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return fallback;
}
