function rangeOf(value, size) {
  if (!value) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) return false;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? {offset:start,length:end-start+1} : false;
}

async function download(request, env, file) {
  const tag = '"' + file.sha + '"';
  const ifRange = request.headers.get('if-range');
  const range = rangeOf(ifRange && ifRange !== tag ? null : request.headers.get('range'),file.size);
  if (range === false) return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+file.size}});
  const object = request.method === 'HEAD' ? await env.BUCKET.head(file.sha) :
    await env.BUCKET.get(file.sha,range ? {range} : undefined);
  if (!object || object.size !== file.size) return new Response(null,{status:404});
  const headers = new Headers({
    'Content-Type':'application/octet-stream',
    'Content-Disposition':'attachment; filename="'+file.name+'"',
    'X-Content-Type-Options':'nosniff',
    'Content-Length':String(range ? range.length : file.size),
    'Accept-Ranges':'bytes','ETag':tag,'Cache-Control':'public, max-age=86400, no-transform'
  });
  if (range) headers.set('Content-Range','bytes '+range.offset+'-'+(range.offset+range.length-1)+'/'+file.size);
  return new Response(object.body ?? null,{status:range ? 206 : 200,headers});
}

function decodeBinary(encoded) {
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    if (/^\/(?:[a-z][a-z0-9-]*\/)?app(?:\/|$)|^\/web-auth\/callback$/.test(pathname)) {
      const response=await workspaceWeb(request,env) ?? await hostedWeb(request,env);
      if (response) return response;
    }
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
    if (pathname.startsWith('/files/')) {
      const file = files.get(pathname.slice(7));
      return file ? download(request,env,file) : new Response(null,{status:404});
    }
    const asset = assets.get(pathname) ?? assets.get(pathname+'/');
    if (!asset) return new Response(null,{status:404});
    const body = request.method === 'HEAD' ? null : ['image/png','application/wasm'].includes(asset.type) ?
      decodeBinary(asset.body) : asset.body;
    const headers = {'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    if (pathname.startsWith('/web/runtime-2.3.7/') || pathname.startsWith('/web/hash-4.12.0/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    return new Response(body,{headers});
  }
};
