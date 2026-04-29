/* AI Voice Agent — embeddable chatbot widget (vanilla JS, no deps).
   Usage:
     <script src="https://yourdomain.com/widget.js"
             data-chatbot-id="<agent uuid>"
             data-color="#f59e0b"
             data-position="right"></script>
*/
(function () {
  if (window.__VA_CHATBOT_LOADED__) return;
  window.__VA_CHATBOT_LOADED__ = true;

  // ── 1. Resolve config from <script> tag ────────────────────────────────
  var script = document.currentScript ||
    (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var origin = (function () { try { return new URL(script.src).origin; } catch (e) { return ''; } })();
  var chatbotId = script.getAttribute('data-chatbot-id') || '';
  var color = script.getAttribute('data-color') || '#f59e0b';
  var position = (script.getAttribute('data-position') || 'right').toLowerCase() === 'left' ? 'left' : 'right';
  if (!chatbotId) { console.warn('[widget] missing data-chatbot-id'); return; }

  // ── 2. Inject styles ────────────────────────────────────────────────────
  var css = ''
    + '.va-cb{position:fixed;bottom:24px;' + position + ':24px;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
    + '.va-cb-btn{display:flex;align-items:center;gap:8px;padding:12px 16px 12px 14px;border-radius:9999px;background:linear-gradient(135deg,' + color + ',' + shade(color, -15) + ');color:#fff;border:0;cursor:pointer;box-shadow:0 10px 40px -10px rgba(0,0,0,.3);font-size:14px;font-weight:600;transition:transform .15s ease}'
    + '.va-cb-btn:hover{transform:translateY(-2px)}'
    + '.va-cb-btn svg{width:20px;height:20px}'
    + '.va-cb-panel{position:fixed;bottom:24px;' + position + ':24px;width:min(380px,calc(100vw - 32px));height:min(600px,calc(100vh - 80px));border-radius:20px;background:#fff;box-shadow:0 20px 60px -20px rgba(0,0,0,.4);display:none;flex-direction:column;overflow:hidden;z-index:2147483647}'
    + '.va-cb-panel.open{display:flex;animation:va-cb-in .25s ease}'
    + '@keyframes va-cb-in{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}'
    + '.va-cb-hd{padding:14px 16px;background:linear-gradient(135deg,' + color + ',' + shade(color, -15) + ');color:#fff;display:flex;justify-content:space-between;align-items:center}'
    + '.va-cb-hd-l{display:flex;align-items:center;gap:10px;min-width:0}'
    + '.va-cb-av{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0}'
    + '.va-cb-av svg{width:20px;height:20px}'
    + '.va-cb-nm{font-size:14px;font-weight:600;line-height:1.2}'
    + '.va-cb-st{font-size:11px;opacity:.85;display:flex;align-items:center;gap:4px;margin-top:2px}'
    + '.va-cb-st::before{content:"";width:6px;height:6px;border-radius:9999px;background:#34d399;animation:va-cb-pulse 1.5s ease-in-out infinite}'
    + '@keyframes va-cb-pulse{0%,100%{opacity:1}50%{opacity:.4}}'
    + '.va-cb-x{background:rgba(255,255,255,.15);border:0;color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center}'
    + '.va-cb-x:hover{background:rgba(255,255,255,.25)}'
    + '.va-cb-bd{flex:1;overflow-y:auto;padding:14px;background:#fafafa;display:flex;flex-direction:column;gap:8px}'
    + '.va-cb-msg{display:flex;gap:8px;max-width:85%}'
    + '.va-cb-msg.u{align-self:flex-end}.va-cb-msg.b{align-self:flex-start}'
    + '.va-cb-bub{padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.45;word-wrap:break-word;white-space:pre-wrap}'
    + '.va-cb-msg.u .va-cb-bub{background:' + color + ';color:#fff;border-bottom-right-radius:4px}'
    + '.va-cb-msg.b .va-cb-bub{background:#fff;border:1px solid #e5e7eb;color:#1f2937;border-bottom-left-radius:4px}'
    + '.va-cb-bub a{color:inherit;text-decoration:underline}'
    + '.va-cb-typing{display:flex;gap:4px;padding:9px 13px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;border-bottom-left-radius:4px;width:fit-content}'
    + '.va-cb-typing span{width:6px;height:6px;border-radius:9999px;background:#9ca3af;animation:va-cb-bounce 1.4s infinite ease-in-out}'
    + '.va-cb-typing span:nth-child(2){animation-delay:.16s}.va-cb-typing span:nth-child(3){animation-delay:.32s}'
    + '@keyframes va-cb-bounce{0%,80%,100%{transform:scale(.6);opacity:.5}40%{transform:scale(1);opacity:1}}'
    + '.va-cb-fm{padding:10px;border-top:1px solid #e5e7eb;background:#fff;display:flex;gap:8px;align-items:flex-end}'
    + '.va-cb-in{flex:1;border:1px solid #e5e7eb;border-radius:14px;padding:9px 12px;font-size:14px;font-family:inherit;outline:0;resize:none;max-height:100px}'
    + '.va-cb-in:focus{border-color:' + color + '}'
    + '.va-cb-sd{width:38px;height:38px;border-radius:12px;background:' + color + ';color:#fff;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
    + '.va-cb-sd:disabled{opacity:.4;cursor:not-allowed}'
    + '.va-cb-sd svg{width:16px;height:16px}'
    + '.va-cb-br{padding:6px;font-size:10px;color:#9ca3af;text-align:center;background:#fff;border-top:1px solid #f3f4f6}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── 3. Build DOM ────────────────────────────────────────────────────────
  var SVG_BOT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/></svg>';
  var SVG_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2L15 22 11 13 2 9 22 2z"/></svg>';

  var btn = el('button', 'va-cb-btn');
  btn.innerHTML = SVG_BOT + '<span>Chat with us</span>';
  btn.setAttribute('aria-label', 'Open chat');

  var panel = el('div', 'va-cb-panel');
  panel.innerHTML = ''
    + '<div class="va-cb-hd">'
    +   '<div class="va-cb-hd-l">'
    +     '<div class="va-cb-av">' + SVG_BOT + '</div>'
    +     '<div><div class="va-cb-nm" data-cb-name>Assistant</div><div class="va-cb-st">Online</div></div>'
    +   '</div>'
    +   '<button class="va-cb-x" aria-label="Close" data-cb-close>' + SVG_X + '</button>'
    + '</div>'
    + '<div class="va-cb-bd" data-cb-body></div>'
    + '<form class="va-cb-fm" data-cb-form>'
    +   '<textarea class="va-cb-in" data-cb-in placeholder="Type your message..." rows="1"></textarea>'
    +   '<button type="submit" class="va-cb-sd" data-cb-send>' + SVG_SEND + '</button>'
    + '</form>'
    + '<div class="va-cb-br">Powered by AI · Replies may be inaccurate</div>';

  var root = el('div', 'va-cb');
  root.appendChild(btn);
  root.appendChild(panel);
  document.body.appendChild(root);

  var body = panel.querySelector('[data-cb-body]');
  var form = panel.querySelector('[data-cb-form]');
  var input = panel.querySelector('[data-cb-in]');
  var sendBtn = panel.querySelector('[data-cb-send]');
  var closeBtn = panel.querySelector('[data-cb-close]');
  var nameEl = panel.querySelector('[data-cb-name]');

  // ── 4. State ────────────────────────────────────────────────────────────
  var conversationId = null;
  var visitorId = getOrCreateVisitorId();
  var busy = false;

  // ── 5. Wire up events ───────────────────────────────────────────────────
  btn.addEventListener('click', function () {
    panel.classList.add('open');
    btn.style.display = 'none';
    if (!body.children.length) loadAgentAndGreet();
    setTimeout(function () { input.focus(); }, 50);
  });
  closeBtn.addEventListener('click', function () {
    panel.classList.remove('open');
    btn.style.display = 'flex';
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ── 6. Functions ────────────────────────────────────────────────────────
  function loadAgentAndGreet() {
    fetch(origin + '/widget/agent/' + chatbotId)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (agent) {
        if (!agent) {
          appendMsg('b', 'Sorry, this chatbot is unavailable right now.');
          return;
        }
        if (agent.name) nameEl.textContent = agent.name;
        var greet = agent.greeting_message ||
          ((agent.metadata || {}).chatbot_config || {}).welcome_message ||
          'Hi! How can I help you today?';
        appendMsg('b', greet);
      })
      .catch(function () {
        appendMsg('b', 'Hi! How can I help you today?');
      });
  }

  function send() {
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;
    appendMsg('u', text);
    input.value = '';
    setBusy(true);
    var typing = appendTyping();

    fetch(origin + '/widget/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: chatbotId,
        message: text,
        conversation_id: conversationId,
        visitor_id: visitorId,
        channel: 'chat',
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data.conversation_id) conversationId = data.conversation_id;
        typing.remove();
        appendMsg('b', data.reply || '(no reply)');
      })
      .catch(function () {
        typing.remove();
        appendMsg('b', 'Sorry, something went wrong. Please try again.');
      })
      .then(function () { setBusy(false); input.focus(); });
  }

  function appendMsg(who, text) {
    var m = el('div', 'va-cb-msg ' + who);
    var b = el('div', 'va-cb-bub');
    b.innerHTML = renderText(text);
    m.appendChild(b);
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }
  function appendTyping() {
    var m = el('div', 'va-cb-msg b');
    var t = el('div', 'va-cb-typing');
    t.innerHTML = '<span></span><span></span><span></span>';
    m.appendChild(t);
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }
  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function getOrCreateVisitorId() {
    try {
      var k = 'va-cb-vid';
      var v = localStorage.getItem(k);
      if (!v) {
        v = 'v-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return 'v-' + Math.random().toString(36).slice(2, 10); }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Renders **bold**, [text](url), and preserves newlines. Links open in new tab.
  function renderText(s) {
    var safe = escapeHtml(s);
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, label, href) {
      return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    return safe;
  }
  // Tiny color shade — accepts #rrggbb, returns shifted hex.
  function shade(hex, percent) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var num = parseInt(h, 16);
    var r = Math.max(0, Math.min(255, ((num >> 16) & 255) + percent));
    var g = Math.max(0, Math.min(255, ((num >> 8) & 255) + percent));
    var b = Math.max(0, Math.min(255, (num & 255) + percent));
    return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
})();
