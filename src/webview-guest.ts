export const MIN_GUEST_HEIGHT = 80;

export function guestViewportPx(hostHeight: number): number {
	const h = Math.floor(hostHeight);
	return h >= MIN_GUEST_HEIGHT ? h : 0;
}

export function wereadHeightCss(): string {
	return `
html, body, #app, .readerContent, .readerContainer {
  height: 100% !important;
  max-height: 100% !important;
  overflow: hidden !important;
}
.readerContent .app_content,
.app_content {
  height: 100% !important;
  max-height: 100% !important;
  min-height: 0 !important;
  box-sizing: border-box !important;
}
.readerChapterContent,
.readerChapterContent_container,
.renderTargetContainer {
  height: calc(100% - 64px) !important;
  max-height: calc(100% - 64px) !important;
  min-height: 0 !important;
}
`.trim();
}

export function wereadHeightScript(hostHeight: number): string {
	const h = guestViewportPx(hostHeight);
	if (!h) return "";
	return `(function(h){
  if (!h) return;
  try {
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: function(){ return h; } });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: function(){ return h; } });
  } catch (e) {}
  var apply = function(){
    var bar = document.querySelector('.readerTopBar');
    var top = bar ? Math.round(bar.getBoundingClientRect().height) : 64;
    var contentH = Math.max(120, h - top);
    document.documentElement.style.setProperty('height', h + 'px', 'important');
    document.documentElement.style.setProperty('max-height', h + 'px', 'important');
    document.body.style.setProperty('height', h + 'px', 'important');
    document.body.style.setProperty('max-height', h + 'px', 'important');
    document.body.style.setProperty('overflow', 'hidden', 'important');
    var app = document.querySelector('.readerContent .app_content') || document.querySelector('.app_content');
    if (app) {
      app.style.setProperty('height', h + 'px', 'important');
      app.style.setProperty('max-height', h + 'px', 'important');
    }
    document.querySelectorAll('.readerChapterContent, .readerChapterContent_container, .renderTargetContainer').forEach(function(n){
      n.style.setProperty('height', contentH + 'px', 'important');
      n.style.setProperty('max-height', contentH + 'px', 'important');
    });
    window.dispatchEvent(new Event('resize'));
  };
  apply();
  setTimeout(apply, 80);
  setTimeout(apply, 400);
  setTimeout(apply, 1200);
})(${h});`;
}

export function keepInGuestScript(): string {
	return `(function(){
  if (window.__zreadStay) return;
  window.__zreadStay = true;
  window.open = function(url){
    if (url) location.assign(String(url));
    return window;
  };
  var goReader = function(){
    if (window.__zreadJumped) return;
    document.querySelectorAll('a[target="_blank"]').forEach(function(a){ a.removeAttribute('target'); });
    if (!/\\/page\\//.test(location.pathname)) return;
    var link = document.querySelector('a[href*="/reader/"]');
    if (link && link.href) {
      window.__zreadJumped = true;
      location.assign(link.href);
      return;
    }
    var nodes = document.querySelectorAll('a,button');
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].textContent || "").replace(/\\s+/g, "");
      if (t === "阅读" || t === "开始阅读" || t === "立即阅读") {
        window.__zreadJumped = true;
        nodes[i].click();
        return;
      }
    }
  };
  goReader();
  new MutationObserver(goReader).observe(document.documentElement, { childList: true, subtree: true });
})();`;
}
