// Low-level wrapper around the GitHub Contents API — the shared storage
// backend when GitHub sync is configured. This is the only module that
// knows about GitHub's REST API shape (base64 content, sha-based optimistic
// concurrency); storage.js is the only caller.

const CONFIG_KEY = 'trade_app.github_sync_config.v1';

class GitHubStoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'GitHubStoreError';
    this.cause = cause;
  }
}

class GitHubConflictError extends GitHubStoreError {
  constructor() {
    super('資料在其他裝置上已被更新，請重新整理後再試一次');
    this.name = 'GitHubConflictError';
  }
}

function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setConfig({ token, owner, repo, path }) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ token, owner, repo, path }));
}

function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

function isConfigured() {
  const c = getConfig();
  return !!(c && c.token && c.owner && c.repo && c.path);
}

function apiUrl(config) {
  return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.path}`;
}

// UTF-8 safe base64 encode/decode (btoa/atob only handle Latin1 directly).
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Fetch the current document. Returns { content: <parsed JSON>, sha } or
 * { content: null, sha: null } if the file doesn't exist yet (first use). */
async function fetchRemote() {
  const config = getConfig();
  if (!config) throw new GitHubStoreError('尚未設定 GitHub 同步');

  let response;
  try {
    response = await fetch(apiUrl(config), {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
      },
    });
  } catch (err) {
    throw new GitHubStoreError('無法連線到 GitHub', err);
  }

  if (response.status === 404) {
    return { content: null, sha: null };
  }
  if (response.status === 401 || response.status === 403) {
    throw new GitHubStoreError('GitHub Token 無效或權限不足，請到資料設定重新輸入');
  }
  if (!response.ok) {
    throw new GitHubStoreError(`GitHub API 回應錯誤：HTTP ${response.status}`);
  }

  const json = await response.json();
  let content;
  try {
    content = JSON.parse(base64ToUtf8(json.content));
  } catch (err) {
    throw new GitHubStoreError('遠端資料格式無法解析', err);
  }
  return { content, sha: json.sha };
}

/** Write the document. `sha` is the sha last read (null for first write).
 * Throws GitHubConflictError on a 409 (someone else wrote in between) —
 * caller should re-fetch and retry rather than blindly overwrite. */
async function pushRemote(content, sha, message = '更新交易資料') {
  const config = getConfig();
  if (!config) throw new GitHubStoreError('尚未設定 GitHub 同步');

  const body = {
    message,
    content: utf8ToBase64(JSON.stringify(content, null, 2)),
  };
  if (sha) body.sha = sha;

  let response;
  try {
    response = await fetch(apiUrl(config), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GitHubStoreError('無法連線到 GitHub', err);
  }

  if (response.status === 409) {
    throw new GitHubConflictError();
  }
  if (response.status === 401 || response.status === 403) {
    throw new GitHubStoreError('GitHub Token 無效或權限不足，請到資料設定重新輸入');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new GitHubStoreError(`GitHub API 寫入失敗：HTTP ${response.status} ${text}`);
  }

  const json = await response.json();
  return json.content.sha;
}

export { getConfig, setConfig, clearConfig, isConfigured, fetchRemote, pushRemote, GitHubStoreError, GitHubConflictError };
