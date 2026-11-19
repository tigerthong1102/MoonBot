const words = new Map(Object.entries({
  'nhân với':'*','chia cho':'/','multiplied by':'*','divided by':'/','phần trăm':'%',
  'không':'0','một':'1','hai':'2','ba':'3','bốn':'4','năm':'5','sáu':'6','bảy':'7','tám':'8','chín':'9','mười':'10',
  zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10',
  'cộng':'+','trừ':'-','nhân':'*','chia':'/',plus:'+',minus:'-',times:'*',percent:'%'
}));
const wordPattern = new RegExp('(?<![\\p{L}\\p{N}])('+[...words.keys()].join('|')+')(?![\\p{L}\\p{N}])','gu');

export function calculate(input,lang) {
  if (input.length > 220) return null;
  let expr = input.trim().toLowerCase().replace(/^(?:tính|calculate|what is)\s+/u,'')
    .replace(/\s*(?:bằng (?:bao nhiêu|mấy))?\s*\?\s*(?:(?:chỉ trả lời bằng (?:một )?chữ số|answer (?:with|in) (?:digits|numbers) only)[.!]?)?$/u,'')
    .replace(wordPattern,w=>words.get(w)).replaceAll('×','*').replaceAll('÷','/').replaceAll('−','-').trim();
  if (lang === 'vi') {
    if (expr.includes('.')) return null;
    expr = expr.replaceAll(',','.');
  }
  if (!/[+*\/%-]/.test(expr)) return null;
  const tokens = expr.match(/\d+(?:\.\d+)?|[()+*/%-]/g);
  if (!tokens || tokens.length > 70 || tokens.join('') !== expr.replace(/\s/g,'')) return null;
  let at = 0;
  function number() {
    const token = tokens[at++];
    if (token === '-' || token === '+') {
      const [n,d] = number();
      return [token === '-' ? -n : n,d];
    }
    let result;
    if (token === '(') {
      result = expression();
      if (tokens[at++] !== ')') throw Error();
    } else {
      if (!token || !/^\d{1,24}(?:\.\d{1,12})?$/.test(token)) throw Error();
      const [int,frac=''] = token.split('.');
      result = [BigInt(int+frac),10n**BigInt(frac.length)];
    }
    if (tokens[at] === '%') { at++; result[1] *= 100n; }
    return result;
  }
  function product() {
    let [n,d] = number();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++], [b,c] = number();
      if (op === '*') { n *= b; d *= c; }
      else { if (!b) throw Error(); n *= c; d *= b; }
    }
    return [n,d];
  }
  function expression() {
    let [n,d] = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++], [b,c] = product();
      n = n*c + (op === '+' ? b : -b)*d;
      d *= c;
    }
    return [n,d];
  }
  try {
    let [n,d] = expression();
    if (at !== tokens.length) return null;
    const negative = (n < 0n) !== (d < 0n);
    if (n < 0n) n = -n;
    if (d < 0n) d = -d;
    let result = (negative && n !== 0n ? '-' : '') + (n/d).toString();
    let rem = n%d, tail = '';
    while (rem && tail.length < 12) { rem *= 10n; tail += (rem/d).toString(); rem %= d; }
    if (tail) result += (lang === 'vi' ? ',' : '.') + tail;
    return (rem ? '≈ ' : '') + result;
  } catch { return null; }
}
