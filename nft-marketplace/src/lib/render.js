export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function htmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

const BASE_STYLE = `
:root{
  --bg:#0D0714;
  --surface:#160D20;
  --surface-2:#1E1329;
  --border:#332145;
  --text:#F3EEFA;
  --text-muted:#A797C0;
  --violet:#8B5CF6;
  --magenta:#F43F7E;
  --gold:#F5C24D;
  --green:#34D399;
  --radius:14px;
  --font-display:'Space Grotesk', 'Segoe UI', sans-serif;
  --font-body:'Inter', 'Segoe UI', sans-serif;
  --font-mono:'JetBrains Mono', ui-monospace, monospace;
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  background:
    radial-gradient(circle at 15% 0%, rgba(139,92,246,0.16), transparent 45%),
    radial-gradient(circle at 85% 20%, rgba(244,63,126,0.14), transparent 40%),
    var(--bg);
  color:var(--text);
  font-family:var(--font-body);
  min-height:100vh;
  line-height:1.5;
}
a{color:inherit;}
.container{max-width:1180px;margin:0 auto;padding:0 24px;}
.nav{
  display:flex;align-items:center;justify-content:space-between;
  padding:20px 24px;border-bottom:1px solid var(--border);
  position:sticky;top:0;z-index:20;
  background:rgba(13,7,20,0.85);backdrop-filter:blur(10px);
}
.brand{
  font-family:var(--font-display);font-weight:700;font-size:20px;
  letter-spacing:0.02em;display:flex;align-items:center;gap:10px;
  text-decoration:none;
}
.brand-dot{
  width:10px;height:10px;border-radius:3px;
  background:conic-gradient(from 90deg, var(--violet), var(--magenta), var(--gold), var(--violet));
}
.nav-links{display:flex;gap:22px;align-items:center;font-size:14px;color:var(--text-muted);}
.nav-links a{text-decoration:none;transition:color .15s;}
.nav-links a:hover{color:var(--text);}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:11px 20px;border-radius:10px;border:1px solid transparent;
  font-family:var(--font-body);font-weight:600;font-size:14px;cursor:pointer;
  text-decoration:none;transition:transform .12s ease, box-shadow .12s ease, opacity .12s ease;
}
.btn:active{transform:scale(0.97);}
.btn-primary{
  background:linear-gradient(135deg, var(--violet), var(--magenta));
  color:#fff;box-shadow:0 8px 24px -8px rgba(139,92,246,0.55);
}
.btn-primary:hover{box-shadow:0 10px 28px -6px rgba(244,63,126,0.55);}
.btn-ghost{background:var(--surface-2);border-color:var(--border);color:var(--text);}
.btn-ghost:hover{border-color:var(--violet);}
.btn-block{width:100%;}
.btn[disabled]{opacity:.5;cursor:not-allowed;}

.hero{padding:64px 24px 32px;text-align:left;}
.eyebrow{
  font-family:var(--font-mono);font-size:12px;letter-spacing:0.14em;
  color:var(--gold);text-transform:uppercase;margin-bottom:14px;display:inline-block;
}
.hero h1{
  font-family:var(--font-display);font-size:clamp(30px,5vw,52px);
  line-height:1.05;margin:0 0 16px;max-width:820px;
}
.hero p{color:var(--text-muted);max-width:560px;font-size:16px;margin:0 0 4px;}

.grid{
  display:grid;grid-template-columns:repeat(auto-fill, minmax(240px,1fr));
  gap:22px;padding:8px 24px 64px;max-width:1180px;margin:0 auto;
}
.card{
  position:relative;border-radius:var(--radius);background:var(--surface);
  border:1px solid var(--border);overflow:hidden;
  transition:transform .18s ease, border-color .18s ease;
}
.card:hover{transform:translateY(-4px);border-color:var(--violet);}
.card::before{
  content:"";position:absolute;inset:0;padding:1px;border-radius:var(--radius);
  background:conic-gradient(from 0deg, var(--violet), var(--magenta), var(--gold), var(--violet));
  -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  opacity:0;transition:opacity .2s ease;pointer-events:none;
}
.card:hover::before{opacity:.9;}
.card-media{aspect-ratio:1/1;width:100%;background:#0A0510;display:block;object-fit:cover;}
.locked-media{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:8px;color:var(--text-muted);background:var(--surface-2);
}
.locked-icon{font-size:28px;opacity:.6;}
.locked-text{font-size:12px;font-weight:600;}
.protected-media{background-color:#0A0510;background-repeat:no-repeat;user-select:none;}
.card-body{padding:16px 16px 18px;}
.card-name{font-family:var(--font-display);font-size:16px;margin:0 0 4px;}
.card-desc{font-size:13px;color:var(--text-muted);margin:0 0 14px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.card-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.price-tag{
  font-family:var(--font-mono);font-size:14px;font-weight:600;color:var(--gold);
  border:1px dashed var(--gold);border-radius:8px;padding:4px 10px;
}
.empty-state{
  grid-column:1/-1;text-align:center;padding:80px 20px;color:var(--text-muted);
}

.auth-wrap{max-width:420px;margin:64px auto;padding:0 24px;}
.panel{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:32px;
}
.panel h2{font-family:var(--font-display);margin:0 0 6px;font-size:24px;}
.panel .sub{color:var(--text-muted);font-size:14px;margin:0 0 24px;}
.field{margin-bottom:16px;}
.field label{display:block;font-size:13px;color:var(--text-muted);margin-bottom:6px;}
.field .req{color:var(--magenta);}
input[type=text],input[type=password],input[type=email],input[type=tel],input[type=number],textarea,select{
  width:100%;padding:11px 13px;border-radius:9px;border:1px solid var(--border);
  background:var(--surface-2);color:var(--text);font-family:var(--font-body);font-size:14px;
  outline:none;transition:border-color .15s;
}
input:focus,textarea:focus,select:focus{border-color:var(--violet);}
.form-note{font-size:13px;color:var(--text-muted);margin-top:18px;text-align:center;}
.form-note a{color:var(--violet);font-weight:600;text-decoration:none;}
.alert{
  padding:12px 14px;border-radius:9px;font-size:13px;margin-bottom:16px;display:none;
}
.alert.show{display:block;}
.alert-error{background:rgba(244,63,126,0.12);border:1px solid rgba(244,63,126,0.4);color:#FCC9DC;}
.alert-success{background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.4);color:#BEF5E0;}

.pay-options{display:flex;gap:10px;margin-bottom:4px;}
.pay-option{
  flex:1;border:1px solid var(--border);border-radius:10px;padding:12px;
  cursor:pointer;text-align:center;font-size:13px;font-weight:600;
  background:var(--surface-2);transition:border-color .15s, background .15s;
}
.pay-option input{display:none;}
.pay-option.active{border-color:var(--violet);background:rgba(139,92,246,0.12);}

.modal-backdrop{
  position:fixed;inset:0;background:rgba(6,3,10,0.72);backdrop-filter:blur(3px);
  display:none;align-items:center;justify-content:center;z-index:100;padding:20px;
}
.modal-backdrop.open{display:flex;}
.modal{
  width:100%;max-width:460px;background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:28px;max-height:90vh;overflow-y:auto;
}
.modal-close{float:right;background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;}

.footer{border-top:1px solid var(--border);padding:28px 24px;text-align:center;color:var(--text-muted);font-size:13px;}

.admin-shell{display:flex;min-height:100vh;}
.admin-side{
  width:220px;flex-shrink:0;background:var(--surface);border-right:1px solid var(--border);
  padding:24px 16px;
}
.admin-side .brand{margin-bottom:28px;}
.admin-side a{
  display:block;padding:10px 12px;border-radius:8px;color:var(--text-muted);
  text-decoration:none;font-size:14px;margin-bottom:4px;
}
.admin-side a:hover, .admin-side a.active{background:var(--surface-2);color:var(--text);}
.admin-main{flex:1;padding:32px;max-width:1000px;}
.admin-main h1{font-family:var(--font-display);font-size:26px;margin:0 0 6px;}
.admin-main .sub{color:var(--text-muted);margin:0 0 28px;font-size:14px;}

table{width:100%;border-collapse:collapse;font-size:14px;}
th{text-align:left;color:var(--text-muted);font-weight:600;font-size:12px;text-transform:uppercase;
  letter-spacing:.04em;padding:10px 12px;border-bottom:1px solid var(--border);}
td{padding:12px;border-bottom:1px solid var(--border);vertical-align:middle;}
tr:last-child td{border-bottom:none;}
.thumb{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#0A0510;}
.row-actions{display:flex;gap:8px;}
.icon-btn{
  background:var(--surface-2);border:1px solid var(--border);border-radius:7px;
  padding:6px 10px;font-size:12px;cursor:pointer;color:var(--text);
}
.icon-btn.danger:hover{border-color:var(--magenta);color:var(--magenta);}
.icon-btn:hover{border-color:var(--violet);}

.upload-card{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:24px;margin-bottom:28px;
}
.upload-card h3{font-family:var(--font-display);margin:0 0 16px;font-size:18px;}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media (max-width:640px){.grid-2{grid-template-columns:1fr;}.admin-shell{flex-direction:column;}
  .admin-side{width:100%;display:flex;align-items:center;justify-content:space-between;}
  .admin-side a{display:inline-block;}
}
`;

export function layout({ title, body, extraHead = "", bodyClass = "" }) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>${BASE_STYLE}</style>
${extraHead}
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}
