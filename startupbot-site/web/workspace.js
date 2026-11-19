export function workspaceAddress(raw) {
  const input = raw.trim();
  if (/[\s\\\x00-\x1f]/.test(input) || !/^https?:\/\//i.test(input)) throw new Error();
  const url = new URL(input);
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error();
  return url;
}

export function connectWorkspace(w) {
  const form = document.getElementById('workspace');
  const field = document.getElementById('host');
  const remember = document.getElementById('remember-host');
  const key = 'startupbot.workspace.origin.v1';
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      field.value = workspaceAddress(stored).origin;
      remember.checked = true;
    }
  } catch {}
  remember.onchange = () => {
    if (!remember.checked) try { localStorage.removeItem(key); } catch {}
  };
  form.onsubmit = event => {
    event.preventDefault();
    try {
      const url = workspaceAddress(field.value);
      try {
        if (remember.checked) localStorage.setItem(key,url.origin);
        else localStorage.removeItem(key);
      } catch {}
      location.assign(url.href);
    } catch {
      document.getElementById('host-error').textContent = w.invalid;
      field.focus();
    }
  };
}
